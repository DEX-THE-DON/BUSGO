"""
BUSGO USSD Interactive Voice & Non-Smartphone Engine (*384#).

Supports:
1. Africa's Talking USSD Gateway (POST form-urlencoded)
2. Direct Telco Gateway (Safaricom / Airtel) & Custom JSON payloads
3. Interactive Feature Phone Web Simulator
4. Bilingual UX (English & Kiswahili)
5. Instant Daraja STK Push trigger upon USSD seat selection
6. Instant SMS passenger ticket delivery via dispatch.py
"""

import os
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Tuple
from sqlalchemy import text, select, or_
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from . import daraja
from . import dispatch
from .models import UssdSession, UssdLog, User, Route, Trip, Vehicle, Sacco, Booking, Payment, Parcel

# Supported USSD service codes
DEFAULT_SERVICE_CODE = os.getenv("USSD_SERVICE_CODE", "*384#")


# =====================================================================
# BILINGUAL LOCALIZATION DICTIONARIES
# =====================================================================

MESSAGES = {
    "en": {
        "welcome": (
            "CON Welcome to BusGo Kenya (*384#)\n"
            "1. Book Bus Ticket\n"
            "2. Check My Ticket\n"
            "3. Track Mzigo Parcel\n"
            "4. Sacco Contacts & Help\n"
            "5. Badili Lugha (Kiswahili)"
        ),
        "no_routes": "END No active travel corridors found at this time. Please try again shortly.",
        "select_route": "CON Select Travel Route:\n{routes}\n0. Back",
        "no_trips": "END No scheduled trips found for this route today. Dial *384# to choose another route.",
        "select_trip": "CON Select Departure Time:\n{trips}\n0. Back",
        "select_seat": (
            "CON Route: {route}\n"
            "Trip: {trip} (KES {fare})\n"
            "Available Seats: {seats}\n"
            "Enter seat number (or 0 for auto):"
        ),
        "enter_name": (
            "CON Passenger Name:\n"
            "{suggestion}"
            "Enter full name:"
        ),
        "confirm_booking": (
            "CON Confirm Booking:\n"
            "Route: {route}\n"
            "Bus: {bus} ({sacco})\n"
            "Seat: #{seat}\n"
            "Fare: KES {fare}\n"
            "Passenger: {name}\n\n"
            "1. Confirm & Pay via M-Pesa\n"
            "0. Cancel"
        ),
        "booking_success": (
            "END Asante! M-Pesa prompt for KES {fare} sent to your phone.\n"
            "Enter your M-Pesa PIN on the prompt to confirm Seat #{seat}.\n"
            "Boarding pass SMS will be sent immediately upon payment."
        ),
        "booking_failed": "END Sorry, failed to hold seat #{seat}. It may have just been booked. Dial *384# to try again.",
        "no_ticket": "END No active tickets found for {phone}.\nDial *384# and press 1 to book a bus.",
        "ticket_found": (
            "END BusGo Ticket #{booking_id}\n"
            "Passenger: {name}\n"
            "Bus: {bus} ({sacco})\n"
            "Route: {route}\n"
            "Seat: #{seat} | Status: {status}\n"
            "Depart: {time}\n"
            "Show this SMS when boarding."
        ),
        "track_parcel_prompt": "CON Enter Mzigo Waybill or Tracking Code:\n(e.g. WB-MZG-4401X or 4401)",
        "parcel_not_found": "END Waybill not found for '{code}'.\nPlease check tracking code or call 0716 314 831.",
        "parcel_found": (
            "END Mzigo: {tracking_code}\n"
            "Status: {status}\n"
            "Route: {pickup} -> {dropoff}\n"
            "Bus: {plate}\n"
            "Recipient: {recipient}\n"
            "Security PIN: {pin}"
        ),
        "sacco_list": "CON Partner SACCO Contacts:\n{saccos}\n0. Back",
        "sacco_detail": (
            "END {name}\n"
            "HQ: {hq}\n"
            "Customer Care: {phone}\n"
            "Email: {email}\n"
            "Open 24/7. Safari Njema!"
        ),
        "lang_switched": "END Lugha imebadilishwa kuwa Kiswahili. Piga *384# kuanza upya.",
        "invalid_option": "CON Invalid choice. Please select from the menu:\n{menu}",
        "session_ended": "END Session ended. Thank you for using BusGo Kenya.",
    },
    "sw": {
        "welcome": (
            "CON Karibu BusGo Kenya (*384#)\n"
            "1. Kata Tiketi ya Basi\n"
            "2. Hali ya Tiketi Yangu\n"
            "3. Fuatilia Mzigo (Mzigo)\n"
            "4. Nambari za Sacco & Msaada\n"
            "5. Switch to English"
        ),
        "no_routes": "END Hakuna safari zilizopo kwa sasa. Tafadhali jaribu tena baadaye.",
        "select_route": "CON Chagua Njia ya Safari:\n{routes}\n0. Rudi Nyuma",
        "no_trips": "END Hakuna basi linaloondoka leo kwenye njia hii. Piga *384# kuchagua njia nyingine.",
        "select_trip": "CON Chagua Saa ya Safari:\n{trips}\n0. Rudi Nyuma",
        "select_seat": (
            "CON Njia: {route}\n"
            "Safari: {trip} (Nauli KES {fare})\n"
            "Viti Vilivyopo: {seats}\n"
            "Weka nambari ya kiti (au 0 kwa kiti cha kwanza):"
        ),
        "enter_name": (
            "CON Jina la Msafiri:\n"
            "{suggestion}"
            "Andika majina kamili:"
        ),
        "confirm_booking": (
            "CON Thibitisha Tiketi:\n"
            "Njia: {route}\n"
            "Basi: {bus} ({sacco})\n"
            "Kiti: #{seat}\n"
            "Nauli: KES {fare}\n"
            "Msafiri: {name}\n\n"
            "1. Thibitisha & Lipa kwa M-Pesa\n"
            "0. Sitisha"
        ),
        "booking_success": (
            "END Asante! Ombi la M-Pesa la KES {fare} limetumwa kwa simu yako.\n"
            "Weka PIN yako ya M-Pesa kulipia Kiti #{seat}.\n"
            "SMS ya tiketi itatumwa mara moja baada ya kulipa."
        ),
        "booking_failed": "END Samahani, kiti #{seat} hakikupatikana. Huenda kimechukuliwa sasa hivi. Piga *384# kujaribu tena.",
        "no_ticket": "END Hakuna tiketi iliyopatikana kwa {phone}.\nPiga *384# na uchague 1 kukata tiketi.",
        "ticket_found": (
            "END Tiketi ya BusGo #{booking_id}\n"
            "Msafiri: {name}\n"
            "Basi: {bus} ({sacco})\n"
            "Njia: {route}\n"
            "Kiti: #{seat} | Hali: {status}\n"
            "Kuondoka: {time}\n"
            "Onyesha SMS hii unapoingia kwenye gari."
        ),
        "track_parcel_prompt": "CON Weka Nambari ya Mzigo (Waybill):\n(Mfano WB-MZG-4401X au 4401)",
        "parcel_not_found": "END Mzigo haujapatikana kwa nambari '{code}'.\nTafadhali hakiki au piga 0716 314 831.",
        "parcel_found": (
            "END Mzigo: {tracking_code}\n"
            "Hali: {status}\n"
            "Kutoka: {pickup} -> {dropoff}\n"
            "Basi: {plate}\n"
            "Mpokeaji: {recipient}\n"
            "PIN ya Siri: {pin}"
        ),
        "sacco_list": "CON Mawasiliano ya Sacco:\n{saccos}\n0. Rudi Nyuma",
        "sacco_detail": (
            "END {name}\n"
            "Ofisi Kuu: {hq}\n"
            "Huduma kwa Wateja: {phone}\n"
            "Barua Pepe: {email}\n"
            "Huduma Saa 24. Safari Njema!"
        ),
        "lang_switched": "END Language changed to English. Dial *384# to start again.",
        "invalid_option": "CON Chaguo si sahihi. Tafadhali chagua kutoka orodha:\n{menu}",
        "session_ended": "END Kikao kimefungwa. Asante kwa kutumia BusGo Kenya.",
    },
}


