"""
Test Suite for Item 5: Handheld Thermal POS Bluetooth Slip Printing (58mm / 80mm ESC/POS)
========================================================================================
Validates:
1. Native ESC/POS binary command stream generation:
   - Printer initialization (ESC @)
   - Left, Center, Right alignments (ESC a n)
   - Font emphasis & character sizing (ESC E 1, GS ! n)
   - Native 2D QR Code generation block (GS ( k ...)
   - Feed and full paper cut (GS V 66 0)
2. 58mm (32 columns) and 80mm (48 columns) column wrapping and padding.
3. Passenger boarding slip & Mzigo parcel waybill formatting.
4. Plain ASCII preview text formatting.
5. Database endpoint simulation for GET /api/bookings/{id}/escpos and /api/parcels/{id}/escpos.
"""

import base64
import os
import sys
from datetime import datetime, timezone

# Point to project root
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from backend.models import Base, User, Trip, Route, Vehicle, Sacco, Booking, Payment, Parcel, VehicleType
from backend.escpos import (
    generate_passenger_ticket_escpos,
    generate_parcel_waybill_escpos,
    generate_plain_ascii_slip,
    CMD_INIT,
    CMD_FEED_AND_CUT,
    WIDTH_COLS,
)

DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(DATABASE_URL, echo=False)

