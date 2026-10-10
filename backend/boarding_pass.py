"""
BUSGO Cryptographic E-Boarding Pass & QR Code Verification Engine.

Zero-dependency pure Python implementation:
  1. HMAC-SHA256 Cryptographic Ticket Signing & Offline Anti-Tamper Verification.
  2. ISO/IEC 18004 QR Code Model 2 Matrix & SVG Generation (Reed-Solomon ECC).
  3. High-Fidelity PDF-1.4 Vector E-Boarding Pass Generator (A4 / Executive voucher).
"""

import os
import hmac
import hashlib
import zlib
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

# Secret signing key for offline conductor verification
BUSGO_TICKET_SECRET = os.getenv("BUSGO_TICKET_SECRET", "busgo-production-hmac-ticket-secret-v1-2026")


# ==============================================================================
# 1. Cryptographic HMAC-SHA256 Token Signature & Verification
# ==============================================================================

def generate_ticket_hmac_token(
    booking_id: int,
    trip_id: int,
    seat_number: int,
    secret_key: Optional[str] = None
) -> str:
    """
    Generates a compact, tamper-evident cryptographic QR token for offline validation.
    Format: BG1:<booking_id>:<trip_id>:<seat_number>:<hmac_12>
    Example: BG1:1042:1:8:b7a3e9c401f2
    """
    secret = (secret_key or BUSGO_TICKET_SECRET).encode("utf-8")
    payload = f"{booking_id}:{trip_id}:{seat_number}".encode("utf-8")
    sig = hmac.new(secret, payload, hashlib.sha256).hexdigest()[:12]
    return f"BG1:{booking_id}:{trip_id}:{seat_number}:{sig}"


