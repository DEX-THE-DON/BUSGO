"""
Automated Cron & Background Sweeper Suite for BUSGO.

This module handles:
1. sweep_expired_pending_bookings: Cancels unpaid seat bookings older than 5 minutes,
   recomputes the corridor seat chain, frees the seat on the live map, and notifies waitlists.
2. sweep_expired_waitlist_windows: Expires 5-minute priority claim windows for notified waitlists,
   freeing the slot for the next passenger in line.
3. auto_complete_arrived_trips: Automatically marks trips as 'completed' when the vehicle reaches
   the final route stop.
4. sweep_upcoming_departure_reminders: Automatically dispatches SMS/WhatsApp alerts for trips departing in < 30 mins.
5. In-process asyncio cron worker loop running every 60 seconds.
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db import AsyncSessionLocal
from backend.ws import manager
from backend.chains import (
    recompute_chain,
    notify_chain_change,
    trip_stop_names,
    create_notification,
)
from backend import dispatch
from backend import reconciliation

logger = logging.getLogger("busgo.crons")
logger.setLevel(logging.INFO)

# Global tracker for admin observability
CRON_STATS: Dict[str, Any] = {
    "status": "running",
    "worker_running": False,
    "last_run": None,
    "runs_count": 0,
    "total_swept_bookings": 0,
    "total_reconciled_confirmed": 0,
    "total_reconciled_refunded": 0,
    "total_expired_waitlists": 0,
    "total_completed_trips": 0,
    "total_reminders_dispatched": 0,
    "last_error": None,
    "last_results": {},
}

_cron_task: Optional[asyncio.Task] = None


async def sweep_expired_pending_bookings(db: AsyncSession, max_age_minutes: int = 5) -> Dict[str, Any]:
    """
    Cancel pending reservations where the user failed to complete payment within max_age_minutes.
    Before cancelling, actively queries Daraja/Paystack gateway to guarantee that delayed
    callbacks do NOT lead to stranded payments or false cancellations.
    """
    query = text(f"""
        SELECT b.id, b.trip_id, b.seat_number, b.board_stop_order, b.alight_stop_order,
               b.user_id, b.status, b.payment_status, b.created_at,
               t.name AS trip_name
        FROM bookings b
        JOIN trips t ON t.id = b.trip_id
        WHERE b.status = 'pending'
          AND b.created_at < (NOW() - INTERVAL '{max_age_minutes} minutes')
        ORDER BY b.id ASC;
    """)
    result = await db.execute(query)
    expired_bookings = [dict(r) for r in result.mappings().all()]

    swept_ids: List[int] = []
    reconciled_confirmed_ids: List[int] = []
    reconciled_refund_ids: List[int] = []

    for b in expired_bookings:
        b_id = b["id"]
        trip_id = b["trip_id"]
        seat_num = b["seat_number"]
        user_id = b["user_id"]
        trip_name = b["trip_name"] or f"Trip #{trip_id}"

        # 1. Actively query payment gateway before blindly cancelling
        try:
            recon = await reconciliation.reconcile_booking_payment(db, b_id)
            action = recon.get("action")
            if action in ("confirmed", "resurrected_and_confirmed"):
                reconciled_confirmed_ids.append(b_id)
                CRON_STATS["total_reconciled_confirmed"] = CRON_STATS.get("total_reconciled_confirmed", 0) + 1
                logger.info(f"[CRON] Reconciled and auto-confirmed pending booking #{b_id} (Receipt: {recon.get('receipt_number')})")
                continue
            elif action == "refund_queued":
                reconciled_refund_ids.append(b_id)
                CRON_STATS["total_reconciled_refunded"] = CRON_STATS.get("total_reconciled_refunded", 0) + 1
                logger.warning(f"[CRON] Booking #{b_id} was paid late; seat was taken, refund reversal queued.")
                continue
            elif action == "cancelled_due_to_gateway":
                swept_ids.append(b_id)
                continue
        except Exception as e:
            logger.warning(f"[CRON] Active payment gateway check failed for #{b_id}: {e}")

        # 2. Fallback: Safe cancellation if no payment was made
        await db.execute(
            text("UPDATE bookings SET status = 'cancelled', payment_status = 'unpaid' WHERE id = :id;"),
            {"id": b_id}
        )

        await db.execute(
            text("""
                UPDATE payments
                SET status = 'failed',
                    provider_payload = jsonb_build_object('reason', 'reservation_timeout_expired')
                WHERE booking_id = :bid AND status = 'initiated';
            """),
            {"bid": b_id}
        )

        await db.commit()

        # 3. Recompute chain & notify waitlist for freed corridor gap
        stop_names = await trip_stop_names(db, trip_id)
        chain = await recompute_chain(db, trip_id, seat_num)
        await notify_chain_change(db, manager, trip_id, seat_num, chain, stop_names)

        # 4. Broadcast live seat_freed / booking_cancelled event to all viewers on this trip
        await manager.broadcast_trip(trip_id, {
            "event": "booking_cancelled",
            "trip_id": trip_id,
            "seat_number": seat_num,
            "booking_id": b_id,
            "reason": "expired_timeout",
        })

        # 5. Push user in-app notification
        if user_id:
            await create_notification(
                db,
                user_id,
                "booking_expired",
                "Reservation Expired",
                f"Your reservation for Seat #{seat_num} on {trip_name} expired before payment. The seat has been released.",
                {"trip_id": trip_id, "seat_number": seat_num, "booking_id": b_id},
            )
            await db.commit()

        swept_ids.append(b_id)
        logger.info(f"[CRON] Swept uncompleted booking #{b_id} (Trip #{trip_id}, Seat #{seat_num})")

    return {
        "swept_count": len(swept_ids),
        "swept_booking_ids": swept_ids,
        "reconciled_confirmed_count": len(reconciled_confirmed_ids),
        "reconciled_confirmed_ids": reconciled_confirmed_ids,
        "reconciled_refund_count": len(reconciled_refund_ids),
        "reconciled_refund_ids": reconciled_refund_ids,
    }


async def sweep_expired_waitlist_windows(db: AsyncSession, max_age_minutes: int = 5) -> Dict[str, Any]:
    """
    Sweeps seat_interests where the user was notified of an open seat, but did not claim
    it within max_age_minutes. Marks as 'expired' and offers the gap to the next waitlisted passenger.
    """
    query = text(f"""
        SELECT si.id, si.user_id, si.trip_id, si.board_stop_order, si.alight_stop_order,
               si.seat_number, si.notified_at
        FROM seat_interests si
        WHERE si.status = 'notified'
          AND si.notified_at IS NOT NULL
          AND si.notified_at < (NOW() - INTERVAL '{max_age_minutes} minutes')
        ORDER BY si.id ASC;
    """)
    result = await db.execute(query)
    expired_interests = [dict(r) for r in result.mappings().all()]

    expired_ids: List[int] = []

    for item in expired_interests:
        i_id = item["id"]
        trip_id = item["trip_id"]
        seat_num = item["seat_number"]
        user_id = item["user_id"]

        # Mark interest as expired
        await db.execute(
            text("UPDATE seat_interests SET status = 'expired' WHERE id = :id;"),
            {"id": i_id}
        )
        await db.commit()

        # In-app notification
        if user_id:
            await create_notification(
                db,
                user_id,
                "waitlist_window_expired",
                "Waitlist Window Passed",
                f"Your 5-minute priority claim window for Trip #{trip_id} has expired and was offered to the next passenger.",
                {"trip_id": trip_id, "interest_id": i_id},
            )
            await db.commit()

        # Re-trigger chain notification for this seat so the next waitlisted person gets notified
        if seat_num:
            stop_names = await trip_stop_names(db, trip_id)
            chain = await recompute_chain(db, trip_id, seat_num)
            await notify_chain_change(db, manager, trip_id, seat_num, chain, stop_names)

        expired_ids.append(i_id)
        logger.info(f"[CRON] Expired waitlist window #{i_id} (Trip #{trip_id})")

    return {
        "expired_count": len(expired_ids),
        "expired_interest_ids": expired_ids,
    }


async def auto_complete_arrived_trips(db: AsyncSession) -> Dict[str, Any]:
    """
    Checks active trips (boarding / in_transit) and marks them 'completed' if the
    vehicle has reached the final stop of its route.
    """
    query = text("""
        SELECT t.id, t.name, t.status, t.current_stop_order,
               (SELECT MAX(stop_order) FROM route_stops rs WHERE rs.route_id = t.route_id) AS max_stop_order
        FROM trips t
        WHERE t.status IN ('in_transit', 'boarding')
          AND t.current_stop_order IS NOT NULL;
    """)
    result = await db.execute(query)
    active_trips = [dict(r) for r in result.mappings().all()]

    completed_ids: List[int] = []

    for t in active_trips:
        max_stop = t["max_stop_order"]
        current_stop = t["current_stop_order"]

        if max_stop and current_stop >= max_stop:
            trip_id = t["id"]
            await db.execute(
                text("UPDATE trips SET status = 'completed' WHERE id = :id;"),
                {"id": trip_id}
            )
            await db.commit()

            # Broadcast trip completion to WebSocket listeners
            await manager.broadcast_trip(trip_id, {
                "event": "trip_completed",
                "trip_id": trip_id,
                "status": "completed",
                "message": f"Trip #{trip_id} reached final stop ({current_stop}/{max_stop}) and is now completed."
            })
            completed_ids.append(trip_id)
            logger.info(f"[CRON] Auto-completed Trip #{trip_id} at final stop {current_stop}/{max_stop}")

    return {
        "completed_count": len(completed_ids),
        "completed_trip_ids": completed_ids,
    }


async def sweep_upcoming_departure_reminders(db: AsyncSession, window_minutes: int = 30) -> Dict[str, Any]:
    """
    Sends automated departure reminder (SMS & WhatsApp) to confirmed passengers
    whose trip departs within window_minutes and haven't yet received a reminder.
    """
    query = text(f"""
        SELECT b.id AS booking_id, b.trip_id, b.user_id, u.phone AS passenger_phone
        FROM bookings b
        JOIN trips t ON t.id = b.trip_id
        JOIN users u ON u.id = b.user_id
        WHERE b.status = 'confirmed'
          AND t.status IN ('scheduled', 'boarding')
          AND t.scheduled_at IS NOT NULL
          AND t.scheduled_at > NOW()
          AND t.scheduled_at <= (NOW() + INTERVAL '{window_minutes} minutes')
          AND NOT EXISTS (
              SELECT 1 FROM dispatches d
              WHERE d.booking_id = b.id
                AND d.message_body LIKE '%DEPARTURE REMINDER%'
          )
        LIMIT 20;
    """)
    result = await db.execute(query)
    candidates = [dict(r) for r in result.mappings().all()]

    reminded_ids: List[int] = []

    for c in candidates:
        b_id = c["booking_id"]
        # Trigger dispatch through dispatch module
        res = await dispatch.dispatch_booking_confirmation(
            db,
            booking_id=b_id,
            channels=["sms", "whatsapp"],
            override_phone=c.get("passenger_phone"),
        )
        if res.get("status") == "dispatched":
            reminded_ids.append(b_id)
            logger.info(f"[CRON] Dispatched departure reminder for Booking #{b_id}")

    return {
        "reminded_count": len(reminded_ids),
        "reminded_booking_ids": reminded_ids,
    }


async def sweep_ntsa_compliance_and_auto_ground(db: AsyncSession) -> Dict[str, Any]:
    """
    Automated NTSA Compliance & Auto-Grounding Sweeper.
    Scans all fleet vehicles and assigned drivers for:
    1. Expired Speed Governor Calibration
    2. Expired NTSA Annual Inspection Sticker
    3. Expired PSV Commercial Insurance Policy
    4. Expired Driver PSV Badge
    If non-compliant:
      - Automatically sets is_grounded = True and details exact grounded_reason.
      - Auto-suspends scheduled/boarding trips assigned to this vehicle.
      - Dispatches instant SMS alerts to Vehicle Owner and Sacco Management.
    If compliant:
      - Automatically restores previously auto-grounded vehicles to active service.
    """
    now = datetime.now(timezone.utc)
    now_plus_30 = now + timedelta(days=30)

    query = text("""
        SELECT v.id AS vehicle_id, v.plate_number, v.sacco_id, v.driver_id,
               v.owner_id, v.owner_name, v.owner_phone,
               s.name AS sacco_name, s.contact_phone AS sacco_phone,
               vc.id AS compliance_id,
               vc.speed_governor_vendor, vc.speed_governor_cert, vc.speed_governor_expiry,
               vc.ntsa_inspection_cert, vc.ntsa_inspection_expiry,
               vc.insurance_underwriter, vc.insurance_policy_no, vc.insurance_expiry,
               COALESCE(vc.is_grounded, false) AS is_grounded,
               vc.grounded_reason,
               u.full_name AS driver_name, u.phone AS driver_phone,
               u.psv_badge_number, u.psv_badge_expiry
        FROM vehicles v
        LEFT JOIN vehicle_compliance vc ON vc.vehicle_id = v.id
        LEFT JOIN saccos s ON s.id = v.sacco_id
        LEFT JOIN users u ON u.id = v.driver_id
        ORDER BY v.id ASC;
    """)
    rows = (await db.execute(query)).mappings().all()

    newly_grounded = []
    cleared = []
    warnings = []
    total_suspended_trips = 0

    def to_utc(val):
        if val is None:
            return None
        if isinstance(val, str):
            try:
                val = datetime.fromisoformat(val.replace("Z", "+00:00"))
            except Exception:
                return None
        if hasattr(val, "tzinfo") and val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        return val

    for row in rows:
        vid = row["vehicle_id"]
        plate = row["plate_number"]
        violations = []
        item_warnings = []

        gov_exp = to_utc(row["speed_governor_expiry"])
        ntsa_exp = to_utc(row["ntsa_inspection_expiry"])
        ins_exp = to_utc(row["insurance_expiry"])
        psv_exp = to_utc(row["psv_badge_expiry"])

        # 1. Speed Governor Check
        if not gov_exp:
            violations.append("Missing Speed Governor Calibration")
        elif gov_exp < now:
            days_ago = max(1, (now - gov_exp).days)
            violations.append(f"Expired Speed Governor ({days_ago}d overdue)")
        elif gov_exp < now_plus_30:
            days_left = max(0, (gov_exp - now).days)
            item_warnings.append(f"Speed Governor expires in {days_left}d")

        # 2. NTSA Inspection Sticker Check
        if not ntsa_exp:
            violations.append("Missing NTSA Inspection Certificate")
        elif ntsa_exp < now:
            days_ago = max(1, (now - ntsa_exp).days)
            violations.append(f"Expired NTSA Annual Inspection ({days_ago}d overdue)")
        elif ntsa_exp < now_plus_30:
            days_left = max(0, (ntsa_exp - now).days)
            item_warnings.append(f"NTSA Inspection expires in {days_left}d")

        # 3. PSV Insurance Policy Check
        if not ins_exp:
            violations.append("Missing PSV Insurance Policy")
        elif ins_exp < now:
            days_ago = max(1, (now - ins_exp).days)
            violations.append(f"Expired PSV Insurance ({days_ago}d overdue)")
        elif ins_exp < now_plus_30:
            days_left = max(0, (ins_exp - now).days)
            item_warnings.append(f"PSV Insurance expires in {days_left}d")

        # 4. Assigned Driver PSV Badge Check
        if row["driver_id"]:
            if not psv_exp:
                violations.append(f"Assigned Driver {row['driver_name'] or 'PSV Driver'} lacks PSV Badge")
            elif psv_exp < now:
                days_ago = max(1, (now - psv_exp).days)
                violations.append(f"Driver {row['driver_name'] or 'PSV Driver'} PSV Badge Expired ({days_ago}d overdue)")
            elif psv_exp < now_plus_30:
                days_left = max(0, (psv_exp - now).days)
                item_warnings.append(f"Driver PSV Badge expires in {days_left}d")

        if item_warnings:
            warnings.append({"plate": plate, "vehicle_id": vid, "warnings": item_warnings})

        # Violation detected => AUTO-GROUND
        if violations:
            reason_text = "NTSA AUTO-GROUNDED: " + "; ".join(violations)
            is_new_grounding = not row["is_grounded"]

            if row["compliance_id"]:
                await db.execute(
                    text("""
                        UPDATE vehicle_compliance
                        SET is_grounded = true, grounded_reason = :reason, updated_at = :now
                        WHERE vehicle_id = :vid;
                    """),
                    {"reason": reason_text, "now": now, "vid": vid}
                )
            else:
                await db.execute(
                    text("""
                        INSERT INTO vehicle_compliance (vehicle_id, is_grounded, grounded_reason, updated_at)
                        VALUES (:vid, true, :reason, :now);
                    """),
                    {"vid": vid, "reason": reason_text, "now": now}
                )

            # Auto-suspend upcoming trips assigned to this vehicle
            t_res = await db.execute(
                text("""
                    UPDATE trips
                    SET status = 'grounded'
                    WHERE vehicle_id = :vid AND status IN ('scheduled', 'boarding')
                    RETURNING id, name;
                """),
                {"vid": vid}
            )
            suspended_trips = t_res.mappings().all()
            total_suspended_trips += len(suspended_trips)

            if is_new_grounding:
                newly_grounded.append({
                    "vehicle_id": vid,
                    "plate_number": plate,
                    "sacco_name": row["sacco_name"],
                    "reason": reason_text,
                    "suspended_trips": [dict(t) for t in suspended_trips],
                })
                logger.warning(f"[NTSA SWEEPER] Auto-grounded vehicle {plate}: {reason_text}")

                try:
                    await manager.broadcast({
                        "event": "vehicle_grounded",
                        "vehicle_id": vid,
                        "plate_number": plate,
                        "reason": reason_text,
                        "suspended_trips_count": len(suspended_trips),
                    })
                except Exception as b_err:
                    logger.warning(f"Failed to broadcast grounding WS: {b_err}")

                sms_targets = set(filter(None, [row["owner_phone"], row["sacco_phone"]]))
                alert_msg = (
                    f"BUSGO NTSA ALERT: Vehicle {plate} has been AUTO-GROUNDED. "
                    f"Violations: {'; '.join(violations[:2])}. "
                    f"All scheduled trips suspended. Renew certifications to restore."
                )
                for ph in sms_targets:
                    try:
                        await dispatch.send_sms_gateway(ph, alert_msg)
                    except Exception as s_err:
                        logger.warning(f"Failed to send compliance SMS to {ph}: {s_err}")

        else:
            # Compliant: If previously auto-grounded, restore to service!
            prev_reason = row["grounded_reason"] or ""
            if row["is_grounded"] and "NTSA AUTO-GROUNDED:" in prev_reason:
                await db.execute(
                    text("""
                        UPDATE vehicle_compliance
                        SET is_grounded = false, grounded_reason = NULL, updated_at = :now
                        WHERE vehicle_id = :vid;
                    """),
                    {"now": now, "vid": vid}
                )
                cleared.append({"vehicle_id": vid, "plate_number": plate})
                logger.info(f"[NTSA SWEEPER] Auto-cleared vehicle {plate} for active transit service.")

                try:
                    await manager.broadcast({
                        "event": "vehicle_cleared",
                        "vehicle_id": vid,
                        "plate_number": plate,
                    })
                except Exception:
                    pass

                sms_targets = set(filter(None, [row["owner_phone"], row["sacco_phone"]]))
                clear_msg = f"BUSGO NTSA NOTICE: Vehicle {plate} certifications verified compliant. CLEARED for active passenger service."
                for ph in sms_targets:
                    try:
                        await dispatch.send_sms_gateway(ph, clear_msg)
                    except Exception:
                        pass

    await db.commit()

    return {
        "timestamp": now.isoformat(),
        "total_vehicles_checked": len(rows),
        "auto_grounded_count": len(newly_grounded),
        "auto_cleared_count": len(cleared),
        "suspended_trips_count": total_suspended_trips,
        "warnings_count": len(warnings),
        "grounded_vehicles": newly_grounded,
        "cleared_vehicles": cleared,
        "warnings": warnings,
    }


async def run_all_crons(db: AsyncSession) -> Dict[str, Any]:
    """
    Executes a single pass of all automated background sweeps.
    Used by both the periodic worker and the manual admin trigger endpoint.
    """
    global CRON_STATS

    from backend.locks import seat_lock_manager
    expired_locks = await seat_lock_manager.sweep_and_get_expired()
    for l in expired_locks:
        try:
            await manager.broadcast_trip(l.trip_id, {
                "event": "seat_unlocked",
                "trip_id": l.trip_id,
                "seat_number": l.seat_number,
                "reason": "lock_expired",
            })
        except Exception as e:
            logger.warning(f"Error broadcasting seat unlock for trip {l.trip_id}: {e}")

    results = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "expired_seat_locks": len(expired_locks),
        "pending_sweeper": await sweep_expired_pending_bookings(db),
        "waitlist_sweeper": await sweep_expired_waitlist_windows(db),
        "trip_completer": await auto_complete_arrived_trips(db),
        "departure_reminders": await sweep_upcoming_departure_reminders(db),
        "ntsa_compliance_sweeper": await sweep_ntsa_compliance_and_auto_ground(db),
    }

    CRON_STATS["last_run"] = results["timestamp"]
    CRON_STATS["runs_count"] += 1
    CRON_STATS["total_swept_bookings"] += results["pending_sweeper"]["swept_count"]
    CRON_STATS["total_expired_waitlists"] += results["waitlist_sweeper"]["expired_count"]
    CRON_STATS["total_completed_trips"] += results["trip_completer"]["completed_count"]
    CRON_STATS["total_reminders_dispatched"] += results["departure_reminders"]["reminded_count"]
    CRON_STATS["total_auto_grounded"] = CRON_STATS.get("total_auto_grounded", 0) + results["ntsa_compliance_sweeper"]["auto_grounded_count"]
    CRON_STATS["total_auto_cleared"] = CRON_STATS.get("total_auto_cleared", 0) + results["ntsa_compliance_sweeper"]["auto_cleared_count"]
    CRON_STATS["last_results"] = results
    CRON_STATS["last_error"] = None

    return results


async def cron_worker_loop(interval_seconds: int = 60):
    """
    Continuous background loop that wakes up every interval_seconds.
    Safe against uncaught exceptions to ensure the worker never crashes.
    """
    global CRON_STATS
    CRON_STATS["worker_running"] = True
    logger.info(f"[CRON] Worker started with {interval_seconds}s interval.")

    while True:
        try:
            async with AsyncSessionLocal() as session:
                await run_all_crons(session)
        except asyncio.CancelledError:
            logger.info("[CRON] Worker received shutdown cancellation.")
            CRON_STATS["worker_running"] = False
            break
        except Exception as exc:
            logger.error(f"[CRON ERROR] In background sweep: {exc}", exc_info=True)
            CRON_STATS["last_error"] = str(exc)

        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            logger.info("[CRON] Worker received shutdown during sleep.")
            CRON_STATS["worker_running"] = False
            break


def start_cron_worker(interval_seconds: int = 60) -> asyncio.Task:
    """Spawns the background asyncio cron task if not already running."""
    global _cron_task
    if _cron_task is None or _cron_task.done():
        _cron_task = asyncio.create_task(cron_worker_loop(interval_seconds=interval_seconds))
    return _cron_task


def stop_cron_worker():
    """Gracefully cancels the background worker task."""
    global _cron_task
    if _cron_task and not _cron_task.done():
        _cron_task.cancel()

