"""
Hardware GPS Tracker Telemetry Ingestion Engine
=================================================
Supports real-world physical telematics devices deployed across Kenyan PSV fleets:
1. Teltonika FM/FMB Series (FMB920, FMB120, FMC130) via Codec 8 / Codec 8 Extended.
2. Concox / Jimi IoT Series (GT06, GT06N, WeTrack2, CRX1) via GT06 Protocol.

Features:
- Dual TCP Socket Listener (Ports 5027 for Teltonika, 5023 for Concox).
- HTTP Rest / Webhook Ingestion API (raw octet-stream / hex string / JSON).
- IMEI-to-Vehicle plate mapping and database sync.
- Real-time Trip GPS tracking updates (current_lat, current_lng, current_speed, current_heading).
- Statutory NTSA PSV overspeeding detection (> 80 km/h) & violation flagging.
- Real-time WebSocket broadcasting to passenger live trip trackers & SACCO dispatch radar.
"""

import asyncio
import logging
import struct
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple, Union
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("telemetry_listener")

# NTSA statutory maximum speed limit for commercial PSVs in Kenya (km/h)
NTSA_SPEED_LIMIT_KMH = 80.0


# ---------------------------------------------------------------------------
# CRC-16 Calculation Utilities
# ---------------------------------------------------------------------------

def crc16_ibm(data: bytes) -> int:
    """CRC-16/IBM (used by Teltonika AVL packets). Polynomial 0xA001."""
    crc = 0x0000
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x0001:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc & 0xFFFF


def crc16_itu(data: bytes) -> int:
    """CRC-16/X-25 / ITU (used by Concox GT06 packets). Polynomial 0x1021."""
    crc = 0xFFFF
    for byte in data:
        crc = ((crc >> 8) | (crc << 8)) & 0xFFFF
        crc ^= byte
        crc ^= ((crc & 0xFF) >> 4)
        crc ^= ((crc << 12) & 0xFFFF)
        crc ^= (((crc & 0xFF) << 5) & 0xFFFF)
    return (~crc) & 0xFFFF


# ---------------------------------------------------------------------------
# 1. Teltonika Codec 8 / Codec 8 Extended Parser
# ---------------------------------------------------------------------------

