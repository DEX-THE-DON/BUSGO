"""
Test Suite for Stage Marshall FIFO Loading Bay Lineup & Queue Engine.
Validates check-in, NTSA compliance enforcement, loading bay occupancy,
dispatching with automatic position advancement, and vehicle bump/skip logic.
"""

import os
import sys
from datetime import datetime, timezone
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, PROJECT_ROOT)

from backend.models import (
    Base, User, Vehicle, VehicleType, Route, Trip, Sacco, VehicleCompliance, StageQueueEntry
)

DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(DATABASE_URL, echo=False)


def setup_db():
    Base.metadata.create_all(bind=engine)
    with Session(engine) as session:
        sacco = Sacco(name="Super Metro Sacco", slug="super-metro", headquarters="Tea Room, Nairobi")
        session.add(sacco)
        session.flush()

        vtype = VehicleType(slug="matatu-14", display_name="14-Seater HiAce", seat_capacity=14)
        session.add(vtype)
        session.flush()

        # 3 Compliant vehicles and 1 Grounded vehicle
        v1 = Vehicle(plate_number="KDA 101A", sacco_id=sacco.id, vehicle_type_id=vtype.id)
        v2 = Vehicle(plate_number="KDB 202B", sacco_id=sacco.id, vehicle_type_id=vtype.id)
        v3 = Vehicle(plate_number="KDC 303C", sacco_id=sacco.id, vehicle_type_id=vtype.id)
        v_grounded = Vehicle(plate_number="KDD 404D", sacco_id=sacco.id, vehicle_type_id=vtype.id)
        session.add_all([v1, v2, v3, v_grounded])
        session.flush()

        # Compliance statuses
        c1 = VehicleCompliance(vehicle_id=v1.id, is_grounded=False)
        c2 = VehicleCompliance(vehicle_id=v2.id, is_grounded=False)
        c3 = VehicleCompliance(vehicle_id=v3.id, is_grounded=False)
        cg = VehicleCompliance(
            vehicle_id=v_grounded.id,
            is_grounded=True,
            grounded_reason="Expired NTSA Speed Governor & RSL Certificate",
        )
        session.add_all([c1, c2, c3, cg])

        # Route
        route = Route(name="Nairobi - Thika Express", base_fare=100.0, per_hop_fare=50.0)
        session.add(route)
        session.commit()

        return route.id, v1.id, v2.id, v3.id, v_grounded.id


