"""
Handheld Thermal POS ESC/POS Binary Slip Generator
===================================================
Produces raw binary ESC/POS byte streams for portable 58mm (32 chars)
and 80mm (48 chars) Bluetooth & USB thermal printers commonly used by
Kenyan matatu conductors and stage clerks (Sunmi V2, Telpo, Zjiang, MPT-II).

Features:
- Standard ESC/POS commands (alignment, font weight, line spacing, paper feed, cut).
- Native 2D QR Code Generation via ESC/POS command sequences (GS ( k).
- Automatic text wrapping and column padding for 58mm (32 cols) and 80mm (48 cols).
- Output as raw binary, base64 payload, or formatted ASCII preview.
"""

import base64
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Tuple, List

# Column character limits for standard thermal roll widths (Font A 12x24)
WIDTH_COLS = {
    58: 32,
    80: 48,
}

# ---------------------------------------------------------------------------
# ESC/POS Byte Command Constants
# ---------------------------------------------------------------------------

ESC = b'\x1b'
GS = b'\x1d'

CMD_INIT = ESC + b'@'                    # Initialize printer
CMD_ALIGN_LEFT = ESC + b'a\x00'          # Left justification
CMD_ALIGN_CENTER = ESC + b'a\x01'        # Centered justification
CMD_ALIGN_RIGHT = ESC + b'a\x02'         # Right justification

CMD_BOLD_ON = ESC + b'E\x01'             # Emphasized / bold mode ON
CMD_BOLD_OFF = ESC + b'E\x00'            # Emphasized / bold mode OFF

CMD_DOUBLE_HEIGHT_ON = GS + b'!\x01'     # Double height font
CMD_DOUBLE_WIDTH_ON = GS + b'!\x10'      # Double width font
CMD_DOUBLE_BOTH_ON = GS + b'!\x11'       # Double height + width font
CMD_NORMAL_SIZE = GS + b'!\x00'          # Normal character size

CMD_FEED_AND_CUT = GS + b'V\x41\x00'     # Feed paper and full cut
CMD_PARTIAL_CUT = GS + b'V\x42\x00'      # Partial cut


def pad_line(left: str, right: str, width: int = 32) -> str:
    """Formats a two-column row (left-aligned label, right-aligned value)."""
    space_needed = width - len(left) - len(right)
    if space_needed < 1:
        # Truncate left string to fit
        max_left = max(0, width - len(right) - 1)
        left = left[:max_left]
        space_needed = 1
    return left + (" " * space_needed) + right


def center_text(text: str, width: int = 32) -> str:
    """Centers text within fixed width columns."""
    if len(text) >= width:
        return text[:width]
    pad = (width - len(text)) // 2
    return (" " * pad) + text


def divider_line(char: str = "-", width: int = 32) -> str:
    """Returns a divider separator line."""
    return char * width


def build_escpos_qr_code(content: str) -> bytes:
    """
    Generates native ESC/POS QR code command sequence (GS ( k).
    Model 2, Error correction level M, 4 dots per module.
    """
    data = content.encode('utf-8', errors='ignore')
    out = bytearray()

    # 1. Select QR Model (Model 2)
    # GS ( k 4 0 49 65 50 0
    out.extend(GS + b'(k\x04\x00\x31\x41\x32\x00')

    # 2. Set Module Size (Dots per module: 5)
    # GS ( k 3 0 49 67 5
    out.extend(GS + b'(k\x03\x00\x31\x43\x05')

    # 3. Set Error Correction (Level M - 15%)
    # GS ( k 3 0 49 69 49
    out.extend(GS + b'(k\x03\x00\x31\x45\x31')

    # 4. Store QR Data in Symbol Storage Area
    # GS ( k pL pH 49 80 48 <data>
    p_len = len(data) + 3
    pL = p_len & 0xFF
    pH = (p_len >> 8) & 0xFF
    out.extend(GS + b'(k' + bytes([pL, pH, 0x31, 0x50, 0x30]) + data)

    # 5. Print Symbol
    # GS ( k 3 0 49 81 48
    out.extend(GS + b'(k\x03\x00\x31\x51\x30')
    out.extend(b'\n')

    return bytes(out)