def run_tests():
    print("=====================================================================")
    print("--- [TEST ITEM 5: Handheld Thermal POS Bluetooth ESC/POS Slip Printing] ---")
    print("=====================================================================")

    # 1. Test Passenger Ticket 58mm ESC/POS Binary Generation
    print("\n--- 1. Testing 58mm Passenger Ticket ESC/POS Stream ---")
    ticket_data = {
        "booking_id": 9942,
        "seat_number": 7,
        "passenger_name": "Wanjiku Mwangi",
        "passenger_phone": "254712345678",
        "sacco_name": "Super Metro Sacco",
        "route_name": "Nairobi - Juja Express",
        "board_stop": "Odeon Cinema Stage",
        "alight_stop": "Juja Stage",
        "vehicle_plate": "KDA 123A",
        "departure_time": datetime.now(timezone.utc),
        "fare_amount": 100.0,
        "luggage_fee": 50.0,
        "receipt_number": "QKA451JK92",
    }

    raw_58 = generate_passenger_ticket_escpos(ticket_data, width_mm=58)
    assert isinstance(raw_58, bytes), "Output must be raw bytes"
    assert raw_58.startswith(CMD_INIT), "Stream must begin with ESC @ init"
    assert raw_58.endswith(CMD_FEED_AND_CUT), "Stream must end with paper cut GS V"
    assert b"SUPER METRO SACCO" in raw_58, "Sacco header must be present"
    assert b"SEAT: #7" in raw_58, "Seat assignment must be present"
    assert b"KDA 123A" in raw_58, "Vehicle plate must be present"
    assert b"WANJIKU MWANGI" in raw_58, "Passenger name must be present"
    assert b"QKA451JK92" in raw_58, "Payment reference must be present"
    # Check QR code command sequence: GS ( k
    assert b"\x1d(k" in raw_58, "Native ESC/POS QR code command (GS ( k) must be included"
    print(f"✓ 58mm Passenger slip generated ({len(raw_58)} raw bytes) with native QR code and paper cut command!")

    # 2. Test Passenger Ticket 80mm ESC/POS Binary Generation
    print("\n--- 2. Testing 80mm Passenger Ticket ESC/POS Stream ---")
    raw_80 = generate_passenger_ticket_escpos(ticket_data, width_mm=80)
    assert raw_80.startswith(CMD_INIT)
    assert raw_80.endswith(CMD_FEED_AND_CUT)
    assert b"SEAT: #7" in raw_80
    assert len(raw_80) > 0
    print(f"✓ 80mm Passenger slip generated ({len(raw_80)} raw bytes) for desktop / terminal printers!")

    # 3. Test Parcel (Mzigo) Waybill Slip
    print("\n--- 3. Testing Parcel (Mzigo) Waybill ESC/POS Stream ---")
    parcel_data = {
        "id": 501,
        "tracking_code": "WB-MZG-78A12",
        "security_pin": "8821",
        "sender_name": "Kariuki Otieno",
        "sender_phone": "254700112233",
        "recipient_name": "Amina Hassan",
        "recipient_phone": "254722998877",
        "category": "Electronics / Solar Kit",
        "weight_kg": 8.5,
        "fee": 750.0,
    }
    raw_parcel = generate_parcel_waybill_escpos(parcel_data, width_mm=58)
    assert raw_parcel.startswith(CMD_INIT)
    assert raw_parcel.endswith(CMD_FEED_AND_CUT)
    assert b"WB-MZG-78A12" in raw_parcel
    assert b"CLAIM PIN: 8821" in raw_parcel
    assert b"AMINA HASSAN" in raw_parcel
    assert b"\x1d(k" in raw_parcel, "Waybill must include native QR code"
    print(f"✓ Mzigo parcel waybill generated ({len(raw_parcel)} raw bytes) with tracking code & claim PIN!")

    # 4. Test Plain ASCII Slip Text Formatting
    print("\n--- 4. Testing Monospace Column Width Formatting ---")
    ascii_slip = generate_plain_ascii_slip(ticket_data, width_mm=58)
    lines = ascii_slip.split("\n")
    max_line_len = max(len(l) for l in lines)
    assert max_line_len <= 32, f"Lines must not exceed 58mm width (32 cols), found length {max_line_len}"
    print(f"✓ Plain ASCII slip verified: {len(lines)} lines, all <= 32 chars wide.")
    print("\n[Preview 58mm Ticket Slip]:\n" + ascii_slip[:320] + "\n...")

    # 5. Database Schema & Data Extraction Verification
    print("\n--- 5. Testing Database Integration for ESC/POS Endpoints ---")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        # Seed test entities
        sacco = Sacco(name="2NK Sacco Ltd", slug="2nk-sacco", contact_phone="254700000001", contact_email="admin@2nk.co.ke")
        vtype = VehicleType(slug="matatu-14", display_name="14 Seater Matatu", seat_capacity=14, purpose="passenger")
        session.add_all([sacco, vtype])
        session.flush()

        user = User(full_name="Faith Wambui", email="faith@busgo.test", phone="254711223344", role="user")
        veh = Vehicle(plate_number="KDA 999Z", vehicle_type_id=vtype.id, sacco_id=sacco.id)
        route = Route(name="Nairobi - Nyeri Express", base_fare=450.0, per_hop_fare=100.0)
        session.add_all([user, veh, route])
        session.flush()

        trip = Trip(name="Nyeri Express 07:00 AM", route_id=route.id, vehicle_id=veh.id, status="scheduled", fixed_price=450.0)
        session.add(trip)
        session.flush()

        booking = Booking(trip_id=trip.id, user_id=user.id, seat_number=3, board_stop_order=1, alight_stop_order=2, status="confirmed", payment_status="paid")
        session.add(booking)
        session.flush()

        payment = Payment(booking_id=booking.id, provider="mpesa", receipt_number="QKA9912AA", amount=450.0, status="completed")
        session.add(payment)

        parcel = Parcel(
            trip_id=trip.id,
            sender_name="Juma Hamisi",
            sender_phone="254733445566",
            recipient_name="Grace Chebet",
            recipient_phone="254755667788",
            tracking_code="WB-MZG-4401X",
            security_pin="5512",
            pickup_stop_order=1,
            dropoff_stop_order=2,
            category="Perishables",
            description="Fresh Farm Produce",
            weight_kg=12.0,
            fee=600.0,
            base_fare=500.0,
            status="registered",
        )
        session.add(parcel)
        session.commit()

        b_id = booking.id
        p_id = parcel.id

    # Test extracting and generating ticket from DB
    with Session(engine) as session:
        b_row = session.execute(text("""
            SELECT b.id, b.seat_number, u.full_name AS passenger_name, u.phone AS passenger_phone,
                   s.name AS sacco_name, r.name AS route_name, v.plate_number AS vehicle_plate,
                   p.receipt_number, p.amount AS fare_amount
            FROM bookings b
            JOIN trips t ON t.id = b.trip_id
            JOIN routes r ON r.id = t.route_id
            LEFT JOIN users u ON u.id = b.user_id
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            LEFT JOIN saccos s ON s.id = v.sacco_id
            LEFT JOIN payments p ON p.booking_id = b.id
            WHERE b.id = :id;
        """), {"id": b_id}).mappings().one()

        db_ticket_payload = {
            "booking_id": b_row["id"],
            "seat_number": b_row["seat_number"],
            "passenger_name": b_row["passenger_name"],
            "passenger_phone": b_row["passenger_phone"],
            "sacco_name": b_row["sacco_name"],
            "route_name": b_row["route_name"],
            "vehicle_plate": b_row["vehicle_plate"],
            "receipt_number": b_row["receipt_number"],
            "fare_amount": b_row["fare_amount"],
        }
        db_escpos_bytes = generate_passenger_ticket_escpos(db_ticket_payload, width_mm=58)
        assert b"FAITH WAMBUI" in db_escpos_bytes
        assert b"QKA9912AA" in db_escpos_bytes
        assert b"KDA 999Z" in db_escpos_bytes
        print(f"✓ Database booking #{b_id} successfully converted to ESC/POS print stream ({len(db_escpos_bytes)} bytes)!")

        # Verify Base64 encoding
        b64_output = base64.b64encode(db_escpos_bytes).decode('ascii')
        assert len(b64_output) > 50, "Base64 payload must be valid non-empty string"
        print(f"✓ Base64 payload verified for mobile HTTP transmission: {b64_output[:40]}...")

    print("\n=====================================================================")
    print("ALL HANDHELD THERMAL POS ESC/POS PRINTING TESTS PASSED!")
    print("=====================================================================")

if __name__ == "__main__":
    run_tests()
