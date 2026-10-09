"""
BUSGO Test Suite - Item 6: USSD (*384#) Interface for Non-Smartphone Passengers.
Tests Africa's Talking gateway protocol, bilingual state transitions,
seat booking + M-Pesa STK push trigger, parcel tracking, and ticket queries.
"""

import sys
import os
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

# Point to project root
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.models import (
    Base, User, Vehicle, VehicleType, Route, Trip, Booking, Payment, Sacco, Parcel,
    UssdSession, UssdLog
)
from backend.ussd import UssdEngine, MESSAGES

DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(DATABASE_URL, echo=False)

def setup_test_db():
    Base.metadata.create_all(bind=engine)

    with Session(engine) as session:
        # Create Sacco
        sacco = Sacco(
            name="Super Metro Sacco",
            slug="super-metro",
            headquarters="Tea Room, Nairobi",
            contact_phone="0716 314 831",
            contact_email="support@supermetro.co.ke",
        )
        session.add(sacco)
        session.flush()

        # Create Vehicle Type & Vehicle
        vtype = VehicleType(slug="matatu-14", display_name="14-Seater HiAce", seat_capacity=14, purpose="passenger")
        session.add(vtype)
        session.flush()

        veh = Vehicle(
            plate_number="KDA 123A",
            sacco_id=sacco.id,
            vehicle_type_id=vtype.id,
            purpose="passenger",
        )
        session.add(veh)
        session.flush()

        # Create Routes
        r1 = Route(name="Nairobi - Nakuru Express", base_fare=450.0, per_hop_fare=100.0)
        r2 = Route(name="Nairobi - Kisumu Fast", base_fare=1200.0, per_hop_fare=200.0)
        session.add_all([r1, r2])
        session.flush()

        # Create Scheduled Trips
        t1 = Trip(
            name="08:00 AM Super Metro Express",
            route_id=r1.id,
            vehicle_id=veh.id,
            status="scheduled",
            fixed_price=450.0,
        )
        t2 = Trip(
            name="11:30 AM Super Metro Dayliner",
            route_id=r1.id,
            vehicle_id=veh.id,
            status="scheduled",
            fixed_price=450.0,
        )
        session.add_all([t1, t2])
        session.flush()

        # Create a Parcel for tracking test
        parcel = Parcel(
            trip_id=t1.id,
            sender_name="Musa Otieno",
            sender_phone="254711223344",
            recipient_name="Grace Chebet",
            recipient_phone="254799887766",
            tracking_code="WB-MZG-4401X",
            security_pin="5512",
            pickup_stop_order=1,
            dropoff_stop_order=2,
            category="Perishables",
            description="Organic Farm Produce",
            weight_kg=12.0,
            fee=600.0,
            base_fare=500.0,
            status="registered",
            sender_city_or_area="Nairobi CBD Hub",
            recipient_city_or_area="Nakuru Stage",
        )
        session.add(parcel)
        session.commit()

    return engine