# ---------------------------------------------------------------------------
# 1. Passenger Boarding Slip Generator
# ---------------------------------------------------------------------------

def generate_passenger_ticket_escpos(
    ticket: Dict[str, Any],
    width_mm: int = 58,
) -> bytes:
    """
    Generates raw binary ESC/POS stream for passenger boarding ticket.
    
    Fields supported in ticket dict:
    - booking_id, seat_number, passenger_name, passenger_phone
    - sacco_name, route_name, board_stop, alight_stop
    - vehicle_plate, departure_time, fare_amount, luggage_fee, receipt_number
    """
    cols = WIDTH_COLS.get(width_mm, 32)
    buf = bytearray()

    # 1. Initialize
    buf.extend(CMD_INIT)
    buf.extend(CMD_ALIGN_CENTER)

    # 2. Header (Sacco & Service Branding)
    sacco = (ticket.get("sacco_name") or "BUSGO TRANSIT SACCO").upper()
    buf.extend(CMD_BOLD_ON + CMD_DOUBLE_HEIGHT_ON)
    buf.extend(f"{sacco}\n".encode('ascii', errors='replace'))
    buf.extend(CMD_NORMAL_SIZE)
    buf.extend(b"PSV PASSENGER STAGE TICKET\n")
    buf.extend(b"CUSTOMER CARE: +254 716 314 831\n")
    buf.extend(divider_line("=", cols).encode('ascii') + b"\n")

    # 3. Key Assignment Highlight (Large Seat Number & Plate)
    buf.extend(CMD_ALIGN_CENTER)
    seat_no = ticket.get("seat_number", 1)
    plate = ticket.get("vehicle_plate") or "ASSIGNED AT STAGE"

    buf.extend(CMD_DOUBLE_BOTH_ON + CMD_BOLD_ON)
    buf.extend(f"SEAT: #{seat_no}\n".encode('ascii'))
    buf.extend(CMD_NORMAL_SIZE)
    buf.extend(CMD_BOLD_ON)
    buf.extend(f"BUS: {plate}\n".encode('ascii'))
    buf.extend(CMD_BOLD_OFF)
    buf.extend(divider_line("-", cols).encode('ascii') + b"\n")

    # 4. Journey & Passenger Details
    buf.extend(CMD_ALIGN_LEFT)
    b_id = ticket.get("booking_id", 0)
    name = (ticket.get("passenger_name") or "PASSENGER").upper()
    phone = ticket.get("passenger_phone") or "WALK-IN"

    dep_dt = ticket.get("departure_time")
    if isinstance(dep_dt, datetime):
        dt_str = dep_dt.strftime("%d/%m/%Y %H:%M")
    elif dep_dt:
        dt_str = str(dep_dt)[:16].replace("T", " ")
    else:
        dt_str = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M")

    buf.extend(pad_line("TICKET NO:", f"BG-{b_id}", cols).encode('ascii') + b"\n")
    buf.extend(pad_line("DATE/TIME:", dt_str, cols).encode('ascii') + b"\n")
    buf.extend(pad_line("PASSENGER:", name[:cols - 12], cols).encode('ascii') + b"\n")
    buf.extend(pad_line("CONTACT:", phone, cols).encode('ascii') + b"\n")

    board = (ticket.get("board_stop") or "STAGE ORIGIN").upper()
    alight = (ticket.get("alight_stop") or "DESTINATION").upper()
    route = (ticket.get("route_name") or f"{board} - {alight}").upper()

    buf.extend(pad_line("ROUTE:", route[:cols - 7], cols).encode('ascii') + b"\n")
    buf.extend(pad_line("BOARD AT:", board[:cols - 10], cols).encode('ascii') + b"\n")
    buf.extend(pad_line("ALIGHT AT:", alight[:cols - 11], cols).encode('ascii') + b"\n")

    buf.extend(divider_line("-", cols).encode('ascii') + b"\n")

    # 5. Financial Breakdown
    fare = float(ticket.get("fare_amount") or 0.0)
    luggage = float(ticket.get("luggage_fee") or 0.0)
    total = fare + luggage
    receipt = ticket.get("receipt_number") or f"MP-{b_id}981"

    buf.extend(pad_line("BASE FARE:", f"KES {fare:,.2f}", cols).encode('ascii') + b"\n")
    if luggage > 0:
        buf.extend(pad_line("MZIGO LUGGAGE:", f"KES {luggage:,.2f}", cols).encode('ascii') + b"\n")

    buf.extend(CMD_BOLD_ON)
    buf.extend(pad_line("TOTAL PAID:", f"KES {total:,.2f}", cols).encode('ascii') + b"\n")
    buf.extend(pad_line("PAYMENT REF:", receipt, cols).encode('ascii') + b"\n")
    buf.extend(CMD_BOLD_OFF)

    buf.extend(divider_line("=", cols).encode('ascii') + b"\n")

    # 6. QR Code for Conductor Scanner Validation
    buf.extend(CMD_ALIGN_CENTER)
    qr_payload = f"BUSGO:TKT:{b_id}:{seat_no}:{receipt}"
    buf.extend(build_escpos_qr_code(qr_payload))
    buf.extend(b"SCAN QR TO VERIFY BOARDING\n")

    # 7. Police Manifest & Luggage Notice Footer
    buf.extend(b"\n")
    buf.extend(b"NOTICE: Retain ticket until alight.\n")
    buf.extend(b"Luggage carried at passenger risk.\n")
    buf.extend(b"REPORT GRIEVANCES: NTSA TOLL 0800 720 000\n")
    buf.extend(divider_line("*", cols).encode('ascii') + b"\n")

    # 8. Paper Feed & Cut
    buf.extend(b"\n\n\n")
    buf.extend(CMD_FEED_AND_CUT)

    return bytes(buf)


