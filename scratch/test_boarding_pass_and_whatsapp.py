"""
End-to-End Verification Suite for:
  1. Cryptographic HMAC-SHA256 E-Boarding Pass Generator & Anti-Tamper Verification
  2. ISO/IEC 18004 Pure-Python QR Matrix & SVG Renderer
  3. PDF-1.4 Vector E-Boarding Pass Document Generation
  4. Two-Way Inbound WhatsApp Business Chatbot & Webhook Pipeline
"""

import sys
import os
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, List
import httpx

sys.path.insert(0, "/home/denno/Documents/PROJECT/busgo-project")
from backend.main import app
from backend.db import get_async_db
from backend.boarding_pass import (
    generate_ticket_hmac_token,
    verify_ticket_hmac_token,
    generate_qr_matrix,
    generate_qr_svg,
    generate_boarding_pass_pdf,
)
from backend.whatsapp_webhook import WHATSAPP_VERIFY_TOKEN


class MockQueryResult:
    def __init__(self, rows: List[Dict[str, Any]]):
        self._rows = rows

    def mappings(self):
        return self

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return self._rows

    def scalar_one(self):
        return 1

    def scalars(self):
        class ScalarMock:
            def first(s):
                return self._rows[0].get("id") if self._rows else None
            def all(s):
                return [r.get("id") for r in self._rows]
        return ScalarMock()


class MockAsyncDbSession:
    """Mock async DB session to verify endpoint routing without active postgres daemon."""

    async def execute(self, stmt, params=None):
        sql = str(stmt).upper()

        if "SELECT STOP_NAME" in sql:
            return MockQueryResult([
                {"stop_order": 1, "stop_name": "Nairobi CBD Railways"},
                {"stop_order": 2, "stop_name": "Nakuru Stage Terminus"},
            ])

        if "FROM BOOKINGS" in sql:
            return MockQueryResult([{
                "id": 101,
                "trip_id": 2,
                "seat_number": 7,
                "board_stop_order": 1,
                "alight_stop_order": 2,
                "status": "confirmed",
                "payment_status": "paid",
                "user_id": 10,
                "passenger_name": "Amina Mohamed",
                "passenger_phone": "+254716314831",
                "phone": "+254716314831",
                "full_name": "Amina Mohamed",
                "trip_name": "Super Metro Express",
                "route_name": "Nairobi — Nakuru Highway",
                "vehicle_plate": "KDA 123A",
                "vehicle_model": "Isuzu 33-Seater",
                "plate_number": "KDA 123A",
                "sacco_name": "SUPER METRO SACCO",
                "departure_time": datetime.now(timezone.utc),
                "scheduled_at": datetime.now(timezone.utc),
                "fixed_price": 500.0,
                "base_fare": 500.0,
                "has_luggage": False,
                "luggage_count": 0,
                "luggage_fee": 0.0,
                "receipt_number": "QK89AB1234",
                "payment_amount": 500.0,
            }])

        if "FROM TRIPS" in sql and "SELECT T.ID" in sql:
            return MockQueryResult([{
                "id": 2,
                "trip_name": "Super Metro Express",
                "scheduled_at": datetime.now(timezone.utc),
                "fixed_price": 500.0,
                "route_name": "Nairobi — Nakuru Highway",
                "base_fare": 500.0,
                "plate_number": "KDA 123A",
                "vehicle_model": "Isuzu 33-Seater",
                "booked_seats": 10,
                "total_seats": 33,
                "status": "in_transit",
                "latitude": -0.3031,
                "longitude": 36.0800,
                "speed": 65.0,
                "heading": 120.0,
                "battery_pct": 94,
            }])

        if "INSERT INTO DISPATCHES" in sql:
            return MockQueryResult([{"id": 42}])

        return MockQueryResult([])

    async def commit(self):
        pass

    async def rollback(self):
        pass


async def override_get_async_db():
    yield MockAsyncDbSession()


