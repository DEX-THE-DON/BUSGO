"""
Seat-chain engine for BUSGO.

Every physical seat on a trip is modelled as a *chain* of segment bookings
(seat 7: A→B 🔗 B→C 🔗 C→D). The chain is recomputed whenever a booking is
created, cancelled, or paid, and drives the relay notifications:

  - *handoff*: the passenger boarding at the same stop where the previous
    passenger alights is told their seat is (or will be) ready.
  - *freed gap*: any segment between two chain links with no occupant is
    offered to matching waitlisted users.
"""
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.ws import ConnectionManager


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Chain persistence
# ---------------------------------------------------------------------------
async def get_chain_rows(db: AsyncSession, trip_id: int, seat_number: int) -> List[dict]:
    """The current ordered chain for (trip, seat), with stop names."""
    rows = (await db.execute(
        text(
            """
            SELECT b.id AS booking_id, b.board_stop_order, b.alight_stop_order,
                   b.user_id, b.status, b.payment_status,
                   u.full_name AS passenger_name,
                   (SELECT stop_name FROM route_stops
                     WHERE route_id = r.id AND stop_order = b.board_stop_order) AS board_stop,
                   (SELECT stop_name FROM route_stops
                     WHERE route_id = r.id AND stop_order = b.alight_stop_order) AS alight_stop
            FROM bookings b
            JOIN trips t ON t.id = b.trip_id
            JOIN routes r ON r.id = t.route_id
            LEFT JOIN users u ON u.id = b.user_id
            WHERE b.trip_id = :trip_id AND b.seat_number = :seat_number
              AND b.status != 'cancelled'
            ORDER BY b.board_stop_order ASC, b.id ASC;
            """
        ),
        {"trip_id": trip_id, "seat_number": seat_number},
    )).mappings().all()
    return [dict(r) for r in rows]


async def recompute_chain(db: AsyncSession, trip_id: int, seat_number: int) -> List[dict]:
    """Replace the stored chain for (trip, seat) with the current bookings.

    Returns the ordered chain rows (already in memory), so callers can drive
    notifications without an extra query.
    """
    chain_rows = await get_chain_rows(db, trip_id, seat_number)

    # Upsert the seat_chains row.
    chain_id = (await db.execute(
        text(
            """
            INSERT INTO seat_chains (trip_id, seat_number, created_at)
            VALUES (:trip_id, :seat_number, now())
            ON CONFLICT (trip_id, seat_number)
            DO UPDATE SET seat_number = EXCLUDED.seat_number
            RETURNING id;
            """
        ),
        {"trip_id": trip_id, "seat_number": seat_number},
    )).scalar_one()

    await db.execute(text("DELETE FROM seat_chain_links WHERE chain_id = :chain_id;"), {"chain_id": chain_id})
    for position, row in enumerate(chain_rows, start=1):
        await db.execute(
            text(
                """
                INSERT INTO seat_chain_links (chain_id, booking_id, position, board_stop_order, alight_stop_order)
                VALUES (:chain_id, :booking_id, :position, :board, :alight);
                """
            ),
            {
                "chain_id": chain_id,
                "booking_id": row["booking_id"],
                "position": position,
                "board": row["board_stop_order"],
                "alight": row["alight_stop_order"],
            },
        )
    return chain_rows

# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
async def create_notification(
    db: AsyncSession,
    user_id: int,
    kind: str,
    title: str,
    body: str,
    payload: Optional[dict] = None,
) -> dict:
    row = (await db.execute(
        text(
            """
            INSERT INTO notifications (user_id, kind, title, body, payload, read, created_at)
            VALUES (:user_id, :kind, :title, :body, CAST(:payload AS jsonb), false, now())
            RETURNING id, user_id, kind, title, body, payload, read, created_at;
            """
        ),
        {"user_id": user_id, "kind": kind, "title": title, "body": body,
         "payload": __import__("json").dumps(payload) if payload is not None else None},
    )).mappings().first()
    return dict(row) if row is not None else {}


async def _push_user_notification(
    db: AsyncSession, manager: ConnectionManager, user_id: int, kind: str,
    title: str, body: str, payload: Optional[dict] = None,
) -> None:
    if user_id is None:
        return
    notif = await create_notification(db, user_id, kind, title, body, payload)
    await db.commit()
    await manager.send_to_user(user_id, {"event": "notification", "notification": notif})