# ---------------------------------------------------------------------------
# 2. Parcel (Mzigo) Waybill Slip Generator
# ---------------------------------------------------------------------------

def generate_parcel_waybill_escpos(
    parcel: Dict[str, Any],
    width_mm: int = 58,
) -> bytes:
    """
    Generates raw binary ESC/POS stream for Mzigo courier / parcel dispatch receipt.
    """
    cols = WIDTH_COLS.get(width_mm, 32)
    buf = bytearray()

    buf.extend(CMD_INIT)
    buf.extend(CMD_ALIGN_CENTER)

    # Header
    buf.extend(CMD_BOLD_ON + CMD_DOUBLE_HEIGHT_ON)
    buf.extend(b"BUSGO MZIGO EXPRESS\n")
    buf.extend(CMD_NORMAL_SIZE)
    buf.extend(b"PARCEL WAYBILL & RECEIPT\n")
    buf.extend(divider_line("=", cols).encode('ascii') + b"\n")

    # Tracking Code
    code = parcel.get("tracking_code") or f"WB-{parcel.get('id', 101)}"
    pin = parcel.get("security_pin") or "1234"

    buf.extend(CMD_DOUBLE_BOTH_ON + CMD_BOLD_ON)
    buf.extend(f"{code}\n".encode('ascii'))
    buf.extend(CMD_NORMAL_SIZE)
    buf.extend(CMD_BOLD_ON)
    buf.extend(f"CLAIM PIN: {pin}\n".encode('ascii'))
    buf.extend(CMD_BOLD_OFF)
    buf.extend(divider_line("-", cols).encode('ascii') + b"\n")

    # Sender & Recipient
    buf.extend(CMD_ALIGN_LEFT)
    s_name = (parcel.get("sender_name") or "SENDER").upper()
    s_phone = parcel.get("sender_phone") or "-"
    r_name = (parcel.get("recipient_name") or "RECIPIENT").upper()
    r_phone = parcel.get("recipient_phone") or "-"

    buf.extend(pad_line("SENDER:", s_name[:cols - 8], cols).encode('ascii') + b"\n")
    buf.extend(pad_line("PHONE:", s_phone, cols).encode('ascii') + b"\n")
    buf.extend(divider_line(".", cols).encode('ascii') + b"\n")
    buf.extend(pad_line("RECIPIENT:", r_name[:cols - 11], cols).encode('ascii') + b"\n")
    buf.extend(pad_line("PHONE:", r_phone, cols).encode('ascii') + b"\n")

    cat = (parcel.get("category") or "General").upper()
    weight = parcel.get("weight_kg", 5.0)
    fee = float(parcel.get("fee", 500.0))

    buf.extend(divider_line("-", cols).encode('ascii') + b"\n")
    buf.extend(pad_line("CATEGORY:", cat, cols).encode('ascii') + b"\n")
    buf.extend(pad_line("WEIGHT:", f"{weight} KG", cols).encode('ascii') + b"\n")
    buf.extend(CMD_BOLD_ON)
    buf.extend(pad_line("FEE PAID:", f"KES {fee:,.2f}", cols).encode('ascii') + b"\n")
    buf.extend(CMD_BOLD_OFF)

    buf.extend(divider_line("=", cols).encode('ascii') + b"\n")

    # QR Code
    buf.extend(CMD_ALIGN_CENTER)
    buf.extend(build_escpos_qr_code(f"BUSGO:MZIGO:{code}:{pin}"))
    buf.extend(b"PRESENT PIN AT DESTINATION COUNTER\n\n\n\n")
    buf.extend(CMD_FEED_AND_CUT)

    return bytes(buf)


