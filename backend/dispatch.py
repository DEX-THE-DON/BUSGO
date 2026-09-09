"""
BUSGO SMS & WhatsApp Passenger Dispatch Engine.

Dispatches instant travel credentials (boarding pass, seat number, vehicle plate,
departure time, QR verification code, and live transit map link) via:
  1. WhatsApp (WhatsApp Cloud API / Twilio WhatsApp / direct wa.me link)
  2. SMS (Africa's Talking / Twilio SMS / Local Simulator)

Includes full outbox database logging into `dispatches` table.
"""

import os
import uuid
import urllib.parse
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Optional Gateway Configuration
AT_USERNAME = os.getenv("AT_USERNAME", "")
AT_API_KEY = os.getenv("AT_API_KEY", "")
AT_SENDER_ID = os.getenv("AT_SENDER_ID", "BUSGO")

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_WHATSAPP_NUMBER = os.getenv("TWILIO_WHATSAPP_NUMBER", "")
TWILIO_SMS_NUMBER = os.getenv("TWILIO_SMS_NUMBER", "")

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
DEFAULT_DISPATCH_PHONE = os.getenv("DEFAULT_DISPATCH_PHONE", "+254716314831")


def normalize_kenyan_phone(phone: str) -> str:
    """Normalize Kenyan phone numbers to E.164 format (+254...).
    Accepts:
      - 0716314831   -> +254716314831
      - 716314831    -> +254716314831
      - 254716314831 -> +254716314831
      - +254716314831-> +254716314831
    """
    if not phone:
        return DEFAULT_DISPATCH_PHONE
    clean = "".join(ch for ch in str(phone).strip() if ch.isdigit() or ch == "+")
    if clean.startswith("+254") and len(clean) == 13:
        return clean
    if clean.startswith("254") and len(clean) == 12:
        return f"+{clean}"
    if clean.startswith("0") and len(clean) == 10:
        return f"+254{clean[1:]}"
    if len(clean) == 9 and (clean.startswith("7") or clean.startswith("1")):
        return f"+254{clean}"
    if not clean.startswith("+"):
        return f"+{clean}"
    return clean


def format_departure(dt_str: Optional[str]) -> str:
    if not dt_str:
        return "On Schedule"
    try:
        dt = datetime.fromisoformat(str(dt_str).replace("Z", "+00:00"))
        return dt.strftime("%b %d, %I:%M %p")
    except Exception:
        return str(dt_str)


def build_ticket_messages(booking: Dict[str, Any], receipt_number: Optional[str] = None) -> Dict[str, str]:
    """Generates formatted WhatsApp and SMS messages along with a direct wa.me link."""
    booking_id = booking.get("id") or booking.get("booking_id")
    trip_id = booking.get("trip_id", 1)
    seat = booking.get("seat_number", 1)
    route = booking.get("route_name") or booking.get("trip_name") or "Transit Corridor"
    board = booking.get("board_stop") or f"Stop #{booking.get('board_stop_order', 1)}"
    alight = booking.get("alight_stop") or f"Stop #{booking.get('alight_stop_order', 2)}"
    plate = booking.get("vehicle_plate") or "Assigned at Depot"
    model = booking.get("vehicle_model") or "Transit Vehicle"
    passenger = booking.get("passenger_name") or "Passenger"
    dept = format_departure(booking.get("departure_time"))
    receipt = receipt_number or booking.get("receipt_number") or "PAID"
    ticket_ref = f"BG-{str(booking_id).zfill(4)}-{seat}"
    tracker_url = f"{FRONTEND_URL}/user?tab=tracker&trip={trip_id}"

    # WhatsApp Rich Message with Markdown formatting & Emojis
    whatsapp_body = (
        f"🚌 *BUSGO TRANSIT — E-BOARDING PASS* 🎫\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 *Passenger:* {passenger}\n"
        f"📍 *Route:* {route}\n"
        f"💺 *Seat Number:* #{seat}\n"
        f"🚐 *Vehicle:* {plate} ({model})\n"
        f"🚩 *Boarding At:* {board}\n"
        f"🏁 *Drop-off:* {alight}\n"
        f"⏰ *Departure:* {dept}\n"
        f"💳 *M-Pesa Receipt:* {receipt}\n"
        f"🎟️ *Ticket Ref:* {ticket_ref}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🗺️ *Live GPS Radar Tracker:*\n"
        f"{tracker_url}\n\n"
        f"ℹ️ _Please arrive at {board} at least 15 mins before departure. "
        f"Present this token or ticket code to your conductor._\n"
        f"Safe journey with BUSGO! 🇰🇪"
    )

    # Concise SMS Message (< 160 chars or 2-part standard GSM)
    sms_body = (
        f"BUSGO TICKET: Seat #{seat} on {route} ({plate}). "
        f"Board: {board} -> {alight}. Dept: {dept}. "
        f"Ref: {ticket_ref}. Receipt: {receipt}. "
        f"Track: {tracker_url}"
    )

    # Direct WhatsApp Sharing Link
    phone_clean = normalize_kenyan_phone(booking.get("phone") or DEFAULT_DISPATCH_PHONE).replace("+", "")
    wa_link = f"https://wa.me/{phone_clean}?text={urllib.parse.quote(whatsapp_body)}"

    return {
        "whatsapp": whatsapp_body,
        "sms": sms_body,
        "wa_link": wa_link,
        "ticket_ref": ticket_ref,
        "recipient": f"+{phone_clean}",
    }