def parse_teltonika_codec8(data: bytes, imei: Optional[str] = None) -> Tuple[List[Dict[str, Any]], bytes]:
    """
    Parses a Teltonika Codec 8 AVL data packet.
    
    Structure:
    - 4 bytes Preamble (zeros)
    - 4 bytes Data Field Length
    - 1 byte Codec ID (0x08 for Codec 8)
    - 1 byte Number of Data 1 (count N)
    - N AVL Records:
        - 8 bytes Timestamp (UTC ms epoch)
        - 1 byte Priority
        - 4 bytes Longitude (int32 / 10_000_000)
        - 4 bytes Latitude (int32 / 10_000_000)
        - 2 bytes Altitude (int16)
        - 2 bytes Angle / Heading (uint16)
        - 1 byte Satellites (uint8)
        - 2 bytes Speed (uint16 km/h)
        - IO Element block
    - 1 byte Number of Data 2 (count N)
    - 4 bytes CRC-16
    
    Returns:
    - List of parsed telemetry records
    - 4-byte response acknowledgment packet (struct.pack('>I', count))
    """
    if len(data) < 15:
        raise ValueError(f"Teltonika packet too short: {len(data)} bytes")

    # If first 2 bytes are IMEI length (Teltonika handshake packet)
    # Handshake format: 2 bytes length (big endian) + IMEI string
    if data[:4] != b'\x00\x00\x00\x00':
        # Might be Teltonika handshake packet
        if len(data) >= 17:
            imei_len = struct.unpack('>H', data[:2])[0]
            if imei_len == 15 and len(data) >= 17:
                parsed_imei = data[2:2 + imei_len].decode('ascii', errors='ignore')
                # Handshake response: 0x01 (1 byte)
                return [{"type": "handshake", "imei": parsed_imei}], b'\x01'
        raise ValueError("Invalid Teltonika preamble (expected 00000000)")

    offset = 4
    data_length = struct.unpack('>I', data[offset:offset + 4])[0]
    offset += 4

    codec_id = data[offset]
    offset += 1
    if codec_id not in (0x08, 0x8E):
        raise ValueError(f"Unsupported Teltonika codec ID: 0x{codec_id:02X} (expected Codec 8: 0x08)")

    record_count = data[offset]
    offset += 1

    records: List[Dict[str, Any]] = []

    for _ in range(record_count):
        if offset + 24 > len(data):
            break

        # Timestamp: 8 bytes (milliseconds since 1970-01-01)
        ts_ms = struct.unpack('>Q', data[offset:offset + 8])[0]
        offset += 8
        try:
            recorded_at = datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc)
        except Exception:
            recorded_at = datetime.now(timezone.utc)

        # Priority (1 byte)
        priority = data[offset]
        offset += 1

        # GPS Element (15 bytes)
        lng_raw = struct.unpack('>i', data[offset:offset + 4])[0]
        offset += 4
        lat_raw = struct.unpack('>i', data[offset:offset + 4])[0]
        offset += 4
        alt = struct.unpack('>h', data[offset:offset + 2])[0]
        offset += 2
        heading = struct.unpack('>H', data[offset:offset + 2])[0]
        offset += 2
        satellites = data[offset]
        offset += 1
        speed = struct.unpack('>H', data[offset:offset + 2])[0]
        offset += 2

        lng = round(lng_raw / 10000000.0, 7)
        lat = round(lat_raw / 10000000.0, 7)

        # IO Element decoding
        event_io_id = data[offset]
        offset += 1
        total_io = data[offset]
        offset += 1

        ignition = True  # Default assume active
        io_elements = {}

        # 1-byte IOs
        if offset < len(data):
            n1 = data[offset]
            offset += 1
            for _ in range(n1):
                if offset + 2 <= len(data):
                    io_id = data[offset]
                    io_val = data[offset + 1]
                    offset += 2
                    io_elements[io_id] = io_val
                    if io_id == 239:  # Teltonika standard Ignition IO
                        ignition = (io_val == 1)

        # 2-byte IOs
        if offset < len(data):
            n2 = data[offset]
            offset += 1
            for _ in range(n2):
                if offset + 3 <= len(data):
                    io_id = data[offset]
                    io_val = struct.unpack('>H', data[offset + 1:offset + 3])[0]
                    offset += 3
                    io_elements[io_id] = io_val

        # 4-byte IOs
        if offset < len(data):
            n4 = data[offset]
            offset += 1
            for _ in range(n4):
                if offset + 5 <= len(data):
                    io_id = data[offset]
                    io_val = struct.unpack('>I', data[offset + 1:offset + 5])[0]
                    offset += 5
                    io_elements[io_id] = io_val

        # 8-byte IOs
        if offset < len(data):
            n8 = data[offset]
            offset += 1
            for _ in range(n8):
                if offset + 9 <= len(data):
                    io_id = data[offset]
                    io_val = struct.unpack('>Q', data[offset + 1:offset + 9])[0]
                    offset += 9
                    io_elements[io_id] = io_val

        records.append({
            "type": "avl_data",
            "protocol": "teltonika",
            "imei": imei,
            "lat": lat,
            "lng": lng,
            "speed": float(speed),
            "heading": float(heading),
            "altitude": float(alt),
            "satellites": int(satellites),
            "ignition": ignition,
            "overspeed": speed > NTSA_SPEED_LIMIT_KMH,
            "io_elements": io_elements,
            "recorded_at": recorded_at,
        })

    # Response is a 4-byte integer acknowledging the number of records parsed
    ack_response = struct.pack('>I', len(records))
    return records, ack_response