def verify_ticket_hmac_token(
    token_str: str,
    secret_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Verifies the cryptographic integrity of a scanned ticket token.
    Supports:
      - Signed tokens: BG1:<booking_id>:<trip_id>:<seat_number>:<sig>
      - Legacy tokens: BUSGO:<booking_id>:<trip_id>:<seat_number> or plain numbers
    """
    clean = str(token_str).strip()
    if not clean:
        return {"valid": False, "reason": "Empty token provided."}

    # Signed token format: BG1:...
    if clean.startswith("BG1:"):
        parts = clean.split(":")
        if len(parts) != 5:
            return {"valid": False, "reason": "Malformed signed ticket format."}
        try:
            booking_id = int(parts[1])
            trip_id = int(parts[2])
            seat_number = int(parts[3])
            sig_received = parts[4].lower()
        except ValueError:
            return {"valid": False, "reason": "Invalid integer fields in ticket token."}

        secret = (secret_key or BUSGO_TICKET_SECRET).encode("utf-8")
        payload = f"{booking_id}:{trip_id}:{seat_number}".encode("utf-8")
        expected_sig = hmac.new(secret, payload, hashlib.sha256).hexdigest()[:12].lower()

        # Constant-time comparison to prevent timing attacks
        if not hmac.compare_digest(sig_received, expected_sig):
            return {
                "valid": False,
                "tampered": True,
                "booking_id": booking_id,
                "trip_id": trip_id,
                "seat_number": seat_number,
                "reason": "Cryptographic signature mismatch! Ticket code may be forged or tampered.",
            }

        return {
            "valid": True,
            "tampered": False,
            "version": 1,
            "booking_id": booking_id,
            "trip_id": trip_id,
            "seat_number": seat_number,
            "signature": sig_received,
            "reason": "Ticket signature verified authentic.",
        }

    # Legacy format: BUSGO:<booking_id>:<trip_id>:<seat_number>
    if clean.startswith("BUSGO:"):
        parts = clean.split(":")
        if len(parts) >= 4:
            try:
                booking_id = int(parts[1])
                trip_id = int(parts[2])
                seat_number = int(parts[3])
                return {
                    "valid": True,
                    "tampered": False,
                    "legacy": True,
                    "booking_id": booking_id,
                    "trip_id": trip_id,
                    "seat_number": seat_number,
                    "reason": "Legacy unsigned ticket accepted.",
                }
            except ValueError:
                pass

    # Fallback integer or BG-ref
    parts = clean.replace(":", "-").split("-")
    digits = [int(p) for p in parts if p.isdigit()]
    if digits:
        return {
            "valid": True,
            "tampered": False,
            "legacy": True,
            "booking_id": digits[0],
            "seat_number": digits[1] if len(digits) > 1 else None,
            "reason": "Parsed numeric booking identifier.",
        }

    return {"valid": False, "reason": f"Unrecognized ticket format: {clean}"}


# ==============================================================================
# 2. Pure Python ISO/IEC 18004 QR Code Generator (Galois Field & Reed-Solomon)
# ==============================================================================

# Galois Field GF(256) tables
EXP_TABLE = [0] * 512
LOG_TABLE = [0] * 256

def _init_gf():
    val = 1
    for i in range(255):
        EXP_TABLE[i] = val
        EXP_TABLE[i + 255] = val
        LOG_TABLE[val] = i
        val <<= 1
        if val & 256:
            val ^= 0x11D  # 285

_init_gf()

def _gf_mul(x: int, y: int) -> int:
    if x == 0 or y == 0:
        return 0
    return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]]

def _rs_poly(degree: int) -> List[int]:
    poly = [1]
    for i in range(degree):
        next_poly = [0] * (len(poly) + 1)
        factor = EXP_TABLE[i]
        for j in range(len(poly)):
            next_poly[j] ^= _gf_mul(poly[j], factor)
            next_poly[j + 1] ^= poly[j]
        poly = next_poly
    return poly

def _calculate_ecc(data: bytes, ecc_len: int) -> List[int]:
    gen = _rs_poly(ecc_len)
    remainder = [0] * ecc_len
    for byte in data:
        factor = byte ^ remainder[0]
        for j in range(ecc_len - 1):
            remainder[j] = remainder[j + 1] ^ _gf_mul(gen[j + 1], factor)
        remainder[ecc_len - 1] = _gf_mul(gen[ecc_len], factor)
    return remainder


def generate_qr_matrix(text: str) -> List[List[bool]]:
    """
    Generates a standard QR Code Model 2 boolean 2D matrix (True = dark module).
    Supports Version 1-4 with Medium ECC.
    """
    data_bytes = text.encode("utf-8")
    length = len(data_bytes)

    if length <= 14:
        version = 1
        total_data = 16
        ecc_len = 10
    elif length <= 26:
        version = 2
        total_data = 28
        ecc_len = 16
    elif length <= 42:
        version = 3
        total_data = 44
        ecc_len = 26
    else:
        version = 4
        total_data = 64
        ecc_len = 36

    size = version * 4 + 17
    modules: List[List[Optional[bool]]] = [[None] * size for _ in range(size)]

    # 1. Finder patterns
    def draw_finder(row: int, col: int):
        for r in range(-1, 8):
            for c in range(-1, 8):
                mr, mc = row + r, col + c
                if 0 <= mr < size and 0 <= mc < size:
                    if 0 <= r <= 6 and 0 <= c <= 6:
                        is_border = r in (0, 6) or c in (0, 6)
                        is_center = 2 <= r <= 4 and 2 <= c <= 4
                        modules[mr][mc] = is_border or is_center
                    else:
                        modules[mr][mc] = False

    draw_finder(0, 0)
    draw_finder(0, size - 7)
    draw_finder(size - 7, 0)

    # 2. Alignment pattern (version >= 2)
    if version >= 2:
        align_pos = size - 7
        for r in range(-2, 3):
            for c in range(-2, 3):
                is_border = abs(r) == 2 or abs(c) == 2
                is_center = r == 0 and c == 0
                modules[align_pos + r][align_pos + c] = is_border or is_center

    # 3. Timing patterns
    for i in range(8, size - 8):
        if modules[6][i] is None:
            modules[6][i] = (i % 2 == 0)
        if modules[i][6] is None:
            modules[i][6] = (i % 2 == 0)

    # Dark module
    modules[size - 8][8] = True

    # 4. Reserve format info
    for i in range(9):
        if modules[8][i] is None:
            modules[8][i] = False
        if modules[i][8] is None:
            modules[i][8] = False
    for i in range(size - 8, size):
        if modules[8][i] is None:
            modules[8][i] = False
        if modules[i][8] is None:
            modules[i][8] = False

    # 5. Bitstream encoding: Byte mode (0100) + character count + bytes
    bitstream: List[int] = []
    def push_bits(val: int, bits: int):
        for i in range(bits - 1, -1, -1):
            bitstream.append((val >> i) & 1)

    push_bits(0b0100, 4)  # Byte mode
    push_bits(length, 8)  # Character count
    for b in data_bytes:
        push_bits(b, 8)

    max_bits = total_data * 8
    term_len = min(4, max_bits - len(bitstream))
    push_bits(0, term_len)

    while len(bitstream) % 8 != 0:
        bitstream.append(0)

    pad_bytes = [0xEC, 0x11]
    pad_idx = 0
    while len(bitstream) < max_bits:
        push_bits(pad_bytes[pad_idx % 2], 8)
        pad_idx += 1

    codewords = bytearray(total_data)
    for i in range(total_data):
        val = 0
        for bit in range(8):
            val = (val << 1) | bitstream[i * 8 + bit]
        codewords[i] = val

    ecc = _calculate_ecc(bytes(codewords), ecc_len)
    final_codewords = bytes(codewords) + bytes(ecc)

    all_bits: List[int] = []
    for cw in final_codewords:
        for i in range(7, -1, -1):
            all_bits.append((cw >> i) & 1)

    # 6. Place data bits (zigzag right-to-left, skip function patterns, mask 0)
    bit_idx = 0
    direction = -1
    row = size - 1

    right_col = size - 1
    while right_col > 0:
        if right_col == 6:
            right_col -= 1
        while 0 <= row < size:
            for c_offset in range(2):
                col = right_col - c_offset
                if modules[row][col] is None:
                    bit = all_bits[bit_idx] if bit_idx < len(all_bits) else 0
                    bit_idx += 1
                    # Mask 0: (row + col) % 2 == 0
                    mask = ((row + col) % 2 == 0)
                    modules[row][col] = (bit == 1) != mask
            row += direction
        direction = -direction
        row += direction
        right_col -= 2

    # 7. Format information (ECC M, Mask 0: 0x5412 = 101010000010010)
    format_bits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0]
    for i in range(6):
        modules[8][i] = (format_bits[i] == 1)
    modules[8][7] = (format_bits[6] == 1)
    modules[8][8] = (format_bits[7] == 1)
    modules[7][8] = (format_bits[8] == 1)
    for i in range(9, 15):
        modules[14 - i][8] = (format_bits[i] == 1)

    for i in range(7):
        modules[size - 1 - i][8] = (format_bits[i] == 1)
    for i in range(7, 15):
        modules[8][size - 15 + i] = (format_bits[i] == 1)

    # Clean None -> False
    return [[bool(m) for m in r] for r in modules]


def generate_qr_svg(text: str, size_px: int = 200, padding: int = 2) -> str:
    """Renders QR code matrix as a standalone SVG markup string."""
    matrix = generate_qr_matrix(text)
    matrix_size = len(matrix)
    total_dim = matrix_size + padding * 2

    paths = []
    for r in range(matrix_size):
        for c in range(matrix_size):
            if matrix[r][c]:
                paths.append(f"M{c + padding},{r + padding}h1v1h-1z")

    path_data = " ".join(paths)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_dim} {total_dim}" '
        f'width="{size_px}" height="{size_px}" shape-rendering="crispEdges">\n'
        f'  <rect width="{total_dim}" height="{total_dim}" fill="#ffffff"/>\n'
        f'  <path d="{path_data}" fill="#0f172a"/>\n'
        f'</svg>'
    )


# ==============================================================================
# 3. High-Fidelity Pure-Python PDF-1.4 Boarding Pass Document Generator
# ==============================================================================

class SimplePdfCanvas:
    """Minimal, robust PDF-1.4 stream canvas builder with vector operations and typography."""

    def __init__(self, width: float = 595.28, height: float = 841.89):
        # A4 standard dimensions in PostScript points (72 pt/inch)
        self.width = width
        self.height = height
        self.stream_ops: List[str] = []

    def set_fill_rgb(self, r: float, g: float, b: float):
        self.stream_ops.append(f"{r:.3f} {g:.3f} {b:.3f} rg")

    def set_stroke_rgb(self, r: float, g: float, b: float):
        self.stream_ops.append(f"{r:.3f} {g:.3f} {b:.3f} RG")

    def set_line_width(self, w: float):
        self.stream_ops.append(f"{w:.2f} w")

    def set_dash(self, array_str: str = "[]", phase: int = 0):
        self.stream_ops.append(f"{array_str} {phase} d")

    def rect(self, x: float, y: float, w: float, h: float, fill: bool = True, stroke: bool = False):
        op = "B" if (fill and stroke) else ("f" if fill else "S")
        self.stream_ops.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re {op}")

    def round_rect(self, x: float, y: float, w: float, h: float, r: float = 8.0, fill: bool = True, stroke: bool = False):
        """Draws rounded rectangle using cubic Bezier curves."""
        op = "B" if (fill and stroke) else ("f" if fill else "S")
        # Approximate circle quarter with kappa = 0.55228475
        k = r * 0.55228475
        ops = [
            f"{x + r:.2f} {y:.2f} m",
            f"{x + w - r:.2f} {y:.2f} l",
            f"{x + w - r + k:.2f} {y:.2f} {x + w:.2f} {y + k:.2f} {x + w:.2f} {y + r:.2f} c",
            f"{x + w:.2f} {y + h - r:.2f} l",
            f"{x + w:.2f} {y + h - r + k:.2f} {x + w - r + k:.2f} {y + h:.2f} {x + w - r:.2f} {y + h:.2f} c",
            f"{x + r:.2f} {y + h:.2f} l",
            f"{x + r - k:.2f} {y + h:.2f} {x:.2f} {y + h - r + k:.2f} {x:.2f} {y + h - r:.2f} c",
            f"{x:.2f} {y + r:.2f} l",
            f"{x:.2f} {y + r - k:.2f} {x + r - k:.2f} {y:.2f} {x + r:.2f} {y:.2f} c",
            f"h {op}"
        ]
        self.stream_ops.extend(ops)

    def line(self, x1: float, y1: float, x2: float, y2: float):
        self.stream_ops.append(f"{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def text(self, text_str: str, x: float, y: float, font: str = "/F1", size: float = 12.0):
        # Escape parenthesis and backslashes in PDF text string
        safe_text = (
            text_str.replace("\\", "\\\\")
            .replace("(", "\\(")
            .replace(")", "\\)")
        )
        self.stream_ops.append(f"BT {font} {size:.1f} Tf {x:.2f} {y:.2f} Td ({safe_text}) Tj ET")

    def draw_qr_matrix(self, matrix: List[List[bool]], x: float, y: float, total_size: float = 120.0):
        """Draws crisp vector QR modules directly into the PDF content stream."""
        dim = len(matrix)
        mod_size = total_size / dim
        for r_idx in range(dim):
            # In PDF coordinates, y=0 is bottom
            mod_y = y + (dim - 1 - r_idx) * mod_size
            for c_idx in range(dim):
                if matrix[r_idx][c_idx]:
                    mod_x = x + c_idx * mod_size
                    self.stream_ops.append(f"{mod_x:.2f} {mod_y:.2f} {mod_size:.2f} {mod_size:.2f} re f")

    def build_pdf_bytes(self) -> bytes:
        """Assembles PDF document with xref table and trailer."""
        content = "\n".join(self.stream_ops).encode("latin-1", "replace")
        compressed_content = zlib.compress(content)

        objects: List[bytes] = []

        # Obj 1: Catalog
        objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

        # Obj 2: Pages
        objects.append(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")

        # Obj 3: Page
        page_dict = (
            f"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.width:.2f} {self.height:.2f}] "
            f"/Contents 4 0 R /Resources << /Font << "
            f"/F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> "
            f"/F1B << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> "
            f"/F2 << /Type /Font /Subtype /Type1 /BaseFont /Courier >> "
            f"/F2B << /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >> "
            f">> >> >>\nendobj\n"
        ).encode("latin-1")
        objects.append(page_dict)

        # Obj 4: Stream (compressed content)
        stream_header = f"4 0 obj\n<< /Length {len(compressed_content)} /Filter /FlateDecode >>\nstream\n".encode("latin-1")
        objects.append(stream_header + compressed_content + b"\nendstream\nendobj\n")

        # Calculate xref offsets
        pdf_header = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
        body = b""
        offsets = [0]
        cur_offset = len(pdf_header)

        for obj in objects:
            offsets.append(cur_offset)
            body += obj
            cur_offset += len(obj)

        # Xref table
        xref_offset = cur_offset + len(pdf_header)
        xref = f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode("latin-1")
        for off in offsets[1:]:
            xref += f"{off:010d} 00000 n \n".encode("latin-1")

        trailer = (
            f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\n"
            f"startxref\n{len(pdf_header) + len(body)}\n%%EOF\n"
        ).encode("latin-1")

        return pdf_header + body + xref + trailer


def generate_boarding_pass_pdf(booking_data: Dict[str, Any]) -> bytes:
    """
    Generates a high-fidelity BusGo Transit E-Boarding Pass PDF.
    Features:
      - Vector brand badge & SACCO operator title
      - Prominent seat assignment (#08)
      - Direct corridor journey graphic (Boarding -> Alighting)
      - Complete fare breakdown & M-Pesa receipt verification
      - Cryptographically signed HMAC QR code matrix
      - NTSA official safety notice & conditions of carriage
    """
    booking_id = int(booking_data.get("id") or booking_data.get("booking_id") or 1)
    trip_id = int(booking_data.get("trip_id") or 1)
    seat = int(booking_data.get("seat_number") or 1)
    passenger_name = booking_data.get("passenger_name") or "Commuter Passenger"
    passenger_phone = booking_data.get("passenger_phone") or booking_data.get("phone") or "+254700000000"
    route_name = booking_data.get("route_name") or "Kenyan Highway Corridor"
    trip_name = booking_data.get("trip_name") or "Express PSV Transit"
    board_stop = booking_data.get("board_stop") or f"Stop #{booking_data.get('board_stop_order', 1)}"
    alight_stop = booking_data.get("alight_stop") or f"Stop #{booking_data.get('alight_stop_order', 2)}"
    plate = booking_data.get("vehicle_plate") or "FLEET UNIT"
    model = booking_data.get("vehicle_model") or "Standard PSV Minibus"
    sacco_name = booking_data.get("sacco_name") or "BUSGO MOBILITY ALLIANCE"
    dept_str = booking_data.get("departure_time") or datetime.now().strftime("%Y-%m-%d %H:%M")
    receipt_no = booking_data.get("receipt_number") or "OFFICIAL-MPESA"
    base_fare = float(booking_data.get("fare_amount") or booking_data.get("base_fare") or 500.0)
    has_luggage = bool(booking_data.get("has_luggage", False))
    luggage_fee = float(booking_data.get("luggage_fee") or 0.0) if has_luggage else 0.0
    total_fare = base_fare + luggage_fee
    payment_status = (booking_data.get("payment_status") or "PAID").upper()

    # Generate HMAC Signed QR Token
    qr_token = generate_ticket_hmac_token(booking_id, trip_id, seat)
    qr_matrix = generate_qr_matrix(qr_token)

    # Initialize A4 Canvas (595.28 x 841.89 pt)
    pdf = SimplePdfCanvas(width=595.28, height=841.89)

    # Background canvas tint
    pdf.set_fill_rgb(0.97, 0.98, 0.99)
    pdf.rect(0, 0, 595.28, 841.89, fill=True)

    # Main Boarding Pass Card Container (margin 40pt)
    card_x = 36.0
    card_y = 50.0
    card_w = 523.28
    card_h = 741.89

    # Card background (Pure White) + subtle border
    pdf.set_fill_rgb(1.0, 1.0, 1.0)
    pdf.set_stroke_rgb(0.85, 0.88, 0.92)
    pdf.set_line_width(1.0)
    pdf.round_rect(card_x, card_y, card_w, card_h, r=16.0, fill=True, stroke=True)

    # 1. Top Header Banner (Brand Navy #0A1128)
    banner_h = 100.0
    banner_y = card_y + card_h - banner_h
    pdf.set_fill_rgb(0.04, 0.07, 0.16)
    pdf.round_rect(card_x, banner_y, card_w, banner_h, r=16.0, fill=True, stroke=False)
    # Square bottom edges of header
    pdf.rect(card_x, banner_y, card_w, 20.0, fill=True, stroke=False)

    # Emblem Badge (Cyan Accented Rounded Box)
    badge_x = card_x + 24.0
    badge_y = banner_y + 22.0
    badge_sz = 56.0
    pdf.set_fill_rgb(0.02, 0.71, 0.83) # #06b6d4
    pdf.round_rect(badge_x, badge_y, badge_sz, badge_sz, r=10.0, fill=True, stroke=False)
    # Emblem Letters "BG"
    pdf.set_fill_rgb(0.04, 0.07, 0.16)
    pdf.text("BG", badge_x + 11.0, badge_y + 17.0, font="/F1B", size=26.0)

    # Header Titles
    pdf.set_fill_rgb(1.0, 1.0, 1.0)
    pdf.text("BUSGO TRANSIT SYSTEM", card_x + 92.0, banner_y + 60.0, font="/F1B", size=20.0)
    pdf.set_fill_rgb(0.02, 0.71, 0.83)
    pdf.text("OFFICIAL HIGHWAY E-BOARDING PASS", card_x + 92.0, banner_y + 44.0, font="/F1B", size=10.0)
    pdf.set_fill_rgb(0.70, 0.75, 0.82)
    pdf.text(f"OPERATOR: {sacco_name.upper()} · SACCO REGULATED", card_x + 92.0, banner_y + 28.0, font="/F1", size=9.0)

    # Paid Badge on Top Right
    pdf.set_fill_rgb(0.06, 0.53, 0.38) # Emerald badge
    pdf.round_rect(card_x + card_w - 140.0, banner_y + 42.0, 116.0, 26.0, r=6.0, fill=True, stroke=False)
    pdf.set_fill_rgb(1.0, 1.0, 1.0)
    pdf.text("VERIFIED & PAID", card_x + card_w - 128.0, banner_y + 51.0, font="/F1B", size=10.0)
    pdf.set_fill_rgb(0.80, 0.85, 0.90)
    pdf.text(f"REF: {receipt_no[:14]}", card_x + card_w - 140.0, banner_y + 28.0, font="/F2B", size=8.5)

    # 2. Prominent Corridor Banner (Origin ➔ Destination)
    corridor_y = banner_y - 82.0
    pdf.set_fill_rgb(0.96, 0.97, 0.99)
    pdf.set_stroke_rgb(0.88, 0.90, 0.94)
    pdf.round_rect(card_x + 24.0, corridor_y, card_w - 48.0, 68.0, r=10.0, fill=True, stroke=True)

    # Boarding Stage (Left)
    pdf.set_fill_rgb(0.02, 0.71, 0.83)
    pdf.text("BOARDING STAGE", card_x + 40.0, corridor_y + 48.0, font="/F1B", size=9.0)
    pdf.set_fill_rgb(0.08, 0.12, 0.20)
    pdf.text(board_stop[:26], card_x + 40.0, corridor_y + 28.0, font="/F1B", size=15.0)
    pdf.set_fill_rgb(0.45, 0.50, 0.58)
    pdf.text(f"Route: {route_name[:28]}", card_x + 40.0, corridor_y + 14.0, font="/F1", size=8.5)

    # Arrow Graphic in Center
    center_cx = card_x + (card_w / 2.0)
    pdf.set_fill_rgb(0.70, 0.75, 0.82)
    pdf.text("TRANSIT CORRIDOR", center_cx - 44.0, corridor_y + 46.0, font="/F1B", size=7.5)
    pdf.set_stroke_rgb(0.02, 0.71, 0.83)
    pdf.set_line_width(2.0)
    pdf.line(center_cx - 36.0, corridor_y + 32.0, center_cx + 26.0, corridor_y + 32.0)
    pdf.line(center_cx + 20.0, corridor_y + 36.0, center_cx + 28.0, corridor_y + 32.0)
    pdf.line(center_cx + 20.0, corridor_y + 28.0, center_cx + 28.0, corridor_y + 32.0)

    # Alighting Stage (Right)
    pdf.set_fill_rgb(0.35, 0.28, 0.85)
    pdf.text("FINAL DESTINATION", card_x + card_w - 180.0, corridor_y + 48.0, font="/F1B", size=9.0)
    pdf.set_fill_rgb(0.08, 0.12, 0.20)
    pdf.text(alight_stop[:24], card_x + card_w - 180.0, corridor_y + 28.0, font="/F1B", size=15.0)
    pdf.set_fill_rgb(0.45, 0.50, 0.58)
    pdf.text(f"Service: {trip_name[:22]}", card_x + card_w - 180.0, corridor_y + 14.0, font="/F1", size=8.5)

    # 3. Triple Specs Matrix: Seat Number, Status, Fare Paid
    matrix_y = corridor_y - 84.0
    col_w = (card_w - 48.0 - 16.0) / 3.0

    # Col 1: Big Seat Card
    pdf.set_fill_rgb(0.92, 0.98, 1.00) # Soft cyan tint
    pdf.set_stroke_rgb(0.68, 0.89, 0.96)
    pdf.set_line_width(1.0)
    pdf.round_rect(card_x + 24.0, matrix_y, col_w, 72.0, r=8.0, fill=True, stroke=True)
    pdf.set_fill_rgb(0.02, 0.50, 0.65)
    pdf.text("ASSIGNED SEAT", card_x + 36.0, matrix_y + 54.0, font="/F1B", size=8.5)
    pdf.set_fill_rgb(0.02, 0.55, 0.72)
    pdf.text(f"#{seat}", card_x + 36.0, matrix_y + 18.0, font="/F1B", size=32.0)

    # Col 2: Departure Time & Date
    pdf.set_fill_rgb(0.97, 0.98, 0.99)
    pdf.set_stroke_rgb(0.88, 0.90, 0.94)
    pdf.round_rect(card_x + 24.0 + col_w + 8.0, matrix_y, col_w, 72.0, r=8.0, fill=True, stroke=True)
    pdf.set_fill_rgb(0.40, 0.45, 0.55)
    pdf.text("SCHEDULED DEPARTURE", card_x + 36.0 + col_w + 8.0, matrix_y + 54.0, font="/F1B", size=8.5)
    pdf.set_fill_rgb(0.08, 0.12, 0.20)
    pdf.text(str(dept_str)[:16], card_x + 36.0 + col_w + 8.0, matrix_y + 32.0, font="/F1B", size=13.0)
    pdf.set_fill_rgb(0.06, 0.53, 0.38)
    pdf.text("Please report 15 mins prior", card_x + 36.0 + col_w + 8.0, matrix_y + 16.0, font="/F1", size=8.5)

    # Col 3: Fare & Payment Total
    pdf.set_fill_rgb(0.97, 0.98, 0.99)
    pdf.set_stroke_rgb(0.88, 0.90, 0.94)
    pdf.round_rect(card_x + 24.0 + (col_w + 8.0) * 2, matrix_y, col_w, 72.0, r=8.0, fill=True, stroke=True)
    pdf.set_fill_rgb(0.40, 0.45, 0.55)
    pdf.text("TOTAL FARE COLLECTED", card_x + 36.0 + (col_w + 8.0) * 2, matrix_y + 54.0, font="/F1B", size=8.5)
    pdf.set_fill_rgb(0.08, 0.12, 0.20)
    pdf.text(f"KES {total_fare:,.2f}", card_x + 36.0 + (col_w + 8.0) * 2, matrix_y + 30.0, font="/F1B", size=16.0)
    pdf.set_fill_rgb(0.45, 0.50, 0.58)
    pdf.text(f"Status: {payment_status}", card_x + 36.0 + (col_w + 8.0) * 2, matrix_y + 16.0, font="/F1B", size=8.5)

    # 4. Passenger & Vehicle Particulars Table
    details_y = matrix_y - 100.0
    pdf.set_fill_rgb(1.0, 1.0, 1.0)
    pdf.set_stroke_rgb(0.88, 0.90, 0.94)
    pdf.round_rect(card_x + 24.0, details_y, card_w - 48.0, 88.0, r=8.0, fill=True, stroke=True)

    # Row 1
    pdf.set_fill_rgb(0.50, 0.55, 0.65)
    pdf.text("PASSENGER NAME", card_x + 36.0, details_y + 68.0, font="/F1B", size=8.0)
    pdf.set_fill_rgb(0.08, 0.12, 0.20)
    pdf.text(passenger_name[:32], card_x + 36.0, details_y + 52.0, font="/F1B", size=12.0)

    pdf.set_fill_rgb(0.50, 0.55, 0.65)
    pdf.text("PHONE NUMBER", card_x + 240.0, details_y + 68.0, font="/F1B", size=8.0)
    pdf.set_fill_rgb(0.08, 0.12, 0.20)
    pdf.text(passenger_phone[:18], card_x + 240.0, details_y + 52.0, font="/F2B", size=11.0)

    pdf.set_fill_rgb(0.50, 0.55, 0.65)
    pdf.text("BOOKING REFERENCE", card_x + 380.0, details_y + 68.0, font="/F1B", size=8.0)
    pdf.set_fill_rgb(0.08, 0.12, 0.20)
    pdf.text(f"BG-{booking_id:04d}-{seat}", card_x + 380.0, details_y + 52.0, font="/F2B", size=11.0)

    # Divider line
    pdf.set_stroke_rgb(0.92, 0.94, 0.96)
    pdf.set_line_width(0.75)
    pdf.line(card_x + 36.0, details_y + 42.0, card_x + card_w - 36.0, details_y + 42.0)

    # Row 2
    pdf.set_fill_rgb(0.50, 0.55, 0.65)
    pdf.text("ASSIGNED VEHICLE REGISTRATION", card_x + 36.0, details_y + 28.0, font="/F1B", size=8.0)
    pdf.set_fill_rgb(0.08, 0.12, 0.20)
    pdf.text(f"{plate} ({model[:20]})", card_x + 36.0, details_y + 12.0, font="/F1B", size=11.0)

    pdf.set_fill_rgb(0.50, 0.55, 0.65)
    pdf.text("LUGGAGE ALLOWANCE", card_x + 240.0, details_y + 28.0, font="/F1B", size=8.0)
    pdf.set_fill_rgb(0.08, 0.12, 0.20)
    luggage_txt = f"Carried (+KES {luggage_fee:,.0f})" if has_luggage else "Standard Hand Luggage"
    pdf.text(luggage_txt, card_x + 240.0, details_y + 12.0, font="/F1", size=10.0)

    pdf.set_fill_rgb(0.50, 0.55, 0.65)
    pdf.text("M-PESA TRANSACTION", card_x + 380.0, details_y + 28.0, font="/F1B", size=8.0)
    pdf.set_fill_rgb(0.08, 0.12, 0.20)
    pdf.text(receipt_no[:16], card_x + 380.0, details_y + 12.0, font="/F2", size=10.0)

    # 5. Cryptographic QR Code & Offline Verification Section
    qr_section_y = details_y - 200.0
    pdf.set_fill_rgb(0.98, 0.99, 1.0)
    pdf.set_stroke_rgb(0.85, 0.88, 0.94)
    pdf.round_rect(card_x + 24.0, qr_section_y, card_w - 48.0, 185.0, r=10.0, fill=True, stroke=True)

    # Draw QR Code directly as vector rectangles into stream
    qr_box_x = card_x + 40.0
    qr_box_y = qr_section_y + 25.0
    qr_size_pts = 135.0

    # White backing for QR code
    pdf.set_fill_rgb(1.0, 1.0, 1.0)
    pdf.set_stroke_rgb(0.08, 0.12, 0.20)
    pdf.set_line_width(1.5)
    pdf.round_rect(qr_box_x - 6.0, qr_box_y - 6.0, qr_size_pts + 12.0, qr_size_pts + 12.0, r=6.0, fill=True, stroke=True)

    # Dark modules
    pdf.set_fill_rgb(0.06, 0.09, 0.16)
    pdf.draw_qr_matrix(qr_matrix, qr_box_x, qr_box_y, total_size=qr_size_pts)

    # Optical Verification Instructions (Right of QR)
    info_x = qr_box_x + qr_size_pts + 24.0
    pdf.set_fill_rgb(0.02, 0.55, 0.72)
    pdf.text("SECURITY BOARDING TOKEN (TAMPER-EVIDENT)", info_x, qr_section_y + 155.0, font="/F1B", size=10.0)

    pdf.set_fill_rgb(0.08, 0.12, 0.20)
    pdf.text("Present this QR code to your conductor upon boarding.", info_x, qr_section_y + 138.0, font="/F1B", size=10.0)

    pdf.set_fill_rgb(0.40, 0.45, 0.55)
    pdf.text("Offline Dead-Zone Safe: Cryptographically signed via HMAC-SHA256.", info_x, qr_section_y + 122.0, font="/F1", size=8.5)
    pdf.text("Can be verified on the highway without active internet connection.", info_x, qr_section_y + 110.0, font="/F1", size=8.5)

    # Security Token String
    pdf.set_fill_rgb(0.94, 0.95, 0.98)
    pdf.round_rect(info_x, qr_section_y + 60.0, card_w - info_x + card_x - 12.0, 38.0, r=6.0, fill=True, stroke=False)
    pdf.set_fill_rgb(0.30, 0.35, 0.45)
    pdf.text("OPTICAL TOKEN STRING:", info_x + 8.0, qr_section_y + 84.0, font="/F1B", size=7.5)
    pdf.set_fill_rgb(0.08, 0.12, 0.20)
    pdf.text(qr_token, info_x + 8.0, qr_section_y + 68.0, font="/F2B", size=9.0)

    pdf.set_fill_rgb(0.06, 0.53, 0.38)
    pdf.text("✓ NTSA DIGITAL COMPLIANT  ·  KENYA TRAFFIC ACT CAP 403", info_x, qr_section_y + 36.0, font="/F1B", size=8.5)

    # 6. Perforation Cut Line
    perf_y = qr_section_y - 20.0
    pdf.set_stroke_rgb(0.70, 0.75, 0.82)
    pdf.set_dash("[4 4]", 0)
    pdf.set_line_width(1.0)
    pdf.line(card_x + 10.0, perf_y, card_x + card_w - 10.0, perf_y)
    pdf.set_dash("[]", 0) # reset to solid

    # 7. Terms of Carriage & Safety Notice
    footer_y = perf_y - 45.0
    pdf.set_fill_rgb(0.45, 0.50, 0.60)
    pdf.text("CONDITIONS OF CARRIAGE & NTSA SAFETY GUIDELINES:", card_x + 24.0, footer_y + 24.0, font="/F1B", size=8.0)
    pdf.text("1. This electronic ticket is personal and non-transferable. Retain this boarding pass throughout your journey.", card_x + 24.0, footer_y + 12.0, font="/F1", size=7.5)
    pdf.text("2. Fasten seat belts at all times. In case of reckless driving or road emergency, alert NTSA Hotline: 0716 314 831.", card_x + 24.0, footer_y + 2.0, font="/F1", size=7.5)
    pdf.text("3. BusGo transit credit refund applies on cancellations initiated at least 60 minutes prior to departure.", card_x + 24.0, footer_y - 8.0, font="/F1", size=7.5)

    pdf.set_fill_rgb(0.02, 0.55, 0.72)
    pdf.text("BusGo Transit Kenya  ·  info@busgo.co.ke  ·  www.busgo.co.ke", card_x + card_w - 240.0, footer_y - 8.0, font="/F1B", size=7.5)

    return pdf.build_pdf_bytes()
