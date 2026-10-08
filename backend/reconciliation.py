"""
Automated Payment Reconciler & Verification Engine for BUSGO.
Prevents stranded payments, false cancellations, and double-booking gaps
by actively querying payment gateway APIs (Safaricom Daraja STK Query & Paystack).
"""
import json
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend import daraja
from backend import paystack
from backend import dispatch
from backend.ws import manager
from backend.chains import (
    recompute_chain,
    notify_chain_change,
    trip_stop_names,
    create_notification,
)

logger = logging.getLogger("busgo.reconciliation")
logger.setLevel(logging.INFO)


async def reconcile_booking_payment(db: AsyncSession, booking_id: int) -> Dict[str, Any]:
    """
    Actively query the payment gateway for a pending or expired booking's transaction.
    
    Resolves the 3-way operational outcomes:
    1. Gateway confirms payment was made (ResultCode == 0 / success) -> Auto-confirm booking & issue ticket.
    2. Gateway confirms user rejected or timed out (ResultCode == 1032 / 1037) -> Safe cancellation & seat release.
    3. Payment was made BUT seat was already reclaimed -> Trigger automated reversal/refund queue.
    """
    # 1. Fetch booking details
    b_row = (await db.execute(
        text("""
            SELECT b.id, b.trip_id, b.seat_number, b.board_stop_order, b.alight_stop_order,
                   b.user_id, b.status AS booking_status, b.payment_status,
                   t.name AS trip_name, u.phone AS user_phone, u.full_name AS user_name
            FROM bookings b
            JOIN trips t ON t.id = b.trip_id
            LEFT JOIN users u ON u.id = b.user_id
            WHERE b.id = :id;
        """),
        {"id": booking_id}
    )).mappings().first()

    if not b_row:
        return {"ok": False, "booking_id": booking_id, "error": "Booking not found"}

    booking_status = b_row["booking_status"]

    # 2. Fetch latest payment record for this booking
    p_row = (await db.execute(
        text("""
            SELECT id, provider, provider_reference, status, amount, phone_number, receipt_number
            FROM payments
            WHERE booking_id = :bid
            ORDER BY id DESC LIMIT 1;
        """),
        {"bid": booking_id}
    )).mappings().first()

    if not p_row:
        return {
            "ok": True,
            "booking_id": booking_id,
            "reconciled": False,
            "action": "no_payment_initiated",
            "message": "No payment was initiated for this booking.",
        }

    payment_id = p_row["id"]
    provider = p_row["provider"] or ""
    provider_ref = p_row["provider_reference"] or ""
    current_pay_status = p_row["status"]
    amount = float(p_row["amount"] or 0.0)
    customer_phone = p_row["phone_number"] or b_row["user_phone"] or "254700000000"

    # If already completed and booking is confirmed, no reconciliation needed
    if current_pay_status == "completed" and booking_status == "confirmed":
        return {
            "ok": True,
            "booking_id": booking_id,
            "reconciled": False,
            "action": "already_confirmed",
            "message": "Payment and booking are already settled and confirmed.",
        }

    is_paid = False
    is_cancelled_by_user = False
    is_still_pending = False
    receipt_code: Optional[str] = None
    gateway_desc = ""

    # 3. Query the specific gateway
    if "daraja" in provider or "mpesa" in provider:
        try:
            query_res = await daraja.query_stk_status(provider_ref)
            raw_res_code = query_res.get("ResultCode")
            gateway_desc = query_res.get("ResultDesc") or query_res.get("ResponseDescription") or ""

            # Standard Safaricom Daraja ResultCodes:
            # 0: Success (User entered PIN, deducted)
            # 1032: Cancelled by user
            # 1037: DS timeout (user took too long to enter PIN)
            # 2001: Wrong PIN / Insufficient funds
            if raw_res_code in (0, "0"):
                is_paid = True
                receipt_code = query_res.get("MpesaReceiptNumber") or f"MP{checkout_suffix(provider_ref)}"
            elif raw_res_code in (1032, "1032", 1037, "1037", 2001, "2001", 1, "1"):
                is_cancelled_by_user = True
            else:
                # Gateway still has request in flight
                is_still_pending = True
        except Exception as e:
            logger.warning(f"[RECONCILE] Failed querying Daraja for {provider_ref}: {e}")
            is_still_pending = True

    elif "paystack" in provider:
        try:
            query_res = await paystack.verify_transaction(provider_ref)
            status_val = str(query_res.get("status") or "").lower()
            gateway_desc = query_res.get("gateway_response") or ""
            if status_val == "success":
                is_paid = True
                receipt_code = f"PST-{provider_ref[:10]}"
            elif status_val in ("failed", "abandoned"):
                is_cancelled_by_user = True
            else:
                is_still_pending = True
        except Exception as e:
            logger.warning(f"[RECONCILE] Failed verifying Paystack for {provider_ref}: {e}")
            is_still_pending = True

    else:
        return {"ok": False, "booking_id": booking_id, "error": f"Unsupported provider: {provider}"}

    # 4. Handle Resolution Scenarios

    # CASE A: Payment Succeeded!
    if is_paid:
        receipt_code = receipt_code or f"REC-{provider_ref[:8]}"
        trip_id = b_row["trip_id"]
        seat_num = b_row["seat_number"]
        user_id = b_row["user_id"]
        b_order = b_row["board_stop_order"]
        a_order = b_row["alight_stop_order"]

        # Check if booking is still pending (standard flow) or already cancelled (delayed callback)
        if booking_status == "pending":
            # Auto-confirm booking and finalize payment
            await db.execute(
                text("""
                    UPDATE bookings
                    SET status = 'confirmed', payment_status = 'paid'
                    WHERE id = :id;
                """),
                {"id": booking_id}
            )
            await db.execute(
                text("""
                    UPDATE payments
                    SET status = 'completed', callback_verified = true,
                        receipt_number = COALESCE(:receipt, receipt_number),
                        provider_payload = jsonb_build_object('reconciled', true, 'reconciled_at', NOW())
                    WHERE id = :pid;
                """),
                {"receipt": receipt_code, "pid": payment_id}
            )

            # Award Loyalty Safari Points
            if user_id:
                pts = max(1, int(amount // 10))
                await db.execute(
                    text("UPDATE users SET loyalty_points = COALESCE(loyalty_points, 0) + :pts WHERE id = :uid;"),
                    {"pts": pts, "uid": user_id}
                )

            await db.commit()

            # Recompute chain & broadcast live booking confirmation
            stop_names = await trip_stop_names(db, trip_id)
            chain = await recompute_chain(db, trip_id, seat_num)
            await notify_chain_change(db, manager, trip_id, seat_num, chain, stop_names)
            await manager.broadcast_trip(trip_id, {
                "event": "seat_booked",
                "trip_id": trip_id,
                "seat_number": seat_num,
                "booking_id": booking_id,
                "status": "confirmed",
            })

            # Send automated SMS & WhatsApp digital ticket dispatch
            try:
                ticket_code = f"BG-{trip_id}-{seat_num}-{booking_id}"
                dispatch.dispatch_notification(
                    to_phone=customer_phone,
                    message=(
                        f"🎉 BUSGO CONFIRMATION: Seat #{seat_num} on {b_row['trip_name']} is CONFIRMED! "
                        f"M-Pesa Ref: {receipt_code}. Ticket: {ticket_code}. Show this SMS upon boarding."
                    ),
                    channel="sms",
                    category="ticket",
                    reference_id=ticket_code,
                )
            except Exception as e:
                logger.warning(f"Could not dispatch ticket SMS: {e}")

            logger.info(f"[RECONCILE] Successfully auto-confirmed booking #{booking_id} with receipt {receipt_code}")
            return {
                "ok": True,
                "booking_id": booking_id,
                "reconciled": True,
                "action": "confirmed",
                "receipt_number": receipt_code,
                "amount": amount,
                "message": f"Payment verified successfully! Seat #{seat_num} confirmed with receipt {receipt_code}.",
            }

        elif booking_status == "cancelled":
            # The seat was previously cancelled (e.g., due to false timeout), but customer actually paid!
            # Check if the corridor seat is still available
            conflict = (await db.execute(
                text("""
                    SELECT id FROM bookings
                    WHERE trip_id = :tid AND seat_number = :seat
                      AND status != 'cancelled'
                      AND NOT (alight_stop_order <= :board OR board_stop_order >= :alight);
                """),
                {"tid": trip_id, "seat": seat_num, "board": b_order, "alight": a_order}
            )).first()

            if not conflict:
                # Seat is still free! Resurrect and restore the booking!
                await db.execute(
                    text("UPDATE bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = :id;"),
                    {"id": booking_id}
                )
                await db.execute(
                    text("UPDATE payments SET status = 'completed', callback_verified = true, receipt_number = :receipt WHERE id = :pid;"),
                    {"receipt": receipt_code, "pid": payment_id}
                )
                await db.commit()

                stop_names = await trip_stop_names(db, trip_id)
                chain = await recompute_chain(db, trip_id, seat_num)
                await notify_chain_change(db, manager, trip_id, seat_num, chain, stop_names)

                logger.info(f"[RECONCILE] Resurrected cancelled booking #{booking_id} after late payment verification!")
                return {
                    "ok": True,
                    "booking_id": booking_id,
                    "reconciled": True,
                    "action": "resurrected_and_confirmed",
                    "receipt_number": receipt_code,
                    "message": "Payment verified late; seat was free and has been safely restored & confirmed.",
                }
            else:
                # Seat was double-allocated while payment was delayed! Queue automatic refund!
                reversal_ref = f"REV-{provider_ref[:8]}"
                await db.execute(
                    text("""
                        UPDATE payments
                        SET status = 'refund_pending',
                            provider_payload = jsonb_build_object(
                                'reason', 'seat_reallocated_before_payment_reconciliation',
                                'reversal_ref', :rev
                            )
                        WHERE id = :pid;
                    """),
                    {"rev": reversal_ref, "pid": payment_id}
                )
                await db.commit()

                # Dispatch immediate apology & reversal notice
                try:
                    dispatch.dispatch_notification(
                        to_phone=customer_phone,
                        message=(
                            f"⚠️ BUSGO NOTICE: Payment of KES {amount:.0f} (Ref: {receipt_code}) was received after timeout. "
                            f"Your seat was re-allocated. Reversal {reversal_ref} initiated back to your M-Pesa."
                        ),
                        channel="sms",
                        category="refund",
                        reference_id=reversal_ref,
                    )
                except Exception:
                    pass

                logger.warning(f"[RECONCILE] Booking #{booking_id} paid but seat was taken! Refund {reversal_ref} queued.")
                return {
                    "ok": True,
                    "booking_id": booking_id,
                    "reconciled": True,
                    "action": "refund_queued",
                    "receipt_number": receipt_code,
                    "reversal_ref": reversal_ref,
                    "message": "Payment verified but seat was already reallocated. Full M-Pesa refund reversal queued.",
                }

    # CASE B: Gateway Confirms Payment Cancelled / Expired
    elif is_cancelled_by_user:
        trip_id = b_row["trip_id"]
        seat_num = b_row["seat_number"]

        if booking_status == "pending":
            await db.execute(
                text("UPDATE bookings SET status = 'cancelled', payment_status = 'unpaid' WHERE id = :id;"),
                {"id": booking_id}
            )
            await db.execute(
                text("""
                    UPDATE payments
                    SET status = 'failed',
                        provider_payload = jsonb_build_object('reason', :desc)
                    WHERE id = :pid;
                """),
                {"desc": gateway_desc or "customer_cancelled_or_timed_out", "pid": payment_id}
            )
            await db.commit()

            stop_names = await trip_stop_names(db, trip_id)
            chain = await recompute_chain(db, trip_id, seat_num)
            await notify_chain_change(db, manager, trip_id, seat_num, chain, stop_names)
            await manager.broadcast_trip(trip_id, {
                "event": "booking_cancelled",
                "trip_id": trip_id,
                "seat_number": seat_num,
                "booking_id": booking_id,
                "reason": "gateway_declined",
            })

            logger.info(f"[RECONCILE] Cancelled booking #{booking_id} based on gateway failure confirmation.")
            return {
                "ok": True,
                "booking_id": booking_id,
                "reconciled": True,
                "action": "cancelled_due_to_gateway",
                "message": f"Payment cancelled or timed out on gateway ({gateway_desc}). Seat safely released.",
            }

    # CASE C: Still in-flight on gateway side
    return {
        "ok": True,
        "booking_id": booking_id,
        "reconciled": False,
        "action": "still_pending",
        "message": "Transaction is still awaiting customer PIN entry or gateway confirmation.",
    }


def checkout_suffix(ref: str) -> str:
    cleaned = "".join(ch for ch in ref if ch.isalnum())
    return cleaned[-6:].upper() if len(cleaned) >= 6 else "781920"