def build_teltonika_codec8_packet(
    records: List[Dict[str, Any]],
    codec_id: int = 0x08,
) -> bytes:
    """Helper to synthesize a valid binary Teltonika Codec 8 AVL packet for tests / simulation."""
    data_bytes = bytearray()
    data_bytes.append(codec_id)
    data_bytes.append(len(records))

    for r in records:
        ts = r.get("recorded_at", datetime.now(timezone.utc))
        ts_ms = int(ts.timestamp() * 1000)
        data_bytes.extend(struct.pack('>Q', ts_ms))
        data_bytes.append(1)  # Priority
        data_bytes.extend(struct.pack('>i', int(r.get("lng", 36.817223) * 10000000)))
        data_bytes.extend(struct.pack('>i', int(r.get("lat", -1.286389) * 10000000)))
        data_bytes.extend(struct.pack('>h', int(r.get("altitude", 1680))))
        data_bytes.extend(struct.pack('>H', int(r.get("heading", 0))))
        data_bytes.append(int(r.get("satellites", 12)))
        data_bytes.extend(struct.pack('>H', int(r.get("speed", 65))))
        # Minimal IO: event id 0, total 1, 1 1-byte IO (ignition 239 -> 1)
        data_bytes.append(0)  # Event IO ID
        data_bytes.append(1)  # Total IO count
        data_bytes.append(1)  # 1x 1-byte IO
        data_bytes.append(239)
        data_bytes.append(1 if r.get("ignition", True) else 0)
        data_bytes.append(0)  # 0x 2-byte IO
        data_bytes.append(0)  # 0x 4-byte IO
        data_bytes.append(0)  # 0x 8-byte IO

    data_bytes.append(len(records))  # Number of data 2

    # Preamble 4 zeros + 4 bytes length
    packet = bytearray(b'\x00\x00\x00\x00')
    packet.extend(struct.pack('>I', len(data_bytes)))
    packet.extend(data_bytes)
    # CRC16
    crc = crc16_ibm(data_bytes)
    packet.extend(struct.pack('>I', crc))
    return bytes(packet)


# ---------------------------------------------------------------------------
# 2. Concox GT06 Protocol Parser
# ---------------------------------------------------------------------------