# ---------------------------------------------------------------------------
# 3. Plain ASCII Slip Fallback (for browser modal previews)
# ---------------------------------------------------------------------------

def generate_plain_ascii_slip(ticket: Dict[str, Any], width_mm: int = 58) -> str:
    """Generates pure monospace text formatted strictly to thermal column widths."""
    cols = WIDTH_COLS.get(width_mm, 32)
    lines: List[str] = []

    sacco = (ticket.get("sacco_name") or "BUSGO TRANSIT SACCO").upper()
    lines.append(center_text(f"*** {sacco} ***", cols))
    lines.append(center_text("STAGE PASSENGER TICKET", cols))
    lines.append(center_text("CUSTOMER CARE: 0716 314 831", cols))
    lines.append(divider_line("=", cols))

    seat_no = ticket.get("seat_number", 1)
    plate = ticket.get("vehicle_plate") or "ASSIGNED AT STAGE"
    lines.append(center_text(f"SEAT: #{seat_no}", cols))
    lines.append(center_text(f"BUS: {plate}", cols))
    lines.append(divider_line("-", cols))

    b_id = ticket.get("booking_id", 0)
    dep_dt = ticket.get("departure_time")
    if isinstance(dep_dt, datetime):
        dt_str = dep_dt.strftime("%d/%m/%Y %H:%M")
    elif dep_dt:
        dt_str = str(dep_dt)[:16].replace("T", " ")
    else:
        dt_str = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M")

    lines.append(pad_line("TICKET NO:", f"BG-{b_id}", cols))
    lines.append(pad_line("DATE/TIME:", dt_str, cols))
    lines.append(pad_line("PASSENGER:", (ticket.get("passenger_name") or "PASSENGER").upper()[:cols - 12], cols))
    lines.append(pad_line("PHONE:", ticket.get("passenger_phone") or "WALK-IN", cols))

    board = (ticket.get("board_stop") or "STAGE ORIGIN").upper()
    alight = (ticket.get("alight_stop") or "DESTINATION").upper()
    lines.append(pad_line("FROM:", board[:cols - 6], cols))
    lines.append(pad_line("TO:", alight[:cols - 4], cols))
    lines.append(divider_line("-", cols))

    fare = float(ticket.get("fare_amount") or 0.0)
    luggage = float(ticket.get("luggage_fee") or 0.0)
    total = fare + luggage
    receipt = ticket.get("receipt_number") or f"MP-{b_id}981"

    lines.append(pad_line("FARE:", f"KES {fare:,.2f}", cols))
    if luggage > 0:
        lines.append(pad_line("LUGGAGE:", f"KES {luggage:,.2f}", cols))
    lines.append(pad_line("TOTAL PAID:", f"KES {total:,.2f}", cols))
    lines.append(pad_line("RECEIPT REF:", receipt, cols))
    lines.append(divider_line("=", cols))
    lines.append(center_text(f"[QR: BUSGO:TKT:{b_id}:{seat_no}]", cols))
    lines.append(center_text("SCAN QR TO BOARD", cols))
    lines.append(divider_line("*", cols))
    lines.append(center_text("Retain ticket until alight.", cols))

    return "\n".join(lines)