def run_tests():
    print("=" * 65)
    print("--- [TEST ITEM 6: USSD (*384#) Non-Smartphone Interface] ---")
    print("=" * 65)

    engine = setup_test_db()
    test_phone = "+254716314831"
    session_id = "test_at_sess_001"

    # -------------------------------------------------------------
    # 1. INITIAL DIAL (*384#)
    # -------------------------------------------------------------
    print("\n--- 1. Testing Initial Dial (*384#) ---")
    with Session(engine) as session:
        resp = UssdEngine.handle_request(
            db=session,
            session_id=session_id,
            phone_number=test_phone,
            text_param="",
        )
        assert resp.startswith("CON "), f"Expected CON prefix, got: {resp}"
        assert "Welcome to BusGo Kenya" in resp
        assert "1. Book Bus Ticket" in resp
        assert "2. Check My Ticket" in resp
        assert "3. Track Mzigo Parcel" in resp
        assert "4. Sacco Contacts & Help" in resp
        assert "5. Badili Lugha" in resp
        print("✓ Initial Dial (*384#) Welcome screen successfully returned:")
        print(f"  {resp.splitlines()[0]}")

    # -------------------------------------------------------------
    # 2. BILINGUAL LANGUAGE SWITCHING (Option 5)
    # -------------------------------------------------------------
    print("\n--- 2. Testing Bilingual Language Toggle (Option 5) ---")
    with Session(engine) as session:
        # User dials 5 to switch to Kiswahili
        resp_sw = UssdEngine.handle_request(
            db=session,
            session_id=session_id,
            phone_number=test_phone,
            text_param="5",
        )
        assert resp_sw.startswith("END "), f"Expected END prefix, got: {resp_sw}"
        assert "Lugha imebadilishwa kuwa Kiswahili" in resp_sw
        print("✓ Switched to Kiswahili successfully.")

        # Next session dial should now be in Kiswahili!
        sess_2 = "test_at_sess_002"
        resp_welcome_sw = UssdEngine.handle_request(
            db=session,
            session_id=sess_2,
            phone_number=test_phone,
            text_param="",
        )
        assert resp_welcome_sw.startswith("CON ")
        assert "Karibu BusGo Kenya" in resp_welcome_sw
        assert "1. Kata Tiketi ya Basi" in resp_welcome_sw
        print("✓ Subsequent dial loaded Kiswahili Welcome Screen automatically:")
        print(f"  {resp_welcome_sw.splitlines()[0]}")

        # Switch back to English
        resp_en = UssdEngine.handle_request(
            db=session,
            session_id=sess_2,
            phone_number=test_phone,
            text_param="5",
        )
        assert "Language changed to English" in resp_en
        print("✓ Switched back to English successfully.")

    # -------------------------------------------------------------
    # 3. END-TO-END BUS TICKET BOOKING & DARAJA STK PUSH (Option 1)
    # -------------------------------------------------------------
    print("\n--- 3. Testing Complete Bus Ticket Booking & Payment Trigger ---")
    with Session(engine) as session:
        booking_sess = "test_booking_sess_999"

        # Step 3a: Select 1 (Book Bus Ticket) -> Shows routes
        r_step1 = UssdEngine.handle_request(session, booking_sess, test_phone, "1")
        assert r_step1.startswith("CON ")
        assert "Select Travel Route:" in r_step1
        assert "1. Nairobi - Nakuru Express" in r_step1
        print("✓ Step 1: Route selection menu rendered.")

        # Step 3b: Select Route 1 -> Shows departure times
        r_step2 = UssdEngine.handle_request(session, booking_sess, test_phone, "1*1")
        assert r_step2.startswith("CON ")
        assert "Select Departure Time:" in r_step2
        assert "08:00 AM Super Metro Express" in r_step2
        print("✓ Step 2: Departure times list rendered.")

        # Step 3c: Select Trip 1 -> Shows available seats
        r_step3 = UssdEngine.handle_request(session, booking_sess, test_phone, "1*1*1")
        assert r_step3.startswith("CON ")
        assert "Available Seats:" in r_step3
        print("✓ Step 3: Available seat allocation grid rendered.")

        # Step 3d: Enter Seat 0 (auto-assign) -> Asks for passenger name
        r_step4 = UssdEngine.handle_request(session, booking_sess, test_phone, "1*1*1*0")
        assert r_step4.startswith("CON ")
        assert "Passenger Name:" in r_step4
        print("✓ Step 4: Passenger identification prompt rendered.")

        # Step 3e: Enter Name 'Wanjiku Mwangi' -> Shows booking confirmation
        r_step5 = UssdEngine.handle_request(session, booking_sess, test_phone, "1*1*1*0*Wanjiku Mwangi")
        assert r_step5.startswith("CON ")
        assert "Confirm Booking:" in r_step5
        assert "Route: Nairobi - Nakuru Express" in r_step5
        assert "Passenger: Wanjiku Mwangi" in r_step5
        assert "Fare: KES 450" in r_step5
        assert "1. Confirm & Pay via M-Pesa" in r_step5
        print("✓ Step 5: Booking confirmation summary verified:")
        for line in r_step5.splitlines()[:5]:
            print(f"    {line}")

        # Step 3f: Enter 1 (Confirm & Pay) -> Executes booking & triggers STK push!
        r_step6 = UssdEngine.handle_request(session, booking_sess, test_phone, "1*1*1*0*Wanjiku Mwangi*1")
        assert r_step6.startswith("END "), f"Expected END, got: {r_step6}"
        assert "M-Pesa prompt for KES 450 sent to your phone" in r_step6
        print("✓ Step 6: Booking finalized & M-Pesa payment prompt triggered!")

        # Verify Booking row in database
        b_row = session.execute(
            select(Booking).order_by(Booking.id.desc()).limit(1)
        ).scalar_one()
        assert b_row.seat_number >= 1
        assert b_row.status == "pending"
        assert b_row.payment_status == "pending"
        print(f"✓ Database verified: Booking #{b_row.id} created for Seat #{b_row.seat_number}!")

    # -------------------------------------------------------------
    # 4. TICKET INSPECTION (Option 2)
    # -------------------------------------------------------------
    print("\n--- 4. Testing Passenger Ticket Inquiry (Option 2) ---")
    with Session(engine) as session:
        r_ticket = UssdEngine.handle_request(session, "ticket_query_sess", test_phone, "2")
        assert r_ticket.startswith("END ")
        assert "BusGo Ticket #" in r_ticket
        assert "Nairobi - Nakuru Express" in r_ticket
        print("✓ Active ticket successfully queried via USSD:")
        print(f"    {r_ticket.splitlines()[0]}")
        print(f"    {r_ticket.splitlines()[1]}")

    # -------------------------------------------------------------
    # 5. MZIGO PARCEL TRACKING (Option 3)
    # -------------------------------------------------------------
    print("\n--- 5. Testing Mzigo Parcel Tracking (Option 3) ---")
    with Session(engine) as session:
        # Step 5a: User selects 3 -> Prompt for tracking code
        r_p1 = UssdEngine.handle_request(session, "parcel_sess", test_phone, "3")
        assert r_p1.startswith("CON ")
        assert "Enter Mzigo Waybill" in r_p1

        # Step 5b: User enters WB-MZG-4401X
        r_p2 = UssdEngine.handle_request(session, "parcel_sess", test_phone, "3*WB-MZG-4401X")
        assert r_p2.startswith("END ")
        assert "WB-MZG-4401X" in r_p2
        assert "REGISTERED" in r_p2
        assert "5512" in r_p2
        print("✓ Parcel waybill found and live tracking details returned:")
        print(f"    {r_p2.splitlines()[0]}")
        print(f"    {r_p2.splitlines()[1]}")

    # -------------------------------------------------------------
    # 6. SACCO CONTACTS & HELPDESK (Option 4)
    # -------------------------------------------------------------
    print("\n--- 6. Testing SACCO Support Directory (Option 4) ---")
    with Session(engine) as session:
        r_s1 = UssdEngine.handle_request(session, "sacco_sess", test_phone, "4")
        assert r_s1.startswith("CON ")
        assert "Super Metro Sacco" in r_s1

        # Select Sacco 1
        r_s2 = UssdEngine.handle_request(session, "sacco_sess", test_phone, "4*1")
        assert r_s2.startswith("END ")
        assert "Super Metro Sacco" in r_s2
        assert "0716 314 831" in r_s2
        print("✓ Sacco customer care hotline and HQ details returned:")
        print(f"    {r_s2.splitlines()[0]}")
        print(f"    {r_s2.splitlines()[2]}")

    # -------------------------------------------------------------
    # 7. TELEMETRY & AUDIT LOGGING VERIFICATION
    # -------------------------------------------------------------
    print("\n--- 7. Verifying USSD Session & Inbound Hop Audit Logs ---")
    with Session(engine) as session:
        logs_count = session.execute(select(text("COUNT(*)")).select_from(UssdLog)).scalar()
        sessions_count = session.execute(select(text("COUNT(*)")).select_from(UssdSession)).scalar()
        assert logs_count > 0, "Expected USSD logs recorded"
        assert sessions_count > 0, "Expected USSD sessions recorded"
        print(f"✓ Recorded {sessions_count} unique sessions and {logs_count} inbound USSD hops in audit table!")

    print("\n" + "=" * 65)
    print("ALL USSD (*384#) INTEGRATION TESTS PASSED SUCCESSFULLY!")
    print("=" * 65)


if __name__ == "__main__":
    run_tests()