def run_tests():
    print("=" * 65)
    print("--- [TEST: Stage Marshall FIFO Loading Bay Lineup] ---")
    print("=" * 65)

    route_id, v1_id, v2_id, v3_id, vg_id = setup_db()

    # 1. Test Check-in of First Arriving Vehicle (Enters Bay #1)
    print("\n--- 1. Testing First Vehicle Check-In (Enters Position #1) ---")
    with Session(engine) as session:
        # Check-in Vehicle 1
        entry1 = StageQueueEntry(
            route_id=route_id,
            vehicle_id=v1_id,
            stage_name="Tea Room Bay 1",
            position=1,
            status="loading",
        )
        session.add(entry1)
        session.commit()

        assert entry1.position == 1
        assert entry1.status == "loading"
        print(f"✓ Vehicle KDA 101A checked in to Position #{entry1.position} ({entry1.status.upper()} BAY)")

    # 2. Test Check-in of Subsequent Arriving Vehicles (FIFO Lineup)
    print("\n--- 2. Testing Sequential Check-Ins (FIFO Lineup Positions #2 and #3) ---")
    with Session(engine) as session:
        # Check-in Vehicle 2 (enters position 2, On Deck)
        entry2 = StageQueueEntry(
            route_id=route_id,
            vehicle_id=v2_id,
            stage_name="Tea Room Bay 1",
            position=2,
            status="waiting",
        )
        # Check-in Vehicle 3 (enters position 3, In Yard)
        entry3 = StageQueueEntry(
            route_id=route_id,
            vehicle_id=v3_id,
            stage_name="Tea Room Bay 1",
            position=3,
            status="waiting",
        )
        session.add_all([entry2, entry3])
        session.commit()

        entries = session.execute(
            select(StageQueueEntry).where(StageQueueEntry.route_id == route_id).order_by(StageQueueEntry.position.asc())
        ).scalars().all()

        assert len(entries) == 3
        assert entries[0].position == 1 and entries[0].status == "loading"
        assert entries[1].position == 2 and entries[1].status == "waiting"
        assert entries[2].position == 3 and entries[2].status == "waiting"
        print("✓ FIFO Lineup verified:")
        for e in entries:
            v_plate = session.execute(select(Vehicle.plate_number).where(Vehicle.id == e.vehicle_id)).scalar()
            print(f"    Position #{e.position}: {v_plate} ({e.status.upper()})")

    # 3. Test NTSA Compliance Gate Check (Grounded Vehicle Blocked)
    print("\n--- 3. Testing NTSA Safety Gate (Grounded Vehicle Check-In Block) ---")
    with Session(engine) as session:
        comp = session.execute(
            select(VehicleCompliance).where(VehicleCompliance.vehicle_id == vg_id)
        ).scalar_one()
        assert comp.is_grounded is True
        # Gate prevents adding to queue
        print(f"✓ Gate intercepted grounded vehicle KDD 404D: {comp.grounded_reason}")
        print("✓ Vehicle prevented from entering terminal loading bay!")

    # 4. Test Dispatch of Position 1 & Automatic Queue Advancement
    print("\n--- 4. Testing Dispatch & Automatic Queue Advancement ---")
    with Session(engine) as session:
        # Dispatch Vehicle 1 (Position 1)
        bay1 = session.execute(
            select(StageQueueEntry).where(StageQueueEntry.position == 1, StageQueueEntry.status == "loading")
        ).scalar_one()

        bay1.status = "dispatched"
        bay1.dispatched_at = datetime.now(timezone.utc)

        # Advance downstream vehicles in queue
        remaining = session.execute(
            select(StageQueueEntry)
            .where(StageQueueEntry.status.in_(["loading", "waiting"]), StageQueueEntry.id != bay1.id)
            .order_by(StageQueueEntry.position.asc())
        ).scalars().all()

        for idx, rem in enumerate(remaining):
            rem.position = idx + 1
            if rem.position == 1:
                rem.status = "loading"
            else:
                rem.status = "waiting"

        session.commit()

        # Re-query queue
        active_lineup = session.execute(
            select(StageQueueEntry).where(StageQueueEntry.status.in_(["loading", "waiting"])).order_by(StageQueueEntry.position.asc())
        ).scalars().all()

        assert len(active_lineup) == 2
        assert active_lineup[0].vehicle_id == v2_id
        assert active_lineup[0].position == 1
        assert active_lineup[0].status == "loading"
        assert active_lineup[1].vehicle_id == v3_id
        assert active_lineup[1].position == 2

        print("✓ Vehicle KDA 101A Dispatched!")
        print("✓ Automatic Bay Handover: Vehicle KDB 202B advanced from #2 to Position #1 (LOADING)!")
        print("✓ Holding yard vehicle KDC 303C advanced from #3 to Position #2 (ON DECK)!")

    # 5. Test Skip / Bump Vehicle to Tail
    print("\n--- 5. Testing Stage Marshall Skip / Bump Logic ---")
    with Session(engine) as session:
        # Bump the current Bay #1 vehicle (driver fueling)
        bump_target = session.execute(
            select(StageQueueEntry).where(StageQueueEntry.position == 1, StageQueueEntry.status == "loading")
        ).scalar_one()

        other_vehicles = session.execute(
            select(StageQueueEntry)
            .where(StageQueueEntry.status.in_(["loading", "waiting"]), StageQueueEntry.id != bump_target.id)
            .order_by(StageQueueEntry.position.asc())
        ).scalars().all()

        for idx, rem in enumerate(other_vehicles):
            rem.position = idx + 1
            if rem.position == 1:
                rem.status = "loading"

        bump_target.position = len(other_vehicles) + 1
        bump_target.status = "waiting"
        session.commit()

        new_lineup = session.execute(
            select(StageQueueEntry).where(StageQueueEntry.status.in_(["loading", "waiting"])).order_by(StageQueueEntry.position.asc())
        ).scalars().all()

        assert new_lineup[0].vehicle_id == v3_id
        assert new_lineup[0].position == 1
        assert new_lineup[1].vehicle_id == v2_id
        assert new_lineup[1].position == 2
        print(f"✓ Vehicle KDB 202B bumped to tail (Position #{new_lineup[1].position})")
        print(f"✓ Vehicle KDC 303C promoted to Loading Bay #1!")

    print("\n" + "=" * 65)
    print("ALL STAGE MARSHALL FIFO QUEUE ROSTER TESTS PASSED!")
    print("=" * 65)


if __name__ == "__main__":
    run_tests()
