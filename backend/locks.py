"""
In-Memory Atomic TTL Seat Reservation Lock Manager for BUSGO.
Prevents double-booking and database lock contention under high-demand rush hours.
Maintains segment-aware locks with automatic expiration (TTL = 5 to 7 minutes).
"""
import asyncio
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple, Any

logger = logging.getLogger("busgo.locks")
logger.setLevel(logging.INFO)


class SeatLock:
    def __init__(
        self,
        trip_id: int,
        seat_number: int,
        user_id: int,
        board_stop_order: int,
        alight_stop_order: int,
        ttl_seconds: int = 420,  # 7 minutes default
    ):
        self.trip_id = trip_id
        self.seat_number = seat_number
        self.user_id = user_id
        self.board_stop_order = board_stop_order
        self.alight_stop_order = alight_stop_order
        self.token = str(uuid.uuid4())
        self.created_at = datetime.now(timezone.utc)
        self.expires_at = self.created_at + timedelta(seconds=ttl_seconds)

    @property
    def is_expired(self) -> bool:
        return datetime.now(timezone.utc) >= self.expires_at

    @property
    def seconds_remaining(self) -> int:
        now = datetime.now(timezone.utc)
        if now >= self.expires_at:
            return 0
        return int((self.expires_at - now).total_seconds())

    def overlaps_segment(self, board_order: int, alight_order: int) -> bool:
        """
        Segment overlap condition matching database constraints:
        Two reservations do NOT conflict if one finishes before or at the other's board stop,
        or starts at or after the other's alight stop.
        Conflict occurs if NOT (self.alight <= board_order or self.board >= alight_order).
        """
        no_conflict = (self.alight_stop_order <= board_order) or (self.board_stop_order >= alight_order)
        return not no_conflict

    def to_dict(self) -> Dict[str, Any]:
        return {
            "token": self.token,
            "trip_id": self.trip_id,
            "seat_number": self.seat_number,
            "user_id": self.user_id,
            "board_stop_order": self.board_stop_order,
            "alight_stop_order": self.alight_stop_order,
            "seconds_remaining": self.seconds_remaining,
            "expires_at": self.expires_at.isoformat(),
            "created_at": self.created_at.isoformat(),
        }


class SeatLockManager:
    def __init__(self):
        # Key: (trip_id, seat_number) -> List[SeatLock]
        self._locks: Dict[Tuple[int, int], List[SeatLock]] = {}
        self._mutex = asyncio.Lock()

    def _cleanup_expired(self) -> List[SeatLock]:
        """Removes expired locks in-place and returns the list of expired locks."""
        expired = []
        now = datetime.now(timezone.utc)
        for key in list(self._locks.keys()):
            active = []
            for lock in self._locks[key]:
                if now >= lock.expires_at:
                    expired.append(lock)
                else:
                    active.append(lock)
            if active:
                self._locks[key] = active
            else:
                self._locks.pop(key, None)
        return expired

    async def acquire_lock(
        self,
        trip_id: int,
        seat_number: int,
        user_id: int,
        board_order: int,
        alight_order: int,
        ttl_seconds: int = 420,
    ) -> Tuple[bool, Optional[SeatLock], str]:
        """
        Attempts to atomically acquire a temporary TTL lock on a seat segment.
        Returns: (success, lock_object, message)
        """
        async with self._mutex:
            self._cleanup_expired()
            key = (trip_id, seat_number)
            existing_locks = self._locks.get(key, [])

            # Check if any active lock conflicts with requested segment
            for ex in existing_locks:
                if ex.overlaps_segment(board_order, alight_order):
                    if ex.user_id == user_id:
                        # Same user: refresh TTL
                        ex.expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
                        return True, ex, "Seat lock refreshed for your session."
                    else:
                        rem = ex.seconds_remaining
                        return False, ex, f"Seat {seat_number} is currently reserved by another commuter ({rem}s remaining)."

            # No conflict - create and save new lock
            new_lock = SeatLock(
                trip_id=trip_id,
                seat_number=seat_number,
                user_id=user_id,
                board_stop_order=board_order,
                alight_stop_order=alight_order,
                ttl_seconds=ttl_seconds,
            )
            self._locks.setdefault(key, []).append(new_lock)
            logger.info(f"Seat lock acquired: trip {trip_id}, seat {seat_number}, user {user_id}, ttl {ttl_seconds}s")
            return True, new_lock, "Seat lock successfully acquired."

    async def release_lock(
        self,
        trip_id: int,
        seat_number: int,
        user_id: Optional[int] = None,
        lock_token: Optional[str] = None,
    ) -> bool:
        """Releases lock held by user or by token."""
        async with self._mutex:
            self._cleanup_expired()
            key = (trip_id, seat_number)
            if key not in self._locks:
                return False

            initial_count = len(self._locks[key])
            self._locks[key] = [
                l for l in self._locks[key]
                if not (
                    (lock_token and l.token == lock_token) or
                    (user_id is not None and l.user_id == user_id) or
                    (lock_token is None and user_id is None)
                )
            ]
            released = len(self._locks[key]) < initial_count
            if not self._locks[key]:
                self._locks.pop(key, None)
            return released

    async def check_lock_conflict(
        self,
        trip_id: int,
        seat_number: int,
        board_order: int,
        alight_order: int,
        requesting_user_id: int,
    ) -> Tuple[bool, Optional[SeatLock]]:
        """
        Returns (is_conflicted, conflicting_lock).
        Returns False if no conflicting lock or if the lock belongs to requesting_user_id.
        """
        async with self._mutex:
            self._cleanup_expired()
            key = (trip_id, seat_number)
            for l in self._locks.get(key, []):
                if l.overlaps_segment(board_order, alight_order) and l.user_id != requesting_user_id:
                    return True, l
            return False, None

    async def get_locks_for_trip(
        self,
        trip_id: int,
        board_order: Optional[int] = None,
        alight_order: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Returns all non-expired locks for a trip, optionally filtered by segment overlap."""
        async with self._mutex:
            self._cleanup_expired()
            results = []
            for (t_id, seat_no), locks in self._locks.items():
                if t_id != trip_id:
                    continue
                for l in locks:
                    if board_order is not None and alight_order is not None:
                        if l.overlaps_segment(board_order, alight_order):
                            results.append(l.to_dict())
                    else:
                        results.append(l.to_dict())
            return results

    async def sweep_and_get_expired(self) -> List[SeatLock]:
        """Sweeps expired locks and returns them for WebSocket broadcast."""
        async with self._mutex:
            return self._cleanup_expired()


# Singleton lock manager
seat_lock_manager = SeatLockManager()

