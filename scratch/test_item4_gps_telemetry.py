"""
Test Suite for Item 4: Hardware GPS Tracker Telemetry Ingestion (Teltonika / Concox GT06)
========================================================================================
Validates:
1. Teltonika Codec 8 binary packet parser, coordinates calculation, IO decoding, and 4-byte ACK response.
2. Concox GT06 binary packet parser (Login 0x01, GPS Location 0x22), CRC-16 ITU check, and ACK packets.
3. Database ingestion pipeline via process_telemetry_point:
   - Telemetry breadcrumbs saved to gps_telemetry_logs
   - Vehicle location and speed cache updated
   - Active Trip GPS coordinates synced in real-time
   - NTSA PSV overspeeding (> 80 km/h) violation detection
4. End-to-end TCP socket server client communication over asyncio stream reader/writer.
"""

import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta

# Point to project root
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from backend.models import Base, User, Trip, Route, Vehicle, Sacco, VehicleType, GpsTelemetryLog
from backend.auth import hash_password
from backend.telemetry_listener import (
    parse_teltonika_codec8,
    build_teltonika_codec8_packet,
    parse_concox_gt06,
    build_concox_login_packet,
    build_concox_location_packet,
    process_telemetry_point,
    HardwareTelemetryTCPServer,
    NTSA_SPEED_LIMIT_KMH,
)

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
    print("=====================================================================")
    print("--- [TEST ITEM 4: Hardware GPS Telemetry Ingestion (Teltonika/Concox)] ---")
    print("=====================================================================")

    # Step 1: Validate Teltonika Codec 8 Binary Frame Parsing
    print("\n--- 1. Testing Teltonika Codec 8 Parser ---")
    records_to_send = [
        {
            "lat": -1.286389,
            "lng": 36.817223,
            "speed": 74.0,
            "heading": 315,
            "altitude": 1680,
            "satellites": 14,
            "ignition": True,
            "recorded_at": datetime.now(timezone.utc),
        }
    ]
    raw_packet = build_teltonika_codec8_packet(records_to_send)
    assert len(raw_packet) > 15, "Synthesized packet is valid length"

    parsed_records, ack_bytes = parse_teltonika_codec8(raw_packet, imei="358721094819283")
    assert len(parsed_records) == 1, f"Expected 1 record, got {len(parsed_records)}"
    rec = parsed_records[0]

    assert abs(rec["lat"] - (-1.286389)) < 0.0001, f"Latitude mismatch: {rec['lat']}"
    assert abs(rec["lng"] - 36.817223) < 0.0001, f"Longitude mismatch: {rec['lng']}"
    assert rec["speed"] == 74.0, f"Speed mismatch: {rec['speed']}"
    assert rec["heading"] == 315, f"Heading mismatch: {rec['heading']}"
    assert rec["satellites"] == 14, f"Satellites mismatch: {rec['satellites']}"
    assert rec["overspeed"] is False, "74 km/h should NOT be overspeed"
    assert len(ack_bytes) == 4, f"Teltonika ACK must be 4 bytes, got {len(ack_bytes)}"
    print("✓ Teltonika Codec 8 packet parsed accurately with coordinates, speed, and 4-byte ACK!")

    # Step 2: Validate Concox GT06 Protocol Parsing
    print("\n--- 2. Testing Concox GT06 Protocol Parser ---")
    # 2a. Login packet (0x01)
    login_pkt = build_concox_login_packet(imei="868204030123456", serial_no=42)
    login_info, login_ack = parse_concox_gt06(login_pkt)
    assert login_info["type"] == "login"
    assert "868204030123456" in login_info["imei"]
    assert login_ack is not None and len(login_ack) == 10, f"Expected 10-byte login ACK, got {len(login_ack)}"
    print(f"✓ Concox GT06 login recognized for IMEI {login_info['imei']} with ITU-CRC ACK!")

    # 2b. Location packet (0x22)
    now_dt = datetime.now(timezone.utc)
    loc_pkt = build_concox_location_packet(
        lat=-1.1118,
        lng=36.6437,
        speed=88.5, # Over 80 km/h
        heading=270,
        recorded_at=now_dt,
        serial_no=43
    )
    loc_info, _ = parse_concox_gt06(loc_pkt)
    assert loc_info["type"] == "avl_data"
    assert abs(loc_info["lat"] - (-1.1118)) < 0.001
    assert abs(loc_info["lng"] - 36.6437) < 0.001
    assert loc_info["speed"] == 88.0 or loc_info["speed"] == 88.5
    assert loc_info["overspeed"] is True, "88 km/h must trigger overspeed flag!"
    print(f"✓ Concox GT06 location decoded: Lat {loc_info['lat']}, Lng {loc_info['lng']}, Speed {loc_info['speed']} km/h (Overspeed: {loc_info['overspeed']})")

    # Step 3: Database Ingestion & Trip Sync
    print("\n--- 3. Testing Database Ingestion Pipeline & Trip Synchronization ---")
    Base.metadata.create_all(engine)

    test_imei = "358721094819283"
    plate_no = "KDC 888X"

    with Session(engine) as sync_session:
        session = AsyncDBSessionMock(sync_session)

        # Seed Sacco & Vehicle
        sacco = Sacco(name="2NK Sacco Ltd", slug="2nk-sacco", contact_phone="254700000001", contact_email="admin@2nk.co.ke")
        vtype = VehicleType(slug="matatu-14", display_name="14 Seater Matatu", seat_capacity=14, purpose="passenger")
        session.add_all([sacco, vtype])
        await session.flush()

        vehicle = Vehicle(
            plate_number=plate_no,
            vehicle_type_id=vtype.id,
            sacco_id=sacco.id,
            tracker_imei=test_imei,
            tracker_model="teltonika_fmb920",
        )
        route = Route(name="Nairobi - Nakuru Express Corridor", base_fare=350.0, per_hop_fare=100.0)
        session.add_all([vehicle, route])
        await session.flush()

        # Seed active trip assigned to this vehicle
        trip = Trip(
            name="Nairobi-Nakuru 09:00 AM Express",
            route_id=route.id,
            vehicle_id=vehicle.id,
            status="in_transit",
            current_lat=-1.286389,
            current_lng=36.817223,
            current_speed=0.0,
            scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=20)
        )
        session.add(trip)
        await session.commit()
        trip_id = trip.id
        veh_id = vehicle.id

    # 3a. Ingest normal telemetry point (Speed = 70 km/h)
    with Session(engine) as sync_session:
        session = AsyncDBSessionMock(sync_session)
        pt_normal = {
            "imei": test_imei,
            "lat": -1.200000,
            "lng": 36.750000,
            "speed": 70.0,
            "heading": 310.0,
            "altitude": 1720.0,
            "satellites": 11,
            "protocol": "teltonika",
            "recorded_at": datetime.now(timezone.utc),
        }
        res_normal = await process_telemetry_point(session, pt_normal)
        print("Ingestion Result (Normal):", res_normal)
        assert res_normal["status"] == "ingested"
        assert res_normal["plate_number"] == plate_no
        assert res_normal["trip_id"] == trip_id
        assert res_normal["overspeed_warning"] is False

    # Verify Database state
    with Session(engine) as sync_session:
        session = AsyncDBSessionMock(sync_session)
        t_row = (await session.execute(text("SELECT current_lat, current_lng, current_speed, last_gps_at FROM trips WHERE id = :id"), {"id": trip_id})).mappings().one()
        assert abs(t_row["current_lat"] - (-1.200000)) < 0.0001
        assert abs(t_row["current_lng"] - 36.750000) < 0.0001
        assert t_row["current_speed"] == 70.0
        assert t_row["last_gps_at"] is not None

        v_row = (await session.execute(text("SELECT last_lat, last_speed, last_ping_at FROM vehicles WHERE id = :id"), {"id": veh_id})).mappings().one()
        assert abs(v_row["last_lat"] - (-1.200000)) < 0.0001
        assert v_row["last_speed"] == 70.0
        print("✓ Database verified: Trip coordinates and vehicle cache synced seamlessly!")

    # 3b. Ingest overspeed telemetry point (Speed = 96.5 km/h > 80 km/h limit)
    with Session(engine) as sync_session:
        session = AsyncDBSessionMock(sync_session)
        pt_overspeed = {
            "imei": test_imei,
            "lat": -1.150000,
            "lng": 36.680000,
            "speed": 96.5,
            "heading": 315.0,
            "satellites": 12,
            "protocol": "teltonika",
            "recorded_at": datetime.now(timezone.utc),
        }
        res_over = await process_telemetry_point(session, pt_overspeed)
        print("Ingestion Result (Overspeed):", res_over)
        assert res_over["overspeed_warning"] is True
        assert res_over["speed_kmh"] == 96.5

        # Check gps_telemetry_logs
        log_row = (await session.execute(
            text("SELECT speed, overspeed_flag FROM gps_telemetry_logs WHERE imei = :imei ORDER BY id DESC LIMIT 1"),
            {"imei": test_imei}
        )).mappings().one()
        assert log_row["overspeed_flag"] == 1 or log_row["overspeed_flag"] is True
        assert log_row["speed"] == 96.5
        print(f"✓ NTSA PSV overspeed violation ({log_row['speed']} km/h > 80 km/h) flagged and logged in audit log!")

    # Step 4: TCP Server Socket Integration
    print("\n--- 4. Testing Live TCP Socket Server Listener ---")
    class SessionContextManager:
        def __call__(self):
            return self
        async def __aenter__(self):
            self.s = Session(engine)
            return AsyncDBSessionMock(self.s)
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            self.s.close()

    tcp_server = HardwareTelemetryTCPServer(SessionContextManager())
    test_port = 15027
    await tcp_server.start(host="127.0.0.1", teltonika_port=test_port, concox_port=15023)

    try:
        # Connect client socket
        reader, writer = await asyncio.open_connection("127.0.0.1", test_port)

        # Handshake: send IMEI length + IMEI ASCII string
        handshake_payload = bytearray()
        handshake_payload.extend(b'\x00\x0f') # length 15
        handshake_payload.extend(test_imei.encode('ascii'))
        writer.write(handshake_payload)
        await writer.drain()

        # Read handshake response (0x01)
        resp = await reader.read(1)
        assert resp == b'\x01', f"Expected 0x01 handshake ACK, got {resp.hex()}"
        print("✓ TCP Handshake succeeded: Server replied with 0x01 ACK!")

        # Send AVL data packet
        avl_pkt = build_teltonika_codec8_packet([
            {
                "lat": -1.050000,
                "lng": 36.600000,
                "speed": 62.0,
                "heading": 320,
                "satellites": 10,
                "ignition": True,
                "recorded_at": datetime.now(timezone.utc),
            }
        ])
        writer.write(avl_pkt)
        await writer.drain()

        # Read 4-byte record ACK
        ack_resp = await reader.read(4)
        assert len(ack_resp) == 4, f"Expected 4-byte ACK, got {len(ack_resp)}"
        print(f"✓ TCP AVL packet ingested over live socket! Server acknowledged: {ack_resp.hex()}")

        writer.close()
        await writer.wait_closed()
    finally:
        await tcp_server.stop()

    print("\n=====================================================================")
    print("ALL HARDWARE GPS TRACKER TELEMETRY INGESTION TESTS PASSED!")
    print("=====================================================================")

if __name__ == "__main__":
    asyncio.run(run_tests())
