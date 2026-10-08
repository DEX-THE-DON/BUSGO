"""
Test Suite for Step 2: In-Memory Atomic TTL Seat Locks & Concurrency Control.
"""
import asyncio
from backend.locks import SeatLockManager, SeatLock

async def run_lock_tests():
    mgr = SeatLockManager()
    trip_id = 99
    seat_no = 4

    print("Test 1: User 101 acquires lock on seat 4 for stops 1 -> 3")
    ok, lock1, msg = await mgr.acquire_lock(trip_id, seat_no, user_id=101, board_order=1, alight_order=3, ttl_seconds=300)
    assert ok, f"Expected lock to succeed: {msg}"
    assert lock1 is not None
    assert lock1.seconds_remaining > 0
    print("✓ Lock 1 acquired:", lock1.to_dict())

    print("\nTest 2: User 102 attempts to acquire lock on overlapping segment 2 -> 4")
    ok, lock2, msg = await mgr.acquire_lock(trip_id, seat_no, user_id=102, board_order=2, alight_order=4)
    assert not ok, "Expected overlapping lock to be rejected!"
    print("✓ Lock 2 correctly rejected:", msg)

    print("\nTest 3: User 103 attempts to acquire lock on non-overlapping segment 3 -> 5")
    ok, lock3, msg = await mgr.acquire_lock(trip_id, seat_no, user_id=103, board_order=3, alight_order=5)
    assert ok, f"Expected non-overlapping lock to succeed: {msg}"
    print("✓ Lock 3 on relay segment 3->5 succeeded!")

    print("\nTest 4: User 101 refreshes their own lock")
    ok, lock1_refreshed, msg = await mgr.acquire_lock(trip_id, seat_no, user_id=101, board_order=1, alight_order=3)
    assert ok
    print("✓ User 101 refreshed their lock successfully.")

    print("\nTest 5: Check conflict detection for third-party booking")
    is_conf, conf_lock = await mgr.check_lock_conflict(trip_id, seat_no, board_order=1, alight_order=2, requesting_user_id=999)
    assert is_conf, "Expected conflict for user 999"
    is_conf_self, _ = await mgr.check_lock_conflict(trip_id, seat_no, board_order=1, alight_order=2, requesting_user_id=101)
    assert not is_conf_self, "User 101 should not conflict with their own lock"
    print("✓ Conflict detection working accurately.")

    print("\nTest 6: User 101 releases their lock")
    released = await mgr.release_lock(trip_id, seat_no, user_id=101)
    assert released, "Expected lock release to succeed"
    active = await mgr.get_locks_for_trip(trip_id)
    assert len(active) == 1 and active[0]["user_id"] == 103
    print("✓ User 101 released lock; User 103 relay lock remains active.")

    print("\nTest 7: TTL expiration")
    short_mgr = SeatLockManager()
    await short_mgr.acquire_lock(1, 1, 55, 1, 2, ttl_seconds=-1) # already expired
    expired = await short_mgr.sweep_and_get_expired()
    assert len(expired) == 1
    print("✓ TTL expiration and cleanup working as expected.")

    print("\nALL STEP 2 CONCURRENCY & TTL LOCK TESTS PASSED!")

if __name__ == "__main__":
    asyncio.run(run_lock_tests())

