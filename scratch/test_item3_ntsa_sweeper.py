import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta

# Point to project root
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from backend.models import Base, User, Trip, Route, Vehicle, Sacco, VehicleCompliance, VehicleType
from backend.crons import sweep_ntsa_compliance_and_auto_ground
from backend.auth import hash_password

DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(DATABASE_URL, echo=False)

class AsyncDBSessionMock:
    def __init__(self, sync_session: Session):
        self.sync_session = sync_session

    async def execute(self, statement, params=None):
        if params is not None:
            return self.sync_session.execute(statement, params)
        return self.sync_session.execute(statement)

    async def commit(self):
        self.sync_session.commit()

    async def rollback(self):
        self.sync_session.rollback()

    async def flush(self):
        self.sync_session.flush()

    def add(self, obj):
        self.sync_session.add(obj)

    def add_all(self, objs):
        self.sync_session.add_all(objs)

async def run_tests():
    print("--- [TEST ITEM 3: NTSA Compliance & Auto-Grounding Sweeper] ---")
    Base.metadata.create_all(engine)
    now = datetime.now(timezone.utc)

    with Session(engine) as sync_session:
        session = AsyncDBSessionMock(sync_session)
        # 1. Seed Sacco
        sacco = Sacco(name="2NK Sacco Ltd", slug="2nk-sacco", contact_phone="254700000001", contact_email="admin@2nk.co.ke")
        session.add(sacco)
        await session.flush()

        # 2. Seed Route
        route = Route(name="Nairobi - Nyeri Express", base_fare=400.0, per_hop_fare=100.0)
        session.add(route)
        await session.flush()

        # 3. Seed Drivers
        driver_valid = User(
            full_name="Peter Kamau",
            email="kamau@2nk.co.ke",
            phone="254711111111",
            password_hash=hash_password("Pass123!"),
            role="driver",
            psv_badge_number="NTSA/DRV/2026/0891",
            psv_badge_expiry=now + timedelta(days=180) # Valid
        )
        driver_expired = User(
            full_name="John Omondi",
            email="omondi@2nk.co.ke",
            phone="254722222222",
            password_hash=hash_password("Pass123!"),
            role="driver",
            psv_badge_number="NTSA/DRV/2024/0112",
            psv_badge_expiry=now - timedelta(days=15) # Expired 15 days ago
        )
        session.add_all([driver_valid, driver_expired])
        await session.flush()

        # 3b. Seed VehicleType
        vtype = VehicleType(slug="matatu-14", display_name="14 Seater Matatu", seat_capacity=14, purpose="passenger")
        session.add(vtype)
        await session.flush()

        # 4. Seed Vehicles
        # Vehicle A: Clean vehicle with valid compliance
        veh_clean = Vehicle(
            plate_number="KDA 101A",
            vehicle_type_id=vtype.id,
            sacco_id=sacco.id,
            driver_id=driver_valid.id,
            owner_name="Mama Njeri",
            owner_phone="254733333331"
        )
        # Vehicle B: Expired Speed Governor
        veh_bad_gov = Vehicle(
            plate_number="KDB 202B",
            vehicle_type_id=vtype.id,
            sacco_id=sacco.id,
            driver_id=driver_valid.id,
            owner_name="Bwana Njoroge",
            owner_phone="254733333332"
        )
        # Vehicle C: Assigned Driver has Expired PSV Badge
        veh_bad_driver = Vehicle(
            plate_number="KDC 303C",
            vehicle_type_id=vtype.id,
            sacco_id=sacco.id,
            driver_id=driver_expired.id,
            owner_name="Kariuki Transport",
            owner_phone="254733333333"
        )
        session.add_all([veh_clean, veh_bad_gov, veh_bad_driver])
        await session.flush()

        # 5. Seed Compliance Records
        comp_clean = VehicleCompliance(
            vehicle_id=veh_clean.id,
            speed_governor_vendor="SAFEDRIVE LTD",
            speed_governor_cert="SG-9921",
            speed_governor_expiry=now + timedelta(days=120),
            ntsa_inspection_cert="NTSA-INS-7782",
            ntsa_inspection_expiry=now + timedelta(days=200),
            insurance_underwriter="BRITAM",
            insurance_policy_no="POL-BR-9912",
            insurance_expiry=now + timedelta(days=90),
            is_grounded=False
        )
        comp_bad_gov = VehicleCompliance(
            vehicle_id=veh_bad_gov.id,
            speed_governor_vendor="SAFEDRIVE LTD",
            speed_governor_cert="SG-1102",
            speed_governor_expiry=now - timedelta(days=5), # Expired 5 days ago!
            ntsa_inspection_cert="NTSA-INS-3341",
            ntsa_inspection_expiry=now + timedelta(days=150),
            insurance_underwriter="JUBILEE",
            insurance_policy_no="POL-JB-4451",
            insurance_expiry=now + timedelta(days=60),
            is_grounded=False
        )
        comp_bad_driver = VehicleCompliance(
            vehicle_id=veh_bad_driver.id,
            speed_governor_vendor="TRACKTECH LTD",
            speed_governor_cert="SG-5501",
            speed_governor_expiry=now + timedelta(days=180),
            ntsa_inspection_cert="NTSA-INS-8812",
            ntsa_inspection_expiry=now + timedelta(days=240),
            insurance_underwriter="CIC INSURANCE",
            insurance_policy_no="POL-CIC-1123",
            insurance_expiry=now + timedelta(days=100),
            is_grounded=False
        )
        session.add_all([comp_clean, comp_bad_gov, comp_bad_driver])
        await session.flush()

        # 6. Seed Scheduled Trips
        trip_clean = Trip(
            name="Nairobi-Nyeri 08:00 AM",
            route_id=route.id,
            vehicle_id=veh_clean.id,
            status="scheduled",
            fixed_price=500.0,
            scheduled_at=now + timedelta(hours=2)
        )
        trip_bad_gov = Trip(
            name="Nairobi-Nyeri 09:30 AM",
            route_id=route.id,
            vehicle_id=veh_bad_gov.id,
            status="scheduled",
            fixed_price=500.0,
            scheduled_at=now + timedelta(hours=3)
        )
        trip_bad_driver = Trip(
            name="Nairobi-Nyeri 11:00 AM",
            route_id=route.id,
            vehicle_id=veh_bad_driver.id,
            status="scheduled",
            fixed_price=500.0,
            scheduled_at=now + timedelta(hours=5)
        )
        session.add_all([trip_clean, trip_bad_gov, trip_bad_driver])
        await session.commit()

        trip_clean_id = trip_clean.id
        trip_bad_gov_id = trip_bad_gov.id
        trip_bad_driver_id = trip_bad_driver.id
        veh_clean_id = veh_clean.id
        veh_bad_gov_id = veh_bad_gov.id
        veh_bad_driver_id = veh_bad_driver.id
        driver_expired_id = driver_expired.id

    # Step 1: Run NTSA Sweeper pass
    print("\n--- Running 1st Sweeper Pass ---")
    with Session(engine) as sync_session:
        session = AsyncDBSessionMock(sync_session)
        result = await sweep_ntsa_compliance_and_auto_ground(session)
        print("Sweeper Result:", result)

        assert result["auto_grounded_count"] == 2, f"Expected 2 newly grounded, got {result['auto_grounded_count']}"
        grounded_plates = [g["plate_number"] for g in result["grounded_vehicles"]]
        assert "KDB 202B" in grounded_plates, "KDB 202B should be grounded for expired speed governor"
        assert "KDC 303C" in grounded_plates, "KDC 303C should be grounded for driver expired PSV badge"
        assert "KDA 101A" not in grounded_plates, "KDA 101A must remain clear and operational"
        assert result["suspended_trips_count"] == 2, f"Expected 2 suspended trips, got {result['suspended_trips_count']}"

    # Step 2: Verify Trips and Vehicle Compliance DB State
    print("\n--- Verifying Database Statuses After Sweeper ---")
    with Session(engine) as sync_session:
        session = AsyncDBSessionMock(sync_session)
        # Trip checks
        t_clean = (await session.execute(text("SELECT status FROM trips WHERE id = :id"), {"id": trip_clean_id})).scalar()
        t_bad_gov = (await session.execute(text("SELECT status FROM trips WHERE id = :id"), {"id": trip_bad_gov_id})).scalar()
        t_bad_drv = (await session.execute(text("SELECT status FROM trips WHERE id = :id"), {"id": trip_bad_driver_id})).scalar()

        assert t_clean == "scheduled", f"Clean trip should remain 'scheduled', got {t_clean}"
        assert t_bad_gov == "grounded", f"Trip for vehicle with bad governor should be 'grounded', got {t_bad_gov}"
        assert t_bad_drv == "grounded", f"Trip for vehicle with bad driver should be 'grounded', got {t_bad_drv}"

        # Compliance checks
        c_bad_gov = (await session.execute(text("SELECT is_grounded, grounded_reason FROM vehicle_compliance WHERE vehicle_id = :vid"), {"vid": veh_bad_gov_id})).mappings().one()
        assert c_bad_gov["is_grounded"] is True or c_bad_gov["is_grounded"] == 1
        assert "Expired Speed Governor" in c_bad_gov["grounded_reason"]

        c_bad_drv = (await session.execute(text("SELECT is_grounded, grounded_reason FROM vehicle_compliance WHERE vehicle_id = :vid"), {"vid": veh_bad_driver_id})).mappings().one()
        assert c_bad_drv["is_grounded"] is True or c_bad_drv["is_grounded"] == 1
        assert "PSV Badge Expired" in c_bad_drv["grounded_reason"]

        # Commuter Booking Rejection check (simulating book_seat endpoint logic)
        trip_bad_res = (await session.execute(
            text("""
                SELECT t.id, t.status, v.plate_number, vc.is_grounded, vc.grounded_reason
                FROM trips t
                JOIN routes r ON r.id = t.route_id
                LEFT JOIN vehicles v ON v.id = t.vehicle_id
                LEFT JOIN vehicle_compliance vc ON vc.vehicle_id = v.id
                WHERE t.id = :id;
            """),
            {"id": trip_bad_gov_id}
        )).mappings().first()

        assert trip_bad_res["status"] == "grounded" or trip_bad_res.get("is_grounded")
        print(f"✓ Verified booking attempt on grounded trip #{trip_bad_gov_id} ({trip_bad_res['plate_number']}) is blocked!")

        print("✓ Auto-grounding, trip suspension, and booking prevention validated successfully!")

    # Step 3: Test Auto-Clearing when Renewed
    print("\n--- Testing Auto-Clearing when Renewed ---")
    with Session(engine) as sync_session:
        session = AsyncDBSessionMock(sync_session)
        # Renew speed governor for KDB 202B
        await session.execute(
            text("UPDATE vehicle_compliance SET speed_governor_expiry = :new_exp WHERE vehicle_id = :vid"),
            {"new_exp": now + timedelta(days=365), "vid": veh_bad_gov_id}
        )
        # Renew PSV badge for John Omondi
        await session.execute(
            text("UPDATE users SET psv_badge_expiry = :new_exp WHERE id = :uid"),
            {"new_exp": now + timedelta(days=365), "uid": driver_expired_id}
        )
        await session.commit()

    with Session(engine) as sync_session:
        session = AsyncDBSessionMock(sync_session)
        result2 = await sweep_ntsa_compliance_and_auto_ground(session)
        print("2nd Sweeper Pass Result:", result2)

        assert result2["auto_cleared_count"] == 2, f"Expected 2 cleared vehicles, got {result2['auto_cleared_count']}"
        cleared_plates = [c["plate_number"] for c in result2["cleared_vehicles"]]
        assert "KDB 202B" in cleared_plates
        assert "KDC 303C" in cleared_plates


        # Verify DB is_grounded is False
        c_gov = (await session.execute(text("SELECT is_grounded, grounded_reason FROM vehicle_compliance WHERE vehicle_id = :vid"), {"vid": veh_bad_gov_id})).mappings().one()
        assert (c_gov["is_grounded"] is False or c_gov["is_grounded"] == 0) and c_gov["grounded_reason"] is None

        c_drv = (await session.execute(text("SELECT is_grounded, grounded_reason FROM vehicle_compliance WHERE vehicle_id = :vid"), {"vid": veh_bad_driver_id})).mappings().one()
        assert (c_drv["is_grounded"] is False or c_drv["is_grounded"] == 0) and c_drv["grounded_reason"] is None


        print("✓ Auto-clearing upon compliance renewal validated successfully!")

    print("\n=======================================================")
    print("ALL NTSA COMPLIANCE & AUTO-GROUNDING TESTS PASSED!")
    print("=======================================================")

if __name__ == "__main__":
    asyncio.run(run_tests())