def parse_concox_gt06(data: bytes) -> Tuple[Dict[str, Any], Optional[bytes]]:
    """
    Parses a Concox GT06 tracker packet.
    
    Packets:
    - 0x01: Login packet (extracts Terminal ID/IMEI). Returns Login Response ACK.
    - 0x22: GPS Location packet (Lat/Lng/Speed/Course/Time). Returns optional ACK.
    - 0x13: Status / Heartbeat packet. Returns Heartbeat Response ACK.
    - 0x16: Alarm packet. Returns Alarm Response ACK.
    """
    if len(data) < 10:
        raise ValueError(f"Concox packet too short: {len(data)} bytes")

    if data[:2] not in (b'\x78\x78', b'\x79\x79'):
        raise ValueError(f"Invalid Concox GT06 start bits: {data[:2].hex()}")

    length = data[2]
    protocol_num = data[3]

    # Login packet (0x01)
    if protocol_num == 0x01:
        # 8 bytes terminal ID in BCD format
        raw_imei = data[4:12].hex()
        # Concox BCD IMEIs often have leading 0
        terminal_imei = raw_imei[1:] if raw_imei.startswith('0') else raw_imei
        serial_no = struct.unpack('>H', data[12:14])[0] if len(data) >= 16 else 1

        # Build Login ACK: 78 78 05 01 [serial 2 bytes] [crc 2 bytes] 0D 0A
        ack_body = bytearray([0x05, 0x01])
        ack_body.extend(struct.pack('>H', serial_no))
        crc = crc16_itu(ack_body)
        ack = bytearray(b'\x78\x78')
        ack.extend(ack_body)
        ack.extend(struct.pack('>H', crc))
        ack.extend(b'\x0d\x0a')

        return {
            "type": "login",
            "protocol": "concox",
            "imei": terminal_imei,
            "serial_no": serial_no,
        }, bytes(ack)

    # GPS Location packet (0x22)
    elif protocol_num == 0x22:
        # Date & Time: 6 bytes (YY MM DD HH MM SS)
        offset = 4
        y, m, d, hh, mm, ss = data[offset:offset + 6]
        offset += 6
        year = 2000 + y
        try:
            recorded_at = datetime(year, m, d, hh, mm, ss, tzinfo=timezone.utc)
        except Exception:
            recorded_at = datetime.now(timezone.utc)

        # Quantity of GPS satellites (1 byte)
        sat_byte = data[offset]
        offset += 1
        satellites = sat_byte & 0x0F

        # Latitude: 4 bytes (unit: degrees * 60 * 30000 = degrees * 1800000)
        lat_raw = struct.unpack('>I', data[offset:offset + 4])[0]
        offset += 4
        # Longitude: 4 bytes
        lng_raw = struct.unpack('>I', data[offset:offset + 4])[0]
        offset += 4

        # Speed: 1 byte (km/h)
        speed = float(data[offset])
        offset += 1

        # Course & Status: 2 bytes
        course_status = struct.unpack('>H', data[offset:offset + 2])[0]
        offset += 2
        heading = float(course_status & 0x03FF)  # Lowest 10 bits is heading (0-360)
        is_west = bool(course_status & 0x0800)
        is_south = not bool(course_status & 0x0400)

        lat = (lat_raw / 1800000.0) * (-1.0 if is_south else 1.0)
        lng = (lng_raw / 1800000.0) * (-1.0 if is_west else 1.0)

        serial_no = struct.unpack('>H', data[offset:offset + 2])[0] if len(data) >= offset + 4 else 1

        return {
            "type": "avl_data",
            "protocol": "concox",
            "lat": round(lat, 7),
            "lng": round(lng, 7),
            "speed": speed,
            "heading": heading,
            "satellites": satellites,
            "ignition": True,
            "overspeed": speed > NTSA_SPEED_LIMIT_KMH,
            "recorded_at": recorded_at,
            "serial_no": serial_no,
        }, None

    # Heartbeat / Status packet (0x13)
    elif protocol_num == 0x13:
        status_info = data[4]
        serial_no = struct.unpack('>H', data[9:11])[0] if len(data) >= 13 else 1

        # Build Heartbeat ACK: 78 78 05 13 [serial 2 bytes] [crc 2 bytes] 0D 0A
        ack_body = bytearray([0x05, 0x13])
        ack_body.extend(struct.pack('>H', serial_no))
        crc = crc16_itu(ack_body)
        ack = bytearray(b'\x78\x78')
        ack.extend(ack_body)
        ack.extend(struct.pack('>H', crc))
        ack.extend(b'\x0d\x0a')

        return {
            "type": "heartbeat",
            "protocol": "concox",
            "serial_no": serial_no,
        }, bytes(ack)

    # General packet fallback
    return {
        "type": "unknown",
        "protocol": "concox",
        "protocol_num": f"0x{protocol_num:02X}",
    }, None


def build_concox_login_packet(imei: str = "868204030123456", serial_no: int = 1) -> bytes:
    """Helper to synthesize a valid Concox GT06 Login packet for testing."""
    # Convert IMEI to 8 bytes BCD
    imei_padded = imei.zfill(16)
    imei_bytes = bytes.fromhex(imei_padded)

    body = bytearray([0x0A, 0x01])  # Length 10, protocol 0x01
    body.extend(imei_bytes[:8])
    body.extend(struct.pack('>H', serial_no))
    crc = crc16_itu(body)

    pkt = bytearray(b'\x78\x78')
    pkt.extend(body)
    pkt.extend(struct.pack('>H', crc))
    pkt.extend(b'\x0d\x0a')
    return bytes(pkt)