async def notify_chain_change(
    db: AsyncSession,
    manager: ConnectionManager,
    trip_id: int,
    seat_number: int,
    chain_rows: List[dict],
    stop_names: dict,
) -> None:
    """Emit relay notifications for the (recomputed) chain of one seat.

    Handoffs:  passenger Pn boards at the exact stop Pn-1 alights.
    Freed gaps: a segment with no occupant becomes available for waitlists.
    """
    if not chain_rows:
        return

    stop_name = lambda order: stop_names.get(order, f"Stop {order}")

    # 1) Adjacent handoffs -> notify the boarding passenger.
    for prev, nxt in zip(chain_rows, chain_rows[1:]):
        if nxt["board_stop_order"] == prev["alight_stop_order"] and nxt["user_id"]:
            await _push_user_notification(
                db,
                manager,
                nxt["user_id"],
                "seat_freed",
                f"Seat #{seat_number} is ready for you",
                f"The passenger ahead alights at {stop_name(prev['alight_stop_order'])} — "
                f"board here for seat #{seat_number} (booking #{nxt['booking_id']}).",
                {"trip_id": trip_id, "seat_number": seat_number,
                 "stop_order": prev["alight_stop_order"], "booking_id": nxt["booking_id"]},
            )

    # 2) Freed gaps between links -> offer to waitlisted users.
    for prev, nxt in zip(chain_rows, chain_rows[1:]):
        gap_board, gap_alight = prev["alight_stop_order"], nxt["board_stop_order"]
        if gap_alight > gap_board:
            await _offer_gap(db, manager, trip_id, seat_number, gap_board, gap_alight, stop_name)

    # 3) Open tail after the last link -> waitlists on that segment.
    last = chain_rows[-1]
    max_order = max(stop_names) if stop_names else last["alight_stop_order"]
    if last["alight_stop_order"] < max_order:
        await _offer_gap(db, manager, trip_id, seat_number,
                         last["alight_stop_order"], max_order, stop_name)


async def _offer_gap(
    db: AsyncSession, manager: ConnectionManager, trip_id: int, seat_number: int,
    gap_board: int, gap_alight: int, stop_name,
) -> None:
    """Notify active waitlist entries whose requested segment fits a free gap."""
    interests = (await db.execute(
        text(
            """
            SELECT si.id, si.user_id, si.board_stop_order, si.alight_stop_order, si.seat_number
            FROM seat_interests si
            WHERE si.trip_id = :trip_id AND si.status = 'active'
              AND si.board_stop_order >= :gap_board AND si.alight_stop_order <= :gap_alight
              AND (si.seat_number IS NULL OR si.seat_number = :seat_number);
            """
        ),
        {"trip_id": trip_id, "gap_board": gap_board, "gap_alight": gap_alight,
         "seat_number": seat_number},
    )).mappings().all()

    for interest in interests:
        await _push_user_notification(
            db,
            manager,
            interest["user_id"],
            "seat_freed",
            f"Seat #{seat_number} just freed up",
            f"A seat on this trip is now free for "
            f"{stop_name(interest['board_stop_order'])} → {stop_name(interest['alight_stop_order'])}. Book it now!",
            {"trip_id": trip_id, "seat_number": seat_number,
             "board_stop_order": interest["board_stop_order"],
             "alight_stop_order": interest["alight_stop_order"]},
        )
        # One notification per interest per offer, then park it so we don't spam.
        await db.execute(
            text("UPDATE seat_interests SET status = 'notified' WHERE id = :id;"),
            {"id": interest["id"]},
        )
    if interests:
        await db.commit()


async def trip_stop_names(db: AsyncSession, trip_id: int) -> dict:
    rows = (await db.execute(
        text(
            """
            SELECT rs.stop_order, rs.stop_name
            FROM trips t JOIN route_stops rs ON t.route_id = rs.route_id
            WHERE t.id = :trip_id
            ORDER BY rs.stop_order ASC;
            """
        ),
        {"trip_id": trip_id},
    )).mappings().all()
    return {r["stop_order"]: r["stop_name"] for r in rows}


async def notify_seat_released_at_stop(
    db: AsyncSession, manager: ConnectionManager, trip_id: int, stop_order: int,
) -> int:
    """Driver called "bus is at stop X" -> release seats whose passenger alights.

    Returns the number of released (confirmed) bookings.
    """
    released = (await db.execute(
        text(
            """
            SELECT b.id, b.seat_number, b.user_id
            FROM bookings b
            WHERE b.trip_id = :trip_id AND b.alight_stop_order = :stop_order
              AND b.status NOT IN ('cancelled');
            """
        ),
        {"trip_id": trip_id, "stop_order": stop_order},
    )).mappings().all()

    stop_names = await trip_stop_names(db, trip_id)
    for row in released:
        await manager.broadcast_trip(trip_id, {
            "event": "seat_freed",
            "trip_id": trip_id,
            "seat_number": row["seat_number"],
            "stop_order": stop_order,
            "stop_name": stop_names.get(stop_order),
        })

    # Recompute chains for every released seat and notify waitlists/handoffs.
    for row in released:
        chain = await recompute_chain(db, trip_id, row["seat_number"])
        # The passenger who just alighted is out of the chain, so the chain now
        # shows the next occupant -> handoff notifications fire naturally.
        await notify_chain_change(db, manager, trip_id, row["seat_number"], chain, stop_names)

    if released:
        await db.commit()
    return len(released)