# =====================================================================
# USSD STATE MACHINE PROCESSOR
# =====================================================================

class UssdEngine:
    """
    Stateless & stateful hybrid engine that parses Africa's Talking USSD sequences
    and executes database-backed queries for transit booking, parcel tracking, and payments.
    """

    @staticmethod
    def parse_inputs(text_param: str) -> List[str]:
        """Convert Africa's Talking asterisk-delimited text into sequential steps."""
        if not text_param:
            return []
        parts = [p.strip() for p in text_param.split("*") if p.strip()]
        return parts

    @staticmethod
    def get_or_create_session(
        db: Session, session_id: str, phone_number: str
    ) -> UssdSession:
        norm_phone = dispatch.normalize_kenyan_phone(phone_number)
        session_obj = db.execute(
            select(UssdSession).where(UssdSession.session_id == session_id)
        ).scalar_one_or_none()

        if not session_obj:
            # Check previous session for this phone number to retain language preference
            prev_session = db.execute(
                select(UssdSession).where(
                    or_(UssdSession.phone_number == norm_phone, UssdSession.phone_number == phone_number)
                ).order_by(UssdSession.id.desc()).limit(1)
            ).scalar_one_or_none()
            lang = prev_session.language if prev_session and prev_session.language else "en"

            session_obj = UssdSession(
                session_id=session_id,
                phone_number=norm_phone,
                language=lang,
                current_menu="MAIN_MENU",
                session_data={},
                is_active=True,
            )
            db.add(session_obj)
            db.commit()
            db.refresh(session_obj)
        return session_obj

    @classmethod
    def handle_request(
        cls,
        db: Session,
        session_id: str,
        phone_number: str,
        text_param: str,
        service_code: str = DEFAULT_SERVICE_CODE,
    ) -> str:
        """
        Main synchronous processing entry point for USSD requests.
        Returns string prefixed with 'CON ' or 'END '.
        """
        inputs = cls.parse_inputs(text_param)
        session_obj = cls.get_or_create_session(db, session_id, phone_number)
        lang = session_obj.language or "en"
        data = dict(session_obj.session_data or {})

        # Step 0: Initial dial (text is empty)
        if len(inputs) == 0:
            session_obj.current_menu = "MAIN_MENU"
            session_obj.session_data = {}
            db.commit()
            response = MESSAGES[lang]["welcome"]
            cls._log_hop(db, session_id, phone_number, "", "MAIN_MENU", response)
            return response

        first_choice = inputs[0]

        # -------------------------------------------------------------
        # BRANCH 5: TOGGLE LANGUAGE
        # -------------------------------------------------------------
        if first_choice == "5":
            new_lang = "sw" if lang == "en" else "en"
            session_obj.language = new_lang
            db.commit()
            response = MESSAGES[lang]["lang_switched"]
            cls._log_hop(db, session_id, phone_number, first_choice, "TOGGLE_LANG", response)
            return response

        # -------------------------------------------------------------
        # BRANCH 2: CHECK MY TICKET STATUS
        # -------------------------------------------------------------
        if first_choice == "2":
            norm_phone = session_obj.phone_number
            clean_digits = "".join(ch for ch in norm_phone if ch.isdigit())
            # Find latest booking for this phone
            booking_row = db.execute(
                text("""
                    SELECT b.id, b.seat_number, b.status, b.payment_status,
                           u.full_name AS passenger_name,
                           r.name AS route_name,
                           v.plate_number AS vehicle_plate,
                           s.name AS sacco_name,
                           t.scheduled_at AS departure_time
                    FROM bookings b
                    JOIN trips t ON t.id = b.trip_id
                    JOIN routes r ON r.id = t.route_id
                    LEFT JOIN vehicles v ON v.id = t.vehicle_id
                    LEFT JOIN saccos s ON s.id = v.sacco_id
                    LEFT JOIN users u ON u.id = b.user_id
                    WHERE u.phone = :p1 OR u.phone = :p2 OR u.phone LIKE :p3
                    ORDER BY b.id DESC
                    LIMIT 1;
                """),
                {
                    "p1": norm_phone,
                    "p2": clean_digits,
                    "p3": f"%{clean_digits[-9:]}%" if len(clean_digits) >= 9 else norm_phone,
                },
            ).mappings().one_or_none()

            if not booking_row:
                response = MESSAGES[lang]["no_ticket"].format(phone=norm_phone)
            else:
                dep_time = booking_row["departure_time"]
                dep_str = dep_time.strftime("%d/%m %I:%M %p") if hasattr(dep_time, "strftime") else (str(dep_time) or "Scheduled")
                response = MESSAGES[lang]["ticket_found"].format(
                    booking_id=booking_row["id"],
                    name=booking_row["passenger_name"] or "Passenger",
                    bus=booking_row["vehicle_plate"] or "BUSGO FLEET",
                    sacco=booking_row["sacco_name"] or "Super Metro",
                    route=booking_row["route_name"],
                    seat=booking_row["seat_number"],
                    status=booking_row["status"].upper(),
                    time=dep_str,
                )
            cls._log_hop(db, session_id, phone_number, first_choice, "MY_TICKET", response)
            return response

        # -------------------------------------------------------------
        # BRANCH 3: TRACK MZIGO PARCEL
        # -------------------------------------------------------------
        if first_choice == "3":
            if len(inputs) == 1:
                # Prompt user for code
                session_obj.current_menu = "PARCEL_INPUT"
                db.commit()
                response = MESSAGES[lang]["track_parcel_prompt"]
                cls._log_hop(db, session_id, phone_number, first_choice, "PARCEL_INPUT", response)
                return response
            
            # User entered code
            code_input = inputs[1].strip()
            parcel = db.execute(
                select(Parcel).where(
                    or_(
                        Parcel.tracking_code.ilike(code_input),
                        Parcel.tracking_code.ilike(f"%{code_input}%"),
                    )
                ).limit(1)
            ).scalar_one_or_none()

            if not parcel:
                response = MESSAGES[lang]["parcel_not_found"].format(code=code_input)
            else:
                # Get vehicle plate if attached to trip
                veh_plate = "Fleet Transit"
                if parcel.trip_id:
                    v_row = db.execute(
                        text("SELECT v.plate_number FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = :tid"),
                        {"tid": parcel.trip_id},
                    ).mappings().one_or_none()
                    if v_row:
                        veh_plate = v_row["plate_number"]

                response = MESSAGES[lang]["parcel_found"].format(
                    tracking_code=parcel.tracking_code,
                    status=parcel.status.replace("_", " ").upper(),
                    pickup=parcel.sender_city_or_area or "Origin Hub",
                    dropoff=parcel.recipient_city_or_area or "Destination Hub",
                    plate=veh_plate,
                    recipient=parcel.recipient_name,
                    pin=parcel.security_pin or "****",
                )
            cls._log_hop(db, session_id, phone_number, code_input, "PARCEL_TRACK_RESULT", response)
            return response

        # -------------------------------------------------------------
        # BRANCH 4: SACCO CONTACTS & HELP
        # -------------------------------------------------------------
        if first_choice == "4":
            saccos = db.execute(select(Sacco).limit(5)).scalars().all()
            if len(inputs) == 1:
                if not saccos:
                    lines = "1. Super Metro (+254 716 314 831)\n2. 2NK Sacco (+254 722 000 111)"
                else:
                    lines = "\n".join(f"{idx+1}. {s.name}" for idx, s in enumerate(saccos))
                response = MESSAGES[lang]["sacco_list"].format(saccos=lines)
                cls._log_hop(db, session_id, phone_number, first_choice, "SACCO_LIST", response)
                return response

            if inputs[1] == "0":
                # Go back to main
                session_obj.current_menu = "MAIN_MENU"
                db.commit()
                return MESSAGES[lang]["welcome"]

            try:
                sacco_idx = int(inputs[1]) - 1
                if 0 <= sacco_idx < len(saccos):
                    s = saccos[sacco_idx]
                    response = MESSAGES[lang]["sacco_detail"].format(
                        name=s.name,
                        hq=s.headquarters or "Nairobi",
                        phone=s.contact_phone or "0716 314 831",
                        email=s.contact_email or "support@busgo.co.ke",
                    )
                else:
                    response = MESSAGES[lang]["session_ended"]
            except Exception:
                response = MESSAGES[lang]["session_ended"]
            cls._log_hop(db, session_id, phone_number, inputs[1], "SACCO_DETAIL", response)
            return response

        # -------------------------------------------------------------
        # BRANCH 1: BOOK BUS TICKET FLOW
        # -------------------------------------------------------------
        if first_choice == "1":
            return cls._handle_booking_flow(db, session_obj, inputs[1:], lang)

        # Unknown choice
        return MESSAGES[lang]["welcome"]

    @classmethod
    def _handle_booking_flow(
        cls,
        db: Session,
        session_obj: UssdSession,
        sub_inputs: List[str],
        lang: str,
    ) -> str:
        """
        Sequential sub-flow for ticket reservation:
        Step 1: Select Route
        Step 2: Select Departure Trip
        Step 3: Select Seat Number
        Step 4: Enter / Confirm Passenger Name
        Step 5: Confirm & Trigger STK Push
        """
        routes = db.execute(select(Route).order_by(Route.id).limit(5)).scalars().all()
        if not routes:
            return MESSAGES[lang]["no_routes"]

        # Step 1: User just entered '1' -> Display routes
        if len(sub_inputs) == 0:
            route_lines = "\n".join(
                f"{i+1}. {r.name} (KES {int(r.base_fare)})" for i, r in enumerate(routes)
            )
            response = MESSAGES[lang]["select_route"].format(routes=route_lines)
            session_obj.current_menu = "BOOKING_ROUTE_SELECT"
            db.commit()
            return response

        # Check for '0' (Back to main)
        if sub_inputs[0] == "0":
            session_obj.current_menu = "MAIN_MENU"
            db.commit()
            return MESSAGES[lang]["welcome"]

        # Parse selected route
        try:
            route_idx = int(sub_inputs[0]) - 1
            if not (0 <= route_idx < len(routes)):
                return MESSAGES[lang]["welcome"]
            selected_route = routes[route_idx]
        except ValueError:
            return MESSAGES[lang]["welcome"]

        # Step 2: Trips for selected route
        trips = db.execute(
            select(Trip).where(Trip.route_id == selected_route.id).order_by(Trip.id).limit(4)
        ).scalars().all()

        if not trips:
            return MESSAGES[lang]["no_trips"]

        if len(sub_inputs) == 1:
            trip_lines = []
            for i, t in enumerate(trips):
                # Retrieve Sacco or vehicle
                fare = int(t.fixed_price or selected_route.base_fare)
                dep = t.name or f"Trip #{t.id}"
                trip_lines.append(f"{i+1}. {dep} (KES {fare})")
            response = MESSAGES[lang]["select_trip"].format(trips="\n".join(trip_lines))
            session_obj.current_menu = "BOOKING_TRIP_SELECT"
            db.commit()
            return response

        if sub_inputs[1] == "0":
            # Back to route select
            route_lines = "\n".join(
                f"{i+1}. {r.name} (KES {int(r.base_fare)})" for i, r in enumerate(routes)
            )
            return MESSAGES[lang]["select_route"].format(routes=route_lines)

        try:
            trip_idx = int(sub_inputs[1]) - 1
            if not (0 <= trip_idx < len(trips)):
                return MESSAGES[lang]["welcome"]
            selected_trip = trips[trip_idx]
        except ValueError:
            return MESSAGES[lang]["welcome"]

        # Calculate available seats
        fare = float(selected_trip.fixed_price or selected_route.base_fare)
        booked_seats = set(
            db.execute(
                select(Booking.seat_number).where(
                    Booking.trip_id == selected_trip.id,
                    Booking.status.in_(["confirmed", "pending", "boarded"]),
                )
            ).scalars().all()
        )
        # Assuming vehicle capacity 14 by default
        veh_capacity = 14
        if selected_trip.vehicle_id:
            veh = db.execute(select(Vehicle).where(Vehicle.id == selected_trip.vehicle_id)).scalar_one_or_none()
            if veh and veh.vehicle_type_id:
                # Default 14
                veh_capacity = 14

        available_seats = [s for s in range(1, veh_capacity + 1) if s not in booked_seats]
        if not available_seats:
            return (
                "END All seats on this trip are currently booked. "
                "Dial *384# to choose another departure time."
            )

        # Step 3: Prompt for seat number
        if len(sub_inputs) == 2:
            shown_seats = ", ".join(str(s) for s in available_seats[:6])
            response = MESSAGES[lang]["select_seat"].format(
                route=selected_route.name,
                trip=selected_trip.name or f"Trip #{selected_trip.id}",
                fare=int(fare),
                seats=shown_seats,
            )
            session_obj.current_menu = "BOOKING_SEAT_SELECT"
            db.commit()
            return response

        # Parse seat input
        seat_raw = sub_inputs[2].strip()
        try:
            seat_num = int(seat_raw)
            if seat_num == 0:
                # Auto-assign next available seat
                seat_num = available_seats[0]
            elif seat_num not in available_seats:
                # Specified seat already taken
                return f"END Seat #{seat_num} is unavailable. Dial *384# to pick another seat."
        except ValueError:
            seat_num = available_seats[0]

        # Step 4: Prompt for passenger name
        # Check if existing user has phone
        existing_user = db.execute(
            select(User).where(User.phone == session_obj.phone_number)
        ).scalar_one_or_none()
        suggestion = ""
        if existing_user and existing_user.full_name:
            suggestion = f"1. Use {existing_user.full_name}\n"

        if len(sub_inputs) == 3:
            response = MESSAGES[lang]["enter_name"].format(suggestion=suggestion)
            session_obj.current_menu = "BOOKING_NAME_INPUT"
            db.commit()
            return response

        # Parse passenger name
        name_raw = sub_inputs[3].strip()
        if name_raw == "1" and existing_user and existing_user.full_name:
            passenger_name = existing_user.full_name
        else:
            passenger_name = name_raw if len(name_raw) > 2 else (existing_user.full_name if existing_user else "Commuter Passenger")

        # Step 5: Confirmation menu
        # Get vehicle plate & sacco
        bus_plate = "Fleet Transit"
        sacco_name = "Super Metro"
        if selected_trip.vehicle_id:
            v_info = db.execute(
                text("""
                    SELECT v.plate_number, s.name AS sacco_name
                    FROM vehicles v
                    LEFT JOIN saccos s ON s.id = v.sacco_id
                    WHERE v.id = :vid
                """),
                {"vid": selected_trip.vehicle_id},
            ).mappings().one_or_none()
            if v_info:
                bus_plate = v_info["plate_number"]
                sacco_name = v_info["sacco_name"] or sacco_name

        if len(sub_inputs) == 4:
            response = MESSAGES[lang]["confirm_booking"].format(
                route=selected_route.name,
                bus=bus_plate,
                sacco=sacco_name,
                seat=seat_num,
                fare=int(fare),
                name=passenger_name,
            )
            session_obj.current_menu = "BOOKING_CONFIRMATION"
            db.commit()
            return response

        # Step 6: Confirmation execution
        confirm_choice = sub_inputs[4].strip()
        if confirm_choice != "1":
            return MESSAGES[lang]["session_ended"]

        # Ensure user exists
        user = existing_user
        if not user:
            user = User(
                full_name=passenger_name,
                phone=session_obj.phone_number,
                role="user",
            )
            db.add(user)
            db.flush()

        # Create Booking
        booking = Booking(
            trip_id=selected_trip.id,
            user_id=user.id,
            seat_number=seat_num,
            board_stop_order=1,
            alight_stop_order=2,
            status="pending",
            payment_status="pending",
        )
        db.add(booking)
        db.flush()

        # Trigger M-Pesa STK Push
        cls._trigger_daraja_stk(
            phone=session_obj.phone_number,
            amount=fare,
            booking_id=booking.id,
            seat=seat_num,
        )

        db.commit()

        # Return END screen
        response = MESSAGES[lang]["booking_success"].format(
            fare=int(fare),
            seat=seat_num,
        )
        cls._log_hop(
            db,
            session_obj.session_id,
            session_obj.phone_number,
            confirm_choice,
            "BOOKING_COMPLETED",
            response,
        )
        return response

    @staticmethod
    def _trigger_daraja_stk(phone: str, amount: float, booking_id: int, seat: int):
        """Trigger async STK push or record simulated checkout ID."""
        import asyncio

        async def _push():
            try:
                norm_phone = daraja.normalize_phone(phone)
                if daraja.configured():
                    await daraja.stk_push(
                        phone=norm_phone,
                        amount=amount,
                        account_reference=f"BG-{booking_id}",
                        transaction_desc=f"Seat {seat}",
                    )
            except Exception:
                pass

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(_push())
            else:
                loop.run_until_complete(_push())
        except Exception:
            pass

    @staticmethod
    def _log_hop(
        db: Session,
        session_id: str,
        phone_number: str,
        user_input: str,
        menu_state: str,
        response_text: str,
    ):
        try:
            log = UssdLog(
                session_id=session_id,
                phone_number=phone_number,
                input_text=user_input,
                menu_state=menu_state,
                response_text=response_text[:500],
            )
            db.add(log)
            db.commit()
        except Exception:
            pass


# =====================================================================
# SIMULATOR & FASTAPI ASYNC HELPER
# =====================================================================

async def process_ussd_step(
    db: AsyncSession,
    session_id: str,
    phone_number: str,
    text: str,
    service_code: str = DEFAULT_SERVICE_CODE,
) -> Dict[str, Any]:
    """
    Async helper for FastAPI endpoint execution that unwraps the synchronous engine
    via run_sync, returning structured JSON metadata for web simulation.
    """
    def _sync_exec(sync_session: Session):
        raw_resp = UssdEngine.handle_request(
            sync_session, session_id, phone_number, text, service_code
        )
        return raw_resp

    response_text = await db.run_sync(_sync_exec)
    is_con = response_text.startswith("CON ")
    clean_msg = response_text[4:] if (response_text.startswith("CON ") or response_text.startswith("END ")) else response_text

    return {
        "status": "CON" if is_con else "END",
        "raw_response": response_text,
        "message": clean_msg,
        "session_id": session_id,
        "phone_number": phone_number,
        "inputs": UssdEngine.parse_inputs(text),
    }