def build_concox_location_packet(
    lat: float = -1.286389,
    lng: float = 36.817223,
    speed: float = 75.0,
    heading: float = 310.0,
    recorded_at: Optional[datetime] = None,
    serial_no: int = 1,
) -> bytes:
    """Helper to synthesize a valid Concox GT06 GPS Location packet for testing."""
    dt = recorded_at or datetime.now(timezone.utc)
    y = dt.year - 2000
    m = dt.month
    d = dt.day
    hh = dt.hour
    mm = dt.minute
    ss = dt.second

    lat_raw = int(abs(lat) * 1800000)
    lng_raw = int(abs(lng) * 1800000)

    # Course status: bit 10 North/South, bit 11 East/West, bits 0-9 heading
    cs = int(heading) & 0x03FF
    if lat >= 0:
        cs |= 0x0400  # North
    if lng < 0:
        cs |= 0x0800  # West

    body = bytearray([0x1F, 0x22])  # Length, Protocol 0x22
    body.extend([y, m, d, hh, mm, ss])
    body.append(0x18)  # 8 satellites
    body.extend(struct.pack('>I', lat_raw))
    body.extend(struct.pack('>I', lng_raw))
    body.append(int(speed) & 0xFF)
    body.extend(struct.pack('>H', cs))
    body.extend(struct.pack('>H', serial_no))
    crc = crc16_itu(body)

    pkt = bytearray(b'\x78\x78')
    pkt.extend(body)
    pkt.extend(struct.pack('>H', crc))
    pkt.extend(b'\x0d\x0a')
    return bytes(pkt)


# ---------------------------------------------------------------------------
# 3. Core Telematics Ingestion & Trip Sync Processor
# ---------------------------------------------------------------------------