async def main():
    print("======================================================================")
    print("🚀 [TEST SUITE] Cryptographic PDF Boarding Pass & WhatsApp Bot")
    print("======================================================================")

    # -------------------------------------------------------------------------
    # Phase 1: Cryptographic HMAC Signature & Tamper Detection
    # -------------------------------------------------------------------------
    print("\n[PHASE 1] Cryptographic HMAC Token Integrity & Anti-Tamper Checks...")
    token = generate_ticket_hmac_token(booking_id=101, trip_id=2, seat_number=5)
    print(f"  Generated Signed Token: {token}")
    assert token.startswith("BG1:101:2:5:"), "Token prefix invalid"

    v_ok = verify_ticket_hmac_token(token)
    assert v_ok["valid"] is True, "Valid token failed verification"
    assert v_ok["booking_id"] == 101
    assert v_ok["trip_id"] == 2
    assert v_ok["seat_number"] == 5
    print("  ✓ Authentic token verified successfully.")

    # Tampered token (modified seat or corrupted signature)
    tampered_seat = token.replace(":5:", ":6:")
    v_tampered_seat = verify_ticket_hmac_token(tampered_seat)
    assert v_tampered_seat["valid"] is False, "Seat tampering was not detected!"
    assert v_tampered_seat.get("tampered") is True, "Tamper flag not set on altered seat"

    corrupted_sig = token[:-3] + "xyz"
    v_corrupted_sig = verify_ticket_hmac_token(corrupted_sig)
    assert v_corrupted_sig["valid"] is False, "Corrupted signature was not rejected!"
    print("  ✓ Anti-tamper defenses successfully blocked both altered seat and forged signature.")

    # -------------------------------------------------------------------------
    # Phase 2: QR Matrix & Vector SVG Generation
    # -------------------------------------------------------------------------
    print("\n[PHASE 2] Pure-Python ISO/IEC 18004 QR Matrix & Vector SVG...")
    matrix = generate_qr_matrix(token)
    dim = len(matrix)
    print(f"  Generated Model 2 QR Matrix: {dim}x{dim} modules")
    assert dim in (21, 25, 29, 33), f"Unexpected QR dimension {dim}"
    assert all(len(row) == dim for row in matrix)

    svg = generate_qr_svg(token, size_px=220)
    assert svg.startswith("<svg") and svg.endswith("</svg>")
    assert 'viewBox="0 0' in svg
    assert '<path d="M' in svg
    print(f"  ✓ QR SVG generated cleanly ({len(svg)} chars).")

    # -------------------------------------------------------------------------
    # Phase 3: Pure-Python PDF-1.4 E-Boarding Pass Document Generation
    # -------------------------------------------------------------------------
    print("\n[PHASE 3] PDF-1.4 Vector E-Boarding Pass Assembly...")
    test_booking_dict = {
        "id": 101,
        "trip_id": 2,
        "seat_number": 5,
        "passenger_name": "Kipchoge Keino",
        "passenger_phone": "+254716314831",
        "route_name": "Nairobi — Eldoret Express Corridor",
        "trip_name": "North Rift Shuttle 06:30 AM",
        "board_stop": "Nairobi Railways Stage",
        "alight_stop": "Eldoret Town Depot",
        "vehicle_plate": "KDF 991Z",
        "vehicle_model": "Toyota HiAce Shark 16-Seater",
        "sacco_name": "NORTH RIFT LUXURY SHUTTLE",
        "departure_time": "2026-10-10 06:30:00",
        "receipt_number": "MPESA-QK88901",
        "fare_amount": 1200.0,
        "has_luggage": True,
        "luggage_fee": 200.0,
        "payment_status": "paid",
    }
    pdf_bytes = generate_boarding_pass_pdf(test_booking_dict)
    print(f"  Generated Binary PDF: {len(pdf_bytes)} bytes")
    assert pdf_bytes.startswith(b"%PDF-1.4"), "PDF missing %PDF-1.4 header magic"
    assert b"%%EOF" in pdf_bytes[-40:], "PDF missing %%EOF trailer terminator"
    assert b"/Catalog" in pdf_bytes, "PDF missing Catalog object"
    assert b"/FlateDecode" in pdf_bytes, "PDF missing zlib FlateDecode compression stream"
    print("  ✓ Pure-Python PDF-1.4 compliance verified.")

    # -------------------------------------------------------------------------
    # Phase 4: Live HTTP API Endpoints via Async Client
    # -------------------------------------------------------------------------
    print("\n[PHASE 4] FastAPI Endpoints Verification (Boarding Pass & Verification)...")
    app.dependency_overrides[get_async_db] = override_get_async_db

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        live_booking_id = 101

        # 4a. GET /api/bookings/{id}/boarding-pass.pdf
        pdf_res = await client.get(f"/api/bookings/{live_booking_id}/boarding-pass.pdf")
        assert pdf_res.status_code == 200, f"PDF endpoint failed: {pdf_res.status_code} {pdf_res.text}"
        assert pdf_res.headers["content-type"] == "application/pdf"
        assert pdf_res.content.startswith(b"%PDF-1.4")
        print(f"  ✓ GET /api/bookings/{live_booking_id}/boarding-pass.pdf returned 200 application/pdf ({len(pdf_res.content)} bytes).")

        # 4b. GET /api/bookings/{id}/boarding-pass (JSON Metadata)
        meta_res = await client.get(f"/api/bookings/{live_booking_id}/boarding-pass")
        assert meta_res.status_code == 200, f"Metadata failed: {meta_res.status_code}"
        meta = meta_res.json()
        assert meta["ok"] is True
        assert meta["booking_id"] == live_booking_id
        assert meta["seat_number"] == 7
        assert meta["qr_token"].startswith(f"BG1:{live_booking_id}:2:7:")
        assert "<svg" in meta["qr_svg"]
        print("  ✓ GET /api/bookings/{id}/boarding-pass metadata JSON verified.")

        # 4c. POST /api/tickets/verify (Authentic token)
        verify_res = await client.post("/api/tickets/verify", json={"ticket_code": meta["qr_token"]})
        assert verify_res.status_code == 200
        v_data = verify_res.json()
        assert v_data["valid"] is True
        assert v_data["tampered"] is False
        assert v_data["seat_number"] == 7
        print("  ✓ POST /api/tickets/verify confirmed authentic ticket.")

        # 4d. POST /api/tickets/verify (Tampered token)
        fake_token = meta["qr_token"][:-3] + "abc"
        fake_res = await client.post("/api/tickets/verify", json={"ticket_code": fake_token})
        assert fake_res.status_code == 200
        fake_data = fake_res.json()
        assert fake_data["valid"] is False
        assert fake_data["tampered"] is True
        print("  ✓ POST /api/tickets/verify rejected forged ticket.")

        # ---------------------------------------------------------------------
        # Phase 5: Two-Way Inbound WhatsApp Business Chatbot Webhook
        # ---------------------------------------------------------------------
        print("\n[PHASE 5] Two-Way Inbound WhatsApp Webhook Verification...")

        # 5a. Meta Webhook Verification Challenge (hub.challenge)
        challenge_res = await client.get(
            "/api/webhooks/whatsapp",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": WHATSAPP_VERIFY_TOKEN,
                "hub.challenge": "1234567890",
            }
        )
        assert challenge_res.status_code == 200
        assert challenge_res.text == "1234567890"
        print("  ✓ GET /api/webhooks/whatsapp verified Meta challenge.")

        # 5b. Inbound Message Processing (Option 1: Routes)
        msg_1_res = await client.post(
            "/api/webhooks/whatsapp/simulate",
            json={"phone": "0716314831", "message": "ROUTES", "name": "Amina"}
        )
        assert msg_1_res.status_code == 200
        m1 = msg_1_res.json()
        assert m1["ok"] is True
        assert "SCHEDULED DEPARTURES" in m1["reply_body"] or "CORRIDORS" in m1["reply_body"]
        print("  ✓ WhatsApp Bot 'ROUTES' query returned live schedules.")

        # 5c. Inbound Message Processing (Option 2: Ticket Lookup)
        msg_2_res = await client.post(
            "/api/webhooks/whatsapp/simulate",
            json={"phone": "0716314831", "message": f"TICKET {live_booking_id}", "name": "Amina"}
        )
        assert msg_2_res.status_code == 200
        m2 = msg_2_res.json()
        assert m2["ok"] is True
        assert "E-BOARDING PASS" in m2["reply_body"]
        assert f"#{live_booking_id}" in m2["reply_body"] or "Seat" in m2["reply_body"]
        assert ".pdf" in m2["reply_body"]
        print("  ✓ WhatsApp Bot 'TICKET' query returned e-boarding pass & PDF link.")

        # 5d. Inbound Message Processing (Option 3: GPS Radar)
        msg_3_res = await client.post(
            "/api/webhooks/whatsapp/simulate",
            json={"phone": "0716314831", "message": "TRACK", "name": "Amina"}
        )
        assert msg_3_res.status_code == 200
        m3 = msg_3_res.json()
        assert m3["ok"] is True
        assert "GPS" in m3["reply_body"] or "RADAR" in m3["reply_body"]
        print("  ✓ WhatsApp Bot 'TRACK' query returned live radar response.")

        # 5e. Inbound Welcome Menu (Greeting)
        greet_res = await client.post(
            "/api/webhooks/whatsapp/simulate",
            json={"phone": "0716314831", "message": "HABARI", "name": "Amina"}
        )
        assert greet_res.status_code == 200
        g = greet_res.json()
        assert "BUSGO TRANSIT KENYA" in g["reply_body"]
        assert "ROUTES" in g["reply_body"]
        print("  ✓ WhatsApp Bot greeting returned interactive welcome menu.")

    print("\n======================================================================")
    print("🎉 ALL 5 TEST PHASES PASSED WITH ZERO ERRORS!")
    print("======================================================================")


if __name__ == "__main__":
    asyncio.run(main())
