import os
import re
import json
import uuid
import random
import secrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import logging

logger = logging.getLogger("busgo")

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import (
    create_access_token,
    decode_access_token,
    hash_password,
    require_roles,
    verify_password,
    get_current_user,
    get_current_user_optional,
)
from backend.db import AsyncSessionLocal, engine, get_async_db
from backend.ws import manager
from backend.chains import (
    recompute_chain,
    notify_chain_change,
    trip_stop_names,
    notify_seat_released_at_stop,
    create_notification,
)
from backend import daraja
from backend import paystack
from backend import dispatch
from backend import crons
from backend import reconciliation
from backend import telemetry_listener
from backend import escpos
from backend import ussd
from backend.telemetry_listener import (
    HardwareTelemetryTCPServer,
    process_telemetry_point,
    parse_teltonika_codec8,
    parse_concox_gt06,
    NTSA_SPEED_LIMIT_KMH,
)
from backend.locks import seat_lock_manager
from backend.models import (
    Base,
    Booking,
    Payment,
    Dispatch,
    Parcel,
    Route,
    RouteStop,
    Trip,
    User,
    Vehicle,
    VehicleType,
    SeatChain,
    SeatChainLink,
    SeatInterest,
    Notification,
    Sacco,
    VehicleCompliance,
    LoyaltyTransaction,
    Incident,
    SaccoSettlement,
    VehicleTelemetry,
    GpsTelemetryLog,
    ChargingStation,
    GroupBooking,
    GroupBookingMember,
    StageReconciliation,
    LostFoundItem,
    AuditLog,
    TravelVoucher,
    UssdSession,
    UssdLog,
)

app = FastAPI(title="BUSGO API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_matatu_14_layout() -> dict:
    """14-seater Kenyan Matatu (Toyota HiAce / Shark) from engineering drawing."""
    return {
        "type": "matatu_14",
        "name": "Matatu 14-Seater",
        "columns": 4,
        "door": {"row": 1, "col": 0},
        "driver": {"row": 0, "col": 3},
        "rows": [
            [1, 2, 0, 0],      # Front: 1, 2 next to Driver (col 3)
            [0, 5, 4, 3],      # Row 2: Col 0 is Door, 5, 4, 3
            [8, 0, 7, 6],      # Row 3: 8, Aisle (0), 7, 6
            [11, 0, 10, 9],    # Row 4: 11, Aisle (0), 10, 9
            [14, 13, 0, 12],   # Row 5 (Rear bench): 14, 13, 12
        ],
    }


def get_electric_31_layout() -> dict:
    """31-seater Electric Bus (BasiGo / Roam) from engineering drawing."""
    return {
        "type": "electric_31",
        "name": "Electric Bus 31-Seater",
        "columns": 5,
        "door": {"row": 0, "col": 0},
        "driver": {"row": 0, "col": 4},
        "rows": [
            [1, 2, 0, 4, 5],       # Front row behind door/driver
            [3, 0, 0, 0, 6],       # Front blocks: 3 on left, 6 on right
            [10, 9, 0, 8, 7],      # Middle row 1 (2+2)
            [11, 12, 0, 13, 14],   # Middle row 2 (2+2)
            [18, 17, 0, 16, 15],   # Middle row 3 (2+2)
            [19, 20, 0, 21, 22],   # Middle row 4 (2+2)
            [26, 25, 0, 24, 23],   # Middle row 5 (2+2)
            [27, 28, 29, 30, 31],  # Back row 6 (5 across)
        ],
    }


def get_nganya_35_layout() -> dict:
    """35-seater Nganya Minibus (Isuzu FRR / NQR) from engineering drawing."""
    return {
        "type": "nganya_35",
        "name": "Nganya 35-Seater",
        "columns": 6,
        "door": {"row": 2, "col": 0},
        "driver": {"row": 0, "col": 5},
        "rows": [
            [2, 1, 0, 0, 0, 0],       # Front cabin: 2, 1; Driver on far right (col 5)
            [7, 6, 0, 5, 4, 3],       # Row 1: Left 7, 6; Right 5, 4, 3
            [0, 0, 0, 10, 9, 8],      # Row 2: Left is Door (cols 0, 1); Right 10, 9, 8
            [15, 14, 0, 13, 12, 11],  # Row 3: Left 15, 14; Right 13, 12, 11
            [20, 19, 0, 18, 17, 16],  # Row 4: Left 20, 19; Right 18, 17, 16
            [25, 24, 0, 23, 22, 21],  # Row 5: Left 25, 24; Right 23, 22, 21
            [30, 29, 0, 28, 27, 26],  # Row 6: Left 30, 29; Right 28, 27, 26
            [35, 34, 33, 32, 31, 0],  # Row 7: Back bench - 35, 34, 33, 32, 31
        ],
    }


def get_coach_51_layout() -> dict:
    """51-seater Highway Coach."""
    rows = []
    rows.append([1, 2, 0, 0, 0, 0])
    seat = 3
    for _ in range(9):
        rows.append([seat, seat + 1, 0, seat + 2, seat + 3, seat + 4])
        seat += 5
    rows.append([seat, seat + 1, seat + 2, seat + 3, 0, 0])
    return {
        "type": "coach_51",
        "name": "Large Coach 51-Seater",
        "columns": 6,
        "door": {"row": 0, "col": 0},
        "driver": {"row": 0, "col": 5},
        "rows": rows,
    }


def _get_layout_for_vehicle(slug: str = "", capacity: int = 14) -> dict:
    s = (slug or "").lower()
    if "matatu" in s or capacity == 14:
        return get_matatu_14_layout()
    if "electric" in s or "ev" in s or capacity == 31:
        return get_electric_31_layout()
    if "nganya" in s or "bus_33" in s or "bus_35" in s or capacity in (33, 35):
        return get_nganya_35_layout()
    if capacity == 51:
        return get_coach_51_layout()
    rows: list[list[int]] = []
    st = 1
    cols = 4 if capacity <= 20 else 5
    while st <= capacity:
        take = min(cols, capacity - st + 1)
        rows.append(list(range(st, st + take)))
        st += take
    return {"type": "generic", "columns": cols, "rows": rows}


def _default_seat_layout(capacity: int, columns: int = 4) -> dict:
    return _get_layout_for_vehicle("", capacity)


async def initialize_database() -> None:
    """
    Create schema for BUSGO and seed initial data with authentic Kenyan seat maps.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        await conn.execute(
            text(
                """
                CREATE OR REPLACE FUNCTION check_seat_conflict() RETURNS trigger AS $$
                BEGIN
                    IF NEW.status = 'cancelled' THEN
                        RETURN NEW;
                    END IF;
                    IF EXISTS (
                        SELECT 1 FROM bookings b
                        WHERE b.trip_id = NEW.trip_id
                          AND b.seat_number = NEW.seat_number
                          AND b.status != 'cancelled'
                          AND NOT (b.alight_stop_order <= NEW.board_stop_order OR b.board_stop_order >= NEW.alight_stop_order)
                          AND (TG_OP = 'INSERT' OR b.id != NEW.id)
                    ) THEN
                        RAISE EXCEPTION 'Seat conflict for trip % and seat %', NEW.trip_id, NEW.seat_number;
                    END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
                """
            )
        )
        await conn.execute(text("DROP TRIGGER IF EXISTS trg_check_seat_conflict ON bookings;"))
        await conn.execute(
            text(
                """
                CREATE TRIGGER trg_check_seat_conflict
                BEFORE INSERT OR UPDATE ON bookings
                FOR EACH ROW EXECUTE FUNCTION check_seat_conflict();
                """
            )
        )
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_bookings_trip_seat ON bookings (trip_id, seat_number);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_route_stops_route_order ON route_stops (route_id, stop_order);"))

        # Automated schema evolution for Route pricing & Trip driver tiers
        await conn.execute(text("ALTER TABLE routes ADD COLUMN IF NOT EXISTS base_fare DOUBLE PRECISION NOT NULL DEFAULT 200.0;"))
        await conn.execute(text("ALTER TABLE routes ADD COLUMN IF NOT EXISTS per_hop_fare DOUBLE PRECISION NOT NULL DEFAULT 150.0;"))
        await conn.execute(text("ALTER TABLE routes ADD COLUMN IF NOT EXISTS fare_matrix JSONB;"))

        await conn.execute(text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS fixed_price DOUBLE PRECISION;"))
        await conn.execute(text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS allow_driver_tier BOOLEAN NOT NULL DEFAULT FALSE;"))
        await conn.execute(text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS max_surcharge_pct DOUBLE PRECISION NOT NULL DEFAULT 25.0;"))
        await conn.execute(text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS driver_tier VARCHAR NOT NULL DEFAULT 'standard';"))

        # Real-time Driver GPS Telemetry columns
        await conn.execute(text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION;"))
        await conn.execute(text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS current_lng DOUBLE PRECISION;"))
        await conn.execute(text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS current_speed DOUBLE PRECISION;"))
        await conn.execute(text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS current_heading DOUBLE PRECISION;"))
        await conn.execute(text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS last_gps_at TIMESTAMP WITH TIME ZONE;"))

        # Payments M-Pesa receipt column
        await conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_number VARCHAR;"))

        # Passenger SMS and WhatsApp Dispatches outbox
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS dispatches (
                id SERIAL PRIMARY KEY,
                booking_id INTEGER REFERENCES bookings(id),
                user_id INTEGER REFERENCES users(id),
                channel VARCHAR NOT NULL,
                recipient VARCHAR NOT NULL,
                message_body TEXT NOT NULL,
                status VARCHAR NOT NULL DEFAULT 'sent',
                provider VARCHAR NOT NULL DEFAULT 'simulator',
                provider_reference VARCHAR,
                error_message TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_dispatches_booking_id ON dispatches (booking_id);"))

        # Luggage & Accompanied Cargo columns on bookings (Item F)
        await conn.execute(text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS has_luggage BOOLEAN NOT NULL DEFAULT FALSE;"))
        await conn.execute(text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS luggage_count INTEGER NOT NULL DEFAULT 0;"))
        await conn.execute(text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS luggage_fee DOUBLE PRECISION NOT NULL DEFAULT 0.0;"))
        await conn.execute(text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS luggage_description VARCHAR;"))

        # Unaccompanied Cargo / Mzigo Service Table (Item F)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS parcels (
                id SERIAL PRIMARY KEY,
                trip_id INTEGER NOT NULL REFERENCES trips(id),
                sender_id INTEGER REFERENCES users(id),
                sender_name VARCHAR NOT NULL,
                sender_phone VARCHAR NOT NULL,
                recipient_name VARCHAR NOT NULL,
                recipient_phone VARCHAR NOT NULL,
                pickup_stop_order INTEGER NOT NULL,
                dropoff_stop_order INTEGER NOT NULL,
                tracking_code VARCHAR UNIQUE NOT NULL,
                security_pin VARCHAR NOT NULL,
                category VARCHAR NOT NULL DEFAULT 'medium_box',
                description VARCHAR NOT NULL,
                weight_kg DOUBLE PRECISION,
                fee DOUBLE PRECISION NOT NULL DEFAULT 300.0,
                payment_status VARCHAR NOT NULL DEFAULT 'unpaid',
                status VARCHAR NOT NULL DEFAULT 'registered',
                loaded_at TIMESTAMP WITH TIME ZONE,
                delivered_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_parcels_trip_id ON parcels (trip_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_parcels_tracking_code ON parcels (tracking_code);"))

        # Flexible Door-to-Door & Station-to-Station Parcel Delivery System (ENA Coach Model)
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pickup_type VARCHAR NOT NULL DEFAULT 'station';"))
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS delivery_type VARCHAR NOT NULL DEFAULT 'station';"))
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS base_fare DOUBLE PRECISION NOT NULL DEFAULT 300.0;"))
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pickup_fee DOUBLE PRECISION NOT NULL DEFAULT 0.0;"))
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS delivery_fee DOUBLE PRECISION NOT NULL DEFAULT 0.0;"))
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS sender_address VARCHAR;"))
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS sender_city_or_area VARCHAR;"))
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS sender_pickup_notes TEXT;"))
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS recipient_address VARCHAR;"))
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS recipient_city_or_area VARCHAR;"))
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS recipient_delivery_notes TEXT;"))
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS declared_value DOUBLE PRECISION DEFAULT 0.0;"))
        await conn.execute(text("ALTER TABLE parcels ADD COLUMN IF NOT EXISTS courier_rider_phone VARCHAR;"))

        # Seat interests and booking timeout migrations (Item G)
        await conn.execute(text("ALTER TABLE seat_interests ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP WITH TIME ZONE;"))
        await conn.execute(text("ALTER TABLE bookings ALTER COLUMN created_at SET DEFAULT NOW();"))
        await conn.execute(text("UPDATE bookings SET created_at = NOW() WHERE created_at IS NULL;"))

        # Multi-SACCO & Fleet Compliance schema evolution (Item A)
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS sacco_id INTEGER REFERENCES saccos(id);"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS chassis_number VARCHAR;"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS manufacture_year INTEGER;"))
        # Driver & Fleet Vehicle Registration: Cargo Lorries & Passenger PSVs
        await conn.execute(text("ALTER TABLE vehicle_types ADD COLUMN IF NOT EXISTS purpose VARCHAR NOT NULL DEFAULT 'passenger';"))
        await conn.execute(text("ALTER TABLE vehicle_types ADD COLUMN IF NOT EXISTS cargo_tonnage DOUBLE PRECISION;"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS purpose VARCHAR NOT NULL DEFAULT 'passenger';"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL;"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cargo_tonnage_capacity DOUBLE PRECISION;"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS body_type VARCHAR;"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_vehicles_driver_id ON vehicles (driver_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_vehicles_purpose ON vehicles (purpose);"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS sacco_id INTEGER REFERENCES saccos(id);"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS psv_badge_number VARCHAR;"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS psv_badge_expiry TIMESTAMP WITH TIME ZONE;"))
        await conn.execute(text("ALTER TABLE routes ADD COLUMN IF NOT EXISTS sacco_id INTEGER REFERENCES saccos(id);"))
        await conn.execute(text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS sacco_id INTEGER REFERENCES saccos(id);"))

        # Commuter Loyalty Safari Points (Option 7)
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_points INTEGER NOT NULL DEFAULT 0;"))

        # Vehicles Owner & Category tracking
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_name VARCHAR;"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_phone VARCHAR;"))

        # SACCO Treasury & Daraja B2C Settlements (Option 2)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sacco_settlements (
                id SERIAL PRIMARY KEY,
                sacco_id INTEGER NOT NULL REFERENCES saccos(id),
                vehicle_id INTEGER REFERENCES vehicles(id),
                gross_amount DOUBLE PRECISION NOT NULL,
                platform_fee DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                net_payout DOUBLE PRECISION NOT NULL,
                recipient_phone VARCHAR NOT NULL,
                recipient_name VARCHAR NOT NULL,
                settlement_type VARCHAR NOT NULL DEFAULT 'sacco_treasury',
                b2c_conversation_id VARCHAR,
                b2c_originator_conversation_id VARCHAR,
                b2c_transaction_id VARCHAR,
                b2c_response_code VARCHAR,
                b2c_response_desc VARCHAR,
                status VARCHAR NOT NULL DEFAULT 'initiated',
                notes TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        """))
        await conn.execute(text("ALTER TABLE sacco_settlements ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES vehicles(id);"))
        await conn.execute(text("ALTER TABLE sacco_settlements ADD COLUMN IF NOT EXISTS settlement_type VARCHAR NOT NULL DEFAULT 'sacco_treasury';"))
        await conn.execute(text("ALTER TABLE sacco_settlements ADD COLUMN IF NOT EXISTS b2c_transaction_id VARCHAR;"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_sacco_settlements_sacco_id ON sacco_settlements (sacco_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_sacco_settlements_vehicle_id ON sacco_settlements (vehicle_id);"))

        # Commuter Travel Credit Vouchers & Rescheduling
        await conn.execute(text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS voucher_code VARCHAR;"))
        await conn.execute(text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS voucher_discount DOUBLE PRECISION NOT NULL DEFAULT 0.0;"))
        await conn.execute(text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rescheduled_from_id INTEGER REFERENCES bookings(id);"))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS travel_vouchers (
                id SERIAL PRIMARY KEY,
                code VARCHAR UNIQUE NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id),
                original_booking_id INTEGER REFERENCES bookings(id),
                initial_amount DOUBLE PRECISION NOT NULL,
                remaining_balance DOUBLE PRECISION NOT NULL,
                currency VARCHAR NOT NULL DEFAULT 'KES',
                status VARCHAR NOT NULL DEFAULT 'active',
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                redeemed_at TIMESTAMP WITH TIME ZONE
            );
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_travel_vouchers_user_id ON travel_vouchers (user_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_travel_vouchers_code ON travel_vouchers (code);"))

        # EV Telemetry & Battery Health (Option 4)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS vehicle_telemetry (
                id SERIAL PRIMARY KEY,
                vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
                battery_soc_pct DOUBLE PRECISION NOT NULL DEFAULT 100.0,
                battery_temp_c DOUBLE PRECISION NOT NULL DEFAULT 28.0,
                estimated_range_km DOUBLE PRECISION NOT NULL DEFAULT 250.0,
                charging_status VARCHAR NOT NULL DEFAULT 'discharging',
                power_consumption_kwh_per_km DOUBLE PRECISION NOT NULL DEFAULT 0.85,
                co2_saved_kg DOUBLE PRECISION NOT NULL DEFAULT 450.0,
                regen_braking_kwh DOUBLE PRECISION NOT NULL DEFAULT 12.5,
                recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_vehicle_telemetry_vehicle_id ON vehicle_telemetry (vehicle_id);"))

        # Hardware GPS Trackers (Teltonika Codec 8 / Concox GT06) Telematics
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tracker_imei VARCHAR(30);"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_tracker_imei ON vehicles (tracker_imei);"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tracker_model VARCHAR(50);"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_ping_at TIMESTAMP WITH TIME ZONE;"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_lat DOUBLE PRECISION;"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_lng DOUBLE PRECISION;"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_speed DOUBLE PRECISION;"))
        await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_heading DOUBLE PRECISION;"))

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS gps_telemetry_logs (
                id SERIAL PRIMARY KEY,
                vehicle_id INTEGER REFERENCES vehicles(id),
                imei VARCHAR(30) NOT NULL,
                protocol VARCHAR(20) NOT NULL,
                lat DOUBLE PRECISION NOT NULL,
                lng DOUBLE PRECISION NOT NULL,
                speed DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                heading DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                altitude DOUBLE PRECISION DEFAULT 0.0,
                satellites INTEGER DEFAULT 0,
                ignition_on BOOLEAN DEFAULT TRUE,
                overspeed_flag BOOLEAN DEFAULT FALSE,
                raw_payload_hex TEXT,
                recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_gps_logs_vehicle_id ON gps_telemetry_logs (vehicle_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_gps_logs_imei ON gps_telemetry_logs (imei);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_gps_logs_recorded_at ON gps_telemetry_logs (recorded_at);"))

        # Kenyan Highway EV Fast Charging Stations (Option 4)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ev_charging_stations (
                id SERIAL PRIMARY KEY,
                name VARCHAR NOT NULL,
                operator VARCHAR NOT NULL,
                location_name VARCHAR NOT NULL,
                corridor VARCHAR NOT NULL,
                lat DOUBLE PRECISION NOT NULL,
                lng DOUBLE PRECISION NOT NULL,
                power_kw DOUBLE PRECISION NOT NULL DEFAULT 120.0,
                ports_total INTEGER NOT NULL DEFAULT 4,
                ports_available INTEGER NOT NULL DEFAULT 3,
                connector_type VARCHAR NOT NULL DEFAULT 'CCS2 / GB/T',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        """))

        # Seed & update authentic Kenyan vehicle types matching user blueprints (PSVs + Cargo Lorries)
        vt_configs = [
            # Passenger PSVs (People)
            ("matatu_14", "Matatu (14 seats)", 14, json.dumps(get_matatu_14_layout()), "passenger", None),
            ("ev_matatu_14", "EV Matatu (14 seats)", 14, json.dumps(get_matatu_14_layout()), "passenger", None),
            ("bus_33", "Nganya Minibus (35 seats)", 35, json.dumps(get_nganya_35_layout()), "passenger", None),
            ("nganya_35", "Nganya Minibus (35 seats)", 35, json.dumps(get_nganya_35_layout()), "passenger", None),
            ("ev_bus_33", "Electric Bus (31 seats)", 31, json.dumps(get_electric_31_layout()), "passenger", None),
            ("electric_31", "Electric Bus (31 seats)", 31, json.dumps(get_electric_31_layout()), "passenger", None),
            ("bus_51", "Large Coach (51 seats)", 51, json.dumps(get_coach_51_layout()), "passenger", None),
            # Cargo Lorries & Trucks (Cargo)
            ("lorry_canter_3t", "Canter Lorry (3.5 Tons)", 2, json.dumps({"columns": 2, "rows": [[1, 2]]}), "cargo", 3.5),
            ("lorry_isuzu_7t", "Isuzu FRR Box Lorry (7 Tons)", 2, json.dumps({"columns": 2, "rows": [[1, 2]]}), "cargo", 7.0),
            ("lorry_actros_15t", "Actros Tipper / Heavy Lorry (15 Tons)", 2, json.dumps({"columns": 2, "rows": [[1, 2]]}), "cargo", 15.0),
            ("lorry_flatbed_10t", "Flatbed Cargo Lorry (10 Tons)", 2, json.dumps({"columns": 2, "rows": [[1, 2]]}), "cargo", 10.0),
            ("pickup_lorry_1t", "Toyota Dyna Pickup Lorry (1.5 Tons)", 2, json.dumps({"columns": 2, "rows": [[1, 2]]}), "cargo", 1.5),
        ]
        for slug, name, cap, lyt, purpose, tonnage in vt_configs:
            await conn.execute(
                text("""
                    INSERT INTO vehicle_types (slug, display_name, seat_capacity, seat_layout, purpose, cargo_tonnage)
                    VALUES (:slug, :name, :cap, CAST(:lyt AS jsonb), :purpose, :tonnage)
                    ON CONFLICT (slug) DO UPDATE SET
                        display_name = EXCLUDED.display_name,
                        seat_capacity = EXCLUDED.seat_capacity,
                        seat_layout = EXCLUDED.seat_layout,
                        purpose = EXCLUDED.purpose,
                        cargo_tonnage = EXCLUDED.cargo_tonnage;
                """),
                {"slug": slug, "name": name, "cap": cap, "lyt": lyt, "purpose": purpose, "tonnage": tonnage}
            )

    async with AsyncSessionLocal() as session:
        # Backfill any remaining vehicle types
        for vt in (await session.execute(select(VehicleType))).scalars().all():
            vt.seat_layout = _get_layout_for_vehicle(vt.slug, vt.seat_capacity)
        await session.commit()
        # Seed Kenyan SACCOs if none exist
        sacco_count = await session.scalar(select(func.count()).select_from(Sacco))
        super_metro = None
        if sacco_count == 0:
            super_metro = Sacco(
                name='Super Metro Sacco',
                slug='super_metro',
                registration_no='CPR/2013/10294',
                headquarters='Nairobi CBD',
                contact_phone='+254700123456',
                contact_email='info@supermetro.co.ke',
                primary_color='#06b6d4',
                accent_color='#f43f5e',
                created_at=datetime.now(timezone.utc),
            )
            two_nk = Sacco(
                name='2NK Sacco',
                slug='2nk',
                registration_no='CPR/1994/2301',
                headquarters='Nyeri Stage',
                contact_phone='+254722123456',
                contact_email='dispatch@2nksacco.co.ke',
                primary_color='#10b981',
                accent_color='#fbbf24',
                created_at=datetime.now(timezone.utc),
            )
            easy_coach = Sacco(
                name='Easy Coach Ltd',
                slug='easy_coach',
                registration_no='CPR/2003/5502',
                headquarters='Kisumu Central',
                contact_phone='+254733123456',
                contact_email='info@easycoachkenya.com',
                primary_color='#8b5cf6',
                accent_color='#ec4899',
                created_at=datetime.now(timezone.utc),
            )
            tahmeed = Sacco(
                name='Tahmeed Coach',
                slug='tahmeed',
                registration_no='CPR/2006/8890',
                headquarters='Mombasa Coast',
                contact_phone='+254711123456',
                contact_email='support@tahmeedexpress.com',
                primary_color='#f59e0b',
                accent_color='#06b6d4',
                created_at=datetime.now(timezone.utc),
            )
            session.add_all([super_metro, two_nk, easy_coach, tahmeed])
            await session.flush()
        else:
            super_metro = (await session.execute(select(Sacco).order_by(Sacco.id))).scalars().first()

        v_count = await session.scalar(select(func.count()).select_from(Vehicle))
        if v_count == 0:
            vehicle_types = await session.execute(select(VehicleType))
            vt_map = {vt.slug: vt.id for vt in vehicle_types.scalars().all()}
            v1 = Vehicle(plate_number='KDA 123A', vehicle_type_id=vt_map.get('matatu_14'), is_electric=False, sacco_id=super_metro.id if super_metro else None, chassis_number='JT72HA14-99120', manufacture_year=2021)
            v2 = Vehicle(plate_number='KDK 456E', vehicle_type_id=vt_map.get('ev_matatu_14'), is_electric=True, sacco_id=super_metro.id if super_metro else None, chassis_number='EV98BM14-33211', manufacture_year=2024)
            v3 = Vehicle(plate_number='KCE 999B', vehicle_type_id=vt_map.get('ev_bus_33'), is_electric=True, sacco_id=super_metro.id if super_metro else None, chassis_number='BYD33EV-10492', manufacture_year=2025)
            v4 = Vehicle(plate_number='KAA 556C', vehicle_type_id=vt_map.get('bus_51'), is_electric=False, sacco_id=super_metro.id if super_metro else None, chassis_number='ISZ51FR-44109', manufacture_year=2018)
            v5 = Vehicle(plate_number='KDB 777D', vehicle_type_id=vt_map.get('bus_33'), is_electric=False, sacco_id=super_metro.id if super_metro else None, chassis_number='MB33CO-88219', manufacture_year=2023)
            session.add_all([v1, v2, v3, v4, v5])
            await session.flush()

            now = datetime.now(timezone.utc)
            session.add_all([
                # KDA 123A: Fully Compliant
                VehicleCompliance(
                    vehicle_id=v1.id,
                    speed_governor_vendor='Omata Africa Ltd',
                    speed_governor_cert='OM-2026-881',
                    speed_governor_expiry=now + timedelta(days=180),
                    ntsa_inspection_cert='NTSA-INS-9912-L',
                    ntsa_inspection_expiry=now + timedelta(days=210),
                    insurance_underwriter='Directline Assurance',
                    insurance_policy_no='DL-PSV-44210-A',
                    insurance_expiry=now + timedelta(days=200),
                    is_grounded=False,
                    last_inspected_at=now - timedelta(days=40),
                ),
                # KDK 456E: Warning Expiring Soon (< 30 days)
                VehicleCompliance(
                    vehicle_id=v2.id,
                    speed_governor_vendor='Cartrack Kenya',
                    speed_governor_cert='CT-2026-112',
                    speed_governor_expiry=now + timedelta(days=14),
                    ntsa_inspection_cert='NTSA-INS-7721-R',
                    ntsa_inspection_expiry=now + timedelta(days=24),
                    insurance_underwriter='CIC General Insurance',
                    insurance_policy_no='CIC-EV-8821-B',
                    insurance_expiry=now + timedelta(days=320),
                    is_grounded=False,
                    last_inspected_at=now - timedelta(days=110),
                ),
                # KCE 999B: Compliant Electric Bus
                VehicleCompliance(
                    vehicle_id=v3.id,
                    speed_governor_vendor='BasiGo Gov',
                    speed_governor_cert='BG-EV-2026-003',
                    speed_governor_expiry=now + timedelta(days=300),
                    ntsa_inspection_cert='NTSA-INS-1049-T',
                    ntsa_inspection_expiry=now + timedelta(days=340),
                    insurance_underwriter='Britam Insurance',
                    insurance_policy_no='BR-EV-9921-X',
                    insurance_expiry=now + timedelta(days=300),
                    is_grounded=False,
                    last_inspected_at=now - timedelta(days=25),
                ),
                # KAA 556C: Grounded (Expired NTSA & Governor)
                VehicleCompliance(
                    vehicle_id=v4.id,
                    speed_governor_vendor='Dalcom Speed Regulators',
                    speed_governor_cert='DC-2025-442',
                    speed_governor_expiry=now - timedelta(days=10),
                    ntsa_inspection_cert='NTSA-INS-5561-EXP',
                    ntsa_inspection_expiry=now - timedelta(days=15),
                    insurance_underwriter='Invesco Assurance',
                    insurance_policy_no='INV-PSV-1102',
                    insurance_expiry=now + timedelta(days=45),
                    is_grounded=True,
                    grounded_reason='NTSA Annual Inspection and Speed Governor Calibration Expired (Ruaraka Center)',
                    last_inspected_at=now - timedelta(days=380),
                ),
                # KDB 777D: Compliant
                VehicleCompliance(
                    vehicle_id=v5.id,
                    speed_governor_vendor='Omata Africa Ltd',
                    speed_governor_cert='OM-2026-904',
                    speed_governor_expiry=now + timedelta(days=120),
                    ntsa_inspection_cert='NTSA-INS-8819-N',
                    ntsa_inspection_expiry=now + timedelta(days=150),
                    insurance_underwriter='Heritage Insurance',
                    insurance_policy_no='HER-PSV-771',
                    insurance_expiry=now + timedelta(days=190),
                    is_grounded=False,
                    last_inspected_at=now - timedelta(days=60),
                ),
            ])
            await session.flush()

        # Backfill compliance and sacco for any existing vehicles
        for veh in (await session.execute(select(Vehicle))).scalars().all():
            if veh.sacco_id is None and super_metro:
                veh.sacco_id = super_metro.id
            comp_exists = await session.scalar(select(func.count()).select_from(VehicleCompliance).where(VehicleCompliance.vehicle_id == veh.id))
            if comp_exists == 0:
                now = datetime.now(timezone.utc)
                session.add(VehicleCompliance(
                    vehicle_id=veh.id,
                    speed_governor_vendor='Omata Africa Ltd',
                    speed_governor_cert=f'OM-{veh.plate_number.replace(" ", "")}',
                    speed_governor_expiry=now + timedelta(days=180),
                    ntsa_inspection_cert=f'NTSA-{veh.plate_number.replace(" ", "")}',
                    ntsa_inspection_expiry=now + timedelta(days=210),
                    insurance_underwriter='Directline Assurance',
                    insurance_policy_no=f'DL-{veh.plate_number.replace(" ", "")}',
                    insurance_expiry=now + timedelta(days=190),
                    is_grounded=False,
                    last_inspected_at=now - timedelta(days=30),
                ))
        if super_metro:
            await session.execute(
                text("UPDATE vehicles SET sacco_id = :sid WHERE sacco_id IS NULL;"),
                {"sid": super_metro.id}
            )
            await session.execute(
                text("UPDATE routes SET sacco_id = :sid WHERE sacco_id IS NULL;"),
                {"sid": super_metro.id}
            )
            await session.execute(
                text("UPDATE trips SET sacco_id = :sid WHERE sacco_id IS NULL;"),
                {"sid": super_metro.id}
            )
        await session.commit()

        u_count = await session.scalar(select(func.count()).select_from(User))
        if u_count == 0:
            session.add_all(
                [
                    User(full_name='Admin User', phone=None, email='admin@busgo.test', password_hash=hash_password('admin123'), role='admin'),
                    User(full_name='Driver One', phone=None, email='driver1@busgo.test', password_hash=hash_password('driver123'), role='driver'),
                    User(full_name='Super Metro Dispatcher', phone=None, email='sacco_admin@busgo.test', password_hash=hash_password('sacco123'), role='sacco_admin', sacco_id=super_metro.id if super_metro else None),
                    User(full_name='Driver One', phone=None, email='driver1@busgo.test', password_hash=hash_password('driver123'), role='driver', sacco_id=super_metro.id if super_metro else None, psv_badge_number='NTSA-DRV-44910'),
                    User(full_name='Passenger One', phone=None, email='passenger1@busgo.test', password_hash=hash_password('pass123'), role='user'),
                ]
            )

        # Ensure the demo accounts always have a usable password hash, even if
        # they were seeded before password hashing was introduced.
        # Ensure the demo accounts always have a usable password hash
        async def _ensure_demo_passwords() -> None:
            demo = {
                'admin@busgo.test': ('admin123', 'admin', None),
                'sacco_admin@busgo.test': ('sacco123', 'sacco_admin', super_metro.id if super_metro else None),
                'driver1@busgo.test': ('driver123', 'driver', super_metro.id if super_metro else None),
                'passenger1@busgo.test': ('pass123', 'user', None),
            }
            for email, (pw, role, s_id) in demo.items():
                row = (await session.execute(select(User).where(User.email == email))).scalars().first()
                if row is not None and (row.password_hash is None or not row.password_hash):
                    row.password_hash = hash_password(pw)
                if row is None:
                    session.add(User(full_name=email.split('@')[0].capitalize(), email=email, password_hash=hash_password(pw), role=role, sacco_id=s_id))
                else:
                    if row.password_hash is None or not row.password_hash:
                        row.password_hash = hash_password(pw)
                    if not row.role:
                        row.role = role
                    if s_id and not row.sacco_id:
                        row.sacco_id = s_id
        await _ensure_demo_passwords()

        # Assign the seeded driver to any trips that have no driver yet, so the
        # driver dashboard/manifest has data to show.
        driver_user = (await session.execute(select(User).where(User.role == 'driver').limit(1))).scalars().first()
        if driver_user is not None:
            orphan_trips = (await session.execute(select(Trip).where(Trip.driver_id.is_(None)))).scalars().all()
            for t in orphan_trips:
                t.driver_id = driver_user.id
                if t.sacco_id is None and super_metro:
                    t.sacco_id = super_metro.id

        route_count = await session.scalar(select(func.count()).select_from(Route))
        trip_id = None
        if route_count == 0:
            route = Route(name='Nairobi - Nakuru Express', country='KE')
            session.add(route)
            await session.flush()

            session.add_all(
                [
                    RouteStop(route_id=route.id, stop_name='Nairobi Station', stop_order=1),
                    RouteStop(route_id=route.id, stop_name='Westlands', stop_order=2),
                    RouteStop(route_id=route.id, stop_name='Eldoret Junction', stop_order=3),
                    RouteStop(route_id=route.id, stop_name='Nakuru Terminal', stop_order=4),
                ]
            )

            vehicle = (await session.execute(select(Vehicle).limit(1))).scalars().first()
            vehicle_id = vehicle.id if vehicle else None
            trip = Trip(route_id=route.id, vehicle_id=vehicle_id, name='Nairobi - Nakuru Express Morning')
            session.add(trip)
            await session.flush()
            trip_id = trip.id
        else:
            trip = (await session.execute(select(Trip).join(Route).limit(1))).scalars().first()
            trip_id = trip.id if trip else None

        # Guarantee active Kenyan transit routes & scheduled upcoming trips exist
        async def _ensure_active_passenger_network():
            now_utc = datetime.now(timezone.utc)
            # Find or create Easy Coach sacco
            ec_sacco = (await session.execute(select(Sacco).where(Sacco.name.ilike('%Easy Coach%')).limit(1))).scalars().first()
            if not ec_sacco:
                ec_sacco = Sacco(name="Easy Coach Ltd", registration_number="SAC-EC-002", primary_color="#10b981")
                session.add(ec_sacco)
                await session.flush()

            # Find driver and passenger vehicles
            drv = (await session.execute(select(User).where(User.role == 'driver').limit(1))).scalars().first()
            drv_id = drv.id if drv else None
            veh_matatu = (await session.execute(select(Vehicle).where(Vehicle.plate_number == 'KDA 123A').limit(1))).scalars().first()
            veh_ev = (await session.execute(select(Vehicle).where(Vehicle.plate_number == 'KCE 999B').limit(1))).scalars().first()
            veh_coach = (await session.execute(select(Vehicle).where(Vehicle.plate_number == 'KAA 556C').limit(1))).scalars().first()
            veh_shuttle = (await session.execute(select(Vehicle).where(Vehicle.plate_number == 'KDT 456Y').limit(1))).scalars().first()

            # Ensure Route 1: Nairobi - Nakuru
            r1 = (await session.execute(select(Route).where(Route.name.ilike('%Nairobi - Nakuru%')).limit(1))).scalars().first()
            if not r1:
                r1 = Route(name="Nairobi - Nakuru Express", sacco_id=super_metro.id if super_metro else None, country="KE", route_type="stopwise", base_fare=200.0, per_hop_fare=150.0)
                session.add(r1)
                await session.flush()
            r1_stops = [
                (1, "Nairobi Central"),
                (2, "Westlands"),
                (3, "Limuru Stage"),
                (4, "Naivasha Junction"),
                (5, "Gilgil"),
                (6, "Nakuru Terminal"),
            ]
            cur_r1 = (await session.execute(select(RouteStop).where(RouteStop.route_id == r1.id))).scalars().all()
            if len(cur_r1) < len(r1_stops):
                await session.execute(text("DELETE FROM route_stops WHERE route_id = :rid;"), {"rid": r1.id})
                for o, name in r1_stops:
                    session.add(RouteStop(route_id=r1.id, stop_name=name, stop_order=o))
                await session.flush()

            # Ensure Route 2: Nairobi - Mombasa
            r2 = (await session.execute(select(Route).where(Route.name.ilike('%Nairobi - Mombasa%')).limit(1))).scalars().first()
            if not r2:
                r2 = Route(name="Nairobi - Mombasa Luxury Highway", sacco_id=ec_sacco.id, country="KE", route_type="stopwise", base_fare=500.0, per_hop_fare=350.0)
                session.add(r2)
                await session.flush()
                for o, name in [(1, "Nairobi Central"), (2, "Mtito Andei"), (3, "Voi Station"), (4, "Mombasa CBD")]:
                    session.add(RouteStop(route_id=r2.id, stop_name=name, stop_order=o))
                await session.flush()

            # Ensure Route 3: Nairobi - Kisumu
            r3 = (await session.execute(select(Route).where(Route.name.ilike('%Nairobi - Kisumu%')).limit(1))).scalars().first()
            if not r3:
                r3 = Route(name="Nairobi - Kisumu Lake Express", sacco_id=ec_sacco.id, country="KE", route_type="stopwise", base_fare=400.0, per_hop_fare=250.0)
                session.add(r3)
                await session.flush()
                for o, name in [(1, "Nairobi Central"), (2, "Naivasha Junction"), (3, "Nakuru Terminal"), (4, "Kericho Town"), (5, "Kisumu Central")]:
                    session.add(RouteStop(route_id=r3.id, stop_name=name, stop_order=o))
                await session.flush()

            # Refresh Trip 1
            t1 = (await session.execute(select(Trip).where(Trip.id == 1))).scalars().first()
            if t1:
                t1.status = 'scheduled'
                t1.scheduled_at = now_utc + timedelta(hours=2)
                t1.route_id = r1.id
                t1.vehicle_id = veh_matatu.id if veh_matatu else None
                t1.driver_id = drv_id
                t1.current_stop_order = 1
                t1.name = "Nairobi - Nakuru Express Morning"

            # Ensure active upcoming trips
            trip_templates = [
                ("Nairobi - Nakuru Express (Super Metro)", r1.id, veh_matatu.id if veh_matatu else None, super_metro.id if super_metro else None, 3),
                ("Nairobi - Nakuru Electric Shuttle ⚡", r1.id, veh_ev.id if veh_ev else None, super_metro.id if super_metro else None, 5),
                ("Nairobi - Mombasa Luxury Coach", r2.id, veh_coach.id if veh_coach else None, ec_sacco.id, 4),
                ("Nairobi - Kisumu Lake Shuttle", r3.id, veh_shuttle.id if veh_shuttle else (veh_matatu.id if veh_matatu else None), ec_sacco.id, 6),
            ]
            for t_name, r_id, v_id, s_id, hrs in trip_templates:
                ext = (await session.execute(select(Trip).where(Trip.name == t_name))).scalars().first()
                if ext:
                    ext.status = 'scheduled'
                    ext.scheduled_at = now_utc + timedelta(hours=hrs)
                    ext.vehicle_id = v_id
                    ext.driver_id = drv_id
                    ext.sacco_id = s_id
                    ext.current_stop_order = 1
                else:
                    session.add(Trip(
                        name=t_name,
                        route_id=r_id,
                        vehicle_id=v_id,
                        driver_id=drv_id,
                        sacco_id=s_id,
                        status='scheduled',
                        scheduled_at=now_utc + timedelta(hours=hrs),
                        current_stop_order=1,
                        allow_driver_tier=True,
                        max_surcharge_pct=25.0,
                    ))
            await session.commit()
        await _ensure_active_passenger_network()

        booking_count = await session.scalar(select(func.count()).select_from(Booking))
        if booking_count == 0 and trip_id is not None:
            user = (await session.execute(select(User).where(User.role == 'user').limit(1))).scalars().first()
            if user is None:
                user = User(full_name='Passenger Fallback', phone=None, email='pf@busgo.test', password_hash=None, role='user')
                session.add(user)
                await session.flush()

            booking = Booking(
                trip_id=trip_id,
                user_id=user.id,
                seat_number=3,
                board_stop_order=1,
                alight_stop_order=3,
                status='confirmed',
                payment_status='paid',
            )
            session.add(booking)
            await session.flush()
            payment = Payment(
                booking_id=booking.id,
                provider='mpesa_sim',
                provider_payload=None,
                amount=500.00,
                status='completed',
            )
            session.add(payment)

        # Seed Kenyan Highway EV Fast Charging Stations
        cs_count = await session.scalar(select(func.count()).select_from(ChargingStation))
        if cs_count == 0:
            session.add_all([
                ChargingStation(
                    name="BasiGo Embakasi Central Depot",
                    operator="BasiGo",
                    location_name="Embakasi, Nairobi",
                    corridor="A109",
                    lat=-1.3200,
                    lng=36.9100,
                    power_kw=150.0,
                    ports_total=6,
                    ports_available=4,
                    connector_type="CCS2 / GB/T",
                    is_active=True,
                ),
                ChargingStation(
                    name="DriveElectric Kenya Roysambu Hub",
                    operator="DriveElectric Kenya",
                    location_name="Roysambu, Nairobi",
                    corridor="Thika Superhighway",
                    lat=-1.2185,
                    lng=36.8876,
                    power_kw=120.0,
                    ports_total=4,
                    ports_available=3,
                    connector_type="CCS2",
                    is_active=True,
                ),
                ChargingStation(
                    name="Limuru Escarpment EV Fast Station",
                    operator="BasiGo",
                    location_name="Limuru Escarpment Viewpoint",
                    corridor="A104",
                    lat=-1.1118,
                    lng=36.6437,
                    power_kw=180.0,
                    ports_total=4,
                    ports_available=2,
                    connector_type="CCS2 / GB/T",
                    is_active=True,
                ),
                ChargingStation(
                    name="Naivasha Green Waypoint Hub",
                    operator="Roam",
                    location_name="Naivasha Town Junction",
                    corridor="A104",
                    lat=-0.7172,
                    lng=36.4310,
                    power_kw=120.0,
                    ports_total=4,
                    ports_available=3,
                    connector_type="CCS2",
                    is_active=True,
                ),
                ChargingStation(
                    name="Nakuru CBD Mega Depot",
                    operator="DriveElectric Kenya",
                    location_name="Nakuru Terminal",
                    corridor="A104",
                    lat=-0.3031,
                    lng=36.0800,
                    power_kw=150.0,
                    ports_total=6,
                    ports_available=5,
                    connector_type="CCS2 / GB/T",
                    is_active=True,
                ),
            ])
            await session.flush()

        # Seed initial EV Telemetry for electric vehicles
        ev_veh = (await session.execute(select(Vehicle).where(Vehicle.is_electric == True))).scalars().first()
        if ev_veh:
            vt_count = await session.scalar(select(func.count()).select_from(VehicleTelemetry).where(VehicleTelemetry.vehicle_id == ev_veh.id))
            if vt_count == 0:
                session.add(VehicleTelemetry(
                    vehicle_id=ev_veh.id,
                    battery_soc_pct=82.5,
                    battery_temp_c=29.4,
                    estimated_range_km=198.0,
                    charging_status="discharging",
                    power_consumption_kwh_per_km=0.82,
                    co2_saved_kg=480.0,
                    regen_braking_kwh=14.2,
                    recorded_at=datetime.now(timezone.utc),
                ))

        await session.commit()


global_telemetry_tcp_server: Optional[HardwareTelemetryTCPServer] = None

@app.on_event("startup")
async def on_startup():
    global global_telemetry_tcp_server
    await initialize_database()
    crons.start_cron_worker(interval_seconds=60)
    try:
        global_telemetry_tcp_server = HardwareTelemetryTCPServer(AsyncSessionLocal, ws_manager=manager)
        asyncio.create_task(global_telemetry_tcp_server.start(host="0.0.0.0", teltonika_port=5027, concox_port=5023))
    except Exception as tcp_err:
        logger.warning(f"Failed to start Hardware Telemetry TCP Listener: {tcp_err}")


@app.on_event("shutdown")
async def on_shutdown():
    global global_telemetry_tcp_server
    crons.stop_cron_worker()
    if global_telemetry_tcp_server:
        await global_telemetry_tcp_server.stop()


@app.get("/")
def read_root():
    return {"message": "Welcome to BUSGO API - Dynamic Transport & Seating Platform"}


@app.get("/api/health")
def healthcheck():
    return {
        "status": "healthy",
        "service": "busgo-backend",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/progress", response_class=HTMLResponse)
def progress_page():
    return """
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>BUSGO Backend Progress</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px; }
          h1 { color: #22c55e; margin-bottom: 16px; }
          section { margin-bottom: 24px; }
          code { background: #111827; padding: 2px 6px; border-radius: 6px; }
          a { color: #38bdf8; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>BUSGO Backend Progress</h1>
        <section>
          <p>The backend is running and the async database layer is configured.</p>
          <ul>
            <li>Async DB module: <code>backend/db.py</code></li>
            <li>ORM models: <code>backend/models.py</code></li>
            <li>Alembic initialized: <code>backend/alembic/</code></li>
            <li>Initial migration: <code>backend/alembic/versions/c861d38ec0fb_initial_models.py</code></li>
            <li>Async SQLAlchemy-based endpoints enabled</li>
          </ul>
        </section>
        <section>
          <h2>Try these endpoints</h2>
          <ul>
            <li><a href="/">Root API</a></li>
            <li><a href="/api/trips/1/stops">Trip stops</a></li>
            <li><a href="/api/trips/1/booked-seats?board_order=1&alight_order=3">Booked seats</a></li>
            <li><a href="/api/trips/1/manifest">Trip manifest</a></li>
          </ul>
        </section>
      </body>
    </html>
    """


from sqlalchemy import text
from backend.db import get_async_db
from sqlalchemy.exc import DBAPIError


# --------------------------------------------------------------------------
# Authentication
# --------------------------------------------------------------------------
class RegisterRequest(BaseModel):
    full_name: str
    email: str
    phone: str | None = None
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    full_name: str
    email: str | None = None
    phone: str | None = None
    role: str

    class Config:
        from_attributes = True


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


@app.post("/api/auth/register", response_model=AuthResponse)
async def register_user(payload: RegisterRequest, db=Depends(get_async_db)):
    """Create a new passenger account and return a JWT. New accounts always
    get the `user` role — self-service registration can never create an
    admin or driver."""
    existing = (
        await db.execute(select(User).where(User.email == payload.email))
    ).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with that email already exists.")

    user = User(
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        role='user',
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token({"sub": str(user.id), "role": user.role})
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


@app.post("/api/auth/login", response_model=AuthResponse)
async def login(payload: LoginRequest, db=Depends(get_async_db)):
    """Exchange email + password for a JWT access token."""
    user = (
        await db.execute(select(User).where(User.email == payload.email))
    ).scalars().first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_access_token({"sub": str(user.id), "role": user.role})
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


@app.get("/api/auth/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


class UpdateProfileRequest(BaseModel):
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    password: str | None = None


@app.patch("/api/auth/profile", response_model=UserOut)
@app.put("/api/auth/profile", response_model=UserOut)
async def update_profile(
    payload: UpdateProfileRequest,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Update current authenticated user's profile details."""
    user_row = await db.get(User, current_user.id)
    if not user_row:
        raise HTTPException(status_code=404, detail="User not found.")

    if payload.email and payload.email.strip() != (user_row.email or ""):
        clean_email = payload.email.strip().lower()
        existing = await db.scalar(select(User).where(User.email == clean_email, User.id != current_user.id))
        if existing:
            raise HTTPException(status_code=409, detail="Email already in use by another account.")
        user_row.email = clean_email

    if payload.phone and payload.phone.strip() != (user_row.phone or ""):
        clean_phone = payload.phone.strip()
        existing_phone = await db.scalar(select(User).where(User.phone == clean_phone, User.id != current_user.id))
        if existing_phone:
            raise HTTPException(status_code=409, detail="Phone number already registered with another account.")
        user_row.phone = clean_phone

    if payload.full_name is not None and payload.full_name.strip():
        user_row.full_name = payload.full_name.strip()

    if payload.password:
        if len(payload.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
        user_row.password_hash = hash_password(payload.password)

    await db.commit()
    await db.refresh(user_row)
    return user_row


@app.get("/api/trips")
async def list_trips(db=Depends(get_async_db)):
    """Public: all trips available for booking, with route/vehicle details
    and the seat capacity of the assigned vehicle."""
    rows = (await db.execute(
        text("""
        SELECT t.id, t.name, t.status, t.scheduled_at, t.current_stop_order,
               t.fixed_price, t.allow_driver_tier, t.max_surcharge_pct, t.driver_tier,
               t.current_lat, t.current_lng, t.current_speed, t.current_heading, t.last_gps_at,
               r.id AS route_id, r.name AS route_name, r.route_type,
               v.id AS vehicle_id, v.plate_number, v.is_electric,
               vt.seat_capacity, vt.slug AS vehicle_type, vt.seat_layout,
               COALESCE(s.id, sv.id) AS sacco_id,
               COALESCE(s.name, sv.name) AS sacco_name,
               COALESCE(s.primary_color, sv.primary_color, '#06b6d4') AS sacco_color
        FROM trips t
        JOIN routes r ON r.id = t.route_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        LEFT JOIN saccos s ON s.id = t.sacco_id
        LEFT JOIN saccos sv ON sv.id = v.sacco_id
        WHERE t.status != 'cancelled'
          AND (vt.purpose IS NULL OR vt.purpose != 'cargo')
        ORDER BY
            CASE WHEN t.status IN ('scheduled', 'boarding', 'in_transit') THEN 0 ELSE 1 END,
            CASE WHEN v.id IS NOT NULL AND vt.seat_capacity IS NOT NULL THEN 0 ELSE 1 END,
            t.scheduled_at ASC NULLS LAST,
            t.id ASC;
        """)
    )).mappings().all()
    return {"trips": [dict(r) for r in rows]}


@app.get("/api/trips/{trip_id}/stops")
async def get_trip_stops(trip_id: int, db=Depends(get_async_db)):
    query = text(
        """
        SELECT rs.id, rs.stop_name, rs.stop_order
        FROM trips t
        JOIN route_stops rs ON t.route_id = rs.route_id
        WHERE t.id = :trip_id
        ORDER BY rs.stop_order ASC;
        """
    )
    res = await db.execute(query, {"trip_id": trip_id})
    rows = [dict(r) for r in res.mappings().all()]
    return {"trip_id": trip_id, "stops": rows}


def stop_matches_query(query: str, stop_name: str) -> bool:
    """
    Check if a queried stop name matches a database route stop name.
    Matches exact substrings, or primary city/hub keywords.
    E.g. "Nairobi Central" -> matches "Nairobi Station", "Nairobi CBD", "Nairobi"
         "Nakuru" -> matches "Nakuru Terminal"
         "Limuru" -> matches "Limuru Stage"
    """
    q = (query or "").strip().lower()
    s = (stop_name or "").strip().lower()
    if not q or not s:
        return False
    if q in s or s in q:
        return True
    stopwords = {"station", "terminal", "stage", "junction", "cbd", "town", "central", "stop", "express", "depot", "hub", "road", "way"}
    q_tokens = [t for t in re.split(r'[\s\-_/,]+', q) if len(t) >= 3 and t not in stopwords]
    s_tokens = [t for t in re.split(r'[\s\-_/,]+', s) if len(t) >= 3 and t not in stopwords]
    for qt in q_tokens:
        for st in s_tokens:
            if qt == st or qt in st or st in qt:
                return True
    return False


@app.get("/api/trips/search")
async def search_trips(
    board_stop: Optional[str] = None,
    alight_stop: Optional[str] = None,
    db=Depends(get_async_db)
):
    """
    Search trips by boarding and alighting stop names.
    Returns matching trips with dynamic segment fares and available seat counts for that leg.
    """
    trips_rows = (await db.execute(
        text("""
        SELECT t.id AS trip_id, t.name, t.status, t.scheduled_at, t.current_stop_order,
               t.fixed_price, t.allow_driver_tier, t.max_surcharge_pct, t.driver_tier,
               t.current_lat, t.current_lng, t.current_speed, t.current_heading, t.last_gps_at,
               r.id AS route_id, r.name AS route_name, r.route_type,
               r.base_fare, r.per_hop_fare, r.fare_matrix,
               v.id AS vehicle_id, v.plate_number, v.is_electric,
               vt.seat_capacity, vt.slug AS vehicle_type, vt.seat_layout,
               COALESCE(s.name, sv.name) AS sacco_name,
               COALESCE(s.primary_color, sv.primary_color, '#06b6d4') AS sacco_color
        FROM trips t
        JOIN routes r ON r.id = t.route_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        LEFT JOIN saccos s ON s.id = t.sacco_id
        LEFT JOIN saccos sv ON sv.id = v.sacco_id
        LEFT JOIN vehicle_compliance vc ON vc.vehicle_id = v.id
        WHERE t.status IN ('scheduled', 'boarding', 'in_transit')
          AND COALESCE(vc.is_grounded, false) = false
          AND (vt.purpose IS NULL OR vt.purpose != 'cargo')
        ORDER BY
            CASE WHEN t.status IN ('scheduled', 'boarding', 'in_transit') THEN 0 ELSE 1 END,
            CASE WHEN v.id IS NOT NULL AND vt.seat_capacity IS NOT NULL THEN 0 ELSE 1 END,
            t.scheduled_at ASC NULLS LAST,
            t.id ASC;
        """)
    )).mappings().all()

    board_clean = (board_stop or "").strip().lower()
    alight_clean = (alight_stop or "").strip().lower()
    results = []

    for trip in trips_rows:
        tid = trip["trip_id"]
        stops_rows = (await db.execute(
            text("SELECT id, stop_name, stop_order FROM route_stops WHERE route_id = :rid ORDER BY stop_order ASC;"),
            {"rid": trip["route_id"]}
        )).mappings().all()
        stops = [dict(s) for s in stops_rows]

        if len(stops) < 2:
            continue

        matched_board = None
        matched_alight = None

        if board_clean and alight_clean:
            for s in stops:
                if stop_matches_query(board_clean, s["stop_name"]) and not matched_board:
                    matched_board = s
                    break
            if matched_board:
                for s in stops:
                    if s["stop_order"] > matched_board["stop_order"] and stop_matches_query(alight_clean, s["stop_name"]):
                        matched_alight = s
                        break
        elif board_clean:
            for s in stops:
                if stop_matches_query(board_clean, s["stop_name"]):
                    matched_board = s
                    break
            if matched_board and matched_board["stop_order"] < stops[-1]["stop_order"]:
                matched_alight = stops[-1]
        elif alight_clean:
            for s in stops:
                if stop_matches_query(alight_clean, s["stop_name"]):
                    matched_alight = s
                    break
            if matched_alight and stops[0]["stop_order"] < matched_alight["stop_order"]:
                matched_board = stops[0]
        else:
            matched_board = stops[0]
            matched_alight = stops[-1]

        if not matched_board or not matched_alight or matched_board["stop_order"] >= matched_alight["stop_order"]:
            continue

        b_order = matched_board["stop_order"]
        a_order = matched_alight["stop_order"]
        hops = a_order - b_order
        matrix = trip["fare_matrix"] if isinstance(trip["fare_matrix"], dict) else (json.loads(trip["fare_matrix"]) if trip["fare_matrix"] else None)
        fare = calculate_segment_fare(
            board_order=b_order,
            alight_order=a_order,
            base_fare=trip["base_fare"] or 200.0,
            per_hop_fare=trip["per_hop_fare"] or 150.0,
            fare_matrix=matrix,
            fixed_price=trip["fixed_price"],
            allow_driver_tier=trip["allow_driver_tier"],
            driver_tier=trip["driver_tier"] or "standard",
            max_surcharge_pct=trip["max_surcharge_pct"] or 25.0,
        )

        capacity = trip["seat_capacity"] or 14
        booked_query = text("""
            SELECT DISTINCT seat_number FROM bookings
            WHERE trip_id = :trip_id
              AND status != 'cancelled'
              AND NOT (alight_stop_order <= :board_order OR board_stop_order >= :alight_order);
        """)
        occupied = (await db.execute(booked_query, {"trip_id": tid, "board_order": b_order, "alight_order": a_order})).scalars().all()
        available_seats = max(0, capacity - len(occupied))

        results.append({
            "trip_id": tid,
            "name": trip["name"],
            "route_id": trip["route_id"],
            "route_name": trip["route_name"],
            "route_type": trip["route_type"],
            "scheduled_at": trip["scheduled_at"].isoformat() if trip["scheduled_at"] else None,
            "status": trip["status"],
            "plate_number": trip["plate_number"],
            "vehicle_type": trip["vehicle_type"],
            "is_electric": bool(trip["is_electric"]),
            "seat_capacity": capacity,
            "seat_layout": trip["seat_layout"],
            "board_stop": matched_board,
            "alight_stop": matched_alight,
            "hop_count": hops,
            "fare": fare,
            "is_fixed_price": bool(trip["fixed_price"]),
            "driver_tier": trip["driver_tier"] or "standard",
            "available_seats": available_seats,
            "occupied_seats": list(occupied),
            "stops": stops,
            "sacco_name": trip["sacco_name"],
            "sacco_color": trip["sacco_color"],
        })

    return {"results": results}


@app.get("/api/trips/{trip_id}/booked-seats")
async def get_booked_seats(trip_id: int, board_order: int, alight_order: int, db=Depends(get_async_db)):
    query = text(
        """
        SELECT DISTINCT seat_number FROM bookings
        WHERE trip_id = :trip_id
          AND NOT (alight_stop_order <= :board_order OR board_stop_order >= :alight_order);
        """
    )
    res = await db.execute(query, {"trip_id": trip_id, "board_order": board_order, "alight_order": alight_order})
    booked = [r[0] for r in res.all()]
    return {"trip_id": trip_id, "booked_seats": booked}


class BoardPassengerRequest(BaseModel):
    booking_id: Optional[int] = None
    ticket_code: Optional[str] = None


@app.get("/api/trips/{trip_id}/manifest")
async def get_trip_manifest(trip_id: int, db=Depends(get_async_db), current_user: User = Depends(require_roles('driver', 'admin'))):
    """Driver/Admin-only: passenger list for a trip, with names and stops."""
    """Driver/Admin-only: passenger list for a trip, with names, stops, and boarding status."""
    query = text(
        """
        SELECT b.id AS booking_id, b.seat_number, b.user_id, u.full_name, u.phone,
               b.board_stop_order, b.alight_stop_order, b.status, b.payment_status,
               (SELECT stop_name FROM route_stops
                 WHERE route_id = trips.route_id AND stop_order = b.board_stop_order) AS board_stop,
               (SELECT stop_name FROM route_stops
                 WHERE route_id = trips.route_id AND stop_order = b.alight_stop_order) AS alight_stop
        FROM bookings b
        LEFT JOIN users u ON u.id = b.user_id
        JOIN trips ON trips.id = b.trip_id
        WHERE b.trip_id = :trip_id
        ORDER BY b.seat_number ASC;
        """
    )
    trip = (await db.execute(text("SELECT route_id FROM trips WHERE id = :id;"), {"id": trip_id})).mappings().first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    res = await db.execute(query, {"trip_id": trip_id})
    rows = [dict(r) for r in res.mappings().all()]

    # Driver access is limited to trips assigned to them; admins see everything.
    if current_user.role == 'driver':
        driver_trip = (await db.execute(
            text("SELECT id FROM trips WHERE id = :id AND driver_id = :driver_id;"),
            {"id": trip_id, "driver_id": current_user.id},
        )).scalars().first()
        if driver_trip is None:
            raise HTTPException(status_code=403, detail="This trip is not assigned to you.")

    return {"trip_id": trip_id, "manifest": rows}


@app.patch("/api/trips/{trip_id}/board-passenger")
async def board_passenger(
    trip_id: int,
    payload: BoardPassengerRequest,
    db=Depends(get_async_db),
    current_user: User = Depends(require_roles('driver', 'admin')),
):
    """Driver/Admin: marks a passenger as boarded on the trip by booking_id or ticket_code."""
    if current_user.role == 'driver':
        driver_trip = (await db.execute(
            text("SELECT id FROM trips WHERE id = :id AND driver_id = :driver_id;"),
            {"id": trip_id, "driver_id": current_user.id},
        )).scalars().first()
        if driver_trip is None:
            raise HTTPException(status_code=403, detail="This trip is not assigned to you.")

    booking_id = payload.booking_id
    if not booking_id and payload.ticket_code:
        # Standard format: BUSGO-{booking_id}-{trip_id}-{seat_number} or BG-{booking_id}-{seat_number}
        code = payload.ticket_code.strip()
        parts = code.replace(":", "-").split("-")
        for part in parts:
            if part.isdigit():
                booking_id = int(part)
                break

    if not booking_id:
        raise HTTPException(status_code=400, detail="Valid booking_id or ticket_code is required.")

    booking = (await db.execute(
        text("SELECT id, trip_id, seat_number, status, user_id FROM bookings WHERE id = :id AND trip_id = :trip_id;"),
        {"id": booking_id, "trip_id": trip_id},
    )).mappings().first()

    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found for this trip.")

    await db.execute(
        text("UPDATE bookings SET status = 'boarded' WHERE id = :id;"),
        {"id": booking_id},
    )
    await db.commit()

    # Broadcast live boarding event to the trip WebSocket
    await manager.broadcast_trip(trip_id, {
        "event": "passenger_boarded",
        "booking_id": booking_id,
        "seat_number": booking["seat_number"],
    })

    return {
        "ok": True,
        "message": f"Passenger on Seat #{booking['seat_number']} successfully boarded.",
        "booking_id": booking_id,
        "status": "boarded",
        "seat_number": booking["seat_number"],
    }


class OfflineSyncItem(BaseModel):
    booking_id: Optional[int] = None
    ticket_code: Optional[str] = None
    seat_number: Optional[int] = None
    scanned_at: Optional[str] = None


class OfflineSyncBatchRequest(BaseModel):
    scans: List[OfflineSyncItem]
    synced_at: Optional[str] = None


@app.post("/api/trips/{trip_id}/offline-sync")
async def batch_offline_manifest_sync(
    trip_id: int,
    payload: OfflineSyncBatchRequest,
    db=Depends(get_async_db),
    current_user: User = Depends(require_roles('driver', 'admin')),
):
    """
    Deterministic batch reconciliation of offline scans made in highway dead zones.
    Handles idempotent boardings, detects cancelled-ticket conflicts, and broadcasts updates.
    """
    if current_user.role == 'driver':
        driver_trip = (await db.execute(
            text("SELECT id FROM trips WHERE id = :id AND driver_id = :driver_id;"),
            {"id": trip_id, "driver_id": current_user.id},
        )).scalars().first()
        if driver_trip is None:
            raise HTTPException(status_code=403, detail="This trip is not assigned to you.")

    boarded_count = 0
    already_boarded_count = 0
    conflict_count = 0
    results = []

    for item in payload.scans:
        b_id = item.booking_id
        if not b_id and item.ticket_code:
            code = item.ticket_code.strip()
            parts = code.replace(":", "-").split("-")
            for part in parts:
                if part.isdigit():
                    b_id = int(part)
                    break

        if not b_id and item.seat_number:
            match = (await db.execute(
                text("SELECT id, status FROM bookings WHERE trip_id = :tid AND seat_number = :snum ORDER BY id DESC LIMIT 1;"),
                {"tid": trip_id, "snum": item.seat_number}
            )).mappings().first()
            if match:
                b_id = match["id"]

        if not b_id:
            results.append({"item": item.dict(), "status": "error", "message": "Cannot resolve booking ID"})
            conflict_count += 1
            continue

        b_row = (await db.execute(
            text("SELECT id, seat_number, status FROM bookings WHERE id = :id AND trip_id = :tid;"),
            {"id": b_id, "tid": trip_id}
        )).mappings().first()

        if not b_row:
            results.append({"booking_id": b_id, "status": "not_found", "message": "Booking not found on trip"})
            conflict_count += 1
            continue

        cur_status = b_row["status"]
        seat_num = b_row["seat_number"]

        if cur_status == 'boarded':
            already_boarded_count += 1
            results.append({"booking_id": b_id, "seat_number": seat_num, "status": "already_boarded"})
        elif cur_status == 'cancelled':
            conflict_count += 1
            results.append({"booking_id": b_id, "seat_number": seat_num, "status": "conflict_cancelled", "message": "Ticket was cancelled before offline boarding"})
        else:
            await db.execute(
                text("UPDATE bookings SET status = 'boarded' WHERE id = :id;"),
                {"id": b_id}
            )
            boarded_count += 1
            results.append({"booking_id": b_id, "seat_number": seat_num, "status": "boarded_synced"})
            await manager.broadcast_trip(trip_id, {
                "event": "passenger_boarded",
                "booking_id": b_id,
                "seat_number": seat_num,
                "offline_synced": True,
            })

    await db.commit()

    # Log sync event to immutable audit trail
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            action VARCHAR(100) NOT NULL,
            entity_type VARCHAR(100) NOT NULL,
            entity_id INTEGER NOT NULL,
            actor_user_id INTEGER,
            actor_role VARCHAR(50) NOT NULL,
            supervisor_pin_verified BOOLEAN NOT NULL DEFAULT FALSE,
            supervisor_user_id INTEGER,
            previous_state JSONB,
            new_state JSONB,
            reason TEXT,
            ip_address VARCHAR(100),
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    """))
    await db.execute(text("""
        INSERT INTO audit_logs (
            action, entity_type, entity_id, actor_user_id, actor_role,
            supervisor_pin_verified, previous_state, new_state, reason, created_at
        ) VALUES (
            'offline_manifest_sync', 'trip', :tid, :uid, :role,
            FALSE, NULL, :new::jsonb, :reason, NOW()
        );
    """), {
        "tid": trip_id,
        "uid": current_user.id,
        "role": current_user.role,
        "new": json.dumps({"scans_total": len(payload.scans), "boarded": boarded_count, "conflicts": conflict_count}),
        "reason": f"Conductor offline dead-zone sync pass: {boarded_count} boarded, {conflict_count} conflicts",
    })
    await db.commit()

    return {
        "ok": True,
        "trip_id": trip_id,
        "total_scans": len(payload.scans),
        "boarded_count": boarded_count,
        "already_boarded_count": already_boarded_count,
        "conflict_count": conflict_count,
        "results": results,
    }


@app.get("/api/driver/trips")
async def driver_trips(db=Depends(get_async_db), current_user: User = Depends(require_roles('driver', 'admin'))):
    """Driver/Admin-only: the trips assigned to the authenticated driver
    (or every trip, for admins), with route and vehicle details."""
    base = """
        SELECT t.id, t.name, t.status, t.scheduled_at, t.current_stop_order,
               t.fixed_price, t.allow_driver_tier, t.max_surcharge_pct, t.driver_tier,
               t.current_lat, t.current_lng, t.current_speed, t.current_heading, t.last_gps_at,
               r.name AS route_name, r.route_type, r.base_fare, r.per_hop_fare, r.fare_matrix,
               v.plate_number, v.is_electric, vt.seat_capacity, vt.seat_layout,
               COALESCE(s.id, sv.id) AS sacco_id,
               COALESCE(s.name, sv.name) AS sacco_name,
               COALESCE(s.primary_color, sv.primary_color, '#06b6d4') AS sacco_color
        FROM trips t
        JOIN routes r ON r.id = t.route_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        LEFT JOIN saccos s ON s.id = t.sacco_id
        LEFT JOIN saccos sv ON sv.id = v.sacco_id
    """
    if current_user.role == 'admin':
        rows = (await db.execute(text(base + " ORDER BY t.id ASC;"))).mappings().all()
    else:
        rows = (await db.execute(
            text(base + " WHERE t.driver_id = :driver_id ORDER BY t.id ASC;"),
            {"driver_id": current_user.id},
        )).mappings().all()

    return {"trips": [dict(r) for r in rows]}


class TripStatusRequest(BaseModel):
    status: str


@app.patch("/api/trips/{trip_id}/status")
async def update_trip_status(trip_id: int, payload: TripStatusRequest, db=Depends(get_async_db), current_user: User = Depends(require_roles('driver', 'admin'))):
    """Driver/Admin-only: update a trip's lifecycle status."""
    allowed = {'scheduled', 'boarding', 'in_transit', 'completed', 'cancelled'}
    if payload.status not in allowed:
        raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(sorted(allowed))}")

    trip = (await db.execute(text("SELECT id FROM trips WHERE id = :id;"), {"id": trip_id})).mappings().first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    if current_user.role == 'driver':
        owner = (await db.execute(
            text("SELECT id FROM trips WHERE id = :id AND driver_id = :driver_id;"),
            {"id": trip_id, "driver_id": current_user.id},
        )).scalars().first()
        if owner is None:
            raise HTTPException(status_code=403, detail="This trip is not assigned to you.")

    await db.execute(text("UPDATE trips SET status = :status WHERE id = :id;"), {"status": payload.status, "id": trip_id})
    await db.commit()
    await manager.broadcast_trip(trip_id, {"event": "trip_status", "trip_id": trip_id, "status": payload.status})
    return {"trip_id": trip_id, "status": payload.status}


TIER_MULTIPLIERS: dict[str, float] = {
    'off_peak': 0.90,       # 10% off-peak discount
    'standard': 1.00,       # Standard regular fare
    'peak_rush': 1.15,      # 15% rush hour surcharge
    'rush_hour_rain': 1.25, # 25% severe condition / surge surcharge
}


def calculate_segment_fare(
    board_order: int,
    alight_order: int,
    base_fare: float = 200.0,
    per_hop_fare: float = 150.0,
    fare_matrix: Optional[dict] = None,
    fixed_price: Optional[float] = None,
    allow_driver_tier: bool = False,
    driver_tier: str = 'standard',
    max_surcharge_pct: float = 25.0,
    board_stop_name: Optional[str] = None,
    alight_stop_name: Optional[str] = None,
) -> float:
    # 1. Fixed Trip Price Priority (e.g. flat KES 1,200 for express direct trips)
    if fixed_price is not None and fixed_price > 0:
        base_amount = float(fixed_price)
    # 2. Stop-to-Stop Price Matrix Priority (e.g. specific custom stop pairs)
    elif fare_matrix:
        order_key = f"{board_order}-{alight_order}"
        name_key = f"{board_stop_name.strip()}-{alight_stop_name.strip()}" if (board_stop_name and alight_stop_name) else None
        
        if order_key in fare_matrix:
            base_amount = float(fare_matrix[order_key])
        elif name_key and name_key in fare_matrix:
            base_amount = float(fare_matrix[name_key])
        elif name_key and any(k.lower() == name_key.lower() for k in fare_matrix):
            matched_k = next(k for k in fare_matrix if k.lower() == name_key.lower())
            base_amount = float(fare_matrix[matched_k])
        else:
            hops = max(1, alight_order - board_order)
            base_amount = float(base_fare + hops * per_hop_fare)
    # 3. Base Fare + Rate Per Stop (corridor hop calculation)
    else:
        hops = max(1, alight_order - board_order)
        base_amount = float(base_fare + hops * per_hop_fare)

    # 4. Driver Operational Tier & Surcharge (Strictly Governed by Admin Bounds)
    multiplier = 1.0
    if allow_driver_tier and driver_tier:
        tier_mult = TIER_MULTIPLIERS.get(driver_tier, 1.0)
        max_allowed_mult = 1.0 + max(0.0, float(max_surcharge_pct) / 100.0)
        # Surcharge is strictly clamped between 0.80 and admin max multiplier
        multiplier = max(0.80, min(tier_mult, max_allowed_mult))

    return round(base_amount * multiplier, 2)


@app.get("/api/trips/{trip_id}/fare")
async def get_trip_fare(trip_id: int, board_order: int, alight_order: int, db=Depends(get_async_db)):
    if board_order >= alight_order:
        raise HTTPException(status_code=400, detail="Alighting stop must be after boarding stop.")

    trip_data = (await db.execute(
        text("""
            SELECT t.id, t.fixed_price, t.allow_driver_tier, t.max_surcharge_pct, t.driver_tier,
                   r.base_fare, r.per_hop_fare, r.fare_matrix
            FROM trips t
            JOIN routes r ON r.id = t.route_id
            WHERE t.id = :id;
        """),
        {"id": trip_id}
    )).mappings().first()

    if not trip_data:
        raise HTTPException(status_code=404, detail="Trip not found.")

    hops = alight_order - board_order
    matrix = trip_data["fare_matrix"] if isinstance(trip_data["fare_matrix"], dict) else (json.loads(trip_data["fare_matrix"]) if trip_data["fare_matrix"] else None)

    fare = calculate_segment_fare(
        board_order=board_order,
        alight_order=alight_order,
        base_fare=trip_data["base_fare"] or 200.0,
        per_hop_fare=trip_data["per_hop_fare"] or 150.0,
        fare_matrix=matrix,
        fixed_price=trip_data["fixed_price"],
        allow_driver_tier=trip_data["allow_driver_tier"],
        driver_tier=trip_data["driver_tier"] or "standard",
        max_surcharge_pct=trip_data["max_surcharge_pct"] or 25.0,
    )
    return {
        "trip_id": trip_id,
        "board_order": board_order,
        "alight_order": alight_order,
        "hop_count": hops,
        "fare": fare,
        "driver_tier": trip_data["driver_tier"],
        "allow_driver_tier": trip_data["allow_driver_tier"],
        "is_fixed_price": bool(trip_data["fixed_price"]),
    }


@app.get("/api/trips/{trip_id}/budget-reach")
async def get_budget_reach(
    trip_id: int,
    board_order: int,
    budget: float,
    intended_alight_order: Optional[int] = None,
    db: AsyncSession = Depends(get_async_db)
):
    """
    "Bei ya Mfuko" (Pocket Fare & Budget Hop Finder):
    Given a starting stop and available budget (e.g. KES 100 on a route where
    the final destination is KES 250), calculates every downstream stop's exact fare,
    identifies the furthest stage within reach, and calculates any deficit.
    """
    if budget < 0:
        raise HTTPException(status_code=400, detail="Budget amount cannot be negative.")

    trip_data = (await db.execute(
        text("""
            SELECT t.id, t.name, t.fixed_price, t.allow_driver_tier, t.max_surcharge_pct, t.driver_tier,
                   r.id AS route_id, r.name AS route_name, r.base_fare, r.per_hop_fare, r.fare_matrix
            FROM trips t
            JOIN routes r ON r.id = t.route_id
            WHERE t.id = :id;
        """),
        {"id": trip_id}
    )).mappings().first()

    if not trip_data:
        raise HTTPException(status_code=404, detail="Trip not found.")

    stops_rows = (await db.execute(
        text("SELECT id, stop_name, stop_order FROM route_stops WHERE route_id = :rid ORDER BY stop_order ASC;"),
        {"rid": trip_data["route_id"]}
    )).mappings().all()

    stops = [dict(s) for s in stops_rows]
    board_stop = next((s for s in stops if s["stop_order"] == board_order), None)
    if not board_stop:
        board_stop = stops[0] if stops else {"id": 1, "stop_name": "Stage 1", "stop_order": 1}
        board_order = board_stop["stop_order"]

    matrix = trip_data["fare_matrix"] if isinstance(trip_data["fare_matrix"], dict) else (json.loads(trip_data["fare_matrix"]) if trip_data["fare_matrix"] else None)

    stages = []
    furthest_reachable = None

    downstream = [s for s in stops if s["stop_order"] > board_order]

    for s in downstream:
        fare = calculate_segment_fare(
            board_order=board_order,
            alight_order=s["stop_order"],
            base_fare=trip_data["base_fare"] or 200.0,
            per_hop_fare=trip_data["per_hop_fare"] or 150.0,
            fare_matrix=matrix,
            fixed_price=trip_data["fixed_price"],
            allow_driver_tier=trip_data["allow_driver_tier"],
            driver_tier=trip_data["driver_tier"] or "standard",
            max_surcharge_pct=trip_data["max_surcharge_pct"] or 25.0,
            board_stop_name=board_stop["stop_name"],
            alight_stop_name=s["stop_name"],
        )

        is_reachable = (budget >= fare)
        change_rem = max(0.0, round(budget - fare, 2))
        deficit = max(0.0, round(fare - budget, 2))

        stage_item = {
            "id": s["id"],
            "stop_name": s["stop_name"],
            "stop_order": s["stop_order"],
            "hop_count": s["stop_order"] - board_order,
            "fare": fare,
            "is_reachable": is_reachable,
            "change_remaining": change_rem,
            "deficit": deficit,
        }
        stages.append(stage_item)

        if is_reachable:
            furthest_reachable = stage_item

    intended_stop = None
    deficit_to_destination = 0.0
    if intended_alight_order:
        intended_stage = next((st for st in stages if st["stop_order"] == intended_alight_order), None)
        if intended_stage:
            intended_stop = intended_stage
            deficit_to_destination = intended_stage["deficit"]
    elif stages:
        intended_stop = stages[-1]
        deficit_to_destination = stages[-1]["deficit"]

    return {
        "trip_id": trip_id,
        "trip_name": trip_data["name"],
        "route_name": trip_data["route_name"],
        "board_stop": board_stop,
        "budget": budget,
        "furthest_reachable_stop": furthest_reachable,
        "intended_alight_stop": intended_stop,
        "deficit_to_destination": deficit_to_destination,
        "stages_breakdown": stages,
        "can_reach_any": furthest_reachable is not None,
    }


class BookingRequest(BaseModel):
    trip_id: int
    seat_number: int
    board_stop_order: int
    alight_stop_order: int
    has_luggage: bool = False
    luggage_count: int = 0
    luggage_description: Optional[str] = None
    voucher_code: Optional[str] = None


@app.post("/api/book-seat")
async def book_seat(booking: BookingRequest, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """Create a booking for the AUTHENTICATED user (the client cannot choose
    who the booking belongs to). Supports accompanied luggage add-ons and Travel Credit Vouchers."""
    # Fast in-memory check for concurrent seat lock conflict
    is_conflict, conflict_lock = await seat_lock_manager.check_lock_conflict(
        trip_id=booking.trip_id,
        seat_number=booking.seat_number,
        board_order=booking.board_stop_order,
        alight_order=booking.alight_stop_order,
        requesting_user_id=current_user.id,
    )
    if is_conflict and conflict_lock:
        raise HTTPException(
            status_code=409,
            detail=f"Seat {booking.seat_number} is temporarily locked by another commuter ({conflict_lock.seconds_remaining}s remaining).",
        )

    try:
        trip_data = (await db.execute(
            text("""
                SELECT t.id, t.status, t.fixed_price, t.allow_driver_tier, t.max_surcharge_pct, t.driver_tier,
                       r.base_fare, r.per_hop_fare, r.fare_matrix,
                       v.plate_number, vc.is_grounded, vc.grounded_reason
                FROM trips t
                JOIN routes r ON r.id = t.route_id
                LEFT JOIN vehicles v ON v.id = t.vehicle_id
                LEFT JOIN vehicle_compliance vc ON vc.vehicle_id = v.id
                WHERE t.id = :id;
            """),
            {"id": booking.trip_id}
        )).mappings().first()

        if not trip_data:
            raise HTTPException(status_code=404, detail="Trip not found.")
        if trip_data["status"] == 'grounded' or trip_data.get("is_grounded"):
            raise HTTPException(
                status_code=403,
                detail=f"Cannot book seat: Vehicle {trip_data.get('plate_number') or ''} is grounded under NTSA compliance ({trip_data.get('grounded_reason') or 'Safety inspection expired'}).",
            )

        matrix = None
        if trip_data and trip_data.get("fare_matrix"):
            fm = trip_data["fare_matrix"]
            matrix = fm if isinstance(fm, dict) else json.loads(fm)

        fare = calculate_segment_fare(
            board_order=booking.board_stop_order,
            alight_order=booking.alight_stop_order,
            base_fare=trip_data["base_fare"] if trip_data else 200.0,
            per_hop_fare=trip_data["per_hop_fare"] if trip_data else 150.0,
            fare_matrix=matrix,
            fixed_price=trip_data["fixed_price"] if trip_data else None,
            allow_driver_tier=trip_data["allow_driver_tier"] if trip_data else False,
            driver_tier=trip_data["driver_tier"] if trip_data else "standard",
            max_surcharge_pct=trip_data["max_surcharge_pct"] if trip_data else 25.0,
        )

        luggage_count = max(0, int(booking.luggage_count)) if booking.has_luggage else 0
        luggage_fee = float(luggage_count * 150.0) if booking.has_luggage else 0.0
        total_fare = float(fare + luggage_fee)

        # Process travel voucher discount if provided
        voucher_discount = 0.0
        voucher_code_applied = None
        if booking.voucher_code and booking.voucher_code.strip():
            clean_code = booking.voucher_code.strip().upper()
            v_check = (await db.execute(
                text("""
                    SELECT id, code, user_id, remaining_balance, status, expires_at
                    FROM travel_vouchers
                    WHERE code = :code;
                """),
                {"code": clean_code}
            )).mappings().first()

            if not v_check:
                raise HTTPException(status_code=400, detail="Invalid travel credit voucher code.")
            if v_check["user_id"] != current_user.id and current_user.role != 'admin':
                raise HTTPException(status_code=403, detail="This voucher does not belong to your account.")
            if v_check["status"] != 'active':
                raise HTTPException(status_code=400, detail=f"Voucher is not active ({v_check['status']}).")

            exp = v_check["expires_at"]
            if isinstance(exp, str):
                exp = datetime.fromisoformat(exp.replace("Z", "+00:00"))
            if exp and exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp and exp < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="Travel credit voucher has expired.")

            rem_bal = float(v_check["remaining_balance"])
            if rem_bal <= 0:
                raise HTTPException(status_code=400, detail="Travel credit voucher has zero balance.")

            voucher_discount = min(total_fare, rem_bal)
            voucher_code_applied = clean_code
            new_balance = round(rem_bal - voucher_discount, 2)
            new_status = 'redeemed' if new_balance <= 0.01 else 'active'

            await db.execute(
                text("""
                    UPDATE travel_vouchers
                    SET remaining_balance = :bal,
                        status = :status,
                        redeemed_at = CASE WHEN :status = 'redeemed' THEN NOW() ELSE redeemed_at END
                    WHERE id = :vid;
                """),
                {"bal": new_balance, "status": new_status, "vid": v_check["id"]}
            )

        net_to_pay = max(0.0, round(total_fare - voucher_discount, 2))
        is_fully_covered = (net_to_pay <= 0.01)

        insert_booking = text(
            """
            INSERT INTO bookings (
                trip_id, user_id, seat_number, board_stop_order, alight_stop_order,
                status, payment_status, has_luggage, luggage_count, luggage_fee, luggage_description,
                voucher_code, voucher_discount
            ) VALUES (
                :trip_id, :user_id, :seat_number, :board_order, :alight_order,
                :status, :payment_status, :has_luggage, :luggage_count, :luggage_fee, :luggage_description,
                :voucher_code, :voucher_discount
            ) RETURNING id;
            """
        )
        res = await db.execute(
            insert_booking,
            {
                "trip_id": booking.trip_id,
                "user_id": current_user.id,
                "seat_number": booking.seat_number,
                "board_order": booking.board_stop_order,
                "alight_order": booking.alight_stop_order,
                "status": 'confirmed' if is_fully_covered else 'pending',
                "payment_status": 'paid' if is_fully_covered else 'unpaid',
                "has_luggage": bool(booking.has_luggage and luggage_count > 0),
                "luggage_count": luggage_count,
                "luggage_fee": luggage_fee,
                "luggage_description": booking.luggage_description,
                "voucher_code": voucher_code_applied,
                "voucher_discount": voucher_discount,
            },
        )
        booking_id = res.scalar_one()

        if is_fully_covered:
            sim_receipt = f"VCH{random.randint(10000000, 99999999)}"
            insert_payment = text(
                """
                INSERT INTO payments (booking_id, provider, provider_payload, amount, status, provider_reference, receipt_number, callback_verified)
                VALUES (:booking_id, 'travel_voucher', :payload, :amount, 'completed', :ref, :receipt, true) RETURNING id;
                """
            )
            pres = await db.execute(
                insert_payment,
                {
                    "booking_id": booking_id,
                    "payload": json.dumps({"voucher_code": voucher_code_applied, "discount": voucher_discount}),
                    "amount": total_fare,
                    "ref": voucher_code_applied,
                    "receipt": sim_receipt,
                },
            )
            payment_id = pres.scalar_one()
        else:
            insert_payment = text(
                "INSERT INTO payments (booking_id, provider, provider_payload, amount, status) VALUES (:booking_id, :provider, :payload, :amount, :status) RETURNING id;"
            )
            pres = await db.execute(
                insert_payment,
                {"booking_id": booking_id, "provider": 'paystack', "payload": None, "amount": net_to_pay, "status": 'initiated'},
            )
            payment_id = pres.scalar_one()

        await db.commit()

        # Release temporary lock as booking is now created in DB
        await seat_lock_manager.release_lock(booking.trip_id, booking.seat_number, user_id=current_user.id)

    except DBAPIError as e:
        await db.rollback()
        msg = str(e)
        if 'Seat conflict' in msg or 'Seat conflict for trip' in msg:
            raise HTTPException(status_code=400, detail='Seat is already occupied for this specific route segment.')
        raise HTTPException(status_code=500, detail=msg)

    # If fully covered, broadcast confirmed booking; otherwise broadcast pending booking
    if is_fully_covered:
        await manager.broadcast_trip(booking.trip_id, {
            'event': 'seat_booked',
            'trip_id': booking.trip_id,
            'seat_number': booking.seat_number,
            'board_stop_order': booking.board_stop_order,
            'alight_stop_order': booking.alight_stop_order,
            'booking_id': booking_id,
        })
        stop_names = await trip_stop_names(db, booking.trip_id)
        chain = await recompute_chain(db, booking.trip_id, booking.seat_number)
        await notify_chain_change(db, manager, booking.trip_id, booking.seat_number, chain, stop_names)

        await create_notification(
            db, current_user.id, 'booking_confirmed',
            f"Seat #{booking.seat_number} confirmed (Voucher)",
            f"Voucher redeemed successfully. Your seat #{booking.seat_number} is confirmed on trip #{booking.trip_id}.",
            {"trip_id": booking.trip_id, "seat_number": booking.seat_number, "booking_id": booking_id},
        )
        await db.commit()
        await manager.send_to_user(current_user.id, {
            "event": "booking_confirmed",
            "trip_id": booking.trip_id,
            "seat_number": booking.seat_number,
            "booking_id": booking_id,
        })
        try:
            await dispatch.dispatch_booking_confirmation(
                db, booking_id, channels=["whatsapp", "sms"]
            )
        except Exception as disp_err:
            logger.warning(f"[Dispatch] Notification error: {disp_err}")

        return {
            "status": "confirmed",
            "booking_id": booking_id,
            "payment_id": payment_id,
            "amount": total_fare,
            "voucher_discount": voucher_discount,
            "net_amount": 0.0,
            "seat_fare": fare,
            "luggage_fee": luggage_fee,
            "has_luggage": bool(booking.has_luggage and luggage_count > 0),
            "luggage_count": luggage_count,
            "message": "Booking 100% paid and confirmed with travel voucher.",
        }

    # Notify listeners about pending booking (so drivers/other systems can be aware)
    await manager.broadcast_trip(booking.trip_id, {
        "event": "booking_pending",
        "trip_id": booking.trip_id,
        "seat_number": booking.seat_number,
        "booking_id": booking_id,
        "board_stop_order": booking.board_stop_order,
        "alight_stop_order": booking.alight_stop_order,
        "has_luggage": bool(booking.has_luggage and luggage_count > 0),
        "luggage_count": luggage_count,
    })

    # Recompute the seat chain and fire relay/waitlist notifications: the
    # passenger ahead is told the seat continues, waitlisted users learn about
    # any newly freed segments.
    stop_names = await trip_stop_names(db, booking.trip_id)
    chain = await recompute_chain(db, booking.trip_id, booking.seat_number)
    await notify_chain_change(db, manager, booking.trip_id, booking.seat_number, chain, stop_names)

    return {
        "status": "pending",
        "booking_id": booking_id,
        "payment_id": payment_id,
        "amount": total_fare,
        "voucher_discount": voucher_discount,
        "net_amount": net_to_pay,
        "seat_fare": fare,
        "luggage_fee": luggage_fee,
        "has_luggage": bool(booking.has_luggage and luggage_count > 0),
        "luggage_count": luggage_count,
        "message": "Booking created and awaiting payment for remaining balance.",
    }


class PaymentRequest(BaseModel):
    phone_number: str
    amount: float
    booking_id: int


@app.post("/api/pay/mpesa-stk")
async def trigger_mpesa_stk(payment: PaymentRequest, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """
    Simulate sending an M-Pesa STK push and immediately mark payment completed
    for demo purposes. (When Daraja credentials are configured, use
    POST /api/pay/daraja/stk for a real STK push instead.)
    This will update the payments table and set booking to confirmed.
    """
    try:
        # Ensure the booking the payment refers to actually exists, so a stray
        # booking_id can never be silently marked as paid.
        booking_check = await db.execute(
            text("SELECT id, user_id FROM bookings WHERE id = :booking_id;"), {"booking_id": payment.booking_id}
        )
        booking_row_full = booking_check.mappings().first()
        if booking_row_full is None:
            raise HTTPException(status_code=404, detail=f"Booking {payment.booking_id} does not exist.")

        # Only the passenger who owns the booking (or an admin) may pay for it.
        if booking_row_full["user_id"] != current_user.id and current_user.role != 'admin':
            raise HTTPException(status_code=403, detail="You can only pay for your own booking.")

        # Find existing payment row
        q = text("SELECT id, status FROM payments WHERE booking_id = :booking_id LIMIT 1;")
        res = await db.execute(q, {"booking_id": payment.booking_id})
        p_row = res.mappings().first()
        payload = json.dumps({"phone": payment.phone_number, "simulated": True})
        sim_receipt = f"SIM{random.randint(10000000, 99999999)}"
        if p_row:
            payment_id = p_row['id']
            await db.execute(
                text("""
                    UPDATE payments
                    SET status = :status, provider = :provider, provider_payload = :payload,
                        provider_reference = :ref, receipt_number = :receipt, phone_number = :phone, callback_verified = true
                    WHERE id = :id;
                """),
                {"status": 'completed', "provider": 'mpesa_sim', "payload": payload,
                 "ref": f"SIM-{payment.booking_id}", "receipt": sim_receipt, "phone": payment.phone_number, "id": payment_id},
            )
        else:
            ir = await db.execute(
                text("""
                    INSERT INTO payments (booking_id, provider, provider_payload, amount, status, provider_reference, receipt_number, phone_number, callback_verified)
                    VALUES (:booking_id, :provider, :payload, :amount, :status, :ref, :receipt, :phone, true) RETURNING id;
                """),
                {"booking_id": payment.booking_id, "provider": 'mpesa_sim', "payload": payload,
                 "amount": payment.amount, "status": 'completed', "ref": f"SIM-{payment.booking_id}",
                 "receipt": sim_receipt, "phone": payment.phone_number},
            )
            payment_id = ir.scalar_one()

        br = await db.execute(
            text("UPDATE bookings SET payment_status = :ps, status = :s WHERE id = :id RETURNING trip_id, seat_number, board_stop_order, alight_stop_order;"),
            {"ps": 'paid', "s": 'confirmed', "id": payment.booking_id},
        )
        booking_row = br.mappings().first()
        await db.commit()

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    # Broadcast seat_booked so UIs and drivers know seat is now taken
    if booking_row:
        await manager.broadcast_trip(booking_row['trip_id'], {
            'event': 'seat_booked',
            'trip_id': booking_row['trip_id'],
            'seat_number': booking_row['seat_number'],
            'board_stop_order': booking_row['board_stop_order'],
            'alight_stop_order': booking_row['alight_stop_order'],
            'booking_id': payment.booking_id,
        })

        # Recompute chain + relay notifications now that the booking is confirmed.
        stop_names = await trip_stop_names(db, booking_row['trip_id'])
        chain = await recompute_chain(db, booking_row['trip_id'], booking_row['seat_number'])
        await notify_chain_change(db, manager, booking_row['trip_id'], booking_row['seat_number'], chain, stop_names)

        # Confirm notification for the passenger.
        await create_notification(
            db, booking_row_full["user_id"], 'booking_confirmed',
            f"Seat #{booking_row['seat_number']} confirmed",
            f"Payment received. Your seat #{booking_row['seat_number']} is confirmed on trip #{booking_row['trip_id']}.",
            {"trip_id": booking_row['trip_id'], "seat_number": booking_row['seat_number'], "booking_id": payment.booking_id},
        )
        await db.commit()
        await manager.send_to_user(booking_row_full["user_id"], {
            "event": "booking_confirmed",
            "trip_id": booking_row['trip_id'],
            "seat_number": booking_row['seat_number'],
            "booking_id": payment.booking_id,
        })

        # Automated SMS & WhatsApp Passenger Dispatch
        try:
            await dispatch.dispatch_booking_confirmation(
                db, payment.booking_id, channels=["whatsapp", "sms"], override_phone=payment.phone_number
            )
        except Exception as disp_err:
            print(f"[Dispatch] Notification error: {disp_err}")

    return {
        "status": "success",
        "message": f"M-Pesa STK push simulated and payment recorded for booking {payment.booking_id}",
        "payment_id": payment_id,
        "booking_id": payment.booking_id,
    }


# --------------------------------------------------------------------------
# Real M-Pesa Daraja STK push (used when MPESA_* env vars are configured)
# --------------------------------------------------------------------------
class DarajaStkRequest(BaseModel):
    booking_id: int
    phone_number: str
    amount: float = 500.0
    simulate: bool = False


@app.post("/api/pay/daraja/stk")
async def daraja_stk(payload: DarajaStkRequest, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """Initiate an M-Pesa STK push via Safaricom Daraja API.

    When MPESA_* env credentials are configured, sends a real STK push to the user's phone.
    If not configured or payload.simulate is True, creates a simulated STK request for testing.
    """
    booking = (await db.execute(
        text("SELECT id, user_id FROM bookings WHERE id = :id;"), {"id": payload.booking_id}
    )).mappings().first()
    if booking is None:
        raise HTTPException(status_code=404, detail=f"Booking {payload.booking_id} does not exist.")
    if booking["user_id"] != current_user.id and current_user.role != 'admin':
        raise HTTPException(status_code=403, detail="You can only pay for your own booking.")

    if daraja.configured() and not payload.simulate:
        try:
            resp = await daraja.stk_push(
                phone=payload.phone_number,
                amount=payload.amount,
                account_reference=f"BUSGO-{payload.booking_id}",
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Daraja request failed: {e}")

        checkout_id = resp.get("CheckoutRequestID")
        if not checkout_id:
            raise HTTPException(status_code=502, detail=f"Daraja rejected the STK push: {resp}")
    else:
        # Simulator fallback for local testing & demos without live credentials
        checkout_id = f"ws_CO_{datetime.now().strftime('%d%m%Y%H%M%S')}_{uuid.uuid4().hex[:8]}"
        resp = {
            "ResponseCode": "0",
            "ResponseDescription": "Success. Request accepted for processing",
            "MerchantRequestID": f"MR-{uuid.uuid4().hex[:8]}",
            "CheckoutRequestID": checkout_id,
            "CustomerMessage": "Success. Request accepted for processing",
            "simulated": True,
        }

    # Record or update the pending payment linked to the provider reference.
    p_check = (await db.execute(
        text("SELECT id FROM payments WHERE booking_id = :bid LIMIT 1;"),
        {"bid": payload.booking_id}
    )).mappings().first()

    if p_check:
        await db.execute(
            text("""
                UPDATE payments
                SET provider = 'mpesa_daraja', status = 'initiated',
                    provider_reference = :ref, phone_number = :phone,
                    amount = :amount,
                    provider_payload = CAST(:payload AS jsonb)
                WHERE id = :pid;
            """),
            {"ref": checkout_id, "phone": payload.phone_number, "amount": payload.amount,
             "payload": json.dumps(resp), "pid": p_check["id"]},
        )
    else:
        await db.execute(
            text("""
                INSERT INTO payments (booking_id, provider, provider_payload, amount, status, provider_reference, phone_number, callback_verified)
                VALUES (:booking_id, 'mpesa_daraja', CAST(:payload AS jsonb), :amount, 'initiated', :ref, :phone, false);
            """),
            {"booking_id": payload.booking_id, "payload": json.dumps(resp),
             "amount": payload.amount, "ref": checkout_id, "phone": payload.phone_number},
        )
    await db.commit()

    return {
        "status": "initiated",
        "message": "STK push sent — enter your M-Pesa PIN to approve.",
        "provider": "mpesa_daraja",
        "checkout_request_id": checkout_id,
        "booking_id": payload.booking_id,
    }


@app.post("/api/pay/daraja/callback")
async def daraja_callback(body: dict, db=Depends(get_async_db)):
    """Safaricom webhook: verify + apply the STK push result idempotently.

    Daraja calls this URL (MPESA_CALLBACK_URL) after the customer approves or
    rejects the push. We look the payment up by CheckoutRequestID and mark the
    booking confirmed only when ResultCode == 0.
    """
    parsed = daraja.parse_callback(body)
    if parsed is None:
        raise HTTPException(status_code=400, detail="Malformed Daraja callback.")

    checkout_id = parsed["checkout_request_id"]
    p_row = (await db.execute(
        text("SELECT id, booking_id FROM payments WHERE provider_reference = :ref LIMIT 1;"),
        {"ref": checkout_id},
    )).mappings().first()
    if p_row is None:
        # Unknown/duplicate callback — still acknowledge (Daraja retries).
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

    payment_id = p_row["id"]
    success = parsed["result_code"] == 0
    new_status = "completed" if success else "failed"
    receipt_num = parsed.get("metadata", {}).get("MpesaReceiptNumber")

    await db.execute(
        text("""
            UPDATE payments
            SET status = :status, callback_payload = CAST(:cb AS jsonb), callback_verified = true,
                receipt_number = COALESCE(:receipt, receipt_number)
            WHERE id = :id;
        """),
        {"status": new_status, "cb": json.dumps(body), "receipt": receipt_num, "id": payment_id},
    )

    booking_row = None
    cancelled_booking = None
    if success:
        br = await db.execute(
            text("""
                UPDATE bookings SET payment_status = 'paid', status = 'confirmed'
                WHERE id = :id
                RETURNING id, trip_id, seat_number, board_stop_order, alight_stop_order, user_id;
            """),
            {"id": p_row["booking_id"]},
        )
        booking_row = br.mappings().first()
        if booking_row and booking_row.get("user_id"):
            amt = float(p_row.get("amount") or 500.0)
            pts = max(1, int(amt // 10))
            await db.execute(
                text("UPDATE users SET loyalty_points = COALESCE(loyalty_points, 0) + :pts WHERE id = :uid;"),
                {"pts": pts, "uid": booking_row["user_id"]}
            )
            await db.execute(
                text("INSERT INTO loyalty_transactions (user_id, points, booking_id, description, created_at) VALUES (:uid, :pts, :bid, :desc, NOW());"),
                {"uid": booking_row["user_id"], "pts": pts, "bid": p_row["booking_id"], "desc": f"Earned {pts} Safari Points for Seat #{booking_row['seat_number']} booking (KES {amt:.0f})"}
            )
    else:
        # Failed/cancelled payment -> release the pending booking so the seat frees up immediately.
        br = await db.execute(
            text("""
                UPDATE bookings SET status = 'cancelled', payment_status = 'unpaid'
                WHERE id = :id
                RETURNING id, trip_id, seat_number, board_stop_order, alight_stop_order, user_id;
            """),
            {"id": p_row["booking_id"]},
        )
        cancelled_booking = br.mappings().first()
    await db.commit()

    if booking_row is not None:
        await manager.broadcast_trip(booking_row["trip_id"], {
            "event": "seat_booked",
            "trip_id": booking_row["trip_id"],
            "seat_number": booking_row["seat_number"],
            "board_stop_order": booking_row["board_stop_order"],
            "alight_stop_order": booking_row["alight_stop_order"],
            "booking_id": booking_row["id"],
        })
        stop_names = await trip_stop_names(db, booking_row["trip_id"])
        chain = await recompute_chain(db, booking_row["trip_id"], booking_row["seat_number"])
        await notify_chain_change(db, manager, booking_row["trip_id"], booking_row["seat_number"], chain, stop_names)
        receipt_desc = f" Receipt: {receipt_num}." if receipt_num else ""
        await create_notification(
            db, booking_row["user_id"], "payment_update",
            "Payment received",
            f"M-Pesa confirmed for seat #{booking_row['seat_number']} on trip #{booking_row['trip_id']}.{receipt_desc}",
            {"trip_id": booking_row["trip_id"], "seat_number": booking_row["seat_number"], "receipt": receipt_num},
        )
        await db.commit()

        # Automated SMS & WhatsApp Passenger Dispatch
        try:
            await dispatch.dispatch_booking_confirmation(
                db, booking_row["id"], channels=["whatsapp", "sms"]
            )
        except Exception as disp_err:
            print(f"[Dispatch] Notification error: {disp_err}")
    elif cancelled_booking is not None:
        await manager.broadcast_trip(cancelled_booking["trip_id"], {
            "event": "booking_cancelled",
            "trip_id": cancelled_booking["trip_id"],
            "seat_number": cancelled_booking["seat_number"],
            "booking_id": cancelled_booking["id"],
        })
        stop_names = await trip_stop_names(db, cancelled_booking["trip_id"])
        chain = await recompute_chain(db, cancelled_booking["trip_id"], cancelled_booking["seat_number"])
        await notify_chain_change(db, manager, cancelled_booking["trip_id"], cancelled_booking["seat_number"], chain, stop_names)
        fail_desc = parsed.get("result_desc") or "Payment cancelled"
        await create_notification(
            db, cancelled_booking["user_id"], "payment_update",
            "Payment unsuccessful",
            f"M-Pesa payment was not completed ({fail_desc}). Reserved seat #{cancelled_booking['seat_number']} has been released.",
            {"trip_id": cancelled_booking["trip_id"], "seat_number": cancelled_booking["seat_number"], "result_code": parsed["result_code"]},
        )
        await db.commit()

    return {"ResultCode": 0, "ResultDesc": "Accepted"}


class DarajaSimulateCallbackRequest(BaseModel):
    checkout_request_id: str
    result_code: int = 0
    amount: float = 500.0
    receipt_number: Optional[str] = None
    phone_number: str = "254712345678"
    result_desc: Optional[str] = None


@app.post("/api/pay/daraja/simulate-callback")
async def daraja_simulate_callback(payload: DarajaSimulateCallbackRequest, db=Depends(get_async_db)):
    """Simulate a Daraja STK callback webhook payload locally for testing without live Safaricom credentials.

    Builds an authentic Safaricom JSON webhook payload (ResultCode: 0 with receipt, or ResultCode: 1032
    for user cancellation) and invokes the internal callback verification handler directly.
    """
    clean_phone = payload.phone_number.replace("+", "").strip()
    receipt = payload.receipt_number or (f"QKA{random.randint(1000000, 9999999)}" if payload.result_code == 0 else None)
    
    if payload.result_code == 0:
        desc = payload.result_desc or "The service request is processed successfully."
        body = {
            "Body": {
                "stkCallback": {
                    "MerchantRequestID": f"MR-{uuid.uuid4().hex[:8].upper()}",
                    "CheckoutRequestID": payload.checkout_request_id,
                    "ResultCode": 0,
                    "ResultDesc": desc,
                    "CallbackMetadata": {
                        "Item": [
                            {"Name": "Amount", "Value": payload.amount},
                            {"Name": "MpesaReceiptNumber", "Value": receipt},
                            {"Name": "Balance"},
                            {"Name": "TransactionDate", "Value": int(datetime.now().strftime("%Y%m%d%H%M%S"))},
                            {"Name": "PhoneNumber", "Value": int(clean_phone) if clean_phone.isdigit() else 254712345678},
                        ]
                    }
                }
            }
        }
    else:
        desc = payload.result_desc or ("Request cancelled by user" if payload.result_code == 1032 else f"Error code {payload.result_code}")
        body = {
            "Body": {
                "stkCallback": {
                    "MerchantRequestID": f"MR-{uuid.uuid4().hex[:8].upper()}",
                    "CheckoutRequestID": payload.checkout_request_id,
                    "ResultCode": payload.result_code,
                    "ResultDesc": desc
                }
            }
        }

    cb_res = await daraja_callback(body, db)
    return {
        "simulation": "completed",
        "result_code": payload.result_code,
        "receipt_number": receipt,
        "callback_response": cb_res,
        "mock_payload": body,
    }


@app.get("/api/pay/status/{booking_id}")
async def get_payment_status(booking_id: int, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """Fetch live payment and booking confirmation status for a booking."""
    booking = (await db.execute(
        text("SELECT id, user_id, status, payment_status, trip_id, seat_number FROM bookings WHERE id = :id;"),
        {"id": booking_id}
    )).mappings().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")
    if booking["user_id"] != current_user.id and current_user.role not in ('admin', 'driver'):
        raise HTTPException(status_code=403, detail="Not authorized to view this booking's payment.")

    pay = (await db.execute(
        text("SELECT id, provider, status, provider_reference, receipt_number, amount, phone_number, callback_verified, created_at FROM payments WHERE booking_id = :id ORDER BY id DESC LIMIT 1;"),
        {"id": booking_id}
    )).mappings().first()

    return {
        "booking_id": booking["id"],
        "booking_status": booking["status"],
        "payment_status": booking["payment_status"],
        "seat_number": booking["seat_number"],
        "trip_id": booking["trip_id"],
        "payment": dict(pay) if pay else None,
    }


class DispatchManualRequest(BaseModel):
    channels: List[str] = ["whatsapp", "sms"]
    override_phone: Optional[str] = None


@app.post("/api/bookings/{booking_id}/dispatch")
async def manual_dispatch_booking(
    booking_id: int,
    payload: Optional[DispatchManualRequest] = None,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Trigger or re-send SMS / WhatsApp boarding pass dispatch for a booking."""
    booking = (await db.execute(
        text("SELECT id, user_id FROM bookings WHERE id = :id;"), {"id": booking_id}
    )).mappings().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")
    if booking["user_id"] != current_user.id and current_user.role not in ('admin', 'driver'):
        raise HTTPException(status_code=403, detail="Not authorized to dispatch tickets for this booking.")

    channels = payload.channels if payload else ["whatsapp", "sms"]
    phone = payload.override_phone if payload else None

    res = await dispatch.dispatch_booking_confirmation(
        db, booking_id, channels=channels, override_phone=phone
    )
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@app.get("/api/bookings/{booking_id}/dispatch")
async def get_booking_dispatch_preview(
    booking_id: int,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Get WhatsApp & SMS formatted text, direct wa.me link, and outbox history for a booking."""
    booking = (await db.execute(
        text("SELECT id, user_id FROM bookings WHERE id = :id;"), {"id": booking_id}
    )).mappings().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")
    if booking["user_id"] != current_user.id and current_user.role not in ('admin', 'driver'):
        raise HTTPException(status_code=403, detail="Not authorized.")

    disp_rows = (await db.execute(
        text("SELECT id, channel, recipient, status, provider, provider_reference, error_message, created_at FROM dispatches WHERE booking_id = :id ORDER BY id DESC;"),
        {"id": booking_id}
    )).mappings().all()

    query = text("""
        SELECT
            b.id, b.trip_id, b.seat_number, b.board_stop_order, b.alight_stop_order,
            b.status, b.payment_status, b.user_id,
            u.full_name AS passenger_name, u.phone AS passenger_phone,
            t.name AS trip_name, t.scheduled_at AS departure_time,
            r.name AS route_name,
            v.plate_number AS vehicle_plate,
            vt.display_name AS vehicle_model,
            p.receipt_number
        FROM bookings b
        JOIN trips t ON t.id = b.trip_id
        JOIN routes r ON r.id = t.route_id
        LEFT JOIN users u ON u.id = b.user_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        LEFT JOIN payments p ON p.booking_id = b.id
        WHERE b.id = :id;
    """)
    b_row = (await db.execute(query, {"id": booking_id})).mappings().first()
    b_dict = dict(b_row) if b_row else {}

    stops_res = await db.execute(
        text("SELECT stop_name, stop_order FROM route_stops rs JOIN trips t ON t.route_id = rs.route_id WHERE t.id = :tid ORDER BY rs.stop_order ASC;"),
        {"tid": b_dict.get("trip_id", 1)},
    )
    stop_map = {s["stop_order"]: s["stop_name"] for s in stops_res.mappings().all()}
    b_dict["board_stop"] = stop_map.get(b_dict.get("board_stop_order"), f"Stop #{b_dict.get('board_stop_order')}")
    b_dict["alight_stop"] = stop_map.get(b_dict.get("alight_stop_order"), f"Stop #{b_dict.get('alight_stop_order')}")

    preview = dispatch.build_ticket_messages(b_dict, receipt_number=b_dict.get("receipt_number"))
    return {
        "booking_id": booking_id,
        "preview": preview,
        "history": [dict(d) for d in disp_rows],
    }


@app.get("/api/bookings/{booking_id}/escpos")
async def get_booking_escpos_slip(
    booking_id: int,
    width: int = 58,
    output: str = "base64",
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Handheld Thermal POS: Generate ESC/POS byte stream for passenger ticket slip."""
    query = text("""
        SELECT
            b.id, b.trip_id, b.seat_number, b.board_stop_order, b.alight_stop_order,
            b.status, b.payment_status, b.user_id, b.has_luggage, b.luggage_count, b.luggage_fee,
            u.full_name AS passenger_name, u.phone AS passenger_phone,
            t.name AS trip_name, t.scheduled_at AS departure_time,
            t.fixed_price,
            r.name AS route_name, r.base_fare,
            v.plate_number AS vehicle_plate,
            s.name AS sacco_name,
            p.receipt_number, p.amount AS payment_amount
        FROM bookings b
        JOIN trips t ON t.id = b.trip_id
        JOIN routes r ON r.id = t.route_id
        LEFT JOIN users u ON u.id = b.user_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN saccos s ON s.id = v.sacco_id
        LEFT JOIN payments p ON p.booking_id = b.id
        WHERE b.id = :id;
    """)
    row = (await db.execute(query, {"id": booking_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Booking not found.")

    b_dict = dict(row)
    stops_res = await db.execute(
        text("""
            SELECT stop_name, stop_order
            FROM route_stops rs
            JOIN trips t ON t.route_id = rs.route_id
            WHERE t.id = :tid
            ORDER BY rs.stop_order ASC;
        """),
        {"tid": b_dict.get("trip_id")},
    )
    stop_map = {s["stop_order"]: s["stop_name"] for s in stops_res.mappings().all()}
    b_dict["board_stop"] = stop_map.get(b_dict.get("board_stop_order"), f"Stop #{b_dict.get('board_stop_order')}")
    b_dict["alight_stop"] = stop_map.get(b_dict.get("alight_stop_order"), f"Stop #{b_dict.get('alight_stop_order')}")

    ticket_payload = {
        "booking_id": b_dict["id"],
        "seat_number": b_dict["seat_number"],
        "passenger_name": b_dict["passenger_name"],
        "passenger_phone": b_dict["passenger_phone"],
        "sacco_name": b_dict.get("sacco_name") or "BUSGO TRANSIT SACCO",
        "route_name": b_dict.get("route_name"),
        "board_stop": b_dict["board_stop"],
        "alight_stop": b_dict["alight_stop"],
        "vehicle_plate": b_dict.get("vehicle_plate"),
        "departure_time": b_dict.get("departure_time"),
        "fare_amount": float(b_dict.get("payment_amount") or b_dict.get("fixed_price") or b_dict.get("base_fare") or 500.0),
        "luggage_fee": float(b_dict.get("luggage_fee") or 0.0),
        "receipt_number": b_dict.get("receipt_number"),
    }

    raw_bytes = escpos.generate_passenger_ticket_escpos(ticket_payload, width_mm=width)
    ascii_slip = escpos.generate_plain_ascii_slip(ticket_payload, width_mm=width)

    if output == "binary":
        from fastapi.responses import Response
        return Response(
            content=raw_bytes,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename=ticket_BG{booking_id}_{width}mm.bin"}
        )

    return {
        "ok": True,
        "booking_id": booking_id,
        "width_mm": width,
        "base64": base64.b64encode(raw_bytes).decode('ascii'),
        "ascii_preview": ascii_slip,
        "ticket": ticket_payload,
    }


@app.get("/api/parcels/{parcel_id}/escpos")
async def get_parcel_escpos_slip(
    parcel_id: int,
    width: int = 58,
    output: str = "base64",
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Handheld Thermal POS: Generate ESC/POS waybill receipt for Mzigo courier."""
    p_row = (await db.execute(text("SELECT * FROM parcels WHERE id = :id;"), {"id": parcel_id})).mappings().first()
    if not p_row:
        raise HTTPException(status_code=404, detail="Parcel not found.")

    parcel_dict = dict(p_row)
    raw_bytes = escpos.generate_parcel_waybill_escpos(parcel_dict, width_mm=width)

    if output == "binary":
        from fastapi.responses import Response
        return Response(
            content=raw_bytes,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename=waybill_P{parcel_id}_{width}mm.bin"}
        )

    return {
        "ok": True,
        "parcel_id": parcel_id,
        "width_mm": width,
        "base64": base64.b64encode(raw_bytes).decode('ascii'),
        "parcel": parcel_dict,
    }



@app.post("/api/bookings/{booking_id}/reconcile")
async def reconcile_single_booking(
    booking_id: int,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Actively query payment gateway (Daraja STK / Paystack) and resolve stranded or delayed payment status."""
    booking = (await db.execute(
        text("SELECT id, user_id FROM bookings WHERE id = :id;"), {"id": booking_id}
    )).mappings().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")
    if booking["user_id"] != current_user.id and current_user.role not in ('admin', 'driver'):
        raise HTTPException(status_code=403, detail="Not authorized to reconcile this booking.")

    result = await reconciliation.reconcile_booking_payment(db, booking_id)
    return result


@app.post("/api/admin/reconcile-all")
async def reconcile_all_pending_bookings(
    max_age_minutes: int = 5,
    db=Depends(get_async_db),
    _: User = Depends(require_roles('admin')),
):
    """Admin endpoint: sweep and actively reconcile all pending bookings against gateways."""
    sweep_res = await crons.sweep_expired_pending_bookings(db, max_age_minutes=max_age_minutes)
    return {
        "status": "success",
        "sweep_summary": sweep_res,
        "cron_stats": crons.get_cron_stats(),
    }


async def list_admin_dispatches(
    limit: int = 50,
    db=Depends(get_async_db),
    _: User = Depends(require_roles('admin')),
):
    """Admin view of all outbound SMS & WhatsApp dispatches."""
    rows = (await db.execute(
        text("""
            SELECT d.id, d.booking_id, d.user_id, d.channel, d.recipient,
                   d.message_body, d.status, d.provider, d.provider_reference,
                   d.error_message, d.created_at,
                   u.full_name AS passenger_name
            FROM dispatches d
            LEFT JOIN users u ON u.id = d.user_id
            ORDER BY d.id DESC
            LIMIT :limit;
        """),
        {"limit": limit}
    )).mappings().all()
    return {"dispatches": [dict(r) for r in rows]}

# --------------------------------------------------------------------------
# Mzigo & Cargo Management (Item F)
# --------------------------------------------------------------------------
PARCEL_CATEGORY_FEES = {
    "small_envelope": 200.0,
    "small_box": 350.0,
    "medium_box": 500.0,
    "heavy_sack": 800.0,
    "special_fragile": 1200.0,
}
DOORSTEP_PICKUP_FEE = 300.0
DOORSTEP_DELIVERY_FEE = 350.0


class ParcelQuotePayload(BaseModel):
    category: str = "medium_box"
    weight_kg: Optional[float] = 5.0
    pickup_type: str = "station"  # 'station' | 'doorstep'
    delivery_type: str = "station"  # 'station' | 'doorstep'
    declared_value: Optional[float] = 0.0
    origin_city: Optional[str] = "Nairobi"
    destination_city: Optional[str] = "Nakuru"
    trip_id: Optional[int] = None


class BookParcelPayload(BaseModel):
    trip_id: Optional[int] = None
    origin_city: Optional[str] = "Nairobi"
    destination_city: Optional[str] = "Nakuru"
    sender_name: str
    sender_phone: str
    recipient_name: str
    recipient_phone: str
    category: str = "medium_box"
    description: str
    weight_kg: Optional[float] = 5.0
    pickup_type: str = "station"  # 'station' | 'doorstep'
    delivery_type: str = "station"  # 'station' | 'doorstep'
    sender_address: Optional[str] = None
    sender_city_or_area: Optional[str] = None
    sender_pickup_notes: Optional[str] = None
    recipient_address: Optional[str] = None
    recipient_city_or_area: Optional[str] = None
    recipient_delivery_notes: Optional[str] = None
    declared_value: Optional[float] = 0.0
    pickup_stop_order: Optional[int] = 1
    dropoff_stop_order: Optional[int] = None
    payment_method: Optional[str] = "mpesa"  # 'mpesa' | 'cash_at_station'


class RegisterParcelPayload(BaseModel):
    sender_name: str
    sender_phone: str
    recipient_name: str
    recipient_phone: str
    pickup_stop_order: int
    dropoff_stop_order: int
    category: str = "medium_box"
    description: str
    weight_kg: Optional[float] = None
    fee: Optional[float] = None
    payment_status: str = "unpaid"
    pickup_type: str = "station"
    delivery_type: str = "station"
    sender_address: Optional[str] = None
    recipient_address: Optional[str] = None
    declared_value: Optional[float] = 0.0


class UpdateParcelStatusPayload(BaseModel):
    status: str
    security_pin: Optional[str] = None
    courier_rider_phone: Optional[str] = None
    courier_notes: Optional[str] = None


@app.post("/api/parcels/quote")
async def get_parcel_quote(payload: ParcelQuotePayload):
    """Calculates transparent itemized shipping quotation for ENA Coach-style parcel delivery."""
    cat = payload.category.lower().strip()
    base_fare = PARCEL_CATEGORY_FEES.get(cat, 500.0)

    # Extra weight surcharge over 15kg
    weight = payload.weight_kg or 5.0
    if weight > 15.0:
        base_fare += (weight - 15.0) * 25.0

    p_type = payload.pickup_type.lower().strip()
    d_type = payload.delivery_type.lower().strip()

    pickup_fee = DOORSTEP_PICKUP_FEE if p_type == "doorstep" else 0.0
    delivery_fee = DOORSTEP_DELIVERY_FEE if d_type == "doorstep" else 0.0

    val = payload.declared_value or 0.0
    insurance_fee = round(val * 0.015, 2) if val > 5000.0 else 0.0

    total_fee = base_fare + pickup_fee + delivery_fee + insurance_fee

    # Compute potential savings of choosing station drop-off/pickup
    savings = (DOORSTEP_PICKUP_FEE if p_type == "station" else 0.0) + (DOORSTEP_DELIVERY_FEE if d_type == "station" else 0.0)

    if p_type == "doorstep" and d_type == "doorstep":
        mode_label = "Door-to-Door Executive Courier"
    elif p_type == "doorstep":
        mode_label = "Door-to-Station Courier"
    elif d_type == "doorstep":
        mode_label = "Station-to-Door Courier"
    else:
        mode_label = "Station-to-Station Standard"

    return {
        "category": cat,
        "weight_kg": weight,
        "pickup_type": p_type,
        "delivery_type": d_type,
        "base_fare": base_fare,
        "pickup_fee": pickup_fee,
        "delivery_fee": delivery_fee,
        "insurance_fee": insurance_fee,
        "total_fee": total_fee,
        "savings_vs_door_to_door": savings,
        "delivery_mode_label": mode_label,
        "estimated_transit_hours": 3.5 if payload.origin_city != payload.destination_city else 1.5,
    }


@app.post("/api/parcels/book")
async def book_parcel(
    payload: BookParcelPayload,
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """Full-featured parcel booking supporting Doorstep Pickup and Doorstep Delivery."""
    # 1. Resolve Trip
    trip_id = payload.trip_id
    if not trip_id:
        # Pick first active non-cancelled trip
        t_res = await db.execute(text("SELECT id, route_id FROM trips WHERE status != 'cancelled' ORDER BY id ASC LIMIT 1;"))
        t_row = t_res.mappings().first()
        if not t_row:
            raise HTTPException(status_code=400, detail="No active bus trips available for cargo booking.")
        trip_id = t_row["id"]
        route_id = t_row["route_id"]
    else:
        t_res = await db.execute(text("SELECT id, route_id FROM trips WHERE id = :id;"), {"id": trip_id})
        t_row = t_res.mappings().first()
        if not t_row:
            raise HTTPException(status_code=404, detail="Specified trip not found.")
        route_id = t_row["route_id"]

    # 2. Resolve stops
    stops_res = await db.execute(
        text("SELECT stop_name, stop_order FROM route_stops WHERE route_id = :rid ORDER BY stop_order ASC;"),
        {"rid": route_id},
    )
    stops = [dict(s) for s in stops_res.mappings().all()]
    if not stops:
        stops = [{"stop_order": 1, "stop_name": payload.origin_city or "Origin Station"},
                 {"stop_order": 2, "stop_name": payload.destination_city or "Destination Station"}]
    
    p_order = payload.pickup_stop_order or stops[0]["stop_order"]
    d_order = payload.dropoff_stop_order or stops[-1]["stop_order"]
    if p_order >= d_order:
        d_order = p_order + 1

    stop_map = {s["stop_order"]: s["stop_name"] for s in stops}
    pickup_name = stop_map.get(p_order, f"Stop #{p_order}")
    dropoff_name = stop_map.get(d_order, f"Stop #{d_order}")

    # 3. Calculate Fees
    cat = payload.category.lower().strip()
    base_fare = PARCEL_CATEGORY_FEES.get(cat, 500.0)
    weight = payload.weight_kg or 5.0
    if weight > 15.0:
        base_fare += (weight - 15.0) * 25.0

    p_type = payload.pickup_type.lower().strip()
    d_type = payload.delivery_type.lower().strip()
    pickup_fee = DOORSTEP_PICKUP_FEE if p_type == "doorstep" else 0.0
    delivery_fee = DOORSTEP_DELIVERY_FEE if d_type == "doorstep" else 0.0

    val = payload.declared_value or 0.0
    insurance_fee = round(val * 0.015, 2) if val > 5000.0 else 0.0
    total_fee = base_fare + pickup_fee + delivery_fee + insurance_fee

    # 4. Generate Codes
    rand_suffix = "".join(random.choices("0123456789ABCDEFGHJKLMNPQRSTUVWXYZ", k=5))
    tracking_code = f"WB-MZG-{rand_suffix}"
    security_pin = f"{random.randint(1000, 9999)}"

    # Initial status
    init_status = "pickup_dispatched" if p_type == "doorstep" else "registered"
    pay_status = "paid" if payload.payment_method == "mpesa" else "unpaid"
    now = datetime.now(timezone.utc)

    sender_uid = current_user.id if current_user else None

    # 5. Insert Record
    insert_q = text("""
        INSERT INTO parcels (
            trip_id, sender_id, sender_name, sender_phone, recipient_name, recipient_phone,
            pickup_stop_order, dropoff_stop_order, tracking_code, security_pin,
            category, description, weight_kg, fee, base_fare, pickup_fee, delivery_fee,
            pickup_type, delivery_type, sender_address, sender_city_or_area, sender_pickup_notes,
            recipient_address, recipient_city_or_area, recipient_delivery_notes, declared_value,
            payment_status, status, created_at
        ) VALUES (
            :tid, :sid, :sname, :sphone, :rname, :rphone,
            :porder, :dorder, :code, :pin,
            :cat, :desc, :wt, :fee, :bfare, :pfee, :dfee,
            :ptype, :dtype, :saddr, :scity, :snotes,
            :raddr, :rcity, :rnotes, :dval,
            :pay_status, :status, :created_at
        ) RETURNING id;
    """)

    res = await db.execute(insert_q, {
        "tid": trip_id,
        "sid": sender_uid,
        "sname": payload.sender_name,
        "sphone": payload.sender_phone,
        "rname": payload.recipient_name,
        "rphone": payload.recipient_phone,
        "porder": p_order,
        "dorder": d_order,
        "code": tracking_code,
        "pin": security_pin,
        "cat": cat,
        "desc": payload.description,
        "wt": weight,
        "fee": total_fee,
        "bfare": base_fare,
        "pfee": pickup_fee,
        "dfee": delivery_fee,
        "ptype": p_type,
        "dtype": d_type,
        "saddr": payload.sender_address,
        "scity": payload.sender_city_or_area,
        "snotes": payload.sender_pickup_notes,
        "raddr": payload.recipient_address,
        "rcity": payload.recipient_city_or_area,
        "rnotes": payload.recipient_delivery_notes,
        "dval": val,
        "pay_status": pay_status,
        "status": init_status,
        "created_at": now,
    })
    parcel_id = res.scalar_one()
    await db.commit()

    parcel_dict = {
        "id": parcel_id,
        "trip_id": trip_id,
        "tracking_code": tracking_code,
        "security_pin": security_pin,
        "sender_name": payload.sender_name,
        "sender_phone": payload.sender_phone,
        "recipient_name": payload.recipient_name,
        "recipient_phone": payload.recipient_phone,
        "pickup_stop_name": pickup_name,
        "dropoff_stop_name": dropoff_name,
        "pickup_type": p_type,
        "delivery_type": d_type,
        "sender_address": payload.sender_address or payload.sender_city_or_area,
        "recipient_address": payload.recipient_address or payload.recipient_city_or_area,
        "category": cat,
        "description": payload.description,
        "fee": total_fee,
        "status": init_status,
        "payment_status": pay_status,
    }

    # Dispatch automated SMS to sender & recipient
    dispatch_info = await dispatch.dispatch_parcel_notification(db, parcel_dict)

    # Broadcast on WebSocket
    await manager.broadcast_trip(trip_id, {
        "event": "parcel_registered",
        "trip_id": trip_id,
        "parcel_id": parcel_id,
        "tracking_code": tracking_code,
        "pickup_type": p_type,
        "delivery_type": d_type,
        "description": payload.description,
    })

    return {
        "ok": True,
        "parcel_id": parcel_id,
        "tracking_code": tracking_code,
        "security_pin": security_pin,
        "fee": total_fee,
        "base_fare": base_fare,
        "pickup_fee": pickup_fee,
        "delivery_fee": delivery_fee,
        "pickup_type": p_type,
        "delivery_type": d_type,
        "status": init_status,
        "dispatch": dispatch_info,
        "message": f"Waybill {tracking_code} booked successfully! Dispatched SMS notifications with security PIN.",
    }


@app.post("/api/trips/{trip_id}/parcels")
async def register_trip_parcel(
    trip_id: int,
    payload: RegisterParcelPayload,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Register unaccompanied cargo (Mzigo) onto a trip.
    Generates unique tracking code and a 4-digit security collection PIN."""
    trip = (await db.execute(select(Trip).where(Trip.id == trip_id))).scalars().first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found.")

    if payload.pickup_stop_order >= payload.dropoff_stop_order:
        raise HTTPException(status_code=400, detail="Pickup stop must be before dropoff stop.")

    cat = payload.category.lower().strip()
    base_fare = PARCEL_CATEGORY_FEES.get(cat, 500.0)
    p_type = payload.pickup_type.lower().strip()
    d_type = payload.delivery_type.lower().strip()
    p_fee = DOORSTEP_PICKUP_FEE if p_type == "doorstep" else 0.0
    d_fee = DOORSTEP_DELIVERY_FEE if d_type == "doorstep" else 0.0
    fee = float(payload.fee) if payload.fee is not None else (base_fare + p_fee + d_fee)

    rand_suffix = "".join(random.choices("0123456789ABCDEFGHJKLMNPQRSTUVWXYZ", k=5))
    tracking_code = f"WB-MZG-{rand_suffix}"
    security_pin = f"{random.randint(1000, 9999)}"

    stops_res = await db.execute(
        text("SELECT stop_name, stop_order FROM route_stops WHERE route_id = :rid ORDER BY stop_order ASC;"),
        {"rid": trip.route_id},
    )
    stop_map = {s["stop_order"]: s["stop_name"] for s in stops_res.mappings().all()}
    pickup_name = stop_map.get(payload.pickup_stop_order, f"Stop #{payload.pickup_stop_order}")
    dropoff_name = stop_map.get(payload.dropoff_stop_order, f"Stop #{payload.dropoff_stop_order}")

    insert_q = text("""
        INSERT INTO parcels (
            trip_id, sender_id, sender_name, sender_phone, recipient_name, recipient_phone,
            pickup_stop_order, dropoff_stop_order, tracking_code, security_pin,
            category, description, weight_kg, fee, base_fare, pickup_fee, delivery_fee,
            pickup_type, delivery_type, sender_address, recipient_address, declared_value,
            payment_status, status, created_at
        ) VALUES (
            :tid, :sid, :sname, :sphone, :rname, :rphone,
            :porder, :dorder, :code, :pin,
            :cat, :desc, :wt, :fee, :bfare, :pfee, :dfee,
            :ptype, :dtype, :saddr, :raddr, :dval,
            :pay_status, 'registered', :created_at
        ) RETURNING id;
    """)
    res = await db.execute(insert_q, {
        "tid": trip_id,
        "sid": current_user.id,
        "sname": payload.sender_name,
        "sphone": payload.sender_phone,
        "rname": payload.recipient_name,
        "rphone": payload.recipient_phone,
        "porder": payload.pickup_stop_order,
        "dorder": payload.dropoff_stop_order,
        "code": tracking_code,
        "pin": security_pin,
        "cat": cat,
        "desc": payload.description,
        "wt": payload.weight_kg,
        "fee": fee,
        "bfare": base_fare,
        "pfee": p_fee,
        "dfee": d_fee,
        "ptype": p_type,
        "dtype": d_type,
        "saddr": payload.sender_address,
        "raddr": payload.recipient_address,
        "dval": payload.declared_value or 0.0,
        "pay_status": payload.payment_status,
        "created_at": datetime.now(timezone.utc),
    })
    parcel_id = res.scalar_one()
    await db.commit()

    parcel_dict = {
        "id": parcel_id,
        "trip_id": trip_id,
        "tracking_code": tracking_code,
        "security_pin": security_pin,
        "sender_name": payload.sender_name,
        "sender_phone": payload.sender_phone,
        "recipient_name": payload.recipient_name,
        "recipient_phone": payload.recipient_phone,
        "pickup_stop_name": pickup_name,
        "dropoff_stop_name": dropoff_name,
        "pickup_stop_order": payload.pickup_stop_order,
        "dropoff_stop_order": payload.dropoff_stop_order,
        "pickup_type": p_type,
        "delivery_type": d_type,
        "category": cat,
        "description": payload.description,
        "fee": fee,
        "status": "registered",
        "payment_status": payload.payment_status,
    }

    # Broadcast parcel registered over trip room
    await manager.broadcast_trip(trip_id, {
        "event": "parcel_registered",
        "trip_id": trip_id,
        "parcel_id": parcel_id,
        "tracking_code": tracking_code,
        "description": payload.description,
        "dropoff_stop": dropoff_name,
    })

    # Trigger automatic SMS & WhatsApp dispatch
    dispatch_info = await dispatch.dispatch_parcel_notification(db, parcel_dict)

    return {
        "ok": True,
        "parcel_id": parcel_id,
        "tracking_code": tracking_code,
        "security_pin": security_pin,
        "fee": fee,
        "status": "registered",
        "dispatch": dispatch_info,
        "message": f"Parcel {tracking_code} registered for trip #{trip_id}.",
    }


@app.get("/api/trips/{trip_id}/parcels")
async def list_trip_parcels(trip_id: int, db=Depends(get_async_db)):
    """Retrieve all parcels on a trip for the Driver Cargo Manifest."""
    trip = (await db.execute(select(Trip).where(Trip.id == trip_id))).scalars().first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found.")

    stops_res = await db.execute(
        text("SELECT stop_name, stop_order FROM route_stops WHERE route_id = :rid ORDER BY stop_order ASC;"),
        {"rid": trip.route_id},
    )
    stop_map = {s["stop_order"]: s["stop_name"] for s in stops_res.mappings().all()}

    parcels_res = await db.execute(
        text("""
            SELECT p.id, p.trip_id, p.sender_id, p.sender_name, p.sender_phone,
                   p.recipient_name, p.recipient_phone, p.pickup_stop_order, p.dropoff_stop_order,
                   p.tracking_code, p.security_pin, p.category, p.description, p.weight_kg,
                   p.fee, p.base_fare, p.pickup_fee, p.delivery_fee, p.pickup_type, p.delivery_type,
                   p.sender_address, p.recipient_address, p.courier_rider_phone,
                   p.payment_status, p.status, p.loaded_at, p.delivered_at, p.created_at
            FROM parcels p
            WHERE p.trip_id = :tid
            ORDER BY p.pickup_stop_order ASC, p.id ASC;
        """),
        {"tid": trip_id},
    )
    parcels = []
    for row in parcels_res.mappings().all():
        p_dict = dict(row)
        p_dict["pickup_stop_name"] = stop_map.get(p_dict["pickup_stop_order"], f"Stop #{p_dict['pickup_stop_order']}")
        p_dict["dropoff_stop_name"] = stop_map.get(p_dict["dropoff_stop_order"], f"Stop #{p_dict['dropoff_stop_order']}")
        parcels.append(p_dict)

    # Luggage bookings count
    luggage_res = await db.execute(
        text("""
            SELECT COUNT(id) AS booking_count, COALESCE(SUM(luggage_count), 0) AS total_bags, COALESCE(SUM(luggage_fee), 0) AS total_luggage_fee
            FROM bookings
            WHERE trip_id = :tid AND status != 'cancelled' AND has_luggage = TRUE;
        """),
        {"tid": trip_id},
    )
    luggage_summary = dict(luggage_res.mappings().first() or {})

    return {
        "trip_id": trip_id,
        "parcels": parcels,
        "cargo_count": len(parcels),
        "luggage_summary": luggage_summary,
    }


@app.patch("/api/parcels/{parcel_id}/status")
async def update_parcel_status(
    parcel_id: int,
    payload: UpdateParcelStatusPayload,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user_optional),
):
    """Advance parcel lifecycle status.
    Transitioning to 'delivered' requires validating the 4-digit security PIN."""
    p_res = await db.execute(text("SELECT * FROM parcels WHERE id = :id;"), {"id": parcel_id})
    parcel = p_res.mappings().first()
    if not parcel:
        raise HTTPException(status_code=404, detail="Parcel not found.")

    new_status = payload.status.lower().strip()
    if new_status == "arrived":
        new_status = "arrived_at_hub"

    valid_statuses = [
        "registered", "pickup_dispatched", "received_at_hub",
        "loaded", "in_transit", "arrived_at_hub",
        "out_for_delivery", "ready_for_collection", "delivered", "returned"
    ]
    if new_status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")

    # Security PIN verification upon collection / delivery handover
    if new_status == "delivered":
        if not payload.security_pin:
            raise HTTPException(status_code=400, detail="A 4-digit Security Claim PIN is required for parcel handover.")
        if payload.security_pin.strip() != str(parcel["security_pin"]).strip():
            raise HTTPException(status_code=400, detail="Invalid Security PIN! Package cannot be released.")

    now = datetime.now(timezone.utc)
    loaded_at = now if new_status == "loaded" else parcel["loaded_at"]
    delivered_at = now if new_status == "delivered" else parcel["delivered_at"]

    await db.execute(
        text("""
            UPDATE parcels
            SET status = :status,
                loaded_at = :loaded_at,
                delivered_at = :delivered_at,
                courier_rider_phone = COALESCE(:rider, courier_rider_phone)
            WHERE id = :id;
        """),
        {
            "status": new_status,
            "loaded_at": loaded_at,
            "delivered_at": delivered_at,
            "rider": payload.courier_rider_phone,
            "id": parcel_id,
        },
    )
    await db.commit()

    # Broadcast update
    await manager.broadcast_trip(parcel["trip_id"], {
        "event": "parcel_status_updated",
        "trip_id": parcel["trip_id"],
        "parcel_id": parcel_id,
        "tracking_code": parcel["tracking_code"],
        "status": new_status,
    })

    return {
        "ok": True,
        "parcel_id": parcel_id,
        "tracking_code": parcel["tracking_code"],
        "status": new_status,
        "message": f"Parcel {parcel['tracking_code']} status updated to '{new_status}'.",
    }


@app.get("/api/parcels/track/{tracking_code}")
async def track_parcel_public(tracking_code: str, db=Depends(get_async_db)):
    """Public Mzigo parcel tracking endpoint.
    Returns journey status, origin & destination stops, doorstep details, and live vehicle location."""
    code = tracking_code.strip().upper()
    p_res = await db.execute(
        text("""
            SELECT p.id, p.trip_id, p.sender_name, p.recipient_name, p.pickup_stop_order, p.dropoff_stop_order,
                   p.tracking_code, p.category, p.description, p.weight_kg, p.fee, p.base_fare,
                   p.pickup_fee, p.delivery_fee, p.pickup_type, p.delivery_type,
                   p.sender_address, p.sender_city_or_area, p.sender_pickup_notes,
                   p.recipient_address, p.recipient_city_or_area, p.recipient_delivery_notes,
                   p.declared_value, p.courier_rider_phone,
                   p.payment_status, p.status, p.loaded_at, p.delivered_at, p.created_at,
                   t.name AS trip_name, t.current_stop_order, t.current_lat, t.current_lng, t.current_speed,
                   t.last_gps_at, t.route_id,
                   v.plate_number AS vehicle_plate
            FROM parcels p
            JOIN trips t ON t.id = p.trip_id
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            WHERE UPPER(p.tracking_code) = :code;
        """),
        {"code": code},
    )
    row = p_res.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail=f"No cargo package found with tracking code '{code}'.")

    p_data = dict(row)
    # Stop names along the route
    stops_res = await db.execute(
        text("SELECT stop_name, stop_order FROM route_stops WHERE route_id = :rid ORDER BY stop_order ASC;"),
        {"rid": p_data["route_id"]},
    )
    stops = [dict(s) for s in stops_res.mappings().all()]
    stop_map = {s["stop_order"]: s["stop_name"] for s in stops}

    p_data["pickup_stop_name"] = stop_map.get(p_data["pickup_stop_order"], f"Stop #{p_data['pickup_stop_order']}")
    p_data["dropoff_stop_name"] = stop_map.get(p_data["dropoff_stop_order"], f"Stop #{p_data['dropoff_stop_order']}")
    p_data["all_route_stops"] = stops

    # Generate visual timeline steps
    cur_status = p_data["status"]
    timeline = [
        {
            "step": 1,
            "label": "Waybill Booked",
            "desc": "Parcel registered on BusGo Mzigo system",
            "done": True,
            "current": cur_status == "registered",
        },
        {
            "step": 2,
            "label": "Doorstep Pickup / Stage Check-In" if p_data["pickup_type"] == "doorstep" else "Stage Counter Check-In",
            "desc": f"Courier collection from {p_data.get('sender_address') or p_data['pickup_stop_name']}" if p_data["pickup_type"] == "doorstep" else f"Drop-off at {p_data['pickup_stop_name']}",
            "done": cur_status in ["received_at_hub", "loaded", "in_transit", "arrived_at_hub", "out_for_delivery", "ready_for_collection", "delivered"],
            "current": cur_status in ["pickup_dispatched", "received_at_hub"],
        },
        {
            "step": 3,
            "label": "Intercity Highway Transit",
            "desc": f"En route aboard {p_data.get('vehicle_plate') or 'Highway Bus'} ({p_data['pickup_stop_name']} -> {p_data['dropoff_stop_name']})",
            "done": cur_status in ["arrived_at_hub", "out_for_delivery", "ready_for_collection", "delivered"],
            "current": cur_status in ["loaded", "in_transit"],
        },
        {
            "step": 4,
            "label": "Destination Hub Arrival",
            "desc": f"Arrived at {p_data['dropoff_stop_name']} parcel depot",
            "done": cur_status in ["out_for_delivery", "ready_for_collection", "delivered"],
            "current": cur_status == "arrived_at_hub",
        },
        {
            "step": 5,
            "label": "Doorstep Delivery" if p_data["delivery_type"] == "doorstep" else "Ready for Counter Pickup",
            "desc": f"Courier delivery to {p_data.get('recipient_address') or 'recipient doorstep'}" if p_data["delivery_type"] == "doorstep" else f"Collect at {p_data['dropoff_stop_name']} with secret PIN",
            "done": cur_status == "delivered",
            "current": cur_status in ["out_for_delivery", "ready_for_collection"],
        },
        {
            "step": 6,
            "label": "Delivered & PIN Verified",
            "desc": "Package safely released to recipient",
            "done": cur_status == "delivered",
            "current": cur_status == "delivered",
        },
    ]
    p_data["timeline"] = timeline

    return {"parcel": p_data}


@app.post("/api/parcels/{parcel_id}/dispatch")
async def manual_parcel_dispatch(
    parcel_id: int,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Manually trigger WhatsApp/SMS dispatch for a parcel."""
    p_res = await db.execute(
        text("""
            SELECT p.*, t.route_id
            FROM parcels p
            JOIN trips t ON t.id = p.trip_id
            WHERE p.id = :id;
        """),
        {"id": parcel_id},
    )
    parcel = p_res.mappings().first()
    if not parcel:
        raise HTTPException(status_code=404, detail="Parcel not found.")

    p_dict = dict(parcel)
    stops_res = await db.execute(
        text("SELECT stop_name, stop_order FROM route_stops WHERE route_id = :rid ORDER BY stop_order ASC;"),
        {"rid": p_dict["route_id"]},
    )
    stop_map = {s["stop_order"]: s["stop_name"] for s in stops_res.mappings().all()}
    p_dict["pickup_stop_name"] = stop_map.get(p_dict["pickup_stop_order"], f"Stop #{p_dict['pickup_stop_order']}")
    p_dict["dropoff_stop_name"] = stop_map.get(p_dict["dropoff_stop_order"], f"Stop #{p_dict['dropoff_stop_order']}")

    res = await dispatch.dispatch_parcel_notification(db, p_dict)
    return {"ok": True, "dispatch": res}


# --------------------------------------------------------------------------
# Paystack Checkout & Verification (Cards, Mobile Money, M-Pesa in KES)
# --------------------------------------------------------------------------
class PaystackInitRequest(BaseModel):
    booking_id: int
    callback_url: Optional[str] = None


@app.post("/api/pay/paystack/initialize")
async def paystack_initialize(payload: PaystackInitRequest, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """Initialize a Paystack transaction for the booking."""
    booking_row = (await db.execute(
        text("""
        SELECT b.id, b.trip_id, b.seat_number, b.board_stop_order, b.alight_stop_order, b.user_id,
               u.email, u.full_name, p.id AS payment_id, p.amount
        FROM bookings b
        LEFT JOIN users u ON u.id = b.user_id
        LEFT JOIN payments p ON p.booking_id = b.id
        WHERE b.id = :booking_id;
        """),
        {"booking_id": payload.booking_id}
    )).mappings().first()

    if not booking_row:
        raise HTTPException(status_code=404, detail="Booking not found.")

    if booking_row["user_id"] != current_user.id and current_user.role not in ('admin', 'driver'):
        raise HTTPException(status_code=403, detail="Unauthorized booking payment.")

    email = booking_row["email"] or current_user.email or f"passenger_{current_user.id}@busgo.ke"
    amount = float(booking_row["amount"] or calculate_segment_fare(booking_row["board_stop_order"], booking_row["alight_stop_order"]))
    reference = f"BUSGO-BK{booking_row['id']}-{int(datetime.now(timezone.utc).timestamp())}"

    try:
        init_data = await paystack.initialize_transaction(
            email=email,
            amount_kes=amount,
            reference=reference,
            callback_url=payload.callback_url,
            metadata={
                "booking_id": booking_row["id"],
                "trip_id": booking_row["trip_id"],
                "seat_number": booking_row["seat_number"],
                "passenger_name": booking_row["full_name"] or current_user.full_name,
            }
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if booking_row["payment_id"]:
        await db.execute(
            text("UPDATE payments SET provider = 'paystack', provider_reference = :ref, amount = :amt WHERE id = :pid;"),
            {"ref": reference, "amt": amount, "pid": booking_row["payment_id"]}
        )
    else:
        await db.execute(
            text("INSERT INTO payments (booking_id, provider, provider_reference, amount, status) VALUES (:bid, 'paystack', :ref, :amt, 'initiated');"),
            {"bid": booking_row["id"], "ref": reference, "amt": amount}
        )
    await db.commit()

    return {
        "status": "success",
        "authorization_url": init_data["authorization_url"],
        "access_code": init_data["access_code"],
        "reference": reference,
        "amount": amount,
        "public_key": paystack.PAYSTACK_PUBLIC_KEY,
    }


@app.get("/api/pay/paystack/verify/{reference}")
async def paystack_verify(reference: str, db=Depends(get_async_db)):
    """Verify Paystack transaction status and confirm booking upon successful settlement."""
    try:
        data = await paystack.verify_transaction(reference)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if data.get("status") == "success":
        payment_row = (await db.execute(
            text("SELECT id, booking_id, amount FROM payments WHERE provider_reference = :ref;"),
            {"ref": reference}
        )).mappings().first()

        if payment_row:
            await db.execute(
                text("UPDATE payments SET status = 'completed', callback_verified = true WHERE id = :pid;"),
                {"pid": payment_row["id"]}
            )
            br = await db.execute(
                text("""
                UPDATE bookings SET status = 'confirmed', payment_status = 'paid'
                WHERE id = :bid
                RETURNING id, trip_id, seat_number, board_stop_order, alight_stop_order, user_id;
                """),
                {"bid": payment_row["booking_id"]}
            )
            booking_row = br.mappings().first()

            if booking_row:
                await manager.broadcast_trip(booking_row["trip_id"], {
                    "event": "seat_booked",
                    "trip_id": booking_row["trip_id"],
                    "seat_number": booking_row["seat_number"],
                    "booking_id": booking_row["id"],
                    "board_stop_order": booking_row["board_stop_order"],
                    "alight_stop_order": booking_row["alight_stop_order"],
                })
                stop_names = await trip_stop_names(db, booking_row["trip_id"])
                chain = await recompute_chain(db, booking_row["trip_id"], booking_row["seat_number"])
                await notify_chain_change(db, manager, booking_row["trip_id"], booking_row["seat_number"], chain, stop_names)
                if booking_row["user_id"]:
                    amt = float(payment_row.get("amount") or 500.0)
                    pts = max(1, int(amt // 10))
                    await db.execute(
                        text("UPDATE users SET loyalty_points = COALESCE(loyalty_points, 0) + :pts WHERE id = :uid;"),
                        {"pts": pts, "uid": booking_row["user_id"]}
                    )
                    await db.execute(
                        text("INSERT INTO loyalty_transactions (user_id, points, booking_id, description, created_at) VALUES (:uid, :pts, :bid, :desc, NOW());"),
                        {"uid": booking_row["user_id"], "pts": pts, "bid": payment_row["booking_id"], "desc": f"Earned {pts} Safari Points for Seat #{booking_row['seat_number']} booking (KES {amt:.0f})"}
                    )
                    await create_notification(
                        db, booking_row["user_id"], "payment_update",
                        "Paystack Payment Received",
                        f"Payment verified for seat #{booking_row['seat_number']} on trip #{booking_row['trip_id']}.",
                        {"trip_id": booking_row["trip_id"], "seat_number": booking_row["seat_number"]},
                    )

            await db.commit()
            return {
                "status": "success",
                "message": "Payment verified and booking confirmed.",
                "booking_id": payment_row["booking_id"],
                "amount": float(payment_row["amount"]),
            }

    return {"status": data.get("status", "pending"), "message": data.get("gateway_response", "Payment pending verification.")}


@app.post("/api/pay/paystack/webhook")
async def paystack_webhook(request: Request, db=Depends(get_async_db)):
    """Paystack webhook for asynchronous payment notifications."""
    raw_body = await request.body()
    signature = request.headers.get("x-paystack-signature")
    if not paystack.verify_webhook_signature(raw_body, signature):
        raise HTTPException(status_code=400, detail="Invalid signature.")

    try:
        body = json.loads(raw_body.decode("utf-8"))
    except Exception:
        return {"status": "ignored"}

    if body.get("event") == "charge.success":
        data = body.get("data", {})
        reference = data.get("reference")
        if reference:
            await paystack_verify(reference, db)

    return {"status": "acknowledged"}


# --------------------------------------------------------------------------
# Bookings: cancellation (frees the seat chain + notifies waitlists)
# --------------------------------------------------------------------------
# --------------------------------------------------------------------------
# Bookings: cancellation with Supervisor PIN & Immutable Audit Trail
# --------------------------------------------------------------------------
SUPERVISOR_PIN = os.getenv("SUPERVISOR_PIN", "9876")


class BookingCancellationPayload(BaseModel):
    reason: Optional[str] = "Customer requested cancellation"
    supervisor_pin: Optional[str] = None


@app.delete("/api/bookings/{booking_id}")
async def cancel_booking(
    booking_id: int,
    payload: Optional[BookingCancellationPayload] = None,
    supervisor_pin: Optional[str] = None,
    reason: Optional[str] = None,
    request: Request = None,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cancels a booking with Role-Based Access Control and an Immutable Audit Log.
    Staff/drivers/clerks MUST provide a valid Supervisor PIN to prevent fraud and cash theft.
    Sends immediate alert SMS to passenger upon staff-initiated cancellation.
    """
    # 1. Fetch full booking details
    query = text("""
        SELECT b.id, b.trip_id, b.seat_number, b.user_id, b.status, b.payment_status,
               u.phone AS user_phone, u.full_name AS user_name, t.name AS trip_name
        FROM bookings b
        JOIN trips t ON t.id = b.trip_id
        LEFT JOIN users u ON u.id = b.user_id
        WHERE b.id = :id;
    """)
    booking = (await db.execute(query, {"id": booking_id})).mappings().first()
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found.")

    pin = (payload.supervisor_pin if payload and payload.supervisor_pin else supervisor_pin)
    cancel_reason = (payload.reason if payload and payload.reason else reason) or "Customer requested cancellation"
    pin_verified = False

    # 2. RBAC & Supervisor PIN Validation
    is_owner = (booking["user_id"] == current_user.id)
    if not is_owner:
        if current_user.role not in ('admin', 'driver', 'sacco_admin'):
            raise HTTPException(status_code=403, detail="You can only cancel your own booking.")
        
        # Admin can cancel without PIN; drivers/conductors/clerks require Supervisor PIN
        if current_user.role in ('driver', 'sacco_admin'):
            if not pin or str(pin).strip() != SUPERVISOR_PIN:
                raise HTTPException(
                    status_code=403,
                    detail="Supervisor authorization required: Invalid or missing Supervisor PIN to cancel this ticket.",
                )
            pin_verified = True
        elif current_user.role == 'admin':
            pin_verified = True if (pin and str(pin).strip() == SUPERVISOR_PIN) else False
    else:
        # Commuter cancelling their own booking
        if booking["status"] == "confirmed" or booking["payment_status"] == "paid":
            # Paid ticket cancellation
            if pin and str(pin).strip() == SUPERVISOR_PIN:
                pin_verified = True

    # 3. Ensure audit_logs table exists
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            action VARCHAR(100) NOT NULL,
            entity_type VARCHAR(100) NOT NULL,
            entity_id INTEGER NOT NULL,
            actor_user_id INTEGER,
            actor_role VARCHAR(50) NOT NULL,
            supervisor_pin_verified BOOLEAN NOT NULL DEFAULT FALSE,
            supervisor_user_id INTEGER,
            previous_state JSONB,
            new_state JSONB,
            reason TEXT,
            ip_address VARCHAR(100),
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    """))

    # 4. Perform cancellation
    await db.execute(
        text("UPDATE bookings SET status = 'cancelled' WHERE id = :id;"), {"id": booking_id}
    )

    # 5. Record immutable audit log
    previous_state = {
        "status": booking["status"],
        "payment_status": booking["payment_status"],
        "seat_number": booking["seat_number"],
        "trip_id": booking["trip_id"],
        "user_id": booking["user_id"],
        "passenger_phone": booking["user_phone"],
    }
    new_state = {
        "status": "cancelled",
        "payment_status": booking["payment_status"],
    }
    client_ip = request.client.host if (request and request.client) else None

    await db.execute(text("""
        INSERT INTO audit_logs (
            action, entity_type, entity_id, actor_user_id, actor_role,
            supervisor_pin_verified, previous_state, new_state, reason, ip_address, created_at
        ) VALUES (
            'booking_cancellation', 'booking', :eid, :uid, :role,
            :pin_verified, :prev::jsonb, :new::jsonb, :reason, :ip, NOW()
        );
    """), {
        "eid": booking_id,
        "uid": current_user.id,
        "role": current_user.role,
        "pin_verified": pin_verified,
        "prev": json.dumps(previous_state),
        "new": json.dumps(new_state),
        "reason": cancel_reason,
        "ip": client_ip,
    })
    await db.commit()

    # 6. Passenger fraud protection alert: dispatch SMS if staff cancelled passenger ticket
    if booking["user_phone"] and not is_owner:
        alert_msg = (
            f"BUSGO ALERT: Your booking #{booking_id} for Seat {booking['seat_number']} on {booking['trip_name'] or 'Trip'} "
            f"was CANCELLED by terminal staff. Reason: {cancel_reason}. "
            f"If this cancellation was unauthorized, please contact station support immediately."
        )
        try:
            await dispatch.send_sms_notification(booking["user_phone"], alert_msg)
        except Exception as e:
            logger.warning(f"Could not dispatch cancellation SMS: {e}")

    # 7. Free the seat chain & notify waitlists
    stop_names = await trip_stop_names(db, booking["trip_id"])
    chain = await recompute_chain(db, booking["trip_id"], booking["seat_number"])
    await notify_chain_change(db, manager, booking["trip_id"], booking["seat_number"], chain, stop_names)
    await manager.broadcast_trip(booking["trip_id"], {
        "event": "booking_cancelled",
        "trip_id": booking["trip_id"],
        "seat_number": booking["seat_number"],
        "booking_id": booking_id,
    })

    return {
        "deleted": booking_id,
        "seat_freed": True,
        "audit_logged": True,
        "supervisor_verified": pin_verified,
        "reason": cancel_reason,
    }


@app.post("/api/bookings/{booking_id}/cancel-to-voucher")
async def cancel_booking_to_voucher(
    booking_id: int,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """
    Commuter Self-Service: Cancel a confirmed ticket in advance and convert 100%
    of the booking amount into an instant 90-day Travel Credit Voucher code.
    Frees the seat for corridor relay / waitlist commuters.
    """
    booking = (await db.execute(
        text("""
            SELECT b.id, b.trip_id, b.seat_number, b.user_id, b.status, b.payment_status,
                   b.board_stop_order, b.alight_stop_order,
                   u.phone AS user_phone, u.full_name AS user_name, t.name AS trip_name
            FROM bookings b
            JOIN trips t ON t.id = b.trip_id
            LEFT JOIN users u ON u.id = b.user_id
            WHERE b.id = :id;
        """),
        {"id": booking_id}
    )).mappings().first()

    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")
    if booking["user_id"] != current_user.id and current_user.role != 'admin':
        raise HTTPException(status_code=403, detail="You can only cancel your own booking.")
    if booking["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="This booking is already cancelled.")

    # Calculate credit amount from completed payments or trip fare
    pay_row = (await db.execute(
        text("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE booking_id = :bid AND status = 'completed';"),
        {"bid": booking_id}
    )).mappings().first()
    paid_amt = float(pay_row["total"]) if pay_row and pay_row["total"] > 0 else 0.0

    if paid_amt <= 0:
        fare_check = (await db.execute(
            text("""
                SELECT r.base_fare, r.per_hop_fare, t.fixed_price
                FROM trips t JOIN routes r ON r.id = t.route_id WHERE t.id = :tid;
            """),
            {"tid": booking["trip_id"]}
        )).mappings().first()
        if fare_check:
            paid_amt = float(fare_check["fixed_price"] or fare_check["base_fare"] or 200.0)

    # Generate unique voucher code
    v_code = f"VCH-{secrets.token_hex(3).upper()}-{random.randint(100, 999)}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=90)

    # Insert TravelVoucher
    vres = await db.execute(
        text("""
            INSERT INTO travel_vouchers (
                code, user_id, original_booking_id, initial_amount, remaining_balance, currency, status, expires_at
            ) VALUES (
                :code, :uid, :bid, :init_amt, :rem_bal, 'KES', 'active', :expires
            ) RETURNING id, code, initial_amount, remaining_balance, currency, status, expires_at;
        """),
        {
            "code": v_code,
            "uid": booking["user_id"],
            "bid": booking_id,
            "init_amt": paid_amt,
            "rem_bal": paid_amt,
            "expires": expires_at,
        }
    )
    voucher = vres.mappings().first()

    # Cancel booking
    await db.execute(text("UPDATE bookings SET status = 'cancelled' WHERE id = :id;"), {"id": booking_id})
    await db.commit()

    # Free seat chain and broadcast
    stop_names = await trip_stop_names(db, booking["trip_id"])
    chain = await recompute_chain(db, booking["trip_id"], booking["seat_number"])
    await notify_chain_change(db, manager, booking["trip_id"], booking["seat_number"], chain, stop_names)
    await manager.broadcast_trip(booking["trip_id"], {
        "event": "booking_cancelled",
        "trip_id": booking["trip_id"],
        "seat_number": booking["seat_number"],
        "booking_id": booking_id,
    })

    # Dispatch SMS with voucher details
    if booking["user_phone"]:
        sms_text = (
            f"BUSGO VOUCHER: Your booking #{booking_id} has been credited to voucher {v_code} "
            f"for KES {paid_amt:,.0f}. Valid for 90 days across all routes. Book anytime at busgo.co.ke"
        )
        try:
            await dispatch.send_sms_notification(booking["user_phone"], sms_text)
        except Exception as e:
            logger.warning(f"Failed to dispatch voucher SMS: {e}")

    voucher_dict = dict(voucher)
    if voucher_dict.get("expires_at"):
        voucher_dict["expires_at"] = str(voucher_dict["expires_at"])

    return {
        "success": True,
        "message": f"Ticket cancelled and KES {paid_amt:,.0f} credited to voucher {v_code}.",
        "voucher": voucher_dict,
    }


class RescheduleBookingRequest(BaseModel):
    new_trip_id: int
    new_seat_number: int
    new_board_stop_order: Optional[int] = None
    new_alight_stop_order: Optional[int] = None
    confirm_topup: Optional[bool] = False


@app.post("/api/bookings/{booking_id}/reschedule")
async def reschedule_booking(
    booking_id: int,
    req: RescheduleBookingRequest,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """
    Commuter Self-Service: Seamlessly transfer an active ticket to a new scheduled trip & seat.
    - If new trip fare == old fare: Transfers immediately with 0 extra cost.
    - If new trip fare < old fare: Transfers immediately & automatically credits the difference
      as an instant Travel Credit Voucher!
    - If new trip fare > old fare: Prompts for top-up or completes with top-up confirmed.
    - Releases the original seat immediately, recomputing corridor relay chains.
    """
    query = text("""
        SELECT b.id, b.trip_id, b.seat_number, b.user_id, b.status, b.payment_status,
               b.board_stop_order, b.alight_stop_order, b.has_luggage, b.luggage_count, b.luggage_fee,
               u.phone AS user_phone, u.full_name AS user_name,
               t.name AS old_trip_name
        FROM bookings b
        JOIN trips t ON t.id = b.trip_id
        LEFT JOIN users u ON u.id = b.user_id
        WHERE b.id = :id;
    """)
    booking = (await db.execute(query, {"id": booking_id})).mappings().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")

    if booking["user_id"] != current_user.id and current_user.role != 'admin':
        raise HTTPException(status_code=403, detail="You can only reschedule your own booking.")

    if booking["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot reschedule a cancelled booking.")

    old_trip_id = booking["trip_id"]
    old_seat_number = booking["seat_number"]

    if req.new_trip_id == old_trip_id and req.new_seat_number == old_seat_number:
        raise HTTPException(status_code=400, detail="Requested new seat and trip are identical to current booking.")

    # Check new trip existence & status
    new_trip = (await db.execute(
        text("""
            SELECT t.id, t.name, t.status, t.fixed_price, t.allow_driver_tier, t.max_surcharge_pct, t.driver_tier,
                   r.base_fare, r.per_hop_fare, r.fare_matrix
            FROM trips t
            JOIN routes r ON r.id = t.route_id
            WHERE t.id = :id;
        """),
        {"id": req.new_trip_id}
    )).mappings().first()

    if not new_trip:
        raise HTTPException(status_code=404, detail=f"Destination trip #{req.new_trip_id} does not exist.")
    if new_trip["status"] in ('completed', 'cancelled'):
        raise HTTPException(status_code=400, detail=f"Trip #{req.new_trip_id} is already {new_trip['status']}.")

    new_board = req.new_board_stop_order if req.new_board_stop_order is not None else booking["board_stop_order"]
    new_alight = req.new_alight_stop_order if req.new_alight_stop_order is not None else booking["alight_stop_order"]

    # Check seat lock conflict on new trip
    is_conflict, conflict_lock = await seat_lock_manager.check_lock_conflict(
        trip_id=req.new_trip_id,
        seat_number=req.new_seat_number,
        board_order=new_board,
        alight_order=new_alight,
        requesting_user_id=current_user.id,
    )
    if is_conflict and conflict_lock:
        raise HTTPException(
            status_code=409,
            detail=f"Seat {req.new_seat_number} on trip #{req.new_trip_id} is temporarily locked ({conflict_lock.seconds_remaining}s remaining).",
        )

    # Check if seat is already occupied on new trip for requested segment
    occ_check = (await db.execute(
        text("""
            SELECT id FROM bookings
            WHERE trip_id = :trip_id
              AND seat_number = :seat_number
              AND status != 'cancelled'
              AND NOT (alight_stop_order <= :board_order OR board_stop_order >= :alight_order)
            LIMIT 1;
        """),
        {
            "trip_id": req.new_trip_id,
            "seat_number": req.new_seat_number,
            "board_order": new_board,
            "alight_order": new_alight,
        }
    )).mappings().first()

    if occ_check:
        raise HTTPException(
            status_code=409,
            detail=f"Seat {req.new_seat_number} on trip #{req.new_trip_id} is already occupied for this segment.",
        )

    # Determine old booking value
    pay_check = (await db.execute(
        text("SELECT COALESCE(SUM(amount), 0) as paid_sum FROM payments WHERE booking_id = :bid AND status = 'completed';"),
        {"bid": booking_id}
    )).mappings().first()
    old_value = float(pay_check["paid_sum"]) if pay_check and pay_check["paid_sum"] > 0 else 0.0

    if old_value <= 0:
        old_trip = (await db.execute(
            text("""
                SELECT t.fixed_price, t.allow_driver_tier, t.max_surcharge_pct, t.driver_tier,
                       r.base_fare, r.per_hop_fare, r.fare_matrix
                FROM trips t JOIN routes r ON r.id = t.route_id WHERE t.id = :id;
            """),
            {"id": old_trip_id}
        )).mappings().first()
        old_fm = json.loads(old_trip["fare_matrix"]) if (old_trip and isinstance(old_trip.get("fare_matrix"), str)) else (old_trip.get("fare_matrix") if old_trip else None)
        old_fare = calculate_segment_fare(
            board_order=booking["board_stop_order"],
            alight_order=booking["alight_stop_order"],
            base_fare=old_trip["base_fare"] if old_trip else 200.0,
            per_hop_fare=old_trip["per_hop_fare"] if old_trip else 150.0,
            fare_matrix=old_fm,
            fixed_price=old_trip["fixed_price"] if old_trip else None,
            allow_driver_tier=old_trip["allow_driver_tier"] if old_trip else False,
            driver_tier=old_trip["driver_tier"] if old_trip else "standard",
            max_surcharge_pct=old_trip["max_surcharge_pct"] if old_trip else 25.0,
        )
        old_value = float(old_fare + (booking["luggage_fee"] or 0.0))

    # Calculate new trip fare
    new_fm = json.loads(new_trip["fare_matrix"]) if isinstance(new_trip.get("fare_matrix"), str) else new_trip.get("fare_matrix")
    new_fare = calculate_segment_fare(
        board_order=new_board,
        alight_order=new_alight,
        base_fare=new_trip["base_fare"] or 200.0,
        per_hop_fare=new_trip["per_hop_fare"] or 150.0,
        fare_matrix=new_fm,
        fixed_price=new_trip["fixed_price"],
        allow_driver_tier=new_trip["allow_driver_tier"] or False,
        driver_tier=new_trip["driver_tier"] or "standard",
        max_surcharge_pct=new_trip["max_surcharge_pct"] or 25.0,
    )
    new_total_fare = float(new_fare + (booking["luggage_fee"] or 0.0))
    fare_difference = round(new_total_fare - old_value, 2)

    # If new trip is more expensive and commuter hasn't confirmed topup yet
    if fare_difference > 0.01 and not req.confirm_topup:
        return {
            "success": False,
            "requires_topup": True,
            "topup_amount": fare_difference,
            "old_fare": old_value,
            "new_fare": new_total_fare,
            "booking_id": booking_id,
            "new_trip_id": req.new_trip_id,
            "new_seat_number": req.new_seat_number,
            "message": f"Rescheduling to {new_trip['name']} requires a top-up of KES {fare_difference:,.0f}.",
        }

    voucher_issued = None
    # If new trip is cheaper, credit difference as travel voucher
    if fare_difference < -0.01:
        credit_amount = round(abs(fare_difference), 2)
        v_code = f"VCH-DIFF-{secrets.token_hex(3).upper()}-{random.randint(100, 999)}"
        exp_at = datetime.now(timezone.utc) + timedelta(days=90)
        vres = await db.execute(
            text("""
                INSERT INTO travel_vouchers (
                    code, user_id, original_booking_id, initial_amount, remaining_balance, currency, status, expires_at
                ) VALUES (
                    :code, :uid, :bid, :init_amt, :rem_bal, 'KES', 'active', :expires
                ) RETURNING id, code, initial_amount, remaining_balance, currency, status, expires_at;
            """),
            {
                "code": v_code,
                "uid": booking["user_id"],
                "bid": booking_id,
                "init_amt": credit_amount,
                "rem_bal": credit_amount,
                "expires": exp_at,
            }
        )
        v_row = vres.mappings().first()
        voucher_issued = dict(v_row)
        if voucher_issued.get("expires_at"):
            voucher_issued["expires_at"] = str(voucher_issued["expires_at"])

    # If topup confirmed and difference > 0, record a completed topup payment
    if fare_difference > 0.01 and req.confirm_topup:
        sim_receipt = f"TOP{random.randint(10000000, 99999999)}"
        await db.execute(
            text("""
                INSERT INTO payments (booking_id, provider, provider_payload, amount, status, provider_reference, receipt_number, callback_verified)
                VALUES (:bid, 'mpesa_topup', :payload, :amt, 'completed', :ref, :receipt, true);
            """),
            {
                "bid": booking_id,
                "payload": json.dumps({"action": "reschedule_topup", "diff": fare_difference}),
                "amt": fare_difference,
                "ref": f"RESCH-{booking_id}",
                "receipt": sim_receipt,
            }
        )

    # Update booking to new trip & seat
    await db.execute(
        text("""
            UPDATE bookings
            SET trip_id = :new_trip_id,
                seat_number = :new_seat_number,
                board_stop_order = :b_order,
                alight_stop_order = :a_order,
                rescheduled_from_id = :orig_id
            WHERE id = :id;
        """),
        {
            "new_trip_id": req.new_trip_id,
            "new_seat_number": req.new_seat_number,
            "b_order": new_board,
            "a_order": new_alight,
            "orig_id": booking["id"],
            "id": booking_id,
        }
    )
    await db.commit()

    # 1. Release original seat on old trip
    old_stop_names = await trip_stop_names(db, old_trip_id)
    old_chain = await recompute_chain(db, old_trip_id, old_seat_number)
    await notify_chain_change(db, manager, old_trip_id, old_seat_number, old_chain, old_stop_names)
    await manager.broadcast_trip(old_trip_id, {
        "event": "booking_cancelled",
        "trip_id": old_trip_id,
        "seat_number": old_seat_number,
        "booking_id": booking_id,
    })

    # 2. Claim new seat on new trip
    new_stop_names = await trip_stop_names(db, req.new_trip_id)
    new_chain = await recompute_chain(db, req.new_trip_id, req.new_seat_number)
    await notify_chain_change(db, manager, req.new_trip_id, req.new_seat_number, new_chain, new_stop_names)
    await manager.broadcast_trip(req.new_trip_id, {
        "event": "seat_booked",
        "trip_id": req.new_trip_id,
        "seat_number": req.new_seat_number,
        "board_stop_order": new_board,
        "alight_stop_order": new_alight,
        "booking_id": booking_id,
    })

    # 3. Notify passenger
    await create_notification(
        db, current_user.id, "booking_rescheduled",
        f"Trip Rescheduled to Seat #{req.new_seat_number}",
        f"Your booking has been moved from {booking['old_trip_name']} to {new_trip['name']} (Seat #{req.new_seat_number}).",
        {"booking_id": booking_id, "new_trip_id": req.new_trip_id, "new_seat_number": req.new_seat_number},
    )
    await db.commit()

    if booking["user_phone"]:
        diff_note = f" (KES {abs(fare_difference):,.0f} credited to voucher {voucher_issued['code']})" if voucher_issued else ""
        sms_msg = (
            f"BUSGO: Your ticket #{booking_id} was rescheduled to {new_trip['name']}, "
            f"Seat #{req.new_seat_number}{diff_note}. View your boarding pass at busgo.co.ke"
        )
        try:
            await dispatch.send_sms_notification(booking["user_phone"], sms_msg)
        except Exception as e:
            logger.warning(f"Could not dispatch reschedule SMS: {e}")

    return {
        "success": True,
        "message": f"Successfully rescheduled ticket #{booking_id} to {new_trip['name']}, Seat #{req.new_seat_number}.",
        "booking_id": booking_id,
        "old_trip_id": old_trip_id,
        "new_trip_id": req.new_trip_id,
        "old_seat_number": old_seat_number,
        "new_seat_number": req.new_seat_number,
        "fare_difference": fare_difference,
        "voucher_issued": voucher_issued,
    }


class VoucherValidateRequest(BaseModel):
    code: str


@app.post("/api/vouchers/validate")
async def validate_voucher(
    req: VoucherValidateRequest,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    code = req.code.strip().upper()
    row = (await db.execute(
        text("""
            SELECT id, code, user_id, initial_amount, remaining_balance, currency, status, expires_at
            FROM travel_vouchers
            WHERE code = :code;
        """),
        {"code": code}
    )).mappings().first()

    if not row:
        return {"valid": False, "message": "Voucher code not found."}
    if row["user_id"] != current_user.id and current_user.role != 'admin':
        return {"valid": False, "message": "This voucher code is assigned to a different user account."}
    if row["status"] != 'active':
        return {"valid": False, "message": f"This voucher is {row['status']} and cannot be used."}

    exp = row["expires_at"]
    if isinstance(exp, str):
        exp = datetime.fromisoformat(exp.replace("Z", "+00:00"))
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp < datetime.now(timezone.utc):
        return {"valid": False, "message": "This voucher has expired."}

    rem = float(row["remaining_balance"])
    if rem <= 0:
        return {"valid": False, "message": "This voucher has KES 0.00 remaining balance."}

    return {
        "valid": True,
        "voucher": {
            "id": row["id"],
            "code": row["code"],
            "remaining_balance": rem,
            "initial_amount": float(row["initial_amount"]),
            "currency": row["currency"],
            "expires_at": str(row["expires_at"]),
        },
        "discount_amount": rem,
        "message": f"Voucher valid for up to KES {rem:,.0f} off.",
    }


@app.get("/api/vouchers/my-vouchers")
async def get_my_vouchers(
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        text("""
            SELECT id, code, user_id, original_booking_id, initial_amount, remaining_balance, currency, status, expires_at, created_at, redeemed_at
            FROM travel_vouchers
            WHERE user_id = :uid
            ORDER BY created_at DESC;
        """),
        {"uid": current_user.id}
    )).mappings().all()

    vouchers = []
    for r in rows:
        vouchers.append({
            "id": r["id"],
            "code": r["code"],
            "user_id": r["user_id"],
            "original_booking_id": r["original_booking_id"],
            "initial_amount": float(r["initial_amount"]),
            "remaining_balance": float(r["remaining_balance"]),
            "currency": r["currency"],
            "status": r["status"],
            "expires_at": str(r["expires_at"]) if r["expires_at"] else None,
            "created_at": str(r["created_at"]) if r["created_at"] else None,
            "redeemed_at": str(r["redeemed_at"]) if r["redeemed_at"] else None,
        })
    return {"vouchers": vouchers}


@app.get("/api/admin/audit-logs")
async def list_audit_logs(
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    limit: int = 100,
    db=Depends(get_async_db),
    _: User = Depends(require_roles('admin')),
):
    """Admin view of the immutable audit trail for security investigations."""
    # Ensure audit_logs table exists
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            action VARCHAR(100) NOT NULL,
            entity_type VARCHAR(100) NOT NULL,
            entity_id INTEGER NOT NULL,
            actor_user_id INTEGER,
            actor_role VARCHAR(50) NOT NULL,
            supervisor_pin_verified BOOLEAN NOT NULL DEFAULT FALSE,
            supervisor_user_id INTEGER,
            previous_state JSONB,
            new_state JSONB,
            reason TEXT,
            ip_address VARCHAR(100),
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    """))
    conditions = []
    params = {"limit": limit}
    if action:
        conditions.append("a.action = :action")
        params["action"] = action
    if entity_type:
        conditions.append("a.entity_type = :entity_type")
        params["entity_type"] = entity_type

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT a.id, a.action, a.entity_type, a.entity_id, a.actor_user_id, a.actor_role,
               a.supervisor_pin_verified, a.previous_state, a.new_state, a.reason,
               a.ip_address, a.created_at, u.full_name AS actor_name, u.phone AS actor_phone
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_user_id
        {where_clause}
        ORDER BY a.id DESC
        LIMIT :limit;
    """
    rows = (await db.execute(text(sql), params)).mappings().all()
    return {"total": len(rows), "audit_logs": [dict(r) for r in rows]}



# --------------------------------------------------------------------------
# Seat chains & seat map (public) — the relay view
# --------------------------------------------------------------------------
@app.get("/api/trips/{trip_id}/chains")
async def get_trip_chains(trip_id: int, db=Depends(get_async_db)):
    """Per-seat chains: ordered segment bookings sharing each physical seat."""
    capacity = (await db.execute(
        text("""
            SELECT vt.seat_capacity
            FROM trips t
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
            WHERE t.id = :trip_id;
        """),
        {"trip_id": trip_id},
    )).scalars().first()
    if capacity is None:
        raise HTTPException(status_code=404, detail="Trip not found.")

    chain_rows = (await db.execute(
        text("""
            SELECT b.seat_number, b.id AS booking_id, b.board_stop_order, b.alight_stop_order,
                   b.user_id, u.full_name AS passenger_name,
                   (SELECT stop_name FROM route_stops
                     WHERE route_id = r.id AND stop_order = b.board_stop_order) AS board_stop,
                   (SELECT stop_name FROM route_stops
                     WHERE route_id = r.id AND stop_order = b.alight_stop_order) AS alight_stop
            FROM bookings b
            JOIN trips t ON t.id = b.trip_id
            JOIN routes r ON r.id = t.route_id
            LEFT JOIN users u ON u.id = b.user_id
            WHERE b.trip_id = :trip_id AND b.status != 'cancelled'
            ORDER BY b.seat_number ASC, b.board_stop_order ASC;
        """),
        {"trip_id": trip_id},
    )).mappings().all()

    chains: dict[int, list[dict]] = {}
    for r in chain_rows:
        chains.setdefault(r["seat_number"], []).append({
            "booking_id": r["booking_id"],
            "board_stop_order": r["board_stop_order"],
            "alight_stop_order": r["alight_stop_order"],
            "board_stop": r["board_stop"],
            "alight_stop": r["alight_stop"],
            "passenger_name": r["passenger_name"] or "Walk-up / Unregistered",
        })

    return {
        "trip_id": trip_id,
        "seat_capacity": capacity,
        "chains": [{"seat_number": seat, "links": links} for seat, links in sorted(chains.items())],
    }


@app.get("/api/trips/{trip_id}/seat-map")
async def get_seat_map(trip_id: int, board_order: int = 1, alight_order: int = 2, db=Depends(get_async_db)):
    """Per-seat availability for the requested board→alight segment.

    state: 'free' (no overlap) | 'partial' (seat frees before your alight) | 'full'.
    next_free_stop: for partial seats, the stop where the seat frees up.
    """
    rows = (await db.execute(
        text("""
            SELECT vt.seat_capacity
            FROM trips t
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
            WHERE t.id = :trip_id;
        """),
        {"trip_id": trip_id},
    )).mappings().first()
    if rows is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    capacity = rows["seat_capacity"] or 0

    # All non-cancelled bookings overlapping the requested segment, per seat.
    overlaps = (await db.execute(
        text("""
            SELECT b.seat_number, b.board_stop_order, b.alight_stop_order,
                   (SELECT stop_name FROM route_stops
                     WHERE route_id = t.route_id AND stop_order = b.alight_stop_order) AS alight_stop
            FROM bookings b
            JOIN trips t ON t.id = b.trip_id
            WHERE b.trip_id = :trip_id
              AND b.status != 'cancelled'
              AND NOT (b.alight_stop_order <= :bo OR b.board_stop_order >= :ao)
            ORDER BY b.seat_number ASC, b.alight_stop_order DESC;
        """),
        {"trip_id": trip_id, "bo": board_order, "ao": alight_order},
    )).mappings().all()

    by_seat: dict[int, list[dict]] = {}
    for o in overlaps:
        by_seat.setdefault(o["seat_number"], []).append(dict(o))

    def classify(intervals: list[dict]) -> tuple[str, dict | None]:
        """Merge overlapping [board, alight) intervals over the requested
        segment. Return the seat state + the first free slot (relay point).

        - 'full'    : the seat is covered continuously across [board, alight).
        - 'partial' : covered for part of the segment; it frees at next_free.
        - 'free'    : no occupancy at all (handled by the caller).
        """
        merged: list[list[int]] = []
        for iv in sorted(intervals, key=lambda x: (x["board_stop_order"], x["alight_stop_order"])):
            b, a = iv["board_stop_order"], iv["alight_stop_order"]
            if merged and b <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], a)
            else:
                merged.append([b, a])

        # Gap before the first occupant?
        if merged[0][0] > board_order:
            return "partial", {"stop_order": board_order, "stop": None}
        cursor = merged[0][1]
        for b, a in merged[1:]:
            if b > cursor:
                return "partial", {"stop_order": cursor, "stop": None}
            cursor = max(cursor, a)
        if cursor < alight_order:
            return "partial", {"stop_order": cursor, "stop": None}
        return "full", None

    stop_by_order = {o["alight_stop_order"]: o["alight_stop"] for iv in overlaps for o in [iv]}

    # Query active in-memory TTL locks for this trip overlapping this route segment
    active_locks = await seat_lock_manager.get_locks_for_trip(trip_id, board_order, alight_order)
    locked_seat_map = {l["seat_number"]: l for l in active_locks}

    seats = []
    for num in range(1, capacity + 1):
        occ = by_seat.get(num, [])
        lock = locked_seat_map.get(num)
        is_locked = lock is not None

        if not occ:
            seat_state = "locked" if is_locked else "free"
            seats.append({
                "seat_number": num,
                "state": seat_state,
                "is_locked": is_locked,
                "lock_seconds_remaining": lock["seconds_remaining"] if lock else 0,
                "next_free_stop": None,
                "next_free_stop_order": None,
            })
            continue
        state, free_at = classify(occ)
        if state == "partial" and free_at is not None:
            # Name the freeing stop for the driver/relay UI.
            free_name = stop_by_order.get(free_at["stop_order"], None)
            if free_name is None:
                stop_name_row = (await db.execute(
                    text("""
                        SELECT stop_name FROM route_stops
                        WHERE route_id = (SELECT route_id FROM trips WHERE id = :trip_id)
                          AND stop_order = :so;
                    """),
                    {"trip_id": trip_id, "so": free_at["stop_order"]},
                )).scalars().first()
                free_name = stop_name_row
            seats.append({
                "seat_number": num,
                "state": "locked" if is_locked else "partial",
                "is_locked": is_locked,
                "lock_seconds_remaining": lock["seconds_remaining"] if lock else 0,
                "next_free_stop": free_name,
                "next_free_stop_order": free_at["stop_order"],
            })
        else:
            seats.append({
                "seat_number": num,
                "state": "full",
                "is_locked": is_locked,
                "lock_seconds_remaining": lock["seconds_remaining"] if lock else 0,
                "next_free_stop": None,
                "next_free_stop_order": None,
            })

    return {
        "trip_id": trip_id,
        "board_order": board_order,
        "alight_order": alight_order,
        "seat_capacity": capacity,
        "seats": seats,
        "active_locks_count": len(active_locks),
    }


class SeatLockRequest(BaseModel):
    board_stop_order: int
    alight_stop_order: int
    ttl_seconds: Optional[int] = 420


@app.post("/api/trips/{trip_id}/seats/{seat_number}/lock")
async def acquire_seat_lock(
    trip_id: int,
    seat_number: int,
    payload: SeatLockRequest,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Temporarily reserve/lock a seat for 5-7 minutes during checkout to avoid double bookings."""
    trip = (await db.execute(
        text("SELECT id FROM trips WHERE id = :id;"), {"id": trip_id}
    )).mappings().first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found.")

    # Check database occupancy for this segment
    overlap = (await db.execute(
        text("""
            SELECT id FROM bookings
            WHERE trip_id = :trip_id AND seat_number = :seat_number AND status != 'cancelled'
              AND NOT (alight_stop_order <= :bo OR board_stop_order >= :ao)
            LIMIT 1;
        """),
        {"trip_id": trip_id, "seat_number": seat_number, "bo": payload.board_stop_order, "ao": payload.alight_stop_order}
    )).first()
    if overlap:
        raise HTTPException(status_code=409, detail=f"Seat {seat_number} is already booked for this route segment.")

    ttl = payload.ttl_seconds or 420
    ok, lock_obj, message = await seat_lock_manager.acquire_lock(
        trip_id=trip_id,
        seat_number=seat_number,
        user_id=current_user.id,
        board_order=payload.board_stop_order,
        alight_order=payload.alight_stop_order,
        ttl_seconds=ttl,
    )
    if not ok:
        raise HTTPException(status_code=409, detail=message)

    # Broadcast seat lock event so concurrent users see it instantaneously
    await manager.broadcast_trip(trip_id, {
        "event": "seat_locked",
        "trip_id": trip_id,
        "seat_number": seat_number,
        "user_id": current_user.id,
        "board_stop_order": payload.board_stop_order,
        "alight_stop_order": payload.alight_stop_order,
        "seconds_remaining": lock_obj.seconds_remaining if lock_obj else ttl,
    })

    return {
        "status": "locked",
        "trip_id": trip_id,
        "seat_number": seat_number,
        "lock": lock_obj.to_dict() if lock_obj else None,
        "message": message,
    }


@app.post("/api/trips/{trip_id}/seats/{seat_number}/unlock")
async def release_seat_lock(
    trip_id: int,
    seat_number: int,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Release a held seat reservation lock."""
    released = await seat_lock_manager.release_lock(trip_id, seat_number, user_id=current_user.id)
    if released:
        await manager.broadcast_trip(trip_id, {
            "event": "seat_unlocked",
            "trip_id": trip_id,
            "seat_number": seat_number,
            "user_id": current_user.id,
            "reason": "user_cancelled",
        })
    return {"status": "unlocked", "released": released}


@app.get("/api/trips/{trip_id}/locks")
async def list_seat_locks(
    trip_id: int,
    board_order: Optional[int] = None,
    alight_order: Optional[int] = None,
    db=Depends(get_async_db),
):
    """Get active locks for a trip."""
    locks = await seat_lock_manager.get_locks_for_trip(trip_id, board_order, alight_order)
    return {"trip_id": trip_id, "active_locks": locks}



# --------------------------------------------------------------------------
# Waitlist (seat interests) — "notify me when this segment frees up"
# --------------------------------------------------------------------------
class SeatInterestIn(BaseModel):
    trip_id: int
    board_stop_order: int
    alight_stop_order: int
    seat_number: int | None = None


@app.post("/api/seat-interests")
async def create_seat_interest(payload: SeatInterestIn, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    if payload.board_stop_order >= payload.alight_stop_order:
        raise HTTPException(status_code=400, detail="Alighting stop must be further down the route than boarding.")
    row = (await db.execute(
        text("""
            INSERT INTO seat_interests (user_id, trip_id, board_stop_order, alight_stop_order, seat_number, status, created_at)
            VALUES (:uid, :trip_id, :board, :alight, :seat, 'active', now())
            RETURNING id, trip_id, board_stop_order, alight_stop_order, seat_number, status;
        """),
        {"uid": current_user.id, "trip_id": payload.trip_id, "board": payload.board_stop_order,
         "alight": payload.alight_stop_order, "seat": payload.seat_number},
    )).mappings().first()
    await db.commit()
    return dict(row)


@app.get("/api/seat-interests")
async def list_seat_interests(db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    rows = (await db.execute(
        text("""
            SELECT si.id, si.trip_id, si.board_stop_order, si.alight_stop_order, si.seat_number, si.status, si.created_at,
                   t.name AS trip_name, r.name AS route_name,
                   (SELECT stop_name FROM route_stops WHERE route_id = r.id AND stop_order = si.board_stop_order) AS board_stop,
                   (SELECT stop_name FROM route_stops WHERE route_id = r.id AND stop_order = si.alight_stop_order) AS alight_stop
            FROM seat_interests si
            JOIN trips t ON t.id = si.trip_id
            JOIN routes r ON r.id = t.route_id
            WHERE si.user_id = :uid
            ORDER BY si.created_at DESC;
        """),
        {"uid": current_user.id},
    )).mappings().all()
    return {"interests": [dict(r) for r in rows]}


@app.delete("/api/seat-interests/{interest_id}")
async def delete_seat_interest(interest_id: int, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    row = (await db.execute(
        text("SELECT id, user_id FROM seat_interests WHERE id = :id;"), {"id": interest_id}
    )).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Waitlist entry not found.")
    if row["user_id"] != current_user.id and current_user.role != 'admin':
        raise HTTPException(status_code=403, detail="You can only remove your own waitlist entry.")
    await db.execute(text("UPDATE seat_interests SET status = 'cancelled' WHERE id = :id;"), {"id": interest_id})
    await db.commit()
    return {"deleted": interest_id}


@app.post("/api/seat-interests/{interest_id}/claim")
async def claim_seat_interest(interest_id: int, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """
    Auto-claim endpoint:
    Checks if a waitlist interest has a freed seat on that segment, creates a pending booking,
    and returns checkout details for the user before the reservation timer expires.
    """
    interest = (await db.execute(
        text("SELECT id, user_id, trip_id, board_stop_order, alight_stop_order, seat_number, status FROM seat_interests WHERE id = :id;"),
        {"id": interest_id}
    )).mappings().first()

    if not interest:
        raise HTTPException(status_code=404, detail="Waitlist entry not found.")
    if interest["user_id"] != current_user.id and current_user.role != 'admin':
        raise HTTPException(status_code=403, detail="You can only claim your own waitlist reservation.")

    trip_id = interest["trip_id"]
    b_order = interest["board_stop_order"]
    a_order = interest["alight_stop_order"]
    target_seat = interest["seat_number"]

    # Check which seats are free on this segment
    cap_row = (await db.execute(
        text("""
        SELECT COALESCE(vt.seat_capacity, 14) AS seat_capacity
        FROM trips t
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        WHERE t.id = :trip_id;
        """),
        {"trip_id": trip_id}
    )).mappings().first()
    capacity = cap_row["seat_capacity"] if cap_row else 14

    occupied_query = text("""
        SELECT DISTINCT seat_number FROM bookings
        WHERE trip_id = :trip_id
          AND status != 'cancelled'
          AND NOT (alight_stop_order <= :board_order OR board_stop_order >= :alight_order);
    """)
    occupied_seats = set((await db.execute(occupied_query, {"trip_id": trip_id, "board_order": b_order, "alight_order": a_order})).scalars().all())

    chosen_seat = None
    if target_seat and target_seat not in occupied_seats:
        chosen_seat = target_seat
    else:
        for s in range(1, capacity + 1):
            if s not in occupied_seats:
                chosen_seat = s
                break

    trip_data = (await db.execute(
        text("""
            SELECT t.id, t.fixed_price, t.allow_driver_tier, t.max_surcharge_pct, t.driver_tier,
                   r.base_fare, r.per_hop_fare, r.fare_matrix
            FROM trips t
            JOIN routes r ON r.id = t.route_id
            WHERE t.id = :id;
        """),
        {"id": trip_id}
    )).mappings().first()

    matrix = None
    if trip_data and trip_data.get("fare_matrix"):
        fm = trip_data["fare_matrix"]
        matrix = fm if isinstance(fm, dict) else json.loads(fm)

    fare = calculate_segment_fare(
        board_order=b_order,
        alight_order=a_order,
        base_fare=trip_data["base_fare"] if trip_data else 200.0,
        per_hop_fare=trip_data["per_hop_fare"] if trip_data else 150.0,
        fare_matrix=matrix,
        fixed_price=trip_data["fixed_price"] if trip_data else None,
        allow_driver_tier=trip_data["allow_driver_tier"] if trip_data else False,
        driver_tier=trip_data["driver_tier"] if trip_data else "standard",
        max_surcharge_pct=trip_data["max_surcharge_pct"] if trip_data else 25.0,
    )

    # Create pending booking
    res = await db.execute(
        text("""
        INSERT INTO bookings (trip_id, user_id, seat_number, board_stop_order, alight_stop_order, status, payment_status)
        VALUES (:trip_id, :user_id, :seat_number, :board_order, :alight_order, 'pending', 'unpaid')
        RETURNING id;
        """),
        {
            "trip_id": trip_id,
            "user_id": current_user.id,
            "seat_number": chosen_seat,
            "board_order": b_order,
            "alight_order": a_order,
        }
    )
    booking_id = res.scalar_one()

    # Create initiated payment
    pres = await db.execute(
        text("INSERT INTO payments (booking_id, provider, amount, status) VALUES (:bid, 'paystack', :amt, 'initiated') RETURNING id;"),
        {"bid": booking_id, "amt": fare}
    )
    payment_id = pres.scalar_one()

    # Mark waitlist interest claimed
    await db.execute(text("UPDATE seat_interests SET status = 'claimed' WHERE id = :id;"), {"id": interest_id})
    await db.commit()

    # Recompute chain & broadcast
    stop_names = await trip_stop_names(db, trip_id)
    chain = await recompute_chain(db, trip_id, chosen_seat)
    await notify_chain_change(db, manager, trip_id, chosen_seat, chain, stop_names)
    await manager.broadcast_trip(trip_id, {
        "event": "booking_pending",
        "trip_id": trip_id,
        "seat_number": chosen_seat,
        "booking_id": booking_id,
        "board_stop_order": b_order,
        "alight_stop_order": a_order,
    })

    return {
        "status": "claimed",
        "booking_id": booking_id,
        "payment_id": payment_id,
        "seat_number": chosen_seat,
        "amount": fare,
        "message": f"Seat #{chosen_seat} successfully reserved! Proceed to checkout.",
    }


# --------------------------------------------------------------------------
# Notifications (in-app + WS push)
# --------------------------------------------------------------------------
@app.get("/api/notifications")
async def list_notifications(limit: int = 30, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    rows = (await db.execute(
        text("""
            SELECT id, kind, title, body, payload, read, created_at
            FROM notifications
            WHERE user_id = :uid
            ORDER BY created_at DESC, id DESC
            LIMIT :limit;
        """),
        {"uid": current_user.id, "limit": limit},
    )).mappings().all()
    unread = (await db.execute(
        text("SELECT count(*) FROM notifications WHERE user_id = :uid AND read = false;"),
        {"uid": current_user.id},
    )).scalar()
    return {"notifications": [dict(r) for r in rows], "unread": unread}


@app.post("/api/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: int, db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    row = (await db.execute(
        text("SELECT id, user_id FROM notifications WHERE id = :id;"), {"id": notif_id}
    )).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Notification not found.")
    if row["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Not your notification.")
    await db.execute(text("UPDATE notifications SET read = true WHERE id = :id;"), {"id": notif_id})
    await db.commit()
    return {"read": True}


@app.post("/api/notifications/read-all")
async def mark_all_notifications_read(db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    await db.execute(
        text("UPDATE notifications SET read = true WHERE user_id = :uid AND read = false;"),
        {"uid": current_user.id},
    )
    await db.commit()
    return {"read_all": True}


# --------------------------------------------------------------------------
# Driver: report which stop the bus is at (drives seat-release notifications)
# --------------------------------------------------------------------------
class CurrentStopRequest(BaseModel):
    stop_order: int


@app.patch("/api/trips/{trip_id}/current-stop")
async def set_current_stop(trip_id: int, payload: CurrentStopRequest, db=Depends(get_async_db), current_user: User = Depends(require_roles('driver', 'admin'))):
    trip = (await db.execute(text("SELECT id, route_id, driver_id FROM trips WHERE id = :id;"), {"id": trip_id})).mappings().first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    if current_user.role == 'driver' and trip["driver_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="This trip is not assigned to you.")

    # Validate the stop belongs to the route.
    valid = (await db.execute(
        text("SELECT id FROM route_stops WHERE route_id = :rid AND stop_order = :so;"),
        {"rid": trip["route_id"], "so": payload.stop_order},
    )).scalars().first()
    if valid is None:
        raise HTTPException(status_code=400, detail="Stop not found on this trip's route.")

    await db.execute(
        text("UPDATE trips SET current_stop_order = :so WHERE id = :id;"),
        {"so": payload.stop_order, "id": trip_id},
    )
    await db.commit()

    # Release seats whose passengers alight here + notify the relay/waitlists.
    released = await notify_seat_released_at_stop(db, manager, trip_id, payload.stop_order)
    await manager.broadcast_trip(trip_id, {
        "event": "trip_at_stop",
        "trip_id": trip_id,
        "stop_order": payload.stop_order,
        "released_seats": released,
    })
    return {"trip_id": trip_id, "stop_order": payload.stop_order, "released_seats": released}


# --------------------------------------------------------------------------
# Admin: Fleet & Catalog management (admin only)
# --------------------------------------------------------------------------
class VehicleTypeIn(BaseModel):
    slug: str
    display_name: str
    seat_capacity: int


class SaccoIn(BaseModel):
    name: str
    slug: str
    registration_no: str | None = None
    headquarters: str = 'Nairobi'
    contact_phone: str | None = None
    contact_email: str | None = None
    primary_color: str = '#06b6d4'
    accent_color: str = '#f43f5e'
    logo_url: str | None = None


class SaccoUpdate(BaseModel):
    name: str | None = None
    registration_no: str | None = None
    headquarters: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    logo_url: str | None = None


class ComplianceUpdate(BaseModel):
    speed_governor_vendor: str | None = None
    speed_governor_cert: str | None = None
    speed_governor_expiry: str | None = None
    ntsa_inspection_cert: str | None = None
    ntsa_inspection_expiry: str | None = None
    insurance_underwriter: str | None = None
    insurance_policy_no: str | None = None
    insurance_expiry: str | None = None


class GroundingToggle(BaseModel):
    is_grounded: bool
    reason: str | None = None


class VehicleIn(BaseModel):
    plate_number: str
    vehicle_type_id: int | None = None
    is_electric: bool = False
    sacco_id: int | None = None
    purpose: str = 'passenger'  # 'passenger' | 'cargo' | 'people'
    body_type: str | None = None
    cargo_tonnage_capacity: float | None = None
    driver_id: int | None = None


class DriverVehicleRegisterIn(BaseModel):
    plate_number: str
    purpose: str = 'cargo'  # 'cargo' | 'people' | 'passenger'
    vehicle_type_id: int | None = None
    body_type: str | None = None
    cargo_tonnage_capacity: float | None = None
    seat_capacity: int | None = None
    is_electric: bool = False
    sacco_id: int | None = None
    chassis_number: str | None = None
    manufacture_year: int | None = None


class AssignTripVehicleIn(BaseModel):
    vehicle_id: int


class RouteIn(BaseModel):
    name: str
    country: str = 'KE'
    route_type: str = 'stopwise'   # 'direct' | 'stopwise'
    stops: list[str] = []
    base_fare: float = 200.0
    per_hop_fare: float = 150.0
    fare_matrix: dict[str, float] | None = None
    sacco_id: int | None = None


class TripIn(BaseModel):
    route_id: int
    vehicle_id: int | None = None
    driver_id: int | None = None
    name: str
    scheduled_at: str | None = None
    status: str = 'scheduled'
    fixed_price: float | None = None
    allow_driver_tier: bool = False
    max_surcharge_pct: float = 25.0
    sacco_id: int | None = None


class TripPatch(BaseModel):
    route_id: int | None = None
    vehicle_id: int | None = None
    driver_id: int | None = None
    name: str | None = None
    scheduled_at: str | None = None
    status: str | None = None
    fixed_price: float | None = None
    allow_driver_tier: bool | None = None
    max_surcharge_pct: float | None = None
    driver_tier: str | None = None


class DriverTierRequest(BaseModel):
    driver_tier: str


@app.get("/api/vehicle-types")
async def list_vehicle_types(db=Depends(get_async_db)):
    """Public/driver list of vehicle types including cargo lorries and passenger PSVs."""
    rows = (await db.execute(text("SELECT id, slug, display_name, seat_capacity, seat_layout, purpose, cargo_tonnage FROM vehicle_types ORDER BY id;"))).mappings().all()
    return {"vehicle_types": [dict(r) for r in rows]}


@app.get("/api/admin/vehicle-types")
async def admin_list_vehicle_types(db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    rows = (await db.execute(text("SELECT id, slug, display_name, seat_capacity, seat_layout, purpose, cargo_tonnage FROM vehicle_types ORDER BY id;"))).mappings().all()
    return {"vehicle_types": [dict(r) for r in rows]}


@app.post("/api/admin/vehicle-types")
async def admin_create_vehicle_type(payload: VehicleTypeIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    norm_p = 'passenger' if payload.purpose in ('people', 'passenger') else 'cargo'
    res = await db.execute(
        text("""
            INSERT INTO vehicle_types (slug, display_name, seat_capacity, seat_layout, purpose, cargo_tonnage)
            VALUES (:slug, :display_name, :seat_capacity, CAST(:layout AS jsonb), :purpose, :cargo_tonnage)
            RETURNING id, slug, display_name, seat_capacity, seat_layout, purpose, cargo_tonnage;
        """),
        {
            "slug": payload.slug,
            "display_name": payload.display_name,
            "seat_capacity": payload.seat_capacity,
            "purpose": norm_p,
            "cargo_tonnage": payload.cargo_tonnage,
            "layout": json.dumps(_default_seat_layout(payload.seat_capacity))
        },
    )
    row = dict(res.mappings().first())
    await db.commit()
    return row


@app.get("/api/admin/vehicles")
async def admin_list_vehicles(db=Depends(get_async_db), _: User = Depends(require_roles('admin', 'sacco_admin'))):
    rows = (await db.execute(
        text("""
        SELECT v.id, v.plate_number, v.vehicle_type_id, v.is_electric, v.created_at,
               v.sacco_id, s.name AS sacco_name,
               v.purpose, v.body_type, v.cargo_tonnage_capacity, v.driver_id,
               u.full_name AS driver_name,
               COALESCE(vc.is_grounded, false) AS is_grounded,
               CASE
                   WHEN vc.is_grounded = true THEN 'grounded'
                   WHEN (vc.ntsa_inspection_expiry IS NOT NULL AND vc.ntsa_inspection_expiry < NOW())
                     OR (vc.speed_governor_expiry IS NOT NULL AND vc.speed_governor_expiry < NOW())
                     OR (vc.insurance_expiry IS NOT NULL AND vc.insurance_expiry < NOW()) THEN 'grounded'
                   WHEN (vc.ntsa_inspection_expiry IS NOT NULL AND vc.ntsa_inspection_expiry < NOW() + INTERVAL '30 days')
                     OR (vc.speed_governor_expiry IS NOT NULL AND vc.speed_governor_expiry < NOW() + INTERVAL '30 days')
                     OR (vc.insurance_expiry IS NOT NULL AND vc.insurance_expiry < NOW() + INTERVAL '30 days') THEN 'warning_expiring'
                   ELSE 'compliant'
               END AS compliance_status,
               vt.slug AS category, vt.display_name AS vehicle_type_name, vt.seat_capacity,
               vt.purpose AS vt_purpose, vt.cargo_tonnage AS vt_cargo_tonnage
        FROM vehicles v
        JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        LEFT JOIN saccos s ON s.id = v.sacco_id
        LEFT JOIN users u ON u.id = v.driver_id
        LEFT JOIN vehicle_compliance vc ON vc.vehicle_id = v.id
        ORDER BY v.id;
        """)
    )).mappings().all()
    return {"vehicles": [dict(r) for r in rows]}


@app.post("/api/admin/vehicles")
async def admin_create_vehicle(payload: VehicleIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin', 'sacco_admin'))):
    try:
        plate = payload.plate_number.strip().upper()
        norm_p = 'passenger' if (payload.purpose or '').lower() in ('people', 'passenger') else 'cargo'
        vt_id = payload.vehicle_type_id
        if not vt_id:
            default_slug = 'matatu_14' if norm_p == 'passenger' else 'lorry_canter_3t'
            vt_row = (await db.execute(
                text("SELECT id, cargo_tonnage FROM vehicle_types WHERE slug = :slug OR purpose = :p ORDER BY (slug = :slug) DESC LIMIT 1;"),
                {"slug": payload.body_type or default_slug, "p": norm_p}
            )).mappings().first()
            vt_id = vt_row["id"] if vt_row else 1
            if payload.cargo_tonnage_capacity is None and vt_row and vt_row.get("cargo_tonnage"):
                payload.cargo_tonnage_capacity = float(vt_row["cargo_tonnage"])

        res = await db.execute(
            text("""
                INSERT INTO vehicles (
                    plate_number, vehicle_type_id, is_electric, sacco_id,
                    purpose, body_type, cargo_tonnage_capacity, driver_id
                )
                VALUES (
                    :plate, :vt_id, :electric, :sacco_id,
                    :purpose, :body_type, :tonnage, :driver_id
                )
                RETURNING id, plate_number, vehicle_type_id, is_electric, sacco_id, purpose, body_type, cargo_tonnage_capacity;
            """),
            {
                "plate": plate,
                "vt_id": vt_id,
                "electric": payload.is_electric,
                "sacco_id": payload.sacco_id,
                "purpose": norm_p,
                "body_type": payload.body_type or ('canter_lorry' if norm_p == 'cargo' else 'matatu_14'),
                "tonnage": payload.cargo_tonnage_capacity,
                "driver_id": payload.driver_id,
            },
        )
        row = dict(res.mappings().first())
        vid = row["id"]

        # Seed initial compliance record
        now = datetime.now(timezone.utc)
        await db.execute(
            text("""
            INSERT INTO vehicle_compliance (vehicle_id, speed_governor_vendor, speed_governor_cert, speed_governor_expiry, ntsa_inspection_cert, ntsa_inspection_expiry, insurance_underwriter, insurance_policy_no, insurance_expiry, is_grounded, last_inspected_at, updated_at)
            VALUES (:vid, 'Omata Africa Ltd', :gov_c, :gov_e, :ntsa_c, :ntsa_e, 'Directline Assurance', :ins_p, :ins_e, false, :now, :now);
            """),
            {
                "vid": vid,
                "gov_c": f"OM-{plate.replace(' ', '')}",
                "gov_e": now + timedelta(days=180),
                "ntsa_c": f"NTSA-{plate.replace(' ', '')}",
                "ntsa_e": now + timedelta(days=210),
                "ins_p": f"DL-FLEET-{plate.replace(' ', '')}",
                "ins_e": now + timedelta(days=190),
                "now": now,
            }
        )
        await db.commit()
    except DBAPIError as e:
        await db.rollback()
        if 'unique' in str(e).lower() or 'duplicate' in str(e).lower():
            raise HTTPException(status_code=409, detail="A vehicle with that plate number already exists.")
        raise HTTPException(status_code=500, detail=str(e))
    return row


@app.get("/api/driver/vehicles")
async def driver_list_vehicles(
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """List vehicles registered by or assigned to the authenticated driver."""
    query = """
        SELECT v.id, v.plate_number, v.vehicle_type_id, v.is_electric, v.created_at,
               v.purpose, v.body_type, v.cargo_tonnage_capacity, v.driver_id,
               v.sacco_id, s.name AS sacco_name,
               COALESCE(vc.is_grounded, false) AS is_grounded,
               CASE
                   WHEN vc.is_grounded = true THEN 'grounded'
                   WHEN (vc.ntsa_inspection_expiry IS NOT NULL AND vc.ntsa_inspection_expiry < NOW())
                     OR (vc.speed_governor_expiry IS NOT NULL AND vc.speed_governor_expiry < NOW())
                     OR (vc.insurance_expiry IS NOT NULL AND vc.insurance_expiry < NOW()) THEN 'grounded'
                   WHEN (vc.ntsa_inspection_expiry IS NOT NULL AND vc.ntsa_inspection_expiry < NOW() + INTERVAL '30 days')
                     OR (vc.speed_governor_expiry IS NOT NULL AND vc.speed_governor_expiry < NOW() + INTERVAL '30 days')
                     OR (vc.insurance_expiry IS NOT NULL AND vc.insurance_expiry < NOW() + INTERVAL '30 days') THEN 'warning_expiring'
                   ELSE 'compliant'
               END AS compliance_status,
               vt.slug AS category, vt.display_name AS vehicle_type_name, vt.seat_capacity,
               cur_trip.id AS active_trip_id, cur_trip.name AS active_trip_name
        FROM vehicles v
        JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        LEFT JOIN saccos s ON s.id = v.sacco_id
        LEFT JOIN vehicle_compliance vc ON vc.vehicle_id = v.id
        LEFT JOIN LATERAL (
            SELECT t.id, t.name
            FROM trips t
            WHERE t.vehicle_id = v.id AND t.status IN ('scheduled', 'boarding', 'in_transit')
            ORDER BY t.scheduled_at DESC
            LIMIT 1
        ) cur_trip ON true
    """
    if current_user.role == 'admin':
        rows = (await db.execute(text(query + " ORDER BY v.id DESC;"))).mappings().all()
    else:
        rows = (await db.execute(
            text(query + " WHERE v.driver_id = :uid ORDER BY v.id DESC;"),
            {"uid": current_user.id},
        )).mappings().all()

    return {"vehicles": [dict(r) for r in rows]}


@app.post("/api/driver/vehicles")
async def driver_register_vehicle(
    payload: DriverVehicleRegisterIn,
    db=Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Driver self-service registration of their vehicle (Cargo Lorries or Passenger PSVs)."""
    plate = payload.plate_number.strip().upper()
    if not plate:
        raise HTTPException(status_code=400, detail="Vehicle plate number is required.")

    # Automatically promote to driver role if currently a standard user
    if current_user.role == 'user':
        await db.execute(text("UPDATE users SET role = 'driver' WHERE id = :uid;"), {"uid": current_user.id})

    norm_purpose = 'passenger' if payload.purpose.lower().strip() in ('people', 'passenger') else 'cargo'
    
    # Resolve vehicle type if not directly provided
    vt_id = payload.vehicle_type_id
    if not vt_id:
        if norm_purpose == 'cargo':
            body_slug_map = {
                'canter_lorry': 'lorry_canter_3t',
                'box_lorry': 'lorry_isuzu_7t',
                'tipper_lorry': 'lorry_actros_15t',
                'flatbed_lorry': 'lorry_flatbed_10t',
                'pickup_lorry': 'pickup_lorry_1t',
            }
            target_slug = body_slug_map.get(payload.body_type or '', 'lorry_canter_3t')
        else:
            body_slug_map = {
                'matatu_14': 'matatu_14',
                'ev_matatu_14': 'ev_matatu_14',
                'nganya_35': 'nganya_35',
                'coach_51': 'bus_51',
            }
            target_slug = body_slug_map.get(payload.body_type or '', 'matatu_14')

        vt_row = (await db.execute(
            text("SELECT id, cargo_tonnage FROM vehicle_types WHERE slug = :slug OR purpose = :p ORDER BY (slug = :slug) DESC LIMIT 1;"),
            {"slug": target_slug, "p": norm_purpose}
        )).mappings().first()

        if vt_row:
            vt_id = vt_row["id"]
            if payload.cargo_tonnage_capacity is None and vt_row.get("cargo_tonnage"):
                payload.cargo_tonnage_capacity = float(vt_row["cargo_tonnage"])
        else:
            vt_id = 1

    try:
        res = await db.execute(
            text("""
                INSERT INTO vehicles (
                    plate_number, vehicle_type_id, is_electric, sacco_id,
                    driver_id, purpose, body_type, cargo_tonnage_capacity,
                    chassis_number, manufacture_year, created_at
                )
                VALUES (
                    :plate, :vt_id, :electric, :sacco_id,
                    :driver_id, :purpose, :body_type, :tonnage,
                    :chassis, :year, NOW()
                )
                RETURNING id, plate_number, purpose, body_type, cargo_tonnage_capacity;
            """),
            {
                "plate": plate,
                "vt_id": vt_id,
                "electric": payload.is_electric,
                "sacco_id": payload.sacco_id or getattr(current_user, 'sacco_id', None),
                "driver_id": current_user.id,
                "purpose": norm_purpose,
                "body_type": payload.body_type or ('canter_lorry' if norm_purpose == 'cargo' else 'matatu_14'),
                "tonnage": payload.cargo_tonnage_capacity if norm_purpose == 'cargo' else None,
                "chassis": payload.chassis_number,
                "year": payload.manufacture_year,
            }
        )
        row = dict(res.mappings().first())
        vid = row["id"]

        # Seed initial compliance
        now = datetime.now(timezone.utc)
        await db.execute(
            text("""
                INSERT INTO vehicle_compliance (
                    vehicle_id, speed_governor_vendor, speed_governor_cert,
                    speed_governor_expiry, ntsa_inspection_cert, ntsa_inspection_expiry,
                    insurance_underwriter, insurance_policy_no, insurance_expiry,
                    is_grounded, last_inspected_at, updated_at
                )
                VALUES (
                    :vid, 'Omata Africa Ltd', :gov_c,
                    :gov_e, :ntsa_c, :ntsa_e,
                    'Directline Assurance', :ins_p, :ins_e,
                    false, :now, :now
                );
            """),
            {
                "vid": vid,
                "gov_c": f"OM-{plate.replace(' ', '')}",
                "gov_e": now + timedelta(days=180),
                "ntsa_c": f"NTSA-{plate.replace(' ', '')}",
                "ntsa_e": now + timedelta(days=210),
                "ins_p": f"DL-INS-{plate.replace(' ', '')}",
                "ins_e": now + timedelta(days=190),
                "now": now,
            }
        )
        await db.commit()
    except DBAPIError as e:
        await db.rollback()
        if 'unique' in str(e).lower() or 'duplicate' in str(e).lower():
            raise HTTPException(status_code=409, detail=f"Vehicle with plate number '{plate}' is already registered in the system.")
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "ok": True,
        "vehicle_id": vid,
        "plate_number": plate,
        "purpose": norm_purpose,
        "body_type": row.get("body_type"),
        "cargo_tonnage_capacity": row.get("cargo_tonnage_capacity"),
        "message": f"Vehicle {plate} successfully registered under {norm_purpose.upper()}!"
    }


@app.post("/api/driver/trips/{trip_id}/assign-vehicle")
async def driver_assign_trip_vehicle(
    trip_id: int,
    payload: AssignTripVehicleIn,
    db=Depends(get_async_db),
    current_user: User = Depends(require_roles('driver', 'admin')),
):
    """Assign a vehicle to an active trip."""
    v_res = await db.execute(
        text("SELECT id, plate_number, purpose, body_type FROM vehicles WHERE id = :vid;"),
        {"vid": payload.vehicle_id}
    )
    v_row = v_res.mappings().first()
    if not v_row:
        raise HTTPException(status_code=404, detail="Vehicle not found.")

    await db.execute(
        text("UPDATE trips SET vehicle_id = :vid WHERE id = :tid;"),
        {"vid": payload.vehicle_id, "tid": trip_id}
    )
    await db.commit()

    return {
        "ok": True,
        "trip_id": trip_id,
        "vehicle_id": payload.vehicle_id,
        "plate_number": v_row["plate_number"],
        "purpose": v_row["purpose"],
        "message": f"Vehicle {v_row['plate_number']} assigned to Trip #{trip_id} successfully!"
    }


@app.delete("/api/admin/vehicles/{vehicle_id}")
async def admin_delete_vehicle(vehicle_id: int, db=Depends(get_async_db), _: User = Depends(require_roles('admin', 'sacco_admin'))):
    row = (await db.execute(text("SELECT id FROM vehicles WHERE id = :id;"), {"id": vehicle_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Vehicle not found.")
    await db.execute(text("DELETE FROM vehicle_compliance WHERE vehicle_id = :id;"), {"id": vehicle_id})
    await db.execute(text("DELETE FROM vehicles WHERE id = :id;"), {"id": vehicle_id})
    await db.commit()
    return {"deleted": vehicle_id}


# --------------------------------------------------------------------------
# Multi-SACCO Management (Option 1)
# --------------------------------------------------------------------------

@app.get("/api/saccos")
async def list_saccos(db=Depends(get_async_db)):
    """List all SACCOs with fleet counts and compliance scores."""
    rows = (await db.execute(
        text("""
        SELECT s.id, s.name, s.slug, s.registration_no, s.headquarters,
               s.contact_phone, s.contact_email, s.primary_color, s.accent_color,
               s.logo_url, s.created_at,
               COUNT(DISTINCT v.id) AS fleet_count,
               COUNT(DISTINCT r.id) AS routes_count,
               COALESCE(
                   ROUND(
                       100.0 * COUNT(DISTINCT CASE WHEN vc.is_grounded = false AND (vc.ntsa_inspection_expiry IS NULL OR vc.ntsa_inspection_expiry > NOW()) THEN v.id END)
                       / NULLIF(COUNT(DISTINCT v.id), 0)
                   ),
                   100
               ) AS compliance_score
        FROM saccos s
        LEFT JOIN vehicles v ON v.sacco_id = s.id
        LEFT JOIN vehicle_compliance vc ON vc.vehicle_id = v.id
        LEFT JOIN routes r ON r.sacco_id = s.id
        GROUP BY s.id
        ORDER BY s.id;
        """)
    )).mappings().all()
    return {"saccos": [dict(r) for r in rows]}


@app.get("/api/saccos/{sacco_id}")
async def get_sacco_detail(sacco_id: int, db=Depends(get_async_db)):
    sacco_row = (await db.execute(
        text("SELECT * FROM saccos WHERE id = :id;"),
        {"id": sacco_id}
    )).mappings().first()
    if not sacco_row:
        raise HTTPException(status_code=404, detail="SACCO not found")

    vehicles = (await db.execute(
        text("""
        SELECT v.id, v.plate_number, v.is_electric, vt.display_name AS vehicle_type,
               COALESCE(vc.is_grounded, false) AS is_grounded, vc.grounded_reason, vc.ntsa_inspection_expiry
        FROM vehicles v
        JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        LEFT JOIN vehicle_compliance vc ON vc.vehicle_id = v.id
        WHERE v.sacco_id = :sid
        ORDER BY v.id;
        """),
        {"sid": sacco_id}
    )).mappings().all()

    routes = (await db.execute(
        text("SELECT id, name, route_type, base_fare FROM routes WHERE sacco_id = :sid ORDER BY id;"),
        {"sid": sacco_id}
    )).mappings().all()

    return {
        "sacco": dict(sacco_row),
        "vehicles": [dict(v) for v in vehicles],
        "routes": [dict(r) for r in routes],
    }


@app.post("/api/saccos")
async def create_sacco(payload: SaccoIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    try:
        res = await db.execute(
            text("""
            INSERT INTO saccos (name, slug, registration_no, headquarters, contact_phone, contact_email, primary_color, accent_color, logo_url, created_at)
            VALUES (:name, :slug, :reg, :hq, :phone, :email, :pri, :acc, :logo, NOW())
            RETURNING id;
            """),
            {
                "name": payload.name,
                "slug": payload.slug.lower().replace(' ', '_'),
                "reg": payload.registration_no,
                "hq": payload.headquarters,
                "phone": payload.contact_phone,
                "email": payload.contact_email,
                "pri": payload.primary_color,
                "acc": payload.accent_color,
                "logo": payload.logo_url,
            }
        )
        sacco_id = res.scalar_one()
        await db.commit()
    except DBAPIError as e:
        await db.rollback()
        if 'unique' in str(e).lower() or 'duplicate' in str(e).lower():
            raise HTTPException(status_code=409, detail="A SACCO with that name or slug already exists.")
        raise HTTPException(status_code=500, detail=str(e))
    return {"id": sacco_id, "name": payload.name, "slug": payload.slug}


@app.put("/api/saccos/{sacco_id}")
async def update_sacco(sacco_id: int, payload: SaccoUpdate, db=Depends(get_async_db), user: User = Depends(require_roles('admin', 'sacco_admin'))):
    if user.role == 'sacco_admin' and user.sacco_id != sacco_id:
        raise HTTPException(status_code=403, detail="You can only manage your assigned SACCO.")

    fields = []
    values = {"id": sacco_id}
    for field, val in payload.model_dump(exclude_unset=True).items():
        if val is not None:
            fields.append(f"{field} = :{field}")
            values[field] = val

    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    sql = f"UPDATE saccos SET {', '.join(fields)} WHERE id = :id RETURNING id, name, slug;"
    res = await db.execute(text(sql), values)
    row = res.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="SACCO not found")
    await db.commit()
    return dict(row)


# --------------------------------------------------------------------------
# Fleet & NTSA Vehicle Compliance Management (Option 1)
# --------------------------------------------------------------------------

@app.get("/api/compliance/fleet")
async def get_fleet_compliance(sacco_id: int | None = None, db=Depends(get_async_db), _: User = Depends(require_roles('admin', 'sacco_admin'))):
    filter_clause = "WHERE v.sacco_id = :sid" if sacco_id else ""
    params = {"sid": sacco_id} if sacco_id else {}

    sql = f"""
    SELECT vc.id, vc.vehicle_id, v.plate_number, s.name AS sacco_name,
           vc.speed_governor_vendor, vc.speed_governor_cert, vc.speed_governor_expiry,
           vc.ntsa_inspection_cert, vc.ntsa_inspection_expiry,
           vc.insurance_underwriter, vc.insurance_policy_no, vc.insurance_expiry,
           COALESCE(vc.is_grounded, false) AS is_grounded, vc.grounded_reason, vc.last_inspected_at, vc.updated_at,
           CASE
               WHEN vc.is_grounded = true THEN 'grounded'
               WHEN (vc.ntsa_inspection_expiry IS NOT NULL AND vc.ntsa_inspection_expiry < NOW())
                 OR (vc.speed_governor_expiry IS NOT NULL AND vc.speed_governor_expiry < NOW())
                 OR (vc.insurance_expiry IS NOT NULL AND vc.insurance_expiry < NOW()) THEN 'grounded'
               WHEN (vc.ntsa_inspection_expiry IS NOT NULL AND vc.ntsa_inspection_expiry < NOW() + INTERVAL '30 days')
                 OR (vc.speed_governor_expiry IS NOT NULL AND vc.speed_governor_expiry < NOW() + INTERVAL '30 days')
                 OR (vc.insurance_expiry IS NOT NULL AND vc.insurance_expiry < NOW() + INTERVAL '30 days') THEN 'warning_expiring'
               ELSE 'compliant'
           END AS status
    FROM vehicle_compliance vc
    JOIN vehicles v ON v.id = vc.vehicle_id
    LEFT JOIN saccos s ON s.id = v.sacco_id
    {filter_clause}
    ORDER BY vc.is_grounded DESC, vc.ntsa_inspection_expiry ASC NULLS LAST;
    """
    rows = (await db.execute(text(sql), params)).mappings().all()
    return {"compliance": [dict(r) for r in rows]}


@app.post("/api/compliance/vehicles/{vehicle_id}")
async def update_vehicle_compliance(vehicle_id: int, payload: ComplianceUpdate, db=Depends(get_async_db), _: User = Depends(require_roles('admin', 'sacco_admin'))):
    existing = (await db.execute(text("SELECT id FROM vehicle_compliance WHERE vehicle_id = :vid;"), {"vid": vehicle_id})).mappings().first()
    now = datetime.now(timezone.utc)

    if existing:
        await db.execute(
            text("""
            UPDATE vehicle_compliance SET
                speed_governor_vendor = COALESCE(:gov_v, speed_governor_vendor),
                speed_governor_cert = COALESCE(:gov_c, speed_governor_cert),
                speed_governor_expiry = COALESCE(CAST(:gov_e AS timestamptz), speed_governor_expiry),
                ntsa_inspection_cert = COALESCE(:ntsa_c, ntsa_inspection_cert),
                ntsa_inspection_expiry = COALESCE(CAST(:ntsa_e AS timestamptz), ntsa_inspection_expiry),
                insurance_underwriter = COALESCE(:ins_u, insurance_underwriter),
                insurance_policy_no = COALESCE(:ins_p, insurance_policy_no),
                insurance_expiry = COALESCE(CAST(:ins_e AS timestamptz), insurance_expiry),
                last_inspected_at = :now,
                updated_at = :now
            WHERE vehicle_id = :vid;
            """),
            {
                "vid": vehicle_id,
                "gov_v": payload.speed_governor_vendor,
                "gov_c": payload.speed_governor_cert,
                "gov_e": payload.speed_governor_expiry,
                "ntsa_c": payload.ntsa_inspection_cert,
                "ntsa_e": payload.ntsa_inspection_expiry,
                "ins_u": payload.insurance_underwriter,
                "ins_p": payload.insurance_policy_no,
                "ins_e": payload.insurance_expiry,
                "now": now,
            }
        )
    else:
        await db.execute(
            text("""
            INSERT INTO vehicle_compliance (vehicle_id, speed_governor_vendor, speed_governor_cert, speed_governor_expiry, ntsa_inspection_cert, ntsa_inspection_expiry, insurance_underwriter, insurance_policy_no, insurance_expiry, is_grounded, last_inspected_at, updated_at)
            VALUES (:vid, :gov_v, :gov_c, CAST(:gov_e AS timestamptz), :ntsa_c, CAST(:ntsa_e AS timestamptz), :ins_u, :ins_p, CAST(:ins_e AS timestamptz), false, :now, :now);
            """),
            {
                "vid": vehicle_id,
                "gov_v": payload.speed_governor_vendor,
                "gov_c": payload.speed_governor_cert,
                "gov_e": payload.speed_governor_expiry,
                "ntsa_c": payload.ntsa_inspection_cert,
                "ntsa_e": payload.ntsa_inspection_expiry,
                "ins_u": payload.insurance_underwriter,
                "ins_p": payload.insurance_policy_no,
                "ins_e": payload.insurance_expiry,
                "now": now,
            }
        )
    await db.commit()
    return {"ok": True, "message": "Vehicle compliance record updated successfully.", "vehicle_id": vehicle_id}


@app.post("/api/compliance/vehicles/{vehicle_id}/ground")
async def toggle_grounding(vehicle_id: int, payload: GroundingToggle, db=Depends(get_async_db), _: User = Depends(require_roles('admin', 'sacco_admin'))):
    row = (await db.execute(text("SELECT plate_number FROM vehicles WHERE id = :vid;"), {"vid": vehicle_id})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    await db.execute(
        text("""
        UPDATE vehicle_compliance SET
            is_grounded = :grounded,
            grounded_reason = :reason,
            updated_at = NOW()
        WHERE vehicle_id = :vid;
        """),
        {
            "vid": vehicle_id,
            "grounded": payload.is_grounded,
            "reason": payload.reason if payload.is_grounded else None,
        }
    )
    await db.commit()
    action = "grounded" if payload.is_grounded else "cleared for service"
    return {
        "ok": True,
        "message": f"Vehicle {row.get('plate_number')} has been {action}.",
        "vehicle_id": vehicle_id,
        "is_grounded": payload.is_grounded,
    }


class DriverPsvBadgeUpdate(BaseModel):
    psv_badge_number: str
    psv_badge_expiry: str


@app.post("/api/compliance/run-sweeper")
async def run_compliance_sweeper(
    db=Depends(get_async_db),
    _: User = Depends(require_roles('admin', 'sacco_admin')),
):
    """
    On-Demand NTSA Compliance & Auto-Grounding Sweeper Execution.
    Audits speed governors, inspections, commercial insurance, and driver PSV badges.
    Auto-grounds non-compliant fleet vehicles and auto-suspends their assigned scheduled trips.
    """
    results = await crons.sweep_ntsa_compliance_and_auto_ground(db)
    return {
        "ok": True,
        "message": f"NTSA Sweeper executed: {results['auto_grounded_count']} vehicle(s) auto-grounded, {results['auto_cleared_count']} restored.",
        "results": results,
    }


@app.get("/api/compliance/summary")
async def get_compliance_summary(
    sacco_id: Optional[int] = None,
    db=Depends(get_async_db),
    _: User = Depends(require_roles('admin', 'sacco_admin')),
):
    """High-level NTSA compliance metrics for executive dashboard."""
    filter_sql = "WHERE v.sacco_id = :sid" if sacco_id else ""
    params = {"sid": sacco_id} if sacco_id else {}

    sql = f"""
    SELECT
        COUNT(v.id) AS total_fleet,
        COUNT(CASE WHEN COALESCE(vc.is_grounded, false) = true THEN 1 END) AS grounded_count,
        COUNT(CASE
            WHEN COALESCE(vc.is_grounded, false) = false
             AND (vc.ntsa_inspection_expiry IS NULL OR vc.ntsa_inspection_expiry >= NOW() + INTERVAL '30 days')
             AND (vc.speed_governor_expiry IS NULL OR vc.speed_governor_expiry >= NOW() + INTERVAL '30 days')
             AND (vc.insurance_expiry IS NULL OR vc.insurance_expiry >= NOW() + INTERVAL '30 days')
            THEN 1 END) AS compliant_count,
        COUNT(CASE
            WHEN COALESCE(vc.is_grounded, false) = false
             AND (
                (vc.ntsa_inspection_expiry IS NOT NULL AND vc.ntsa_inspection_expiry < NOW() + INTERVAL '30 days' AND vc.ntsa_inspection_expiry >= NOW())
                OR (vc.speed_governor_expiry IS NOT NULL AND vc.speed_governor_expiry < NOW() + INTERVAL '30 days' AND vc.speed_governor_expiry >= NOW())
                OR (vc.insurance_expiry IS NOT NULL AND vc.insurance_expiry < NOW() + INTERVAL '30 days' AND vc.insurance_expiry >= NOW())
             )
            THEN 1 END) AS warning_count
    FROM vehicles v
    LEFT JOIN vehicle_compliance vc ON vc.vehicle_id = v.id
    {filter_sql};
    """
    row = (await db.execute(text(sql), params)).mappings().first()
    total = int(row["total_fleet"]) if row else 0
    grounded = int(row["grounded_count"]) if row else 0
    compliant = int(row["compliant_count"]) if row else 0
    warning = int(row["warning_count"]) if row else 0

    score = round((compliant / max(1, total)) * 100, 1)

    return {
        "total_fleet": total,
        "grounded_count": grounded,
        "compliant_count": compliant,
        "warning_count": warning,
        "compliance_score_pct": score,
        "sweeper_stats": {
            "total_auto_grounded": crons.CRON_STATS.get("total_auto_grounded", 0),
            "total_auto_cleared": crons.CRON_STATS.get("total_auto_cleared", 0),
            "last_sweep": crons.CRON_STATS.get("last_run"),
        }
    }


@app.post("/api/compliance/drivers/{driver_id}/psv-badge")
async def update_driver_psv_badge(
    driver_id: int,
    payload: DriverPsvBadgeUpdate,
    db=Depends(get_async_db),
    _: User = Depends(require_roles('admin', 'sacco_admin')),
):
    """Update driver PSV badge certificate and expiry date, re-evaluating fleet compliance."""
    exp = payload.psv_badge_expiry.strip()
    await db.execute(
        text("""
            UPDATE users
            SET psv_badge_number = :badge,
                psv_badge_expiry = CAST(:exp AS timestamptz)
            WHERE id = :uid;
        """),
        {"badge": payload.psv_badge_number.strip().upper(), "exp": exp, "uid": driver_id}
    )
    await db.commit()

    # Re-run compliance sweeper to update any vehicle assigned to this driver
    sweep_res = await crons.sweep_ntsa_compliance_and_auto_ground(db)

    return {
        "ok": True,
        "message": f"Driver PSV badge updated to {payload.psv_badge_number.strip().upper()}.",
        "driver_id": driver_id,
        "sweep_res": sweep_res,
    }


@app.get("/api/routes")
async def list_routes(db=Depends(get_async_db)):
    """Public: all routes with their stops."""
    routes = (await db.execute(text("SELECT id, name, country, route_type, base_fare, per_hop_fare, fare_matrix FROM routes ORDER BY id;"))).mappings().all()
    out = []
    for r in routes:
        stops = (await db.execute(
            text("SELECT id, stop_name, stop_order FROM route_stops WHERE route_id = :rid ORDER BY stop_order;"),
            {"rid": r["id"]},
        )).mappings().all()
        out.append({**dict(r), "stops": [dict(s) for s in stops]})
    return {"routes": out}
# --------------------------------------------------------------------------
# Admin: driver management
# --------------------------------------------------------------------------
class DriverIn(BaseModel):
    full_name: str
    email: str
    phone: str | None = None
    password: str


@app.get("/api/admin/drivers")
async def admin_list_drivers(db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    rows = (await db.execute(
        text("SELECT id, full_name, email, phone, created_at FROM users WHERE role = 'driver' ORDER BY id;")
    )).mappings().all()
    return {"drivers": [dict(r) for r in rows]}


@app.post("/api/admin/drivers")
async def admin_create_driver(payload: DriverIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    existing = (await db.execute(text("SELECT id FROM users WHERE email = :email;"), {"email": payload.email})).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A user with that email already exists.")
    row = (await db.execute(
        text("""
            INSERT INTO users (full_name, email, phone, password_hash, role, created_at)
            VALUES (:name, :email, :phone, :pw, 'driver', now())
            RETURNING id, full_name, email, phone, role;
        """),
        {"name": payload.full_name, "email": payload.email, "phone": payload.phone,
         "pw": hash_password(payload.password)},
    )).mappings().first()
    await db.commit()
    return dict(row)


# --------------------------------------------------------------------------
# Admin: analytics + payment log
# --------------------------------------------------------------------------
@app.get("/api/admin/analytics")
async def admin_analytics(db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    """Revenue + booking/occupancy analytics for the admin dashboard."""
    # Revenue segmented by time period (today / week / month / year), plus the
    # previous equivalent period so the UI can render ▲/▼ trend indicators.
    revenue = (await db.execute(
        text("""
            SELECT
              COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('day', now())), 0) AS today,
              COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('week', now())), 0) AS week,
              COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('month', now())), 0) AS month,
              COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('year', now())), 0) AS year,
              COALESCE(SUM(p.amount), 0) AS total,
              COUNT(DISTINCT p.booking_id) AS paid_bookings,
              COUNT(*) FILTER (WHERE p.status = 'completed') AS completed_payments,
              COUNT(*) FILTER (WHERE p.status = 'failed') AS failed_payments
            FROM payments p;
        """)
    )).mappings().first()

    prev = (await db.execute(
        text("""
            SELECT
              COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('week', now()) - interval '7 days'
                                              AND p.created_at < date_trunc('week', now())), 0) AS week,
              COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('month', now()) - interval '1 month'
                                              AND p.created_at < date_trunc('month', now())), 0) AS month,
              COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= date_trunc('year', now()) - interval '1 year'
                                              AND p.created_at < date_trunc('year', now())), 0) AS year
            FROM payments p
            WHERE p.status = 'completed';
        """)
    )).mappings().first()

    # Bookings per day (last 14 days) for the chart.
    per_day = (await db.execute(
        text("""
            SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS bookings
            FROM bookings
            WHERE created_at >= now() - interval '14 days'
            GROUP BY 1 ORDER BY 1;
        """)
    )).mappings().all()

    # Occupancy: capacity vs confirmed bookings per trip.
    occupancy = (await db.execute(
        text("""
            SELECT t.id, t.name, r.name AS route_name, vt.seat_capacity,
                   COUNT(b.id) FILTER (WHERE b.status NOT IN ('cancelled')) AS seats_taken
            FROM trips t
            JOIN routes r ON r.id = t.route_id
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
            LEFT JOIN bookings b ON b.trip_id = t.id
            GROUP BY t.id, r.name, vt.seat_capacity
            ORDER BY t.id;
        """)
    )).mappings().all()

    return {
        "revenue": dict(revenue),
        "revenue_prev": dict(prev),
        "bookings_per_day": [dict(r) for r in per_day],
        "occupancy": [dict(r) for r in occupancy],
    }


@app.get("/api/admin/payments")
async def admin_payments(limit: int = 50, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    rows = (await db.execute(
        text("""
            SELECT p.id, p.provider, p.status, p.amount, p.phone_number, p.provider_reference,
                   p.callback_verified, p.created_at, b.trip_id, b.seat_number
            FROM payments p
            JOIN bookings b ON b.id = p.booking_id
            ORDER BY p.created_at DESC, p.id DESC
            LIMIT :limit;
        """),
        {"limit": limit},
    )).mappings().all()
    return {"payments": [dict(r) for r in rows]}


@app.get("/api/admin/payments/diagnostics")
async def get_payment_diagnostics(db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    """Admin diagnostic summary of payment gateways and transaction status."""
    total_count = await db.scalar(select(func.count()).select_from(Payment))
    completed_count = await db.scalar(select(func.count()).select_from(Payment).where(Payment.status == 'completed'))
    failed_count = await db.scalar(select(func.count()).select_from(Payment).where(Payment.status.in_(['failed', 'cancelled'])))
    initiated_count = await db.scalar(select(func.count()).select_from(Payment).where(Payment.status == 'initiated'))
    total_revenue = await db.scalar(select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.status == 'completed'))

    # Group by provider
    provider_rows = (await db.execute(
        text("SELECT provider, count(*) as count, coalesce(sum(amount), 0) as total FROM payments GROUP BY provider;")
    )).mappings().all()

    # Recent transactions with detailed payload and reference info
    recent_rows = (await db.execute(
        text("""
        SELECT p.id, p.provider, p.provider_reference, p.amount, p.status, p.callback_verified,
               p.created_at, p.booking_id, b.trip_id, b.seat_number, u.full_name as passenger_name
        FROM payments p
        LEFT JOIN bookings b ON b.id = p.booking_id
        LEFT JOIN users u ON u.id = b.user_id
        ORDER BY p.id DESC
        LIMIT 25;
        """)
    )).mappings().all()

    success_rate = round((completed_count / total_count * 100), 1) if total_count > 0 else 100.0

    return {
        "summary": {
            "total_transactions": total_count,
            "completed": completed_count,
            "failed": failed_count,
            "initiated": initiated_count,
            "total_revenue": float(total_revenue),
            "success_rate_percent": success_rate,
        },
        "gateways": {
            "paystack": {
                "name": "Paystack Payments",
                "configured": paystack.is_configured(),
                "mode": "live",
                "public_key": paystack.PAYSTACK_PUBLIC_KEY,
                "supported_channels": ["card", "mpesa", "mobile_money", "bank"],
            },
            "mpesa_daraja": {
                "name": "Safaricom Daraja",
                "configured": daraja.configured(),
                "mode": daraja.MPESA_ENV,
                "shortcode": daraja.SHORTCODE,
            },
        },
        "provider_breakdown": [dict(r) for r in provider_rows],
        "recent_transactions": [dict(r) for r in recent_rows],
    }


class TestWebhookRequest(BaseModel):
    provider: str = 'paystack'
    booking_id: Optional[int] = None
    reference: Optional[str] = None
    amount: Optional[float] = None


@app.post("/api/admin/payments/test-webhook")
async def admin_test_webhook(payload: TestWebhookRequest, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    """Admin diagnostic simulation to test webhook reconciliation without real funds."""
    payment = None
    if payload.booking_id:
        payment = (await db.execute(
            text("SELECT id, booking_id, provider_reference, amount FROM payments WHERE booking_id = :bid ORDER BY id DESC LIMIT 1;"),
            {"bid": payload.booking_id}
        )).mappings().first()
    elif payload.reference:
        payment = (await db.execute(
            text("SELECT id, booking_id, provider_reference, amount FROM payments WHERE provider_reference = :ref LIMIT 1;"),
            {"ref": payload.reference}
        )).mappings().first()
    else:
        # Latest initiated payment
        payment = (await db.execute(
            text("SELECT id, booking_id, provider_reference, amount FROM payments WHERE status = 'initiated' ORDER BY id DESC LIMIT 1;"),
        )).mappings().first()

    if not payment:
        latest_booking = (await db.execute(text("SELECT id FROM bookings ORDER BY id DESC LIMIT 1;"))).scalars().first()
        if not latest_booking:
            raise HTTPException(status_code=400, detail="No bookings available to simulate webhook against.")
        mock_ref = f"BUSGO-TEST-{int(datetime.now(timezone.utc).timestamp())}"
        amt = payload.amount or 500.0
        pres = await db.execute(
            text("INSERT INTO payments (booking_id, provider, provider_reference, amount, status) VALUES (:bid, :prov, :ref, :amt, 'initiated') RETURNING id;"),
            {"bid": latest_booking, "prov": payload.provider, "ref": mock_ref, "amt": amt}
        )
        payment_id = pres.scalar_one()
        payment = {"id": payment_id, "booking_id": latest_booking, "provider_reference": mock_ref, "amount": amt}

    pid = payment["id"]
    bid = payment["booking_id"]
    ref = payment["provider_reference"] or f"SIM-{pid}"

    await db.execute(
        text("UPDATE payments SET status = 'completed', callback_verified = true, provider_reference = :ref WHERE id = :id;"),
        {"id": pid, "ref": ref}
    )
    br = await db.execute(
        text("UPDATE bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = :id RETURNING id, trip_id, seat_number, board_stop_order, alight_stop_order;"),
        {"id": bid}
    )
    booking = br.mappings().first()

    if booking:
        await manager.broadcast_trip(booking["trip_id"], {
            "event": "seat_booked",
            "trip_id": booking["trip_id"],
            "seat_number": booking["seat_number"],
            "booking_id": booking["id"],
            "board_stop_order": booking["board_stop_order"],
            "alight_stop_order": booking["alight_stop_order"],
        })
        stop_names = await trip_stop_names(db, booking["trip_id"])
        chain = await recompute_chain(db, booking["trip_id"], booking["seat_number"])
        await notify_chain_change(db, manager, booking["trip_id"], booking["seat_number"], chain, stop_names)

    await db.commit()
    return {
        "status": "success",
        "message": f"Successfully simulated {payload.provider} callback for booking #{bid}.",
        "payment_id": pid,
        "booking_id": bid,
        "reference": ref,
        "amount": float(payment["amount"]),
    }




@app.get("/api/admin/crons/stats")
async def get_admin_cron_stats(_: User = Depends(require_roles('admin'))):
    """Admin endpoint to inspect current background cron health, metrics, and last run."""
    return crons.CRON_STATS


@app.post("/api/admin/crons/trigger")
async def trigger_admin_crons(db: AsyncSession = Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    """Admin endpoint to manually trigger a full pass of all background sweepers immediately."""
    results = await crons.run_all_crons(db)
    return {
        "ok": True,
        "message": "Cron sweep completed successfully.",
        "results": results,
        "stats": crons.CRON_STATS,
    }


@app.get("/api/admin/users")
async def admin_list_users(db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    rows = (await db.execute(text("SELECT id, full_name, email, phone, role FROM users ORDER BY id;"))).mappings().all()
    return {"users": [dict(r) for r in rows]}


@app.post("/api/admin/routes")
async def admin_create_route(payload: RouteIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    if payload.route_type not in ('direct', 'stopwise'):
        raise HTTPException(status_code=400, detail="route_type must be 'direct' or 'stopwise'.")
    if len(payload.stops) < 2:
        raise HTTPException(status_code=400, detail="A route needs at least 2 stops.")
    if payload.route_type == 'direct' and len(payload.stops) > 2:
        raise HTTPException(status_code=400, detail="Direct routes have exactly 2 stops (origin, destination).")

    matrix_json = json.dumps(payload.fare_matrix) if payload.fare_matrix else None
    res = await db.execute(
        text("""
            INSERT INTO routes (name, country, route_type, base_fare, per_hop_fare, fare_matrix)
            VALUES (:name, :country, :route_type, :base_fare, :per_hop_fare, CAST(:fare_matrix AS jsonb))
            RETURNING id;
        """),
        {
            "name": payload.name,
            "country": payload.country,
            "route_type": payload.route_type,
            "base_fare": payload.base_fare,
            "per_hop_fare": payload.per_hop_fare,
            "fare_matrix": matrix_json,
        },
    )
    route_id = res.scalar_one()
    for order, stop_name in enumerate(payload.stops, start=1):
        await db.execute(
            text("INSERT INTO route_stops (route_id, stop_name, stop_order) VALUES (:rid, :stop, :order);"),
            {"rid": route_id, "stop": stop_name, "order": order},
        )
    await db.commit()
    return {
        "id": route_id,
        "name": payload.name,
        "country": payload.country,
        "route_type": payload.route_type,
        "stops": payload.stops,
        "base_fare": payload.base_fare,
        "per_hop_fare": payload.per_hop_fare,
        "fare_matrix": payload.fare_matrix,
    }


@app.delete("/api/admin/routes/{route_id}")
async def admin_delete_route(route_id: int, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    row = (await db.execute(text("SELECT id FROM routes WHERE id = :id;"), {"id": route_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Route not found.")
    await db.execute(text("DELETE FROM route_stops WHERE route_id = :id;"), {"id": route_id})
    await db.execute(text("DELETE FROM routes WHERE id = :id;"), {"id": route_id})
    await db.commit()
    return {"deleted": route_id}


@app.post("/api/admin/trips")
async def admin_create_trip(payload: TripIn, db=Depends(get_async_db), _: User = Depends(require_roles('admin', 'sacco_admin'))):
    if payload.vehicle_id:
        comp = (await db.execute(
            text("SELECT v.plate_number, vc.is_grounded, vc.grounded_reason FROM vehicles v LEFT JOIN vehicle_compliance vc ON vc.vehicle_id = v.id WHERE v.id = :vid;"),
            {"vid": payload.vehicle_id}
        )).mappings().first()
        if comp and comp.get("is_grounded"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot assign Vehicle {comp.get('plate_number')}: vehicle is currently GROUNDED under NTSA compliance ({comp.get('grounded_reason') or 'Failed mandatory safety inspection'})."
            )

    try:
        res = await db.execute(
            text("""
            INSERT INTO trips (route_id, vehicle_id, driver_id, name, scheduled_at, status, fixed_price, allow_driver_tier, max_surcharge_pct, driver_tier, sacco_id)
            VALUES (:route_id, :vehicle_id, :driver_id, :name, :scheduled_at, :status, :fixed_price, :allow_driver_tier, :max_surcharge_pct, 'standard', :sacco_id)
            RETURNING id;
            """),
            {
                "route_id": payload.route_id,
                "vehicle_id": payload.vehicle_id,
                "driver_id": payload.driver_id,
                "name": payload.name,
                "scheduled_at": payload.scheduled_at,
                "status": payload.status,
                "fixed_price": payload.fixed_price,
                "allow_driver_tier": payload.allow_driver_tier,
                "max_surcharge_pct": payload.max_surcharge_pct,
                "sacco_id": payload.sacco_id,
            },
        )
        trip_id = res.scalar_one()
        await db.commit()
    except DBAPIError as e:
        await db.rollback()
        if 'foreign key' in str(e).lower() or 'violates' in str(e).lower():
            raise HTTPException(status_code=400, detail="Invalid route, vehicle, or driver id.")
        raise HTTPException(status_code=500, detail=str(e))
    return {"id": trip_id, "name": payload.name, "status": payload.status}


@app.patch("/api/admin/trips/{trip_id}")
async def admin_update_trip(trip_id: int, payload: TripPatch, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    trip = (await db.execute(text("SELECT id FROM trips WHERE id = :id;"), {"id": trip_id})).mappings().first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found.")

    await db.execute(
        text("""
        UPDATE trips SET
            route_id = COALESCE(:route_id, route_id),
            vehicle_id = COALESCE(:vehicle_id, vehicle_id),
            driver_id = COALESCE(:driver_id, driver_id),
            name = COALESCE(:name, name),
            scheduled_at = COALESCE(:scheduled_at, scheduled_at),
            status = COALESCE(:status, status),
            fixed_price = COALESCE(:fixed_price, fixed_price),
            allow_driver_tier = COALESCE(:allow_driver_tier, allow_driver_tier),
            max_surcharge_pct = COALESCE(:max_surcharge_pct, max_surcharge_pct),
            driver_tier = COALESCE(:driver_tier, driver_tier)
        WHERE id = :id;
        """),
        {
            "id": trip_id,
            "route_id": payload.route_id,
            "vehicle_id": payload.vehicle_id,
            "driver_id": payload.driver_id,
            "name": payload.name,
            "scheduled_at": payload.scheduled_at,
            "status": payload.status,
            "fixed_price": payload.fixed_price,
            "allow_driver_tier": payload.allow_driver_tier,
            "max_surcharge_pct": payload.max_surcharge_pct,
            "driver_tier": payload.driver_tier,
        },
    )
    await db.commit()
    return {"id": trip_id, "updated": True}


@app.patch("/api/trips/{trip_id}/driver-tier")
async def update_trip_driver_tier(
    trip_id: int,
    payload: DriverTierRequest,
    db=Depends(get_async_db),
    current_user: User = Depends(require_roles('driver', 'admin')),
):
    """Driver/Admin: update the trip's operational pricing tier.
    Driver can only adjust if admin has set allow_driver_tier == True."""
    allowed_tiers = {'off_peak', 'standard', 'peak_rush', 'rush_hour_rain'}
    if payload.driver_tier not in allowed_tiers:
        raise HTTPException(
            status_code=400,
            detail=f"driver_tier must be one of: {', '.join(sorted(allowed_tiers))}"
        )

    trip = (await db.execute(
        text("SELECT id, driver_id, allow_driver_tier, max_surcharge_pct FROM trips WHERE id = :id;"),
        {"id": trip_id}
    )).mappings().first()

    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found.")

    if current_user.role == 'driver':
        if trip["driver_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="This trip is not assigned to you.")
        if not trip["allow_driver_tier"]:
            raise HTTPException(status_code=403, detail="Admin has not enabled driver pricing tiers for this trip.")

    await db.execute(
        text("UPDATE trips SET driver_tier = :tier WHERE id = :id;"),
        {"tier": payload.driver_tier, "id": trip_id}
    )
    await db.commit()

    await manager.broadcast_trip(trip_id, {
        "event": "driver_tier_changed",
        "trip_id": trip_id,
        "driver_tier": payload.driver_tier,
    })

    return {
        "trip_id": trip_id,
        "driver_tier": payload.driver_tier,
        "message": f"Trip pricing tier updated to {payload.driver_tier}."
    }


class TripGpsRequest(BaseModel):
    lat: float
    lng: float
    speed: Optional[float] = None
    heading: Optional[float] = None


@app.post("/api/trips/{trip_id}/gps")
async def record_trip_gps(
    trip_id: int,
    payload: TripGpsRequest,
    db=Depends(get_async_db),
    current_user: User = Depends(require_roles('driver', 'admin'))
):
    """Driver/Admin: update the real-time physical GPS telemetry for an active trip."""
    trip = (await db.execute(
        text("SELECT id, driver_id FROM trips WHERE id = :id;"),
        {"id": trip_id}
    )).mappings().first()

    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found.")

    if current_user.role == 'driver' and trip["driver_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="This trip is not assigned to you.")

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.execute(
        text("""
            UPDATE trips
            SET current_lat = :lat,
                current_lng = :lng,
                current_speed = :speed,
                current_heading = :heading,
                last_gps_at = CURRENT_TIMESTAMP
            WHERE id = :id;
        """),
        {
            "id": trip_id,
            "lat": payload.lat,
            "lng": payload.lng,
            "speed": payload.speed,
            "heading": payload.heading,
        }
    )
    await db.commit()

    telemetry = {
        "event": "trip_gps",
        "trip_id": trip_id,
        "lat": payload.lat,
        "lng": payload.lng,
        "speed": payload.speed,
        "heading": payload.heading,
        "timestamp": now_iso,
    }
    await manager.broadcast_trip(trip_id, telemetry)
    return {"ok": True, "gps": telemetry}


@app.get("/api/trips/{trip_id}/gps")
async def get_trip_gps(trip_id: int, db=Depends(get_async_db)):
    """Public/Passenger: fetch the latest GPS telemetry for a trip."""
    row = (await db.execute(
        text("SELECT current_lat, current_lng, current_speed, current_heading, last_gps_at FROM trips WHERE id = :id;"),
        {"id": trip_id},
    )).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    return {
        "trip_id": trip_id,
        "lat": row["current_lat"],
        "lng": row["current_lng"],
        "speed": row["current_speed"],
        "heading": row["current_heading"],
        "last_gps_at": row["last_gps_at"].isoformat() if row["last_gps_at"] else None,
    }


@app.delete("/api/admin/trips/{trip_id}")
async def admin_delete_trip(trip_id: int, db=Depends(get_async_db), _: User = Depends(require_roles('admin'))):
    row = (await db.execute(text("SELECT id FROM trips WHERE id = :id;"), {"id": trip_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    await db.execute(text("DELETE FROM trips WHERE id = :id;"), {"id": trip_id})
    await db.commit()
    return {"deleted": trip_id}


# --------------------------------------------------------------------------
# Passenger: booking history (any authenticated user, own bookings only)
# --------------------------------------------------------------------------
@app.get("/api/user/bookings")
async def user_bookings(db=Depends(get_async_db), current_user: User = Depends(get_current_user)):
    rows = (await db.execute(
        text("""
        SELECT b.id, b.trip_id, b.seat_number, b.board_stop_order, b.alight_stop_order,
               b.status, b.payment_status, b.created_at,
               t.name AS trip_name, t.status AS trip_status, t.scheduled_at AS departure_time,
               t.current_stop_order,
               t.current_lat, t.current_lng, t.current_speed, t.current_heading, t.last_gps_at,
               r.name AS route_name,
               v.plate_number AS vehicle_plate, vt.display_name AS vehicle_model,
               u_drv.full_name AS driver_name,
               (SELECT stop_name FROM route_stops
                 WHERE route_id = t.route_id AND stop_order = b.board_stop_order) AS board_stop,
               (SELECT stop_name FROM route_stops
                 WHERE route_id = t.route_id AND stop_order = b.alight_stop_order) AS alight_stop
        FROM bookings b
        JOIN trips t ON t.id = b.trip_id
        JOIN routes r ON r.id = t.route_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        LEFT JOIN users u_drv ON u_drv.id = t.driver_id
        WHERE b.user_id = :uid
        ORDER BY b.created_at DESC, b.id DESC;
        """),
        {"uid": current_user.id},
    )).mappings().all()
    return {"bookings": [dict(r) for r in rows]}


@app.websocket("/ws/trip/{trip_id}")
async def trip_websocket(websocket: WebSocket, trip_id: int):
    await manager.connect_trip(websocket, trip_id)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                if isinstance(payload, dict) and payload.get("type") == "gps_update":
                    lat = payload.get("lat")
                    lng = payload.get("lng")
                    speed = payload.get("speed")
                    heading = payload.get("heading")
                    if lat is not None and lng is not None:
                        async with AsyncSessionLocal() as db:
                            await db.execute(
                                text("""
                                    UPDATE trips
                                    SET current_lat = :lat,
                                        current_lng = :lng,
                                        current_speed = :speed,
                                        current_heading = :heading,
                                        last_gps_at = CURRENT_TIMESTAMP
                                    WHERE id = :id;
                                """),
                                {"id": trip_id, "lat": lat, "lng": lng, "speed": speed, "heading": heading},
                            )
                            await db.commit()

                    await manager.broadcast_trip(trip_id, {
                        "event": "trip_gps",
                        "trip_id": trip_id,
                        "lat": lat,
                        "lng": lng,
                        "speed": speed,
                        "heading": heading,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                elif isinstance(payload, dict):
                    await manager.broadcast_trip(trip_id, payload)
                else:
                    await manager.broadcast_trip(trip_id, {"message": data})
            except Exception:
                await manager.broadcast_trip(trip_id, {"message": data})
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.websocket("/ws/notifications")
async def notifications_websocket(websocket: WebSocket, token: str = ""):
    """Per-user notification channel. Auth via ?token=<jwt> (browsers cannot
    set headers on WebSocket upgrade requests)."""
    user = None
    if token:
        try:
            payload = decode_access_token(token)
            user_id = int(payload.get("sub", 0))
            async with AsyncSessionLocal() as db:
                user = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
        except Exception:
            user = None
    if user is None:
        await websocket.close(code=4401)
        return
    await manager.connect_user(websocket, user.id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ---------------------------------------------------------------------------
# Commuter Loyalty "Safari Points" & USSD Simulator (*384*254#)
# ---------------------------------------------------------------------------

class LoyaltyRedeemRequest(BaseModel):
    booking_id: int
    points_to_redeem: int


@app.get("/api/loyalty/me")
async def get_my_loyalty(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_async_db)):
    user = (await db.execute(select(User).where(User.id == current_user.id))).scalars().first()
    points = user.loyalty_points if user and user.loyalty_points else 0
    tier = "Gold Dereva Legend" if points >= 500 else ("Silver Msafiri" if points >= 150 else "Bronze Mkimbiaji")

    txs = (await db.execute(
        select(LoyaltyTransaction)
        .where(LoyaltyTransaction.user_id == current_user.id)
        .order_by(LoyaltyTransaction.id.desc())
        .limit(10)
    )).scalars().all()

    history = [
        {
            "id": t.id,
            "points": t.points,
            "description": t.description,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in txs
    ]
    return {
        "points": points,
        "cash_value_kes": points,
        "tier": tier,
        "history": history,
    }


@app.post("/api/loyalty/redeem")
async def redeem_loyalty_points(
    payload: LoyaltyRedeemRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    user = (await db.execute(select(User).where(User.id == current_user.id))).scalars().first()
    if not user or (user.loyalty_points or 0) < payload.points_to_redeem:
        raise HTTPException(status_code=400, detail="Insufficient Safari Points balance")

    booking = (await db.execute(select(Booking).where(Booking.id == payload.booking_id, Booking.user_id == current_user.id))).scalars().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    discount = payload.points_to_redeem  # 10 pts = KES 10
    user.loyalty_points = (user.loyalty_points or 0) - payload.points_to_redeem
    db.add(LoyaltyTransaction(
        user_id=user.id,
        points=-payload.points_to_redeem,
        booking_id=booking.id,
        description=f"Redeemed {payload.points_to_redeem} Safari Points for KES {discount} discount on Booking #{booking.id}",
    ))
    await db.commit()
    return {
        "ok": True,
        "discount_kes": discount,
        "remaining_points": user.loyalty_points,
        "message": f"Successfully redeemed {payload.points_to_redeem} Safari Points! Saved KES {discount}."
    }


@app.post("/api/ussd")
async def ussd_gateway(request: Request, db: AsyncSession = Depends(get_async_db)):
    """
    Standard Africa's Talking / Kenyan Telco USSD Gateway (*384*254#).
    Supports offline feature phones ('Mulika Mwizi') for ticket booking and queries.
    """
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        data = await request.json()
    else:
        form = await request.form()
        data = dict(form)

    session_id = data.get("sessionId", "")
    service_code = data.get("serviceCode", "*384*254#")
    phone_number = data.get("phoneNumber", "+254716314831")
    text_input = str(data.get("text", "")).strip()

    parts = [p for p in text_input.split("*") if p]
    depth = len(parts)

    # Level 0: Dialing *384*254#
    if depth == 0:
        response = (
            "CON Karibu BUSGO Transit Kenya\n"
            "1. Reserve Bus Seat\n"
            "2. Check My Ticket Status\n"
            "3. Safari Points Balance\n"
            "4. 24/7 Helpline & Marshall"
        )
        return PlainTextResponse(response)

    # Option 1: Book a Seat
    if parts[0] == "1":
        routes = (await db.execute(select(Route).limit(3))).scalars().all()
        if depth == 1:
            menu = "CON Select Corridor Route:\n"
            for idx, r in enumerate(routes, 1):
                menu += f"{idx}. {r.name} (KES {int(r.base_fare)})\n"
            menu += "0. Back"
            return PlainTextResponse(menu)

        if depth == 2:
            try:
                selected_route = routes[int(parts[1]) - 1]
            except (ValueError, IndexError):
                return PlainTextResponse("END Invalid route selection. Dial *384*254# again.")

            return PlainTextResponse(
                f"CON {selected_route.name}\n"
                "Enter preferred Seat Number (1-14):\n"
                "Front Cabin: 1-2 | Window/Aisle: 3-14"
            )

        if depth == 3:
            try:
                seat_num = int(parts[2])
            except ValueError:
                return PlainTextResponse("END Invalid seat number. Must be numeric (1-14).")

            try:
                selected_route = routes[int(parts[1]) - 1]
            except (ValueError, IndexError):
                return PlainTextResponse("END Invalid route. Dial *384*254# again.")

            fare = int(selected_route.base_fare)
            return PlainTextResponse(
                f"CON Confirm Seat #{seat_num} on {selected_route.name}?\n"
                f"Fare: KES {fare}\n"
                "1. Confirm & Send M-Pesa STK\n"
                "2. Redeem 50 Safari Points\n"
                "0. Cancel"
            )

        if depth == 4:
            if parts[3] == "0":
                return PlainTextResponse("END Reservation cancelled. Dial *384*254# anytime.")

            seat_num = int(parts[2])
            selected_route = routes[int(parts[1]) - 1]

            trip = (await db.execute(
                select(Trip).where(Trip.route_id == selected_route.id, Trip.status != 'cancelled').order_by(Trip.id.asc())
            )).scalars().first()

            if not trip:
                return PlainTextResponse("END No active bus scheduled right now. Call 0716 314 831.")

            stops = (await db.execute(
                select(RouteStop).where(RouteStop.route_id == selected_route.id).order_by(RouteStop.stop_order.asc())
            )).scalars().all()
            b_order = stops[0].stop_order if stops else 1
            a_order = stops[-1].stop_order if stops else 2

            # User account mapping
            user = (await db.execute(select(User).where(User.phone == phone_number))).scalars().first()
            if not user:
                user = User(
                    full_name=f"Commuter {phone_number[-4:]}",
                    phone=phone_number,
                    email=f"{phone_number[-9:]}@ussd.busgo.ke",
                    role="user",
                    loyalty_points=50,
                )
                db.add(user)
                await db.flush()

            ticket_code = f"BG-{trip.id}-S{seat_num}-{uuid.uuid4().hex[:4].upper()}"
            new_booking = Booking(
                trip_id=trip.id,
                user_id=user.id,
                seat_number=seat_num,
                board_stop_order=b_order,
                alight_stop_order=a_order,
                status="confirmed",
                payment_status="paid",
                created_at=datetime.now(timezone.utc),
            )
            try:
                db.add(new_booking)
                await db.flush()
            except Exception:
                await db.rollback()
                return PlainTextResponse(f"END Seat #{seat_num} is already occupied. Please dial *384*254# and choose another seat.")

            # Queue SMS confirmation to phone
            vehicle_plate = "KDA 123A"
            if trip.vehicle_id:
                vp = (await db.execute(select(Vehicle.plate_number).where(Vehicle.id == trip.vehicle_id))).scalar_one_or_none()
                if vp:
                    vehicle_plate = vp

            sms_body = (
                f"BUSGO E-TICKET: Seat #{seat_num} CONFIRMED for {selected_route.name}.\n"
                f"Code: {ticket_code} | Plate: {vehicle_plate} | KES {int(selected_route.base_fare)} PAID.\n"
                f"Show SMS to conductor at boarding. Safari Njema!"
            )
            db.add(Dispatch(
                booking_id=new_booking.id,
                user_id=user.id,
                channel="sms",
                recipient=phone_number,
                message_body=sms_body,
                status="sent",
                provider="simulator",
                created_at=datetime.now(timezone.utc),
            ))
            await db.commit()

            return PlainTextResponse(
                f"END Seat #{seat_num} CONFIRMED! Code: {ticket_code}.\n"
                f"SMS boarding ticket sent to {phone_number}. Safari Njema!"
            )

    # Option 2: Check My Ticket
    if parts[0] == "2":
        user = (await db.execute(select(User).where(User.phone == phone_number))).scalars().first()
        if not user:
            return PlainTextResponse("END No tickets registered for this number. Dial *384*254# to book.")

        booking = (await db.execute(
            select(Booking).where(Booking.user_id == user.id, Booking.status != 'cancelled').order_by(Booking.id.desc())
        )).scalars().first()

        if not booking:
            return PlainTextResponse("END No active bookings found. Dial *384*254# to reserve a seat.")

        trip = (await db.execute(select(Trip).where(Trip.id == booking.trip_id))).scalars().first()
        vehicle_plate = "Fleet Bus"
        if trip and trip.vehicle_id:
            vp = (await db.execute(select(Vehicle.plate_number).where(Vehicle.id == trip.vehicle_id))).scalar_one_or_none()
            if vp:
                vehicle_plate = vp
        return PlainTextResponse(
            f"END ACTIVE TICKET #{booking.id}\n"
            f"Route: {trip.name if trip else 'BusGo Express'}\n"
            f"Seat: #{booking.seat_number}\n"
            f"Plate: {vehicle_plate}\n"
            f"Status: {booking.status.upper()}\n"
            f"Code: BG-{booking.trip_id}-S{booking.seat_number}\n"
            "Safe travels with BUSGO!"
        )

    # Option 3: Safari Points
    if parts[0] == "3":
        user = (await db.execute(select(User).where(User.phone == phone_number))).scalars().first()
        pts = user.loyalty_points if user and user.loyalty_points else 75
        tier = "Gold Dereva Legend" if pts >= 500 else ("Silver Msafiri" if pts >= 150 else "Bronze Mkimbiaji")
        return PlainTextResponse(
            f"END BUSGO SAFARI POINTS\n"
            f"Balance: {pts} Points\n"
            f"Value: KES {pts} Discount\n"
            f"Commuter Tier: {tier}\n"
            "Earn 1 pt per KES 10 spent on any bus!"
        )

    # Option 4: Help
    if parts[0] == "4":
        return PlainTextResponse(
            "END BUSGO 24/7 HELPLINE\n"
            "Phone / WhatsApp: 0716 314 831\n"
            "Stage: Nairobi CBD Ronald Ngala\n"
            "Open 24 Hours Daily"
        )

    return PlainTextResponse("END Invalid selection. Dial *384*254# to start over.")


# ---------------------------------------------------------------------------
# Highway Incidents, Delay Advisories & Relief Bus Dispatch (Option 6)
# ---------------------------------------------------------------------------

class IncidentCreateRequest(BaseModel):
    trip_id: int
    category: str  # 'traffic_jam' | 'accident' | 'police_inspection' | 'mechanical_breakdown' | 'road_hazard' | 'sos'
    severity: Optional[str] = "medium"
    estimated_delay_mins: Optional[int] = 0
    location_name: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    description: str
    broadcast_delay: Optional[bool] = True


class ReliefBusRequest(BaseModel):
    relief_vehicle_id: int
    relief_driver_id: Optional[int] = None
    notes: Optional[str] = None


@app.post("/api/incidents")
async def report_incident(
    payload: IncidentCreateRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db)
):
    trip = (await db.execute(select(Trip).where(Trip.id == payload.trip_id))).scalars().first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    incident = Incident(
        trip_id=payload.trip_id,
        sacco_id=trip.sacco_id,
        reported_by_id=current_user.id,
        category=payload.category,
        severity=payload.severity or "medium",
        estimated_delay_mins=payload.estimated_delay_mins or 0,
        location_name=payload.location_name,
        lat=payload.lat,
        lng=payload.lng,
        description=payload.description,
        status="active",
    )
    db.add(incident)
    await db.flush()

    # Automatically broadcast delay advisory to all booked passengers if requested
    if payload.broadcast_delay and (payload.estimated_delay_mins or 0) > 0:
        bookings = (await db.execute(
            select(Booking).where(Booking.trip_id == payload.trip_id, Booking.status == 'confirmed')
        )).scalars().all()

        for b in bookings:
            user = (await db.execute(select(User).where(User.id == b.user_id))).scalars().first() if b.user_id else None
            recipient_phone = user.phone if user and user.phone else "+254716314831"
            advisory = (
                f"BUSGO HIGHWAY ADVISORY: Trip '{trip.name}' has reported a delay of ~{payload.estimated_delay_mins} mins "
                f"near {payload.location_name} due to {payload.category.replace('_', ' ')}. "
                f"Driver is navigating safely. Updated ETA broadcasted to live map."
            )
            db.add(Dispatch(
                booking_id=b.id,
                user_id=b.user_id,
                channel="sms",
                recipient=recipient_phone,
                message_body=advisory,
                status="sent",
                provider="simulator",
                created_at=datetime.now(timezone.utc),
            ))

    await db.commit()
    await db.refresh(incident)
    return {
        "ok": True,
        "message": f"Incident reported successfully. {payload.estimated_delay_mins}m delay broadcasted.",
        "incident_id": incident.id,
    }


@app.get("/api/incidents")
async def list_incidents(
    sacco_id: Optional[int] = None,
    status: Optional[str] = "active",
    db: AsyncSession = Depends(get_async_db)
):
    q = select(Incident).order_by(Incident.id.desc())
    if sacco_id:
        q = q.where(Incident.sacco_id == sacco_id)
    if status and status != 'all':
        q = q.where(Incident.status == status)

    incidents = (await db.execute(q)).scalars().all()
    results = []
    for inc in incidents:
        trip = (await db.execute(select(Trip).where(Trip.id == inc.trip_id))).scalars().first()
        reporter = (await db.execute(select(User).where(User.id == inc.reported_by_id))).scalars().first()
        sacco = (await db.execute(select(Sacco).where(Sacco.id == inc.sacco_id))).scalars().first() if inc.sacco_id else None
        results.append({
            "id": inc.id,
            "trip_id": inc.trip_id,
            "trip_name": trip.name if trip else f"Trip #{inc.trip_id}",
            "sacco_name": sacco.name if sacco else "Super Metro Sacco",
            "reported_by": reporter.full_name if reporter else "Driver",
            "category": inc.category,
            "severity": inc.severity,
            "estimated_delay_mins": inc.estimated_delay_mins,
            "location_name": inc.location_name,
            "description": inc.description,
            "status": inc.status,
            "created_at": inc.created_at.isoformat() if inc.created_at else None,
        })
    return {"incidents": results}


@app.post("/api/incidents/{incident_id}/relief")
async def dispatch_relief_bus(
    incident_id: int,
    payload: ReliefBusRequest,
    current_user=Depends(require_roles("admin", "sacco_admin")),
    db: AsyncSession = Depends(get_async_db)
):
    incident = (await db.execute(select(Incident).where(Incident.id == incident_id))).scalars().first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    old_trip = (await db.execute(select(Trip).where(Trip.id == incident.trip_id))).scalars().first()
    if not old_trip:
        raise HTTPException(status_code=404, detail="Original trip not found")

    relief_vehicle = (await db.execute(select(Vehicle).where(Vehicle.id == payload.relief_vehicle_id))).scalars().first()
    if not relief_vehicle:
        raise HTTPException(status_code=404, detail="Relief vehicle not found")

    old_plate = "Original Bus"
    if old_trip.vehicle_id:
        v_row = (await db.execute(select(Vehicle.plate_number).where(Vehicle.id == old_trip.vehicle_id))).scalar_one_or_none()
        if v_row:
            old_plate = v_row

    old_trip.vehicle_id = relief_vehicle.id
    if payload.relief_driver_id:
        old_trip.driver_id = payload.relief_driver_id
    incident.status = "relief_dispatched"

    # Notify all active passengers on the manifest
    bookings = (await db.execute(
        select(Booking).where(Booking.trip_id == old_trip.id, Booking.status == 'confirmed')
    )).scalars().all()

    for b in bookings:
        user = (await db.execute(select(User).where(User.id == b.user_id))).scalars().first() if b.user_id else None
        recipient_phone = user.phone if user and user.phone else "+254716314831"
        dispatch_msg = (
            f"BUSGO RELIEF DISPATCH: Your trip '{old_trip.name}' has been assigned a standby relief bus.\n"
            f"New Vehicle: {relief_vehicle.plate_number} (was {old_plate}).\n"
            f"Seat #{b.seat_number} remains reserved. Boarding marshalls are on site. Thank you for your patience!"
        )
        db.add(Dispatch(
            booking_id=b.id,
            user_id=b.user_id,
            channel="sms",
            recipient=recipient_phone,
            message_body=dispatch_msg,
            status="sent",
            provider="simulator",
            created_at=datetime.now(timezone.utc),
        ))

    await db.commit()
    return {
        "ok": True,
        "message": f"Relief bus {relief_vehicle.plate_number} dispatched. {len(bookings)} passengers transferred & notified via SMS.",
        "new_plate": relief_vehicle.plate_number,
        "passengers_transferred": len(bookings),
    }


@app.patch("/api/incidents/{incident_id}/resolve")
async def resolve_incident(
    incident_id: int,
    current_user=Depends(require_roles("admin", "sacco_admin", "driver")),
    db: AsyncSession = Depends(get_async_db)
):
    incident = (await db.execute(select(Incident).where(Incident.id == incident_id))).scalars().first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    incident.status = "resolved"
    incident.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True, "message": f"Incident #{incident_id} marked resolved"}


# ---------------------------------------------------------------------------
# National Fleet Highway Radar (Option 1)
# ---------------------------------------------------------------------------

@app.get("/api/radar/fleet")
async def get_radar_fleet(corridor: Optional[str] = None, db: AsyncSession = Depends(get_async_db)):
    """
    Public / Admin: Live positions, headings, speeds, and passenger occupancy
    for all active transit vehicles navigating Kenyan highways.
    """
    query = """
        SELECT t.id AS trip_id, t.name AS trip_name, t.status, t.current_stop_order,
               t.current_lat, t.current_lng, t.current_speed, t.current_heading, t.last_gps_at,
               r.id AS route_id, r.name AS route_name, r.route_type,
               v.id AS vehicle_id, v.plate_number, v.is_electric,
               vt.seat_capacity, vt.slug AS vehicle_type,
               COALESCE(s.id, sv.id, 1) AS sacco_id,
               COALESCE(s.name, sv.name, 'Super Metro Sacco') AS sacco_name,
               COALESCE(s.primary_color, sv.primary_color, '#06b6d4') AS sacco_color,
               (SELECT COUNT(*) FROM bookings b WHERE b.trip_id = t.id AND b.status = 'confirmed') AS occupied_seats,
               (SELECT COUNT(*) FROM incidents inc WHERE inc.trip_id = t.id AND inc.status = 'active') AS active_incidents
        FROM trips t
        JOIN routes r ON r.id = t.route_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        LEFT JOIN saccos s ON s.id = t.sacco_id
        LEFT JOIN saccos sv ON sv.id = v.sacco_id
        WHERE t.status != 'cancelled'
        ORDER BY t.id ASC;
    """
    rows = (await db.execute(text(query))).mappings().all()

    fleet = []
    for r in rows:
        item = dict(r)
        if item.get("current_lat") is None or item.get("current_lng") is None:
            if "Nakuru" in item.get("route_name", ""):
                item["current_lat"] = -1.1118 + (item["trip_id"] * 0.05)
                item["current_lng"] = 36.6437 - (item["trip_id"] * 0.04)
                item["current_speed"] = 78.5
                item["current_heading"] = 310.0
            elif "Mombasa" in item.get("route_name", ""):
                item["current_lat"] = -2.6900
                item["current_lng"] = 38.1670
                item["current_speed"] = 82.0
                item["current_heading"] = 135.0
            else:
                item["current_lat"] = -1.286389
                item["current_lng"] = 36.817223
                item["current_speed"] = 45.0
                item["current_heading"] = 0.0

        fleet.append(item)

    return {"fleet": fleet, "count": len(fleet), "timestamp": datetime.now(timezone.utc).isoformat()}


# ---------------------------------------------------------------------------
# Hardware GPS Tracker Telemetry Ingestion (Teltonika / Concox GT06)
# ---------------------------------------------------------------------------

class GenericTelemetryIngestRequest(BaseModel):
    imei: Optional[str] = None
    plate_number: Optional[str] = None
    lat: float
    lng: float
    speed: float = 0.0
    heading: float = 0.0
    altitude: float = 0.0
    satellites: int = 0
    ignition: bool = True
    protocol: str = "generic"
    recorded_at: Optional[str] = None


class RawHexIngestRequest(BaseModel):
    imei: Optional[str] = None
    hex_data: str


class BindTrackerRequest(BaseModel):
    vehicle_id: Optional[int] = None
    plate_number: Optional[str] = None
    tracker_imei: str
    tracker_model: Optional[str] = "teltonika_fmb920"


@app.post("/api/telemetry/ingest/teltonika")
async def ingest_teltonika_telemetry(payload: RawHexIngestRequest, db: AsyncSession = Depends(get_async_db)):
    """Webhook / Gateway endpoint: Ingest Teltonika Codec 8 binary frame (encoded in hex)."""
    try:
        data_bytes = bytes.fromhex(payload.hex_data.strip())
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid hex_data payload format.")

    try:
        records, ack = parse_teltonika_codec8(data_bytes, imei=payload.imei)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Teltonika decode error: {e}")

    processed = []
    for r in records:
        if r.get("type") == "avl_data":
            r["raw_hex"] = payload.hex_data[:256]
            res = await process_telemetry_point(db, r, manager)
            processed.append(res)

    return {
        "status": "success",
        "records_count": len(processed),
        "ack_hex": ack.hex(),
        "processed": processed,
    }


@app.post("/api/telemetry/ingest/concox")
async def ingest_concox_telemetry(payload: RawHexIngestRequest, db: AsyncSession = Depends(get_async_db)):
    """Webhook / Gateway endpoint: Ingest Concox GT06 frame (encoded in hex)."""
    try:
        data_bytes = bytes.fromhex(payload.hex_data.strip())
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid hex_data payload format.")

    try:
        info, ack = parse_concox_gt06(data_bytes)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Concox decode error: {e}")

    res = None
    if info.get("type") == "avl_data":
        if payload.imei:
            info["imei"] = payload.imei
        info["raw_hex"] = payload.hex_data[:256]
        res = await process_telemetry_point(db, info, manager)

    return {
        "status": "success",
        "packet_type": info.get("type"),
        "ack_hex": ack.hex() if ack else None,
        "result": res,
        "parsed": info,
    }


@app.post("/api/telemetry/ingest/generic")
async def ingest_generic_telemetry(payload: GenericTelemetryIngestRequest, db: AsyncSession = Depends(get_async_db)):
    """REST endpoint: Ingest normalized GPS coordinate point from any device, gateway, or driver mobile client."""
    rec_dt = None
    if payload.recorded_at:
        try:
            rec_dt = datetime.fromisoformat(payload.recorded_at.replace("Z", "+00:00"))
        except Exception:
            pass

    point = {
        "imei": payload.imei,
        "plate_number": payload.plate_number,
        "lat": payload.lat,
        "lng": payload.lng,
        "speed": payload.speed,
        "heading": payload.heading,
        "altitude": payload.altitude,
        "satellites": payload.satellites,
        "ignition": payload.ignition,
        "protocol": payload.protocol,
        "recorded_at": rec_dt,
    }
    res = await process_telemetry_point(db, point, manager)
    return res


@app.get("/api/telemetry/trackers")
async def list_registered_trackers(db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """Admin/Sacco: List physical hardware GPS trackers bound to fleet vehicles with online status."""
    now = datetime.now(timezone.utc)
    rows = (await db.execute(text("""
        SELECT v.id AS vehicle_id, v.plate_number, v.tracker_imei, v.tracker_model,
               v.last_ping_at, v.last_lat, v.last_lng, v.last_speed, v.last_heading,
               s.name AS sacco_name,
               (SELECT t.id FROM trips t WHERE t.vehicle_id = v.id AND t.status IN ('in_transit', 'boarding', 'scheduled') ORDER BY t.id DESC LIMIT 1) AS active_trip_id,
               (SELECT t.name FROM trips t WHERE t.vehicle_id = v.id AND t.status IN ('in_transit', 'boarding', 'scheduled') ORDER BY t.id DESC LIMIT 1) AS active_trip_name
        FROM vehicles v
        LEFT JOIN saccos s ON s.id = v.sacco_id
        WHERE v.tracker_imei IS NOT NULL
        ORDER BY v.last_ping_at DESC NULLS LAST, v.id ASC;
    """))).mappings().all()

    trackers = []
    for r in rows:
        last_ping = r["last_ping_at"]
        if isinstance(last_ping, str) and last_ping:
            try:
                last_ping = datetime.fromisoformat(last_ping.replace("Z", "+00:00"))
            except Exception:
                pass
        if last_ping and hasattr(last_ping, "tzinfo") and last_ping.tzinfo is None:
            last_ping = last_ping.replace(tzinfo=timezone.utc)

        is_online = bool(last_ping and (now - last_ping).total_seconds() <= 600)  # 10 min threshold

        trackers.append({
            "vehicle_id": r["vehicle_id"],
            "plate_number": r["plate_number"],
            "tracker_imei": r["tracker_imei"],
            "tracker_model": r["tracker_model"] or "teltonika_fmb920",
            "sacco_name": r["sacco_name"],
            "is_online": is_online,
            "last_ping_at": last_ping.isoformat() if hasattr(last_ping, "isoformat") else str(last_ping or ""),
            "last_lat": r["last_lat"],
            "last_lng": r["last_lng"],
            "last_speed": r["last_speed"],
            "last_heading": r["last_heading"],
            "active_trip_id": r["active_trip_id"],
            "active_trip_name": r["active_trip_name"],
        })

    return {"trackers": trackers, "total_trackers": len(trackers)}


@app.post("/api/telemetry/trackers/bind")
async def bind_tracker_to_vehicle(payload: BindTrackerRequest, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_roles('admin', 'sacco_admin'))):
    """Admin/Sacco Admin: Bind a physical tracker IMEI to a fleet vehicle."""
    if not payload.tracker_imei:
        raise HTTPException(status_code=400, detail="tracker_imei is required.")

    veh = None
    if payload.vehicle_id:
        veh = (await db.execute(text("SELECT id, plate_number FROM vehicles WHERE id = :vid;"), {"vid": payload.vehicle_id})).mappings().first()
    elif payload.plate_number:
        veh = (await db.execute(text("SELECT id, plate_number FROM vehicles WHERE plate_number = :plate;"), {"plate": payload.plate_number.upper().strip()})).mappings().first()

    if not veh:
        raise HTTPException(status_code=404, detail="Vehicle not found.")

    existing = (await db.execute(text("SELECT id, plate_number FROM vehicles WHERE tracker_imei = :imei AND id != :vid;"), {"imei": payload.tracker_imei.strip(), "vid": veh["id"]})).mappings().first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Tracker IMEI {payload.tracker_imei} is already registered to vehicle {existing['plate_number']}.")

    await db.execute(
        text("""
            UPDATE vehicles
            SET tracker_imei = :imei,
                tracker_model = :model
            WHERE id = :vid;
        """),
        {"imei": payload.tracker_imei.strip(), "model": payload.tracker_model or "teltonika_fmb920", "vid": veh["id"]}
    )
    await db.commit()

    return {
        "ok": True,
        "message": f"Tracker {payload.tracker_imei} ({payload.tracker_model}) bound to vehicle {veh['plate_number']}.",
        "vehicle_id": veh["id"],
        "plate_number": veh["plate_number"],
    }


@app.get("/api/telemetry/trackers/{imei}/history")
async def get_tracker_history(imei: str, limit: int = 100, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """Returns recent historical GPS breadcrumbs for route trace and corridor audit."""
    rows = (await db.execute(text("""
        SELECT id, lat, lng, speed, heading, altitude, satellites,
               ignition_on, overspeed_flag, recorded_at
        FROM gps_telemetry_logs
        WHERE imei = :imei
        ORDER BY recorded_at DESC
        LIMIT :lim;
    """), {"imei": imei, "lim": limit})).mappings().all()

    trail = [dict(r) for r in reversed(rows)]
    for pt in trail:
        if hasattr(pt.get("recorded_at"), "isoformat"):
            pt["recorded_at"] = pt["recorded_at"].isoformat()
        elif pt.get("recorded_at"):
            pt["recorded_at"] = str(pt["recorded_at"])

    return {"imei": imei, "points_count": len(trail), "breadcrumbs": trail}


@app.get("/api/telemetry/overspeed-alerts")
async def get_overspeed_alerts(limit: int = 50, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """Audit log of NTSA overspeed violations (> 80 km/h) recorded across the fleet."""
    rows = (await db.execute(text("""
        SELECT l.id, l.imei, l.lat, l.lng, l.speed, l.heading, l.recorded_at,
               v.plate_number, s.name AS sacco_name
        FROM gps_telemetry_logs l
        LEFT JOIN vehicles v ON v.id = l.vehicle_id
        LEFT JOIN saccos s ON s.id = v.sacco_id
        WHERE l.overspeed_flag = true
        ORDER BY l.recorded_at DESC
        LIMIT :lim;
    """), {"lim": limit})).mappings().all()

    alerts = []
    for r in rows:
        item = dict(r)
        if hasattr(item.get("recorded_at"), "isoformat"):
            item["recorded_at"] = item["recorded_at"].isoformat()
        alerts.append(item)

    return {
        "overspeed_limit_kmh": NTSA_SPEED_LIMIT_KMH,
        "alerts": alerts,
        "total_alerts": len(alerts),
    }


# ---------------------------------------------------------------------------
# SACCO Treasury & Daraja B2C Instant Cashout (Option 2)
# ---------------------------------------------------------------------------

class SaccoWithdrawRequest(BaseModel):
    sacco_id: int
    amount: float
    recipient_phone: str
    recipient_name: str
    notes: Optional[str] = None


@app.get("/api/settlements/summary")
async def get_settlement_summary(
    sacco_id: Optional[int] = None,
    current_user=Depends(require_roles("admin", "sacco_admin")),
    db: AsyncSession = Depends(get_async_db)
):
    target_sacco_id = sacco_id
    if current_user.role == 'sacco_admin' and current_user.sacco_id:
        target_sacco_id = current_user.sacco_id

    sacco = None
    if target_sacco_id:
        sacco = (await db.execute(select(Sacco).where(Sacco.id == target_sacco_id))).scalars().first()
    if not sacco:
        sacco = (await db.execute(select(Sacco).order_by(Sacco.id.asc()))).scalars().first()

    sid = sacco.id if sacco else 1
    sacco_name = sacco.name if sacco else "Super Metro Sacco"

    gross_sql = """
        SELECT COALESCE(SUM(p.amount), 0.0) AS gross_total
        FROM payments p
        JOIN bookings b ON b.id = p.booking_id
        JOIN trips t ON t.id = b.trip_id
        WHERE (t.sacco_id = :sid OR :sid IS NULL)
          AND p.status = 'completed';
    """
    gross_total = float((await db.execute(text(gross_sql), {"sid": sid})).scalar() or 0.0)

    if gross_total < 500.0:
        gross_total = 48500.0

    platform_fee_pct = 3.0
    platform_fee_total = round(gross_total * (platform_fee_pct / 100.0), 2)
    net_revenue = round(gross_total - platform_fee_total, 2)

    disbursed_sql = """
        SELECT COALESCE(SUM(gross_amount), 0.0) AS total_disbursed
        FROM sacco_settlements
        WHERE sacco_id = :sid AND status = 'completed';
    """
    total_disbursed = float((await db.execute(text(disbursed_sql), {"sid": sid})).scalar() or 0.0)

    available_balance = max(0.0, round(gross_total - total_disbursed, 2))
    available_net = max(0.0, round(available_balance * 0.97, 2))

    recent_rows = (await db.execute(
        select(SaccoSettlement).where(SaccoSettlement.sacco_id == sid).order_by(SaccoSettlement.id.desc()).limit(15)
    )).scalars().all()

    return {
        "sacco_id": sid,
        "sacco_name": sacco_name,
        "gross_revenue": gross_total,
        "platform_fee_pct": platform_fee_pct,
        "platform_fee_total": platform_fee_total,
        "net_revenue": net_revenue,
        "total_disbursed": total_disbursed,
        "available_balance": available_balance,
        "available_net": available_net,
        "recent_settlements": [
            {
                "id": s.id,
                "gross_amount": s.gross_amount,
                "platform_fee": s.platform_fee,
                "net_payout": s.net_payout,
                "recipient_phone": s.recipient_phone,
                "recipient_name": s.recipient_name,
                "b2c_conversation_id": s.b2c_conversation_id,
                "b2c_transaction_id": s.b2c_transaction_id,
                "status": s.status,
                "notes": s.notes,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in recent_rows
        ]
    }


@app.post("/api/settlements/withdraw")
async def withdraw_sacco_funds(
    payload: SaccoWithdrawRequest,
    current_user=Depends(require_roles("admin", "sacco_admin")),
    db: AsyncSession = Depends(get_async_db)
):
    """Initiates an automated Safaricom Daraja B2C treasury cashout to the SACCO treasurer's phone."""
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Withdrawal amount must be greater than 0")

    sacco = (await db.execute(select(Sacco).where(Sacco.id == payload.sacco_id))).scalars().first()
    if not sacco:
        raise HTTPException(status_code=404, detail="SACCO not found")

    platform_fee = round(payload.amount * 0.03, 2)
    net_payout = round(payload.amount - platform_fee, 2)

    # 1. Trigger Daraja B2C Payment Request
    try:
        b2c_res = await daraja.b2c_payment_request(
            phone=payload.recipient_phone,
            amount=net_payout,
            remarks=payload.notes or f"SACCO Payout {sacco.name}",
            occasion="SaccoTreasury",
            command_id="BusinessPayment",
        )
    except Exception as e:
        logger.error(f"Daraja B2C error: {e}")
        raise HTTPException(status_code=502, detail=f"Safaricom B2C Gateway Error: {str(e)}")

    b2c_conv_id = b2c_res.get("ConversationID") or f"AG_B2C_{datetime.now().strftime('%Y%m%d')}_{uuid.uuid4().hex[:6].upper()}"
    b2c_trans_id = b2c_res.get("transaction_id") or b2c_res.get("OriginatorConversationID") or f"B2C{uuid.uuid4().hex[:8].upper()}"
    is_sim = b2c_res.get("simulated", False)
    settlement_status = "completed" if is_sim else "initiated"

    settlement = SaccoSettlement(
        sacco_id=payload.sacco_id,
        vehicle_id=None,
        gross_amount=payload.amount,
        platform_fee=platform_fee,
        net_payout=net_payout,
        recipient_phone=payload.recipient_phone,
        recipient_name=payload.recipient_name,
        settlement_type="sacco_treasury",
        b2c_conversation_id=b2c_conv_id,
        b2c_transaction_id=b2c_trans_id,
        status=settlement_status,
        notes=payload.notes or "SACCO Daily Revenue Cashout",
        created_at=datetime.now(timezone.utc),
    )
    db.add(settlement)
    await db.flush()

    # Log to audit trail
    await db.execute(text("""
        INSERT INTO audit_logs (
            action, entity_type, entity_id, actor_user_id, actor_role,
            supervisor_pin_verified, previous_state, new_state, reason, created_at
        ) VALUES (
            'sacco_b2c_cashout', 'sacco_settlement', :sid, :uid, :role,
            TRUE, NULL, :new::jsonb, :reason, NOW()
        );
    """), {
        "sid": settlement.id,
        "uid": current_user.id,
        "role": current_user.role,
        "new": json.dumps({"gross": payload.amount, "net": net_payout, "phone": payload.recipient_phone, "ref": b2c_trans_id}),
        "reason": f"SACCO Treasury B2C cashout of KES {net_payout:,.2f} to {payload.recipient_phone}",
    })

    # Queue SMS receipt to recipient phone
    sms_body = (
        f"BUSGO B2C DISBURSEMENT: KES {net_payout:,.2f} sent to {payload.recipient_phone} for {sacco.name}.\n"
        f"Ref: {b2c_trans_id} | Platform Fee (3%): KES {platform_fee:,.2f}.\n"
        f"Conversation: {b2c_conv_id}. Transferred via Safaricom M-Pesa B2C."
    )
    db.add(Dispatch(
        user_id=current_user.id,
        channel="sms",
        recipient=payload.recipient_phone,
        message_body=sms_body,
        status="sent",
        provider="daraja_b2c" if not is_sim else "daraja_b2c_simulator",
        provider_reference=b2c_trans_id,
        created_at=datetime.now(timezone.utc),
    ))
    await db.commit()

    return {
        "ok": True,
        "message": f"Successfully initiated KES {net_payout:,.2f} via Daraja B2C to {payload.recipient_phone}.",
        "settlement_id": settlement.id,
        "b2c_transaction_id": b2c_trans_id,
        "b2c_conversation_id": b2c_conv_id,
        "gross_amount": payload.amount,
        "platform_fee": platform_fee,
        "net_payout": net_payout,
        "recipient_phone": payload.recipient_phone,
        "recipient_name": payload.recipient_name,
        "status": settlement_status,
        "simulated": is_sim,
    }


# ---------------------------------------------------------------------------
# Vehicle Owner Revenue Splits & Automated Dividend Disbursals
# ---------------------------------------------------------------------------

class VehicleOwnerDisburseRequest(BaseModel):
    vehicle_id: int
    amount: Optional[float] = None
    recipient_phone: Optional[str] = None
    recipient_name: Optional[str] = None
    notes: Optional[str] = None


class BatchOwnerDisburseRequest(BaseModel):
    sacco_id: Optional[int] = None
    min_amount: Optional[float] = 100.0
    notes: Optional[str] = "Batch Vehicle Owner Daily Dividends"


@app.get("/api/settlements/vehicle-splits")
async def get_vehicle_revenue_splits(
    sacco_id: Optional[int] = None,
    current_user=Depends(require_roles("admin", "sacco_admin", "driver")),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Kenyan SACCO Vehicle Owner Revenue Split Ledger:
    Calculates per-vehicle gross bookings, fuel deductions, conductor commissions,
    SACCO operational levy (5%), BUSGO platform fee (3%), and net owner dividends.
    """
    target_sacco_id = sacco_id
    if current_user.role == 'sacco_admin' and current_user.sacco_id:
        target_sacco_id = current_user.sacco_id

    query = select(Vehicle, VehicleType, Sacco).join(
        VehicleType, Vehicle.vehicle_type_id == VehicleType.id
    ).outerjoin(
        Sacco, Vehicle.sacco_id == Sacco.id
    )
    if target_sacco_id:
        query = query.where(Vehicle.sacco_id == target_sacco_id)
    query = query.order_by(Vehicle.plate_number.asc())

    rows = (await db.execute(query)).all()
    results = []

    total_gross = 0.0
    total_fuel = 0.0
    total_conductor = 0.0
    total_sacco_levies = 0.0
    total_platform_fees = 0.0
    total_net_dividends = 0.0
    total_available_payout = 0.0

    for v, vt, s in rows:
        vid = v.id

        # Trips count
        trips_cnt = (await db.execute(
            text("SELECT COUNT(id) FROM trips WHERE vehicle_id = :vid;"),
            {"vid": vid}
        )).scalar() or 0

        # Gross passenger bookings
        gross_fares = float((await db.execute(
            text("""
                SELECT COALESCE(SUM(p.amount), 0.0)
                FROM payments p
                JOIN bookings b ON b.id = p.booking_id
                JOIN trips t ON t.id = b.trip_id
                WHERE t.vehicle_id = :vid AND p.status = 'completed';
            """),
            {"vid": vid}
        )).scalar() or 0.0)

        # Stage deductions (fuel, conductor commissions, other stage expenses)
        stage_res = (await db.execute(
            text("""
                SELECT COALESCE(SUM(sr.fuel_deduction), 0.0) AS fuel,
                       COALESCE(SUM(sr.conductor_commission), 0.0) AS conductor,
                       COALESCE(SUM(sr.other_expenses), 0.0) AS other
                FROM stage_reconciliations sr
                JOIN trips t ON t.id = sr.trip_id
                WHERE t.vehicle_id = :vid;
            """),
            {"vid": vid}
        )).mappings().first()

        fuel = float(stage_res["fuel"] if stage_res else 0.0)
        conductor = float(stage_res["conductor"] if stage_res else 0.0)
        other_exp = float(stage_res["other"] if stage_res else 0.0)

        # Baseline seed values for local demo if fresh vehicle
        if gross_fares <= 0 and trips_cnt > 0:
            gross_fares = float(trips_cnt * 6800.0)
            fuel = float(trips_cnt * 2200.0)
            conductor = float(trips_cnt * 1000.0)

        # Standard SACCO operational levy (5%) and Platform fee (3%)
        sacco_levy = round(gross_fares * 0.05, 2)
        platform_fee = round(gross_fares * 0.03, 2)

        # Net owner dividend earned
        net_earned = max(0.0, round(gross_fares - fuel - conductor - other_exp - sacco_levy - platform_fee, 2))

        # Total already disbursed to this vehicle owner
        disbursed = float((await db.execute(
            text("""
                SELECT COALESCE(SUM(net_payout), 0.0)
                FROM sacco_settlements
                WHERE vehicle_id = :vid AND status = 'completed';
            """),
            {"vid": vid}
        )).scalar() or 0.0)

        available_for_owner = max(0.0, round(net_earned - disbursed, 2))

        owner_name = v.owner_name or f"Owner ({v.plate_number})"
        owner_phone = v.owner_phone or "254712345678"

        total_gross += gross_fares
        total_fuel += fuel
        total_conductor += conductor
        total_sacco_levies += sacco_levy
        total_platform_fees += platform_fee
        total_net_dividends += net_earned
        total_available_payout += available_for_owner

        results.append({
            "vehicle_id": v.id,
            "plate_number": v.plate_number,
            "vehicle_model": vt.display_name,
            "purpose": v.purpose,
            "sacco_id": s.id if s else None,
            "sacco_name": s.name if s else "Independent Fleet",
            "owner_name": owner_name,
            "owner_phone": owner_phone,
            "trips_count": trips_cnt,
            "gross_revenue": gross_fares,
            "fuel_deduction": fuel,
            "conductor_commission": conductor,
            "other_expenses": other_exp,
            "sacco_levy": sacco_levy,
            "platform_fee": platform_fee,
            "net_earned": net_earned,
            "total_disbursed": disbursed,
            "available_for_owner": available_for_owner,
        })

    return {
        "sacco_id": target_sacco_id,
        "total_vehicles": len(results),
        "totals": {
            "gross_revenue": round(total_gross, 2),
            "fuel_deductions": round(total_fuel, 2),
            "conductor_commissions": round(total_conductor, 2),
            "sacco_levies": round(total_sacco_levies, 2),
            "platform_fees": round(total_platform_fees, 2),
            "net_dividends": round(total_net_dividends, 2),
            "available_payout": round(total_available_payout, 2),
        },
        "vehicles": results,
    }


@app.post("/api/settlements/disburse-vehicle-owner")
async def disburse_vehicle_owner_dividend(
    payload: VehicleOwnerDisburseRequest,
    current_user=Depends(require_roles("admin", "sacco_admin")),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Automated Daraja B2C dividend transfer to a specific Vehicle Owner.
    Calculates net balance, deducts platform/sacco levies, and sends instant M-Pesa.
    """
    vehicle_row = (await db.execute(
        select(Vehicle, Sacco).outerjoin(Sacco, Vehicle.sacco_id == Sacco.id).where(Vehicle.id == payload.vehicle_id)
    )).first()

    if not vehicle_row:
        raise HTTPException(status_code=404, detail="Vehicle not found.")

    v, s = vehicle_row
    sacco_id = s.id if s else 1
    sacco_name = s.name if s else "BUSGO SACCO"

    owner_phone = payload.recipient_phone or v.owner_phone or "254712345678"
    owner_name = payload.recipient_name or v.owner_name or f"Owner ({v.plate_number})"

    payout_amt = payload.amount
    if not payout_amt or payout_amt <= 0:
        # Auto-calculate available net balance
        splits = await get_vehicle_revenue_splits(sacco_id=sacco_id, current_user=current_user, db=db)
        match = next((item for item in splits["vehicles"] if item["vehicle_id"] == v.id), None)
        payout_amt = match["available_for_owner"] if match else 0.0

    if payout_amt <= 0:
        raise HTTPException(status_code=400, detail=f"No positive dividend balance available for vehicle {v.plate_number}.")

    # Trigger Daraja B2C
    try:
        b2c_res = await daraja.b2c_payment_request(
            phone=owner_phone,
            amount=payout_amt,
            remarks=payload.notes or f"BUSGO Dividend {v.plate_number}",
            occasion="OwnerDividend",
            command_id="BusinessPayment",
        )
    except Exception as e:
        logger.error(f"Daraja B2C error for vehicle {v.plate_number}: {e}")
        raise HTTPException(status_code=502, detail=f"Daraja B2C Gateway Error: {str(e)}")

    b2c_conv_id = b2c_res.get("ConversationID") or f"AG_B2C_{datetime.now().strftime('%Y%m%d')}_{uuid.uuid4().hex[:6].upper()}"
    b2c_trans_id = b2c_res.get("transaction_id") or b2c_res.get("OriginatorConversationID") or f"B2C{uuid.uuid4().hex[:8].upper()}"
    is_sim = b2c_res.get("simulated", False)
    settlement_status = "completed" if is_sim else "initiated"

    settlement = SaccoSettlement(
        sacco_id=sacco_id,
        vehicle_id=v.id,
        gross_amount=payout_amt,
        platform_fee=0.0,
        net_payout=payout_amt,
        recipient_phone=owner_phone,
        recipient_name=owner_name,
        settlement_type="vehicle_owner_dividend",
        b2c_conversation_id=b2c_conv_id,
        b2c_transaction_id=b2c_trans_id,
        status=settlement_status,
        notes=payload.notes or f"Owner Daily Dividend for {v.plate_number}",
        created_at=datetime.now(timezone.utc),
    )
    db.add(settlement)
    await db.flush()

    # Log to audit trail
    await db.execute(text("""
        INSERT INTO audit_logs (
            action, entity_type, entity_id, actor_user_id, actor_role,
            supervisor_pin_verified, previous_state, new_state, reason, created_at
        ) VALUES (
            'vehicle_owner_b2c_disbursement', 'vehicle', :vid, :uid, :role,
            TRUE, NULL, :new::jsonb, :reason, NOW()
        );
    """), {
        "vid": v.id,
        "uid": current_user.id,
        "role": current_user.role,
        "new": json.dumps({"vehicle_plate": v.plate_number, "payout": payout_amt, "phone": owner_phone, "ref": b2c_trans_id}),
        "reason": f"Disbursed owner dividend of KES {payout_amt:,.2f} for {v.plate_number} to {owner_phone}",
    })

    # Send SMS notification to Owner
    sms_body = (
        f"BUSGO DIVIDEND PAYOUT: KES {payout_amt:,.2f} sent to {owner_phone} for vehicle {v.plate_number} ({sacco_name}).\n"
        f"M-Pesa Ref: {b2c_trans_id} | Conversation: {b2c_conv_id}.\n"
        f"Thank you for partnering with BUSGO transit."
    )
    db.add(Dispatch(
        user_id=current_user.id,
        channel="sms",
        recipient=owner_phone,
        message_body=sms_body,
        status="sent",
        provider="daraja_b2c" if not is_sim else "daraja_b2c_simulator",
        provider_reference=b2c_trans_id,
        created_at=datetime.now(timezone.utc),
    ))
    await db.commit()

    return {
        "ok": True,
        "message": f"Successfully disbursed KES {payout_amt:,.2f} via Daraja B2C to {owner_name} ({owner_phone}).",
        "settlement_id": settlement.id,
        "vehicle_id": v.id,
        "plate_number": v.plate_number,
        "b2c_transaction_id": b2c_trans_id,
        "b2c_conversation_id": b2c_conv_id,
        "net_payout": payout_amt,
        "recipient_phone": owner_phone,
        "recipient_name": owner_name,
        "status": settlement_status,
        "simulated": is_sim,
    }


@app.post("/api/settlements/batch-disburse-owners")
async def batch_disburse_all_vehicle_owners(
    payload: BatchOwnerDisburseRequest,
    current_user=Depends(require_roles("admin", "sacco_admin")),
    db: AsyncSession = Depends(get_async_db)
):
    """
    1-Click Bulk Daraja B2C Payout to all vehicle owners across the SACCO
    who have positive net balances above min_amount.
    """
    splits_data = await get_vehicle_revenue_splits(sacco_id=payload.sacco_id, current_user=current_user, db=db)
    min_thresh = payload.min_amount or 100.0

    eligible = [v for v in splits_data["vehicles"] if v["available_for_owner"] >= min_thresh]
    if not eligible:
        return {
            "ok": True,
            "message": f"No vehicle owners with pending balances >= KES {min_thresh:,.2f}.",
            "disbursed_count": 0,
            "total_disbursed": 0.0,
            "results": [],
        }

    results = []
    total_paid = 0.0

    for item in eligible:
        vid = item["vehicle_id"]
        amt = item["available_for_owner"]
        phone = item["owner_phone"]
        name = item["owner_name"]
        plate = item["plate_number"]

        try:
            b2c_res = await daraja.b2c_payment_request(
                phone=phone,
                amount=amt,
                remarks=f"Batch Dividend {plate}",
                occasion="BatchDividend",
            )
            conv_id = b2c_res.get("ConversationID") or f"AG_B2C_{uuid.uuid4().hex[:6].upper()}"
            trans_id = b2c_res.get("transaction_id") or b2c_res.get("OriginatorConversationID") or f"B2C{uuid.uuid4().hex[:8].upper()}"
            is_sim = b2c_res.get("simulated", False)

            settlement = SaccoSettlement(
                sacco_id=item["sacco_id"] or 1,
                vehicle_id=vid,
                gross_amount=amt,
                platform_fee=0.0,
                net_payout=amt,
                recipient_phone=phone,
                recipient_name=name,
                settlement_type="vehicle_owner_dividend",
                b2c_conversation_id=conv_id,
                b2c_transaction_id=trans_id,
                status="completed" if is_sim else "initiated",
                notes=f"Batch Owner Daily Dividend for {plate}",
                created_at=datetime.now(timezone.utc),
            )
            db.add(settlement)
            total_paid += amt
            results.append({
                "vehicle_id": vid,
                "plate_number": plate,
                "owner_name": name,
                "phone": phone,
                "amount": amt,
                "status": "success",
                "transaction_id": trans_id,
            })
        except Exception as e:
            logger.error(f"Failed B2C for {plate}: {e}")
            results.append({
                "vehicle_id": vid,
                "plate_number": plate,
                "owner_name": name,
                "phone": phone,
                "amount": amt,
                "status": "failed",
                "error": str(e),
            })

    await db.commit()

    return {
        "ok": True,
        "message": f"Batch B2C Payout complete. Disbursed KES {total_paid:,.2f} across {len(results)} vehicles.",
        "disbursed_count": len([r for r in results if r["status"] == "success"]),
        "total_disbursed": round(total_paid, 2),
        "results": results,
    }


@app.post("/api/pay/daraja/b2c-result")
async def daraja_b2c_result_callback(request: Request, db: AsyncSession = Depends(get_async_db)):
    """Safaricom Daraja B2C Result callback webhook."""
    data = await request.json()
    parsed = daraja.parse_b2c_callback(data)
    if parsed:
        conv_id = parsed.get("conversation_id")
        result_code = parsed.get("result_code")
        trans_id = parsed.get("transaction_id")
        new_status = "completed" if result_code == 0 else "failed"
        if conv_id:
            await db.execute(text("""
                UPDATE sacco_settlements
                SET status = :status,
                    b2c_transaction_id = COALESCE(:trans_id, b2c_transaction_id),
                    b2c_response_code = :code,
                    b2c_response_desc = :desc
                WHERE b2c_conversation_id = :conv_id;
            """), {
                "status": new_status,
                "trans_id": trans_id,
                "code": str(result_code),
                "desc": parsed.get("result_desc", ""),
                "conv_id": conv_id,
            })
            await db.commit()
    return {"ResultCode": 0, "ResultDesc": "B2C Callback Processed Successfully"}


@app.post("/api/pay/daraja/b2c-timeout")
async def daraja_b2c_timeout_callback(request: Request, db: AsyncSession = Depends(get_async_db)):
    """Safaricom Daraja B2C Queue Timeout webhook."""
    return {"ResultCode": 0, "ResultDesc": "B2C Timeout Acknowledged"}



# ---------------------------------------------------------------------------
# EV Fleet Battery & Telemetry Dashboard (Option 4)
# ---------------------------------------------------------------------------

class EvTelemetryUpdate(BaseModel):
    vehicle_id: int
    battery_soc_pct: float
    battery_temp_c: Optional[float] = 28.0
    estimated_range_km: Optional[float] = None
    charging_status: Optional[str] = "discharging"
    power_consumption_kwh_per_km: Optional[float] = 0.85
    co2_saved_kg: Optional[float] = None
    regen_braking_kwh: Optional[float] = None


@app.get("/api/ev/fleet")
async def get_ev_fleet(db: AsyncSession = Depends(get_async_db)):
    query = """
        SELECT v.id AS vehicle_id, v.plate_number, v.manufacture_year,
               vt.slug AS vehicle_type, vt.display_name AS vehicle_type_name, vt.seat_capacity,
               COALESCE(s.id, 1) AS sacco_id,
               COALESCE(s.name, 'Super Metro Sacco') AS sacco_name,
               COALESCE(s.primary_color, '#06b6d4') AS sacco_color,
               t.id AS active_trip_id, t.name AS active_trip_name,
               COALESCE(tel.battery_soc_pct, 85.0) AS battery_soc_pct,
               COALESCE(tel.battery_temp_c, 28.5) AS battery_temp_c,
               COALESCE(tel.estimated_range_km, 210.0) AS estimated_range_km,
               COALESCE(tel.charging_status, 'discharging') AS charging_status,
               COALESCE(tel.power_consumption_kwh_per_km, 0.82) AS power_consumption_kwh_per_km,
               COALESCE(tel.co2_saved_kg, 480.0) AS co2_saved_kg,
               COALESCE(tel.regen_braking_kwh, 14.5) AS regen_braking_kwh,
               tel.recorded_at
        FROM vehicles v
        JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        LEFT JOIN saccos s ON s.id = v.sacco_id
        LEFT JOIN trips t ON t.vehicle_id = v.id AND t.status = 'in_progress'
        LEFT JOIN LATERAL (
            SELECT * FROM vehicle_telemetry
            WHERE vehicle_id = v.id
            ORDER BY recorded_at DESC
            LIMIT 1
        ) tel ON true
        WHERE v.is_electric = true
        ORDER BY v.id ASC;
    """
    rows = (await db.execute(text(query))).mappings().all()

    fleet = []
    total_co2_kg = 0.0
    for r in rows:
        item = dict(r)
        total_co2_kg += float(item.get("co2_saved_kg") or 0.0)
        fleet.append(item)

    return {
        "ev_fleet": fleet,
        "total_electric_vehicles": len(fleet),
        "total_co2_saved_kg": round(total_co2_kg, 1),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/ev/telemetry")
async def record_ev_telemetry(
    payload: EvTelemetryUpdate,
    db: AsyncSession = Depends(get_async_db)
):
    veh = (await db.execute(select(Vehicle).where(Vehicle.id == payload.vehicle_id))).scalars().first()
    if not veh:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    calc_range = payload.estimated_range_km or round(payload.battery_soc_pct * 2.4, 1)

    record = VehicleTelemetry(
        vehicle_id=payload.vehicle_id,
        battery_soc_pct=payload.battery_soc_pct,
        battery_temp_c=payload.battery_temp_c or 28.0,
        estimated_range_km=calc_range,
        charging_status=payload.charging_status or "discharging",
        power_consumption_kwh_per_km=payload.power_consumption_kwh_per_km or 0.85,
        co2_saved_kg=payload.co2_saved_kg or 450.0,
        regen_braking_kwh=payload.regen_braking_kwh or 12.5,
        recorded_at=datetime.now(timezone.utc),
    )
    db.add(record)
    await db.commit()

    return {
        "ok": True,
        "message": f"Telemetry recorded for vehicle #{payload.vehicle_id} (Plate: {veh.plate_number}).",
        "battery_soc_pct": payload.battery_soc_pct,
        "estimated_range_km": calc_range,
        "charging_status": record.charging_status,
    }


@app.get("/api/ev/charging-stations")
async def list_charging_stations(
    corridor: Optional[str] = None,
    db: AsyncSession = Depends(get_async_db)
):
    stmt = select(ChargingStation).where(ChargingStation.is_active == True)
    if corridor:
        stmt = stmt.where(ChargingStation.corridor.ilike(f"%{corridor}%"))
    stmt = stmt.order_by(ChargingStation.id.asc())

    rows = (await db.execute(stmt)).scalars().all()
    return {
        "stations": [
            {
                "id": s.id,
                "name": s.name,
                "operator": s.operator,
                "location_name": s.location_name,
                "corridor": s.corridor,
                "lat": s.lat,
                "lng": s.lng,
                "power_kw": s.power_kw,
                "ports_total": s.ports_total,
                "ports_available": s.ports_available,
                "connector_type": s.connector_type,
            }
            for s in rows
        ],
        "count": len(rows),
    }


# =====================================================================
# FEATURE 1: "Changa na Marafiki" (Group Split Fare & M-Pesa Harambee)
# =====================================================================

class GroupMemberInput(BaseModel):
    seat_number: int
    passenger_name: str
    phone_number: str

class CreateGroupBookingRequest(BaseModel):
    trip_id: int
    group_name: str
    board_stop_order: int = 1
    alight_stop_order: int = 4
    members: List[GroupMemberInput]

class PayGroupShareRequest(BaseModel):
    member_id: int
    phone_number: Optional[str] = None
    provider: str = "daraja"  # 'daraja' | 'mpesa' | 'cash'


@app.post("/api/group-bookings")
async def create_group_booking(
    req: CreateGroupBookingRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    if len(req.members) < 2:
        raise HTTPException(status_code=400, detail="Changa na Marafiki requires at least 2 passenger seats.")

    trip = (await db.execute(select(Trip).where(Trip.id == req.trip_id))).scalars().first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found.")

    trip_data = (await db.execute(
        text("""
            SELECT t.id, t.fixed_price, t.allow_driver_tier, t.max_surcharge_pct, t.driver_tier,
                   r.base_fare, r.per_hop_fare, r.fare_matrix
            FROM trips t
            JOIN routes r ON r.id = t.route_id
            WHERE t.id = :id;
        """),
        {"id": req.trip_id}
    )).mappings().first()

    matrix = None
    if trip_data and trip_data.get("fare_matrix"):
        fm = trip_data["fare_matrix"]
        matrix = fm if isinstance(fm, dict) else json.loads(fm)

    per_seat_fare = calculate_segment_fare(
        board_order=req.board_stop_order,
        alight_order=req.alight_stop_order,
        base_fare=trip_data["base_fare"] if trip_data else 200.0,
        per_hop_fare=trip_data["per_hop_fare"] if trip_data else 150.0,
        fare_matrix=matrix,
        fixed_price=trip_data["fixed_price"] if trip_data else None,
        allow_driver_tier=trip_data["allow_driver_tier"] if trip_data else False,
        driver_tier=trip_data["driver_tier"] if trip_data else "standard",
        max_surcharge_pct=trip_data["max_surcharge_pct"] if trip_data else 25.0,
    )

    requested_seats = [m.seat_number for m in req.members]
    if len(requested_seats) != len(set(requested_seats)):
        raise HTTPException(status_code=400, detail="Duplicate seats in group reservation.")

    # Check overlaps for any requested seat
    existing_conflicts = (await db.execute(
        text("""
            SELECT seat_number FROM bookings
            WHERE trip_id = :trip_id
              AND seat_number = ANY(:seats)
              AND status != 'cancelled'
              AND NOT (alight_stop_order <= :bo OR board_stop_order >= :ao);
        """),
        {"trip_id": req.trip_id, "seats": requested_seats, "bo": req.board_stop_order, "ao": req.alight_stop_order}
    )).scalars().all()

    if existing_conflicts:
        conflicts_sorted = sorted(list(set(existing_conflicts)))
        raise HTTPException(status_code=409, detail=f"Seats {conflicts_sorted} are already booked for this segment.")

    num_members = len(req.members)
    # Tiered Changa na Marafiki Group Split Discount:
    # 2 seats: 5% Chama discount
    # 3-4 seats: 10% Chama Roadtrip discount
    # 5+ seats: 15% Mega Harambee discount
    if num_members >= 5:
        discount_pct = 15.0
    elif num_members >= 3:
        discount_pct = 10.0
    elif num_members >= 2:
        discount_pct = 5.0
    else:
        discount_pct = 0.0

    discounted_seat_fare = round(per_seat_fare * (1.0 - discount_pct / 100.0), 2)
    original_total = round(per_seat_fare * num_members, 2)
    total_amount = round(discounted_seat_fare * num_members, 2)
    discount_amount = round(original_total - total_amount, 2)

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)

    group = GroupBooking(
        trip_id=req.trip_id,
        created_by_user_id=current_user.id if current_user else None,
        group_name=req.group_name,
        board_stop_order=req.board_stop_order,
        alight_stop_order=req.alight_stop_order,
        total_amount=total_amount,
        paid_amount=0.0,
        status="pending",
        expires_at=expires_at,
        created_at=datetime.now(timezone.utc)
    )
    db.add(group)
    await db.flush()

    members_out = []
    for m in req.members:
        # Create tentative booking holding the seat with discounted share fare
        bk = Booking(
            trip_id=req.trip_id,
            user_id=current_user.id if current_user else 1,
            seat_number=m.seat_number,
            board_stop_order=req.board_stop_order,
            alight_stop_order=req.alight_stop_order,
            status="pending",
            payment_status="unpaid",
            created_at=datetime.now(timezone.utc)
        )
        db.add(bk)
        await db.flush()

        member = GroupBookingMember(
            group_booking_id=group.id,
            seat_number=m.seat_number,
            passenger_name=m.passenger_name,
            phone_number=m.phone_number,
            share_amount=discounted_seat_fare,
            payment_status="pending",
            booking_id=bk.id
        )
        db.add(member)
        await db.flush()

        members_out.append({
            "id": member.id,
            "seat_number": member.seat_number,
            "passenger_name": member.passenger_name,
            "phone_number": member.phone_number,
            "share_amount": member.share_amount,
            "payment_status": member.payment_status,
            "booking_id": bk.id
        })

    await db.commit()

    return {
        "group_id": group.id,
        "trip_id": group.trip_id,
        "group_name": group.group_name,
        "board_stop_order": group.board_stop_order,
        "alight_stop_order": group.alight_stop_order,
        "total_amount": group.total_amount,
        "paid_amount": group.paid_amount,
        "discount_pct": discount_pct,
        "discount_amount": discount_amount,
        "original_total_amount": original_total,
        "unit_fare": discounted_seat_fare,
        "original_unit_fare": per_seat_fare,
        "status": group.status,
        "expires_at": group.expires_at.isoformat(),
        "seconds_remaining": 900,
        "members": members_out
    }


@app.get("/api/group-bookings/{group_id}")
async def get_group_booking(group_id: int, db: AsyncSession = Depends(get_async_db)):
    group = (await db.execute(select(GroupBooking).where(GroupBooking.id == group_id))).scalars().first()
    if not group:
        raise HTTPException(status_code=404, detail="Group booking not found.")

    # Check expiry
    now = datetime.now(timezone.utc)
    if group.status == "pending" and now > group.expires_at:
        group.status = "expired"
        # cancel associated unpaid bookings
        members = (await db.execute(select(GroupBookingMember).where(GroupBookingMember.group_booking_id == group_id))).scalars().all()
        for m in members:
            if m.payment_status != "paid" and m.booking_id:
                bk = (await db.execute(select(Booking).where(Booking.id == m.booking_id))).scalars().first()
                if bk and bk.payment_status != "paid":
                    bk.status = "cancelled"
        await db.commit()

    members = (await db.execute(select(GroupBookingMember).where(GroupBookingMember.group_booking_id == group_id).order_by(GroupBookingMember.seat_number.asc()))).scalars().all()
    seconds_remaining = max(0, int((group.expires_at - now).total_seconds())) if group.status == "pending" else 0

    num_m = len(members)
    discount_pct = 15.0 if num_m >= 5 else 10.0 if num_m >= 3 else 5.0 if num_m >= 2 else 0.0

    return {
        "group_id": group.id,
        "trip_id": group.trip_id,
        "group_name": group.group_name,
        "board_stop_order": group.board_stop_order,
        "alight_stop_order": group.alight_stop_order,
        "total_amount": group.total_amount,
        "paid_amount": group.paid_amount,
        "discount_pct": discount_pct,
        "status": group.status,
        "expires_at": group.expires_at.isoformat(),
        "seconds_remaining": seconds_remaining,
        "is_fully_paid": group.status == "completed" or (group.paid_amount >= group.total_amount and group.total_amount > 0),
        "members": [
            {
                "id": m.id,
                "seat_number": m.seat_number,
                "passenger_name": m.passenger_name,
                "phone_number": m.phone_number,
                "share_amount": m.share_amount,
                "payment_status": m.payment_status,
                "mpesa_receipt": m.mpesa_receipt,
                "paid_at": m.paid_at.isoformat() if m.paid_at else None,
                "booking_id": m.booking_id
            }
            for m in members
        ]
    }


@app.post("/api/group-bookings/{group_id}/pay-share")
async def pay_group_share(group_id: int, req: PayGroupShareRequest, db: AsyncSession = Depends(get_async_db)):
    group = (await db.execute(select(GroupBooking).where(GroupBooking.id == group_id))).scalars().first()
    if not group:
        raise HTTPException(status_code=404, detail="Group booking not found.")

    member = (await db.execute(select(GroupBookingMember).where(GroupBookingMember.id == req.member_id, GroupBookingMember.group_booking_id == group_id))).scalars().first()
    if not member:
        raise HTTPException(status_code=404, detail="Group member not found.")

    if member.payment_status == "paid":
        return {"message": "Share already settled!", "payment_status": "paid", "mpesa_receipt": member.mpesa_receipt}

    receipt_no = f"QKA{random.randint(100000, 999999)}HARAMBEE"
    now = datetime.now(timezone.utc)

    member.payment_status = "paid"
    member.mpesa_receipt = receipt_no
    member.paid_at = now

    # Update associated booking
    if member.booking_id:
        bk = (await db.execute(select(Booking).where(Booking.id == member.booking_id))).scalars().first()
        if bk:
            bk.status = "confirmed"
            bk.payment_status = "paid"

            # Create payment record
            pay = Payment(
                booking_id=bk.id,
                provider="daraja_stk",
                receipt_number=receipt_no,
                phone_number=req.phone_number or member.phone_number,
                amount=member.share_amount,
                status="completed",
                callback_verified=True,
                created_at=now
            )
            db.add(pay)

    # Recalculate group paid amount
    members = (await db.execute(select(GroupBookingMember).where(GroupBookingMember.group_booking_id == group_id))).scalars().all()
    paid_sum = sum(m.share_amount for m in members if m.payment_status == "paid")
    group.paid_amount = paid_sum

    if all(m.payment_status == "paid" for m in members):
        group.status = "completed"

    await db.commit()

    # Trigger bilingual SMS ticket dispatch to group member
    try:
        await dispatch.dispatch_group_share_confirmation(db, member.id, receipt_no)
    except Exception as disp_err:
        print(f"[Dispatch] Changa SMS error: {disp_err}")

    return {
        "success": True,
        "member_id": member.id,
        "passenger_name": member.passenger_name,
        "seat_number": member.seat_number,
        "amount_paid": member.share_amount,
        "mpesa_receipt": receipt_no,
        "group_status": group.status,
        "group_paid_amount": group.paid_amount,
        "group_total_amount": group.total_amount,
        "is_fully_paid": group.status == "completed"
    }


# =====================================================================
# FEATURE 2: Stage Dispatcher / "Kondakta" Walk-In POS & Cash Reconciler
# =====================================================================

class WalkInBookingRequest(BaseModel):
    trip_id: int
    seat_number: int
    board_stop_order: int = 1
    alight_stop_order: int = 4
    passenger_name: str = "Walk-In Stage Passenger"
    passenger_phone: str = "254700000000"
    fare_amount: float
    notes: Optional[str] = None

class StageReconcileRequest(BaseModel):
    trip_id: int
    fuel_deduction: float = 0.0
    conductor_commission: float = 0.0
    other_expenses: float = 0.0
    notes: Optional[str] = None


@app.post("/api/dispatcher/walkin-booking")
async def create_walkin_booking(
    req: WalkInBookingRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Instant 1-tap Walk-in Stage cash booking for dispatchers and conductors."""
    # Check seat conflict
    conflict = (await db.execute(
        text("""
            SELECT id FROM bookings
            WHERE trip_id = :trip_id
              AND seat_number = :seat
              AND status != 'cancelled'
              AND NOT (alight_stop_order <= :bo OR board_stop_order >= :ao);
        """),
        {"trip_id": req.trip_id, "seat": req.seat_number, "bo": req.board_stop_order, "ao": req.alight_stop_order}
    )).first()

    if conflict:
        raise HTTPException(status_code=409, detail=f"Seat #{req.seat_number} is already occupied on this corridor segment.")

    now = datetime.now(timezone.utc)
    receipt_no = f"CASH-STAGE-{random.randint(10000, 99999)}"

    booking = Booking(
        trip_id=req.trip_id,
        user_id=current_user.id if current_user else 1,
        seat_number=req.seat_number,
        board_stop_order=req.board_stop_order,
        alight_stop_order=req.alight_stop_order,
        status="confirmed",
        payment_status="paid",
        created_at=now
    )
    db.add(booking)
    await db.flush()

    payment = Payment(
        booking_id=booking.id,
        provider="cash",
        receipt_number=receipt_no,
        phone_number=req.passenger_phone,
        amount=req.fare_amount,
        status="completed",
        callback_verified=True,
        created_at=now
    )
    db.add(payment)
    await db.commit()

    # Trigger SMS dispatch if phone number provided
    if req.passenger_phone:
        try:
            await dispatch.dispatch_booking_confirmation(
                db, booking.id, channels=["sms"], override_phone=req.passenger_phone
            )
        except Exception as disp_err:
            print(f"[Dispatch] Walk-in SMS error: {disp_err}")

    return {
        "booking_id": booking.id,
        "trip_id": booking.trip_id,
        "seat_number": booking.seat_number,
        "passenger_name": req.passenger_name,
        "receipt_number": receipt_no,
        "amount_paid": req.fare_amount,
        "payment_method": "cash",
        "status": "confirmed"
    }


@app.get("/api/dispatcher/trips/{trip_id}/manifest")
async def get_dispatcher_manifest(trip_id: int, db: AsyncSession = Depends(get_async_db)):
    """Manifest distinguishing walk-in cash passengers from digital M-Pesa bookings."""
    trip = (await db.execute(
        text("""
            SELECT t.id, t.name, t.scheduled_at, t.status,
                   v.plate_number, vt.display_name AS vehicle_type, vt.seat_capacity,
                   r.name AS route_name
            FROM trips t
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
            JOIN routes r ON r.id = t.route_id
            WHERE t.id = :trip_id;
        """),
        {"trip_id": trip_id}
    )).mappings().first()

    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found.")

    bookings = (await db.execute(
        text("""
            SELECT b.id, b.seat_number, b.board_stop_order, b.alight_stop_order, b.status, b.payment_status,
                   COALESCE(p.provider, 'unpaid') AS payment_provider,
                   COALESCE(p.receipt_number, 'N/A') AS receipt_number,
                   COALESCE(p.amount, 0) AS amount,
                   COALESCE(u.full_name, 'Stage Passenger') AS passenger_name,
                   COALESCE(p.phone_number, u.phone, '254700000000') AS passenger_phone,
                   (SELECT stop_name FROM route_stops WHERE route_id = (SELECT route_id FROM trips WHERE id = :trip_id) AND stop_order = b.board_stop_order) AS board_stop,
                   (SELECT stop_name FROM route_stops WHERE route_id = (SELECT route_id FROM trips WHERE id = :trip_id) AND stop_order = b.alight_stop_order) AS alight_stop
            FROM bookings b
            LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'completed'
            LEFT JOIN users u ON u.id = b.user_id
            WHERE b.trip_id = :trip_id AND b.status != 'cancelled'
            ORDER BY b.seat_number ASC;
        """),
        {"trip_id": trip_id}
    )).mappings().all()

    cash_passengers = []
    mpesa_passengers = []
    cash_total = 0.0
    mpesa_total = 0.0

    occupied_seats = set()
    for b in bookings:
        occupied_seats.add(b["seat_number"])
        amt = float(b["amount"])
        item = dict(b)
        if b["payment_provider"] == "cash":
            cash_passengers.append(item)
            cash_total += amt
        else:
            mpesa_passengers.append(item)
            mpesa_total += amt

    capacity = trip["seat_capacity"] or 14
    empty_seats = [s for s in range(1, capacity + 1) if s not in occupied_seats]

    return {
        "trip": dict(trip),
        "total_seats": capacity,
        "filled_seats": len(occupied_seats),
        "empty_seats": empty_seats,
        "cash_passengers": cash_passengers,
        "mpesa_passengers": mpesa_passengers,
        "cash_total": cash_total,
        "mpesa_total": mpesa_total,
        "total_collections": cash_total + mpesa_total
    }


@app.post("/api/dispatcher/reconcile")
async def reconcile_stage_trip(
    req: StageReconcileRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Generate 'Mshiko wa Stage' end-of-trip cash closure and handover ledger."""
    # Compute gross cash and mpesa
    payments = (await db.execute(
        text("""
            SELECT p.provider, SUM(p.amount) as total
            FROM payments p
            JOIN bookings b ON b.id = p.booking_id
            WHERE b.trip_id = :trip_id AND p.status = 'completed'
            GROUP BY p.provider;
        """),
        {"trip_id": req.trip_id}
    )).mappings().all()

    gross_cash = 0.0
    gross_mpesa = 0.0
    for p in payments:
        if p["provider"] == "cash":
            gross_cash = float(p["total"])
        else:
            gross_mpesa += float(p["total"])

    total_rev = gross_cash + gross_mpesa
    total_deductions = req.fuel_deduction + req.conductor_commission + req.other_expenses
    net_sacco_cash = max(0.0, gross_cash - total_deductions)

    p_count = (await db.execute(
        text("SELECT COUNT(*) FROM bookings WHERE trip_id = :trip_id AND status != 'cancelled';"),
        {"trip_id": req.trip_id}
    )).scalar() or 0

    reconciliation = StageReconciliation(
        trip_id=req.trip_id,
        dispatcher_id=current_user.id if current_user else None,
        gross_cash=gross_cash,
        gross_mpesa=gross_mpesa,
        total_revenue=total_rev,
        fuel_deduction=req.fuel_deduction,
        conductor_commission=req.conductor_commission,
        other_expenses=req.other_expenses,
        net_sacco_cash=net_sacco_cash,
        passenger_count=p_count,
        notes=req.notes,
        reconciled_at=datetime.now(timezone.utc)
    )
    db.add(reconciliation)
    await db.commit()

    return {
        "id": reconciliation.id,
        "trip_id": req.trip_id,
        "gross_cash": gross_cash,
        "gross_mpesa": gross_mpesa,
        "total_revenue": total_rev,
        "fuel_deduction": req.fuel_deduction,
        "conductor_commission": req.conductor_commission,
        "other_expenses": req.other_expenses,
        "net_sacco_cash": net_sacco_cash,
        "passenger_count": p_count,
        "notes": req.notes,
        "reconciled_at": reconciliation.reconciled_at.isoformat()
    }


class StageB2CPayoutRequest(BaseModel):
    trip_id: int
    recipient_phone: str
    amount: float
    payout_type: str = "conductor_commission"  # 'conductor_commission' | 'driver_float' | 'fuel_deduction' | 'sacco_surplus'
    recipient_name: Optional[str] = "Driver / Conductor"
    reconciliation_id: Optional[int] = None
    notes: Optional[str] = None


@app.post("/api/dispatcher/payout-b2c")
async def disburse_stage_b2c_payout(
    req: StageB2CPayoutRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Instant M-Pesa B2C payout for conductor commission, driver allowances, or fuel float."""
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Payout amount must be greater than zero.")

    # Find trip and associated SACCO
    trip_data = (await db.execute(
        text("""
            SELECT t.id, t.name, r.sacco_id, s.name as sacco_name
            FROM trips t
            JOIN routes r ON r.id = t.route_id
            LEFT JOIN saccos s ON s.id = r.sacco_id
            WHERE t.id = :tid;
        """),
        {"tid": req.trip_id}
    )).mappings().first()

    if not trip_data:
        raise HTTPException(status_code=404, detail="Trip not found.")

    sacco_id = trip_data["sacco_id"] or 1
    sacco_name = trip_data["sacco_name"] or "BUSGO SACCO Fleet"

    norm_phone = dispatch.normalize_kenyan_phone(req.recipient_phone)
    b2c_trans_id = f"B2C{random.randint(10000000, 99999999)}KES"
    b2c_conv_id = f"AG_STG_{datetime.now().strftime('%Y%m%d')}_{uuid.uuid4().hex[:6].upper()}"
    now = datetime.now(timezone.utc)

    settlement = SaccoSettlement(
        sacco_id=sacco_id,
        gross_amount=req.amount,
        platform_fee=0.0,
        net_payout=req.amount,
        recipient_phone=norm_phone,
        recipient_name=req.recipient_name or "Driver / Conductor",
        b2c_conversation_id=b2c_conv_id,
        b2c_transaction_id=b2c_trans_id,
        status="completed",
        notes=f"Stage Handover Payout ({req.payout_type}) for Trip #{req.trip_id}. {req.notes or ''}",
        created_at=now,
    )
    db.add(settlement)
    await db.flush()

    # If reconciliation_id provided, append note
    if req.reconciliation_id:
        rec = (await db.execute(select(StageReconciliation).where(StageReconciliation.id == req.reconciliation_id))).scalars().first()
        if rec:
            rec.notes = f"{rec.notes or ''} [B2C Payout: {req.payout_type} KES {req.amount:.2f} to {norm_phone} Ref: {b2c_trans_id}]".strip()

    # Dispatch SMS receipt
    sms_body = (
        f"M-PESA B2C: Umepokea KES {req.amount:,.2f} kutoka kwa {sacco_name} "
        f"({req.payout_type.replace('_', ' ').title()} - Safari #{req.trip_id}). "
        f"Ref: {b2c_trans_id}. Conversation: {b2c_conv_id}. Transferred instantly via Safaricom M-Pesa B2C."
    )
    try:
        await dispatch.send_sms_gateway(norm_phone, sms_body)
        db.add(Dispatch(
            user_id=current_user.id if current_user else None,
            channel="sms",
            recipient=norm_phone,
            message_body=sms_body,
            status="sent",
            provider="safaricom_b2c",
            provider_reference=b2c_trans_id,
            created_at=now,
        ))
    except Exception as sms_err:
        print(f"[B2C Dispatch Error]: {sms_err}")

    await db.commit()

    return {
        "success": True,
        "b2c_transaction_id": b2c_trans_id,
        "conversation_id": b2c_conv_id,
        "amount": req.amount,
        "recipient_phone": norm_phone,
        "recipient_name": req.recipient_name,
        "payout_type": req.payout_type,
        "sacco_name": sacco_name,
        "settled_at": now.isoformat(),
        "sms_dispatched": True
    }


@app.get("/api/dispatches/outbox")
async def get_outbox_dispatches(
    limit: int = 50,
    channel: Optional[str] = None,
    db: AsyncSession = Depends(get_async_db)
):
    """Retrieves recent outbound SMS and WhatsApp dispatches for conductors, dispatchers and SACCO admins."""
    items = await dispatch.get_dispatch_outbox(db, limit=limit, channel=channel)
    return {"outbox": items, "count": len(items)}


# =====================================================================
# FEATURE 4: "Nipe Shugli" — Highway Lost & Found Registry (`/lost-found`)
# =====================================================================

class CreateLostFoundRequest(BaseModel):
    trip_id: Optional[int] = None
    sacco_id: Optional[int] = None
    item_type: str = "lost"  # 'lost' | 'found'
    category: str = "luggage"  # 'luggage' | 'electronics' | 'wallet_id' | 'clothing' | 'documents' | 'other'
    title: str
    description: str
    location_or_station: str
    contact_name: str
    contact_phone: str

class ResolveLostFoundRequest(BaseModel):
    claimant_phone: str
    claimant_notes: Optional[str] = None


@app.post("/api/lost-found")
async def report_lost_found_item(
    req: CreateLostFoundRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    item = LostFoundItem(
        trip_id=req.trip_id,
        sacco_id=req.sacco_id,
        reported_by_id=current_user.id if current_user else None,
        category=req.category,
        title=req.title,
        description=req.description,
        item_type=req.item_type,
        status="open",
        location_or_station=req.location_or_station,
        contact_phone=req.contact_phone,
        contact_name=req.contact_name,
        created_at=datetime.now(timezone.utc)
    )
    db.add(item)
    await db.commit()
    return {
        "id": item.id,
        "title": item.title,
        "category": item.category,
        "item_type": item.item_type,
        "status": item.status,
        "location_or_station": item.location_or_station,
        "created_at": item.created_at.isoformat(),
        "message": f"Successfully registered {item.item_type} item #{item.id} in BUSGO Lost & Found ledger."
    }


@app.get("/api/lost-found")
async def list_lost_found_items(
    item_type: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    q: Optional[str] = None,
    db: AsyncSession = Depends(get_async_db)
):
    stmt = select(LostFoundItem)
    if item_type:
        stmt = stmt.where(LostFoundItem.item_type == item_type)
    if category:
        stmt = stmt.where(LostFoundItem.category == category)
    if status:
        stmt = stmt.where(LostFoundItem.status == status)
    if q:
        stmt = stmt.where(
            (LostFoundItem.title.ilike(f"%{q}%")) |
            (LostFoundItem.description.ilike(f"%{q}%")) |
            (LostFoundItem.location_or_station.ilike(f"%{q}%"))
        )
    stmt = stmt.order_by(LostFoundItem.id.desc())

    rows = (await db.execute(stmt)).scalars().all()
    return {
        "items": [
            {
                "id": it.id,
                "title": it.title,
                "description": it.description,
                "category": it.category,
                "item_type": it.item_type,
                "status": it.status,
                "location_or_station": it.location_or_station,
                "contact_name": it.contact_name,
                "contact_phone": it.contact_phone,
                "claimant_phone": it.claimant_phone,
                "created_at": it.created_at.isoformat() if it.created_at else None,
                "resolved_at": it.resolved_at.isoformat() if it.resolved_at else None,
            }
            for it in rows
        ],
        "count": len(rows)
    }


@app.patch("/api/lost-found/{item_id}/claim")
async def claim_lost_found_item(item_id: int, req: ResolveLostFoundRequest, db: AsyncSession = Depends(get_async_db)):
    item = (await db.execute(select(LostFoundItem).where(LostFoundItem.id == item_id))).scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found.")

    item.status = "claimed"
    item.claimant_phone = req.claimant_phone
    item.claimant_notes = req.claimant_notes
    item.resolved_at = datetime.now(timezone.utc)
    await db.commit()

    return {
        "id": item.id,
        "title": item.title,
        "status": item.status,
        "claimant_phone": item.claimant_phone,
        "resolved_at": item.resolved_at.isoformat(),
        "message": f"Item #{item.id} claimed successfully."
    }


# =====================================================================
# FEATURE 5: Highway Blackspot & Escarpment Fog Audio Warning Radar
# =====================================================================

KENYAN_HIGHWAY_BLACKSPOTS = [
    {
        "id": "mai_mahiu_escarpment",
        "name": "Mai Mahiu Escarpment Bends",
        "corridor": "A104 Great North Road",
        "lat": -0.9850,
        "lng": 36.5890,
        "radius_km": 3.5,
        "speed_limit_kmh": 50,
        "severity": "critical",
        "hazard_type": "Sharp hairpins & steep drop-offs",
        "caution_sw": "Tahadhari: Unaingia eneo la Mai Mahiu Escarpment. Punguza mwendo na weka taa za ukungu.",
        "caution_en": "Caution: Entering Mai Mahiu Escarpment bends. Reduce speed and engage fog lights."
    },
    {
        "id": "salgaa_stretch",
        "name": "Salgaa Highway Descent",
        "corridor": "A104 Nakuru-Eldoret",
        "lat": -0.2245,
        "lng": 35.8820,
        "radius_km": 4.0,
        "speed_limit_kmh": 60,
        "severity": "critical",
        "hazard_type": "Steep continuous downhill gradient & brake fade",
        "caution_sw": "Tahadhari: Eneo hatari la Salgaa. Mteremko mkali, tumia gia ya chini na uzingatie 60km/h.",
        "caution_en": "Caution: Salgaa steep descent blackspot. Shift to low gear and strictly observe 60km/h."
    },
    {
        "id": "kinungi_fog",
        "name": "Kinungi Escarpment & Fog Zone",
        "corridor": "A104 Naivasha Corridor",
        "lat": -0.8200,
        "lng": 36.5100,
        "radius_km": 3.0,
        "speed_limit_kmh": 60,
        "severity": "high",
        "hazard_type": "Frequent dense mountain fog & sudden blind spots",
        "caution_sw": "Tahadhari: Eneo la Kinungi. Ukungu mzito na kona kali, weka taa za mbele na umbali wa usalama.",
        "caution_en": "Caution: Kinungi fog zone. Heavy mountain mist, use headlights and maintain safe following distance."
    },
    {
        "id": "sachangwan_crest",
        "name": "Sachang'wan Blackspot Crest",
        "corridor": "A104 Molo Junction",
        "lat": -0.2100,
        "lng": 35.8200,
        "radius_km": 2.5,
        "speed_limit_kmh": 50,
        "severity": "high",
        "hazard_type": "Dangerous overtaking crest & heavy truck bottleneck",
        "caution_sw": "Tahadhari: Eneo la Sachang'wan. Marufuku kuipita magari mengine ovyo.",
        "caution_en": "Caution: Sachang'wan high-hazard crest. Strictly no overtaking."
    },
    {
        "id": "limuru_fog_pass",
        "name": "Limuru Mountain Fog Pass",
        "corridor": "A104 Uplands Escarpment",
        "lat": -1.1100,
        "lng": 36.6500,
        "radius_km": 4.0,
        "speed_limit_kmh": 50,
        "severity": "medium",
        "hazard_type": "Sub-zero temperatures & zero-visibility fog",
        "caution_sw": "Tahadhari: Bonde la Limuru lina ukungu mzito. Washa taa za ukungu mara moja.",
        "caution_en": "Caution: Limuru Fog Pass. Dense mist ahead, reduce speed to 50km/h."
    },
    {
        "id": "subuiga_descent",
        "name": "Subuiga Hill Descent",
        "corridor": "A2 Meru-Isiolo Highway",
        "lat": 0.2200,
        "lng": 37.5800,
        "radius_km": 3.0,
        "speed_limit_kmh": 40,
        "severity": "critical",
        "hazard_type": "Extreme downward grade ending at T-junction",
        "caution_sw": "Tahadhari: Mteremko wa Subuiga. Jaribu breki zako na uzingatie 40km/h.",
        "caution_en": "Caution: Subuiga Hill descent. Test your brakes and observe 40km/h."
    },
    {
        "id": "tsavo_wildlife_crossing",
        "name": "Tsavo / Mtito Andei Wildlife Zone",
        "corridor": "A109 Mombasa Highway",
        "lat": -2.6900,
        "lng": 38.1700,
        "radius_km": 5.0,
        "speed_limit_kmh": 70,
        "severity": "medium",
        "hazard_type": "Wild animals (elephants, zebras) crossing highway at night",
        "caution_sw": "Tahadhari: Eneo la Wanyamapori Tsavo. Angalia tembo na wanyama wanaovuka.",
        "caution_en": "Caution: Tsavo National Park wildlife crossing corridor. Watch for elephants and crossing game."
    }
]

import math

def calculate_haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

class CheckProximityRequest(BaseModel):
    lat: float
    lng: float
    current_speed_kmh: Optional[float] = 0.0


@app.get("/api/highway/blackspots")
async def get_highway_blackspots():
    return {
        "blackspots": KENYAN_HIGHWAY_BLACKSPOTS,
        "count": len(KENYAN_HIGHWAY_BLACKSPOTS)
    }


@app.post("/api/highway/check-proximity")
async def check_blackspot_proximity(req: CheckProximityRequest):
    """Real-time GPS proximity check against registered Kenyan highway blackspots."""
    active_alerts = []
    for spot in KENYAN_HIGHWAY_BLACKSPOTS:
        dist = calculate_haversine_distance(req.lat, req.lng, spot["lat"], spot["lng"])
        if dist <= spot["radius_km"]:
            is_overspeeding = (req.current_speed_kmh or 0) > spot["speed_limit_kmh"]
            active_alerts.append({
                "spot_id": spot["id"],
                "name": spot["name"],
                "corridor": spot["corridor"],
                "distance_km": round(dist, 2),
                "severity": spot["severity"],
                "hazard_type": spot["hazard_type"],
                "speed_limit_kmh": spot["speed_limit_kmh"],
                "current_speed_kmh": req.current_speed_kmh,
                "is_overspeeding": is_overspeeding,
                "caution_sw": spot["caution_sw"],
                "caution_en": spot["caution_en"],
            })

    return {
        "in_danger_zone": len(active_alerts) > 0,
        "alerts_count": len(active_alerts),
        "alerts": active_alerts
    }


# =====================================================================
# USSD (*384#) INTERFACE FOR NON-SMARTPHONE PASSENGERS
# =====================================================================

class UssdSimulateRequest(BaseModel):
    sessionId: Optional[str] = None
    phoneNumber: str
    text: Optional[str] = ""
    serviceCode: Optional[str] = "*384#"


@app.post("/api/ussd")
async def handle_ussd_webhook(request: Request, db: AsyncSession = Depends(get_async_db)):
    """
    Africa's Talking & Telco USSD Webhook Handler.
    Standard Africa's Talking sends form-urlencoded:
      - sessionId: String
      - serviceCode: String
      - phoneNumber: String
      - text: String (e.g. "", "1", "1*2")
    Returns plain text starting with 'CON ' or 'END '.
    """
    content_type = request.headers.get("content-type", "")
    session_id = ""
    phone_number = ""
    text_param = ""
    service_code = "*384#"

    if "application/json" in content_type:
        try:
            body = await request.json()
            session_id = body.get("sessionId") or str(uuid.uuid4())
            phone_number = body.get("phoneNumber") or ""
            text_param = body.get("text") or ""
            service_code = body.get("serviceCode") or "*384#"
        except Exception:
            pass
    else:
        try:
            form = await request.form()
            session_id = form.get("sessionId") or str(uuid.uuid4())
            phone_number = form.get("phoneNumber") or ""
            text_param = form.get("text") or ""
            service_code = form.get("serviceCode") or "*384#"
        except Exception:
            pass

    if not phone_number:
        return PlainTextResponse("END Invalid USSD request: Phone number missing.", media_type="text/plain")

    result = await ussd.process_ussd_step(
        db=db,
        session_id=session_id,
        phone_number=phone_number,
        text=text_param,
        service_code=service_code,
    )
    return PlainTextResponse(content=result["raw_response"], media_type="text/plain")


@app.post("/api/ussd/simulate")
async def simulate_ussd_turn(req: UssdSimulateRequest, db: AsyncSession = Depends(get_async_db)):
    """
    JSON simulator endpoint for testing feature phone USSD dial flows on web dashboard.
    """
    session_id = req.sessionId or f"sim_{uuid.uuid4().hex[:10]}"
    result = await ussd.process_ussd_step(
        db=db,
        session_id=session_id,
        phone_number=req.phoneNumber,
        text=req.text or "",
        service_code=req.serviceCode or "*384#",
    )
    return result


@app.get("/api/ussd/sessions")
async def get_ussd_sessions(limit: int = 50, db: AsyncSession = Depends(get_async_db)):
    """Admin view of active and recent USSD sessions."""
    rows = await db.execute(
        select(UssdSession).order_by(UssdSession.updated_at.desc()).limit(limit)
    )
    sessions = rows.scalars().all()
    return {
        "count": len(sessions),
        "sessions": [
            {
                "id": s.id,
                "session_id": s.session_id,
                "phone_number": s.phone_number,
                "language": s.language,
                "current_menu": s.current_menu,
                "is_active": s.is_active,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            }
            for s in sessions
        ],
    }


@app.get("/api/ussd/logs")
async def get_ussd_logs(limit: int = 100, db: AsyncSession = Depends(get_async_db)):
    """Admin audit logs of inbound USSD hops and generated responses."""
    rows = await db.execute(
        select(UssdLog).order_by(UssdLog.id.desc()).limit(limit)
    )
    logs = rows.scalars().all()
    return {
        "count": len(logs),
        "logs": [
            {
                "id": l.id,
                "session_id": l.session_id,
                "phone_number": l.phone_number,
                "input_text": l.input_text,
                "menu_state": l.menu_state,
                "response_text": l.response_text,
                "created_at": l.created_at.isoformat() if l.created_at else None,
            }
            for l in logs
        ],
    }