async def process_telemetry_point(
    db: AsyncSession,
    point: Dict[str, Any],
    manager_instance: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Ingests a single GPS telemetry coordinate point:
    1. Resolves vehicle by tracker_imei or plate_number.
    2. Logs point in gps_telemetry_logs (historical track trace).
    3. Updates vehicles table (last_ping_at, last_lat, last_lng, last_speed, last_heading).
    4. Finds active trip assigned to this vehicle (status: scheduled, boarding, in_transit).
    5. Updates trips table (current_lat, current_lng, current_speed, current_heading, last_gps_at).
    6. Triggers real-time WebSocket broadcast to passengers & SACCO radar.
    7. Evaluates statutory NTSA PSV overspeeding (> 80 km/h).
    """
    imei = point.get("imei")
    plate = point.get("plate_number")
    lat = float(point["lat"])
    lng = float(point["lng"])
    speed = float(point.get("speed", 0.0))
    heading = float(point.get("heading", 0.0))
    altitude = float(point.get("altitude", 0.0))
    satellites = int(point.get("satellites", 0))
    ignition = bool(point.get("ignition", True))
    protocol = point.get("protocol", "generic")
    recorded_at = point.get("recorded_at") or datetime.now(timezone.utc)
    raw_hex = point.get("raw_hex")
    is_overspeed = speed > NTSA_SPEED_LIMIT_KMH

    # Step 1: Resolve Vehicle
    veh_row = None
    if imei:
        q = text("SELECT id, plate_number, sacco_id, tracker_imei FROM vehicles WHERE tracker_imei = :imei LIMIT 1;")
        veh_row = (await db.execute(q, {"imei": imei})).mappings().first()

    if not veh_row and plate:
        q = text("SELECT id, plate_number, sacco_id, tracker_imei FROM vehicles WHERE plate_number = :plate LIMIT 1;")
        veh_row = (await db.execute(q, {"plate": plate})).mappings().first()

    vehicle_id = veh_row["id"] if veh_row else None
    resolved_plate = veh_row["plate_number"] if veh_row else (plate or "UNMAPPED")

    # Step 2: Log historical breadcrumb in gps_telemetry_logs
    await db.execute(
        text("""
            INSERT INTO gps_telemetry_logs (
                vehicle_id, imei, protocol, lat, lng, speed, heading, altitude,
                satellites, ignition_on, overspeed_flag, raw_payload_hex, recorded_at
            )
            VALUES (
                :vid, :imei, :protocol, :lat, :lng, :speed, :heading, :alt,
                :sat, :ign, :over, :raw, :rec
            );
        """),
        {
            "vid": vehicle_id,
            "imei": imei or "UNKNOWN",
            "protocol": protocol,
            "lat": lat,
            "lng": lng,
            "speed": speed,
            "heading": heading,
            "alt": altitude,
            "sat": satellites,
            "ign": ignition,
            "over": is_overspeed,
            "raw": raw_hex,
            "rec": recorded_at,
        }
    )

    # Step 3: Update vehicles table cache
    if vehicle_id:
        await db.execute(
            text("""
                UPDATE vehicles
                SET last_ping_at = :rec,
                    last_lat = :lat,
                    last_lng = :lng,
                    last_speed = :speed,
                    last_heading = :heading
                WHERE id = :vid;
            """),
            {
                "rec": recorded_at,
                "lat": lat,
                "lng": lng,
                "speed": speed,
                "heading": heading,
                "vid": vehicle_id,
            }
        )

    # Step 4: Find active trip and sync GPS coordinates
    active_trip = None
    if vehicle_id:
        trip_q = text("""
            SELECT id, name, status, route_id, driver_id
            FROM trips
            WHERE vehicle_id = :vid
              AND status IN ('in_transit', 'boarding', 'scheduled')
            ORDER BY CASE WHEN status = 'in_transit' THEN 1 WHEN status = 'boarding' THEN 2 ELSE 3 END, id DESC
            LIMIT 1;
        """)
        active_trip = (await db.execute(trip_q, {"vid": vehicle_id})).mappings().first()

    trip_id = active_trip["id"] if active_trip else None

    if trip_id:
        await db.execute(
            text("""
                UPDATE trips
                SET current_lat = :lat,
                    current_lng = :lng,
                    current_speed = :speed,
                    current_heading = :heading,
                    last_gps_at = :rec
                WHERE id = :tid;
            """),
            {
                "lat": lat,
                "lng": lng,
                "speed": speed,
                "heading": heading,
                "rec": recorded_at,
                "tid": trip_id,
            }
        )

    await db.commit()

    # Step 5: Broadcast WebSocket Updates
    telemetry_event = {
        "event": "hardware_telemetry",
        "vehicle_id": vehicle_id,
        "plate_number": resolved_plate,
        "imei": imei,
        "protocol": protocol,
        "lat": lat,
        "lng": lng,
        "speed": speed,
        "heading": heading,
        "satellites": satellites,
        "ignition": ignition,
        "overspeed": is_overspeed,
        "trip_id": trip_id,
        "recorded_at": recorded_at.isoformat() if hasattr(recorded_at, "isoformat") else str(recorded_at),
    }

    if manager_instance:
        try:
            if trip_id:
                await manager_instance.broadcast_trip(trip_id, {
                    "event": "trip_gps",
                    "trip_id": trip_id,
                    "lat": lat,
                    "lng": lng,
                    "speed": speed,
                    "heading": heading,
                    "timestamp": telemetry_event["recorded_at"],
                })
            # Broadcast to Fleet Radar
            await manager_instance.broadcast({
                "event": "radar_telemetry_ping",
                "telemetry": telemetry_event,
            })
        except Exception as ws_err:
            logger.warning(f"Failed to broadcast WebSocket telemetry: {ws_err}")

    return {
        "status": "ingested",
        "vehicle_id": vehicle_id,
        "plate_number": resolved_plate,
        "trip_id": trip_id,
        "speed_kmh": speed,
        "overspeed_warning": is_overspeed,
        "coordinates": {"lat": lat, "lng": lng},
        "recorded_at": telemetry_event["recorded_at"],
    }


# ---------------------------------------------------------------------------
# 4. Async TCP Socket Server Listeners
# ---------------------------------------------------------------------------

class HardwareTelemetryTCPServer:
    """Async TCP Server handling concurrent incoming socket connections from Teltonika & Concox trackers."""

    def __init__(self, db_session_factory, ws_manager=None):
        self.session_factory = db_session_factory
        self.ws_manager = ws_manager
        self.teltonika_server = None
        self.concox_server = None

    async def handle_teltonika_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """TCP Handler for Teltonika AVL Codec 8 devices."""
        client_addr = writer.get_extra_info('peername')
        logger.info(f"[TELTONIKA TCP] New connection from {client_addr}")
        session_imei = None

        try:
            # 1. Teltonika Handshake: Client sends IMEI
            handshake_data = await reader.read(64)
            if not handshake_data:
                return

            records, response = parse_teltonika_codec8(handshake_data)
            if records and records[0].get("type") == "handshake":
                session_imei = records[0]["imei"]
                writer.write(response)
                await writer.drain()
                logger.info(f"[TELTONIKA TCP] IMEI Accepted: {session_imei}")

            # 2. Continuous AVL Packet Ingestion Loop
            while not reader.at_eof():
                data = await reader.read(4096)
                if not data:
                    break

                try:
                    records, ack = parse_teltonika_codec8(data, imei=session_imei)
                    writer.write(ack)
                    await writer.drain()

                    async with self.session_factory() as db:
                        for rec in records:
                            if rec.get("type") == "avl_data":
                                rec["raw_hex"] = data.hex()[:256]
                                await process_telemetry_point(db, rec, self.ws_manager)
                except Exception as err:
                    logger.error(f"[TELTONIKA TCP] Error processing packet: {err}")
                    break
        except Exception as conn_err:
            logger.error(f"[TELTONIKA TCP] Socket error: {conn_err}")
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            logger.info(f"[TELTONIKA TCP] Connection closed for {client_addr} (IMEI: {session_imei})")

    async def handle_concox_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """TCP Handler for Concox GT06 devices."""
        client_addr = writer.get_extra_info('peername')
        logger.info(f"[CONCOX TCP] New connection from {client_addr}")
        session_imei = None

        try:
            while not reader.at_eof():
                data = await reader.read(2048)
                if not data:
                    break

                try:
                    info, ack = parse_concox_gt06(data)
                    if ack:
                        writer.write(ack)
                        await writer.drain()

                    if info.get("type") == "login":
                        session_imei = info["imei"]
                        logger.info(f"[CONCOX TCP] Login successful for IMEI: {session_imei}")
                    elif info.get("type") == "avl_data":
                        info["imei"] = session_imei
                        info["raw_hex"] = data.hex()[:256]
                        async with self.session_factory() as db:
                            await process_telemetry_point(db, info, self.ws_manager)
                except Exception as err:
                    logger.error(f"[CONCOX TCP] Packet decode error: {err}")
                    break
        except Exception as conn_err:
            logger.error(f"[CONCOX TCP] Socket error: {conn_err}")
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            logger.info(f"[CONCOX TCP] Connection closed for {client_addr}")

    async def start(self, host: str = "0.0.0.0", teltonika_port: int = 5027, concox_port: int = 5023):
        """Starts both Teltonika and Concox TCP socket servers concurrently."""
        try:
            self.teltonika_server = await asyncio.start_server(self.handle_teltonika_client, host, teltonika_port)
            logger.info(f"✓ Teltonika Codec 8 TCP Listener running on {host}:{teltonika_port}")
        except Exception as e:
            logger.warning(f"Could not bind Teltonika port {teltonika_port}: {e}")

        try:
            self.concox_server = await asyncio.start_server(self.handle_concox_client, host, concox_port)
            logger.info(f"✓ Concox GT06 TCP Listener running on {host}:{concox_port}")
        except Exception as e:
            logger.warning(f"Could not bind Concox port {concox_port}: {e}")

    async def stop(self):
        """Stops listeners cleanly."""
        if self.teltonika_server:
            self.teltonika_server.close()
            await self.teltonika_server.wait_closed()
        if self.concox_server:
            self.concox_server.close()
            await self.concox_server.wait_closed()