async def send_sms_gateway(to_phone: str, message: str) -> Dict[str, Any]:
    """Sends SMS via Africa's Talking / Twilio, or simulator fallback."""
    norm_phone = normalize_kenyan_phone(to_phone)

    # 1. Africa's Talking Gateway
    if AT_API_KEY and AT_USERNAME:
        try:
            url = "https://api.africastalking.com/version1/messaging"
            headers = {
                "ApiKey": AT_API_KEY,
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            }
            data = {
                "username": AT_USERNAME,
                "to": norm_phone,
                "message": message,
            }
            if AT_SENDER_ID:
                data["from"] = AT_SENDER_ID
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.post(url, headers=headers, data=data)
                if res.status_code in (200, 201):
                    return {"provider": "africastalking", "status": "sent", "ref": res.text[:100]}
        except Exception as e:
            return {"provider": "africastalking", "status": "failed", "error": str(e)}

    # 2. Twilio Gateway
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_SMS_NUMBER:
        try:
            url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
            auth = (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            data = {
                "From": TWILIO_SMS_NUMBER,
                "To": norm_phone,
                "Body": message,
            }
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.post(url, auth=auth, data=data)
                if res.status_code in (200, 201):
                    sid = res.json().get("sid", "TW-SMS")
                    return {"provider": "twilio", "status": "sent", "ref": sid}
        except Exception as e:
            return {"provider": "twilio", "status": "failed", "error": str(e)}

    # 3. High-Fidelity Local Simulator
    sim_ref = f"SIM-SMS-{uuid.uuid4().hex[:8].upper()}"
    return {
        "provider": "simulator",
        "status": "simulated",
        "ref": sim_ref,
        "recipient": norm_phone,
    }


async def send_whatsapp_gateway(to_phone: str, message: str) -> Dict[str, Any]:
    """Sends WhatsApp message via Twilio / Meta Cloud API, or simulator fallback."""
    norm_phone = normalize_kenyan_phone(to_phone)

    # 1. Twilio WhatsApp Gateway
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_NUMBER:
        try:
            url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
            auth = (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            from_wa = f"whatsapp:{TWILIO_WHATSAPP_NUMBER}" if not TWILIO_WHATSAPP_NUMBER.startswith("whatsapp:") else TWILIO_WHATSAPP_NUMBER
            data = {
                "From": from_wa,
                "To": f"whatsapp:{norm_phone}",
                "Body": message,
            }
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.post(url, auth=auth, data=data)
                if res.status_code in (200, 201):
                    sid = res.json().get("sid", "TW-WA")
                    return {"provider": "twilio_whatsapp", "status": "sent", "ref": sid}
        except Exception as e:
            return {"provider": "twilio_whatsapp", "status": "failed", "error": str(e)}

    # 2. Local High-Fidelity Simulator
    sim_ref = f"SIM-WA-{uuid.uuid4().hex[:8].upper()}"
    return {
        "provider": "whatsapp_simulator",
        "status": "simulated",
        "ref": sim_ref,
        "recipient": norm_phone,
    }


async def dispatch_booking_confirmation(
    db: AsyncSession,
    booking_id: int,
    channels: Optional[List[str]] = None,
    override_phone: Optional[str] = None,
) -> Dict[str, Any]:
    """Gathers booking credentials, builds tickets, logs outbox records, and fires dispatch."""
    if channels is None:
        channels = ["whatsapp", "sms"]

    # Retrieve complete booking details with joins
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
    res = await db.execute(query, {"id": booking_id})
    row = res.mappings().first()
    if not row:
        return {"error": f"Booking {booking_id} not found."}

    booking_dict = dict(row)

    # Fetch stop names
    stops_res = await db.execute(
        text("SELECT stop_name, stop_order FROM route_stops rs JOIN trips t ON t.route_id = rs.route_id WHERE t.id = :tid ORDER BY rs.stop_order ASC;"),
        {"tid": booking_dict["trip_id"]},
    )
    stop_map = {s["stop_order"]: s["stop_name"] for s in stops_res.mappings().all()}
    booking_dict["board_stop"] = stop_map.get(booking_dict["board_stop_order"], f"Stop #{booking_dict['board_stop_order']}")
    booking_dict["alight_stop"] = stop_map.get(booking_dict["alight_stop_order"], f"Stop #{booking_dict['alight_stop_order']}")

    target_phone = override_phone or booking_dict.get("passenger_phone") or DEFAULT_DISPATCH_PHONE
    booking_dict["phone"] = target_phone

    ticket_data = build_ticket_messages(booking_dict, receipt_number=booking_dict.get("receipt_number"))
    results = []

    for ch in channels:
        ch_lower = ch.lower().strip()
        if ch_lower == "whatsapp":
            send_res = await send_whatsapp_gateway(target_phone, ticket_data["whatsapp"])
            body_text = ticket_data["whatsapp"]
        elif ch_lower == "sms":
            send_res = await send_sms_gateway(target_phone, ticket_data["sms"])
            body_text = ticket_data["sms"]
        else:
            continue

        # Persist to dispatches outbox
        insert_q = text("""
            INSERT INTO dispatches (booking_id, user_id, channel, recipient, message_body, status, provider, provider_reference, error_message, created_at)
            VALUES (:bid, :uid, :ch, :recipient, :body, :status, :provider, :ref, :err, :created_at)
            RETURNING id;
        """)
        ins = await db.execute(insert_q, {
            "bid": booking_id,
            "uid": booking_dict.get("user_id"),
            "ch": ch_lower,
            "recipient": ticket_data["recipient"],
            "body": body_text,
            "status": send_res.get("status", "sent"),
            "provider": send_res.get("provider", "simulator"),
            "ref": send_res.get("ref"),
            "err": send_res.get("error"),
            "created_at": datetime.now(timezone.utc),
        })
        disp_id = ins.scalar_one()
        results.append({
            "dispatch_id": disp_id,
            "channel": ch_lower,
            "recipient": ticket_data["recipient"],
            "status": send_res.get("status"),
            "provider": send_res.get("provider"),
            "ref": send_res.get("ref"),
        })

    await db.commit()

    return {
        "booking_id": booking_id,
        "recipient": ticket_data["recipient"],
        "ticket_ref": ticket_data["ticket_ref"],
        "wa_link": ticket_data["wa_link"],
        "messages": {
            "whatsapp": ticket_data["whatsapp"],
            "sms": ticket_data["sms"],
        },
        "dispatches": results,
    }


def build_parcel_messages(parcel: Dict[str, Any]) -> Dict[str, Any]:
    """Generates formatted WhatsApp/SMS messages for both sender and recipient of cargo/mzigo."""
    tracking_code = parcel.get("tracking_code", "MZG-0000")
    pin = parcel.get("security_pin", "0000")
    sender_name = parcel.get("sender_name", "Sender")
    sender_phone = normalize_kenyan_phone(parcel.get("sender_phone", ""))
    recip_name = parcel.get("recipient_name", "Recipient")
    recip_phone = normalize_kenyan_phone(parcel.get("recipient_phone", ""))
    cat = (parcel.get("category") or "medium_box").replace("_", " ").title()
    desc = parcel.get("description", "Cargo package")
    pickup = parcel.get("pickup_stop_name") or f"Stop #{parcel.get('pickup_stop_order', 1)}"
    dropoff = parcel.get("dropoff_stop_name") or f"Stop #{parcel.get('dropoff_stop_order', 2)}"
    fee = float(parcel.get("fee", 300.0))
    trip_id = parcel.get("trip_id", 1)
    pickup_type = parcel.get("pickup_type", "station") # 'station' | 'doorstep'
    delivery_type = parcel.get("delivery_type", "station") # 'station' | 'doorstep'
    sender_addr = parcel.get("sender_address") or parcel.get("sender_city_or_area") or pickup
    recip_addr = parcel.get("recipient_address") or parcel.get("recipient_city_or_area") or dropoff
    tracker_url = f"{FRONTEND_URL}/parcels?code={tracking_code}"

    # Delivery Mode Label
    if pickup_type == "doorstep" and delivery_type == "doorstep":
        mode_label = "Door-to-Door Executive Courier 🏠➡️🏠"
    elif pickup_type == "doorstep":
        mode_label = "Door-to-Station Courier 🏠➡️🏢"
    elif delivery_type == "doorstep":
        mode_label = "Station-to-Door Courier 🏢➡️🏠"
    else:
        mode_label = "Station-to-Station Standard 🏢➡️🏢"

    # Recipient Message (Includes pickup PIN and collection stop/doorstep address)
    if delivery_type == "doorstep":
        recipient_destination_info = f"🏠 *Doorstep Delivery Address:* {recip_addr}\n🛵 *Service:* Last-Mile Courier Handover"
        recipient_sms_dest = f"Delivering to your door at {recip_addr}"
    else:
        recipient_destination_info = f"🏢 *Collection Point:* {dropoff} (Parcel Counter)"
        recipient_sms_dest = f"Collect at {dropoff} bus office"

    recipient_whatsapp = (
        f"📦 *BUSGO MZIGO — INCOMING PACKAGE NOTIFICATION* 🎁\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🏷️ *Tracking Ref:* {tracking_code}\n"
        f"🚚 *Service Mode:* {mode_label}\n"
        f"📦 *Item:* {cat} — {desc}\n"
        f"👤 *Sender:* {sender_name} ({sender_phone})\n"
        f"{recipient_destination_info}\n"
        f"🔒 *YOUR SECRET CLAIM PIN:* *{pin}*\n"
        f"*(Present this 4-digit PIN to the courier rider/clerk upon handover)*\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🗺️ *Live Waybill & Vehicle Tracker:*\n"
        f"{tracker_url}\n\n"
        f"BUSGO Cargo Kenya 🇰🇪"
    )

    recipient_sms = (
        f"BUSGO MZIGO: Incoming package {tracking_code} from {sender_name}. {recipient_sms_dest}. "
        f"Secret Handover PIN: {pin}. Track: {tracker_url}"
    )

    # Sender Message (Dispatch confirmation)
    if pickup_type == "doorstep":
        pickup_info = f"🛵 *Doorstep Pickup Address:* {sender_addr} (Courier dispatched)"
        pickup_sms = f"Doorstep pickup at {sender_addr}"
    else:
        pickup_info = f"🏢 *Origin Station:* {pickup} (Drop-off at counter)"
        pickup_sms = f"Drop at {pickup}"

    sender_whatsapp = (
        f"📦 *BUSGO MZIGO — DISPATCH CONFIRMATION* 🚚\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🏷️ *Tracking Ref:* {tracking_code}\n"
        f"🚚 *Service Mode:* {mode_label}\n"
        f"📦 *Item:* {cat} — {desc}\n"
        f"👤 *Recipient:* {recip_name} ({recip_phone})\n"
        f"{pickup_info}\n"
        f"🏁 *Destination:* {recip_addr}\n"
        f"💳 *Total Fee:* KES {fee:,.2f}\n"
        f"🔒 *Recipient PIN:* {pin}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🗺️ *Track Live:*\n"
        f"{tracker_url}\n\n"
        f"Thank you for shipping with BUSGO! 🇰🇪"
    )

    sender_sms = (
        f"BUSGO MZIGO: Waybill {tracking_code} to {recip_name} registered ({mode_label}). {pickup_sms}. "
        f"Fee: KES {fee:,.0f}. Recipient PIN: {pin}. Track: {tracker_url}"
    )

    recip_wa_link = f"https://wa.me/{recip_phone.lstrip('+')}?text={urllib.parse.quote(recipient_whatsapp)}"
    sender_wa_link = f"https://wa.me/{sender_phone.lstrip('+')}?text={urllib.parse.quote(sender_whatsapp)}"

    return {
        "tracking_code": tracking_code,
        "security_pin": pin,
        "recipient": recip_phone,
        "sender": sender_phone,
        "recipient_whatsapp": recipient_whatsapp,
        "recipient_sms": recipient_sms,
        "recipient_wa_link": recip_wa_link,
        "sender_whatsapp": sender_whatsapp,
        "sender_sms": sender_sms,
        "sender_wa_link": sender_wa_link,
        "tracker_url": tracker_url,
    }


async def dispatch_parcel_notification(
    db: AsyncSession,
    parcel_dict: Dict[str, Any],
    notify_recipient: bool = True,
    notify_sender: bool = True,
) -> Dict[str, Any]:
    """Sends SMS and WhatsApp dispatches for parcel registration or delivery."""
    msg_data = build_parcel_messages(parcel_dict)
    results = []

    # Send to recipient
    if notify_recipient and msg_data["recipient"]:
        wa_res = await send_whatsapp_gateway(msg_data["recipient"], msg_data["recipient_whatsapp"])
        sms_res = await send_sms_gateway(msg_data["recipient"], msg_data["recipient_sms"])
        results.append({"to": "recipient", "channel": "whatsapp", "res": wa_res})
        results.append({"to": "recipient", "channel": "sms", "res": sms_res})

    # Send to sender
    if notify_sender and msg_data["sender"]:
        wa_res = await send_whatsapp_gateway(msg_data["sender"], msg_data["sender_whatsapp"])
        sms_res = await send_sms_gateway(msg_data["sender"], msg_data["sender_sms"])
        results.append({"to": "sender", "channel": "whatsapp", "res": wa_res})
        results.append({"to": "sender", "channel": "sms", "res": sms_res})

    return {
        "tracking_code": msg_data["tracking_code"],
        "security_pin": msg_data["security_pin"],
        "recipient_wa_link": msg_data["recipient_wa_link"],
        "sender_wa_link": msg_data["sender_wa_link"],
        "results": results,
    }


async def dispatch_group_share_confirmation(
    db: AsyncSession,
    member_id: int,
    receipt_number: str
) -> Dict[str, Any]:
    """Sends bilingual SMS to a Changa group member upon settling their share."""
    query = text("""
        SELECT
            m.id as member_id, m.seat_number, m.passenger_name, m.phone_number,
            m.share_amount, m.booking_id,
            g.id as group_id, g.group_name, g.trip_id,
            t.name as trip_name, t.scheduled_at,
            r.name as route_name,
            v.plate_number as vehicle_plate
        FROM group_booking_members m
        JOIN group_bookings g ON g.id = m.group_booking_id
        JOIN trips t ON t.id = g.trip_id
        JOIN routes r ON r.id = t.route_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        WHERE m.id = :member_id;
    """)
    res = await db.execute(query, {"member_id": member_id})
    row = res.mappings().first()
    if not row:
        return {"error": f"Group member {member_id} not found."}

    norm_phone = normalize_kenyan_phone(row["phone_number"])
    sms_body = (
        f"BUSGO CHANGA: Hongera {row['passenger_name']}! Umelipia KES {row['share_amount']:.2f} "
        f"kwa Kiti #{row['seat_number']} (Safari: {row['group_name']}). "
        f"Gari: {row['vehicle_plate'] or 'BUSGO Fleet'} ({row['route_name']}). "
        f"Stakabadhi: {receipt_number}. Tiketi: BUSGO-{row['booking_id'] or row['member_id']}. "
        f"Safari njema!"
    )

    send_res = await send_sms_gateway(norm_phone, sms_body)

    # Log to dispatches outbox
    insert_q = text("""
        INSERT INTO dispatches (booking_id, user_id, channel, recipient, message_body, status, provider, provider_reference, error_message, created_at)
        VALUES (:bid, NULL, 'sms', :recipient, :body, :status, :provider, :ref, :err, :created_at)
        RETURNING id;
    """)
    ins = await db.execute(insert_q, {
        "bid": row["booking_id"],
        "recipient": norm_phone,
        "body": sms_body,
        "status": send_res.get("status", "sent"),
        "provider": send_res.get("provider", "simulator"),
        "ref": send_res.get("ref"),
        "err": send_res.get("error"),
        "created_at": datetime.now(timezone.utc),
    })
    disp_id = ins.scalar_one()
    await db.commit()

    return {
        "dispatch_id": disp_id,
        "channel": "sms",
        "recipient": norm_phone,
        "message": sms_body,
        "status": send_res.get("status"),
        "provider": send_res.get("provider"),
        "ref": send_res.get("ref"),
    }


async def get_dispatch_outbox(
    db: AsyncSession,
    limit: int = 50,
    channel: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Retrieves recent outbound SMS and WhatsApp notifications from the audit ledger."""
    where_clause = ""
    params: Dict[str, Any] = {"limit": limit}
    if channel:
        where_clause = "WHERE channel = :ch"
        params["ch"] = channel.lower().strip()

    q = text(f"""
        SELECT id, booking_id, user_id, channel, recipient, message_body, status, provider, provider_reference, error_message, created_at
        FROM dispatches
        {where_clause}
        ORDER BY created_at DESC
        LIMIT :limit;
    """)
    rows = (await db.execute(q, params)).mappings().all()
    return [
        {
            "id": r["id"],
            "booking_id": r["booking_id"],
            "channel": r["channel"],
            "recipient": r["recipient"],
            "message_body": r["message_body"],
            "status": r["status"],
            "provider": r["provider"],
            "provider_reference": r["provider_reference"],
            "error_message": r["error_message"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


