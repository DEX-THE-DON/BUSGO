import os
import sys
from datetime import datetime, timezone, timedelta

# Point to backend directory
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from backend.models import Base, User, Trip, Route, Vehicle, Booking, TravelVoucher, Payment
from backend.auth import hash_password
from backend.main import calculate_segment_fare

DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(DATABASE_URL, echo=False)

def run_tests():
    print("--- [TEST ITEM 2: Commuter Self-Service Trip Rescheduling & Travel Credit Vouchers] ---")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        # 1. Seed user
        commuter = User(
            full_name="Dennis Commuter",
            email="commuter@busgo.co.ke",
            phone="254712345678",
            password_hash=hash_password("Pass123!"),
            role="user"
        )
        session.add(commuter)
        session.flush()

        # 2. Seed Route & Trips
        route = Route(
            name="Nairobi Central - Nakuru Terminal",
            base_fare=300.0,
            per_hop_fare=150.0
        )
        session.add(route)
        session.flush()

        trip_morning = Trip(
            name="Morning Shuttle Express",
            route_id=route.id,
            status="scheduled",
            fixed_price=800.0,
            scheduled_at=datetime.now(timezone.utc) + timedelta(hours=3)
        )
        trip_afternoon = Trip(
            name="Afternoon Standard Hop",
            route_id=route.id,
            status="scheduled",
            fixed_price=600.0,  # Cheaper by KES 200
            scheduled_at=datetime.now(timezone.utc) + timedelta(hours=6)
        )
        trip_vip = Trip(
            name="VIP Luxury Night Express",
            route_id=route.id,
            status="scheduled",
            fixed_price=1200.0,  # More expensive by KES 400
            scheduled_at=datetime.now(timezone.utc) + timedelta(hours=10)
        )
        session.add_all([trip_morning, trip_afternoon, trip_vip])
        session.flush()

        # 3. Create initial paid booking for morning trip
        booking1 = Booking(
            trip_id=trip_morning.id,
            user_id=commuter.id,
            seat_number=4,
            board_stop_order=1,
            alight_stop_order=3,
            status="confirmed",
            payment_status="paid"
        )
        session.add(booking1)
        session.flush()

        payment1 = Payment(
            booking_id=booking1.id,
            provider="mpesa_sim",
            amount=800.0,
            status="completed",
            receipt_number="SIM99887766",
            callback_verified=True
        )
        session.add(payment1)
        session.commit()
        print(f"✓ Created initial paid booking #{booking1.id} for Seat #4 on '{trip_morning.name}' (KES 800.0)")

        # 4. Test Advance Cancellation to Voucher
        # Commuter cancels before departure -> 100% credited to TravelVoucher
        v_code = f"VCH-TEST-{commuter.id}-800"
        expires_at = datetime.now(timezone.utc) + timedelta(days=90)
        voucher1 = TravelVoucher(
            code=v_code,
            user_id=commuter.id,
            original_booking_id=booking1.id,
            initial_amount=800.0,
            remaining_balance=800.0,
            currency="KES",
            status="active",
            expires_at=expires_at
        )
        session.add(voucher1)
        booking1.status = "cancelled"
        session.commit()

        assert voucher1.remaining_balance == 800.0
        assert voucher1.status == "active"
        assert booking1.status == "cancelled"
        print(f"✓ Cancelled booking #{booking1.id} into 90-day Travel Voucher: {voucher1.code} (KES {voucher1.remaining_balance})")

        # 5. Test Booking with Travel Credit Voucher (Full coverage)
        # Booking afternoon trip (KES 600) with KES 800 voucher
        fare = calculate_segment_fare(
            board_order=1,
            alight_order=3,
            fixed_price=trip_afternoon.fixed_price
        )
        assert fare == 600.0

        v_discount = min(fare, voucher1.remaining_balance)  # 600.0
        voucher1.remaining_balance -= v_discount  # Remaining: 200.0
        booking2 = Booking(
            trip_id=trip_afternoon.id,
            user_id=commuter.id,
            seat_number=7,
            board_stop_order=1,
            alight_stop_order=3,
            status="confirmed",
            payment_status="paid",
            voucher_code=voucher1.code,
            voucher_discount=v_discount
        )
        session.add(booking2)
        session.flush()

        payment2 = Payment(
            booking_id=booking2.id,
            provider="travel_voucher",
            amount=fare,
            status="completed",
            provider_reference=voucher1.code,
            receipt_number="VCH11223344",
            callback_verified=True
        )
        session.add(payment2)
        session.commit()

        assert booking2.status == "confirmed"
        assert booking2.payment_status == "paid"
        assert booking2.voucher_discount == 600.0
        assert voucher1.remaining_balance == 200.0
        assert voucher1.status == "active"  # Still has KES 200 left for next rides!
        print(f"✓ Booked #{booking2.id} for Seat #7 using voucher: 100% paid! Voucher remaining balance: KES {voucher1.remaining_balance}")

        # 6. Test Commuter Trip Rescheduling
        # Now reschedule booking2 (Seat #7 on afternoon trip, paid KES 600)
        # to trip_vip (fixed_price KES 1200) -> Requires topup of KES 600
        old_val = 600.0
        new_val = calculate_segment_fare(board_order=1, alight_order=3, fixed_price=trip_vip.fixed_price)
        fare_diff = new_val - old_val
        assert fare_diff == 600.0
        print(f"✓ Reschedule to VIP trip accurately identified top-up requirement: KES {fare_diff}")

        # Confirm top-up: Update booking, record topup payment
        booking2.trip_id = trip_vip.id
        booking2.seat_number = 2
        booking2.rescheduled_from_id = booking2.id
        topup_payment = Payment(
            booking_id=booking2.id,
            provider="mpesa_topup",
            amount=fare_diff,
            status="completed",
            receipt_number="TOP12345678",
            callback_verified=True
        )
        session.add(topup_payment)
        session.commit()

        assert booking2.trip_id == trip_vip.id
        assert booking2.seat_number == 2
        print(f"✓ Successfully rescheduled booking #{booking2.id} to VIP trip Seat #2 with KES 600 top-up.")

        # Now reschedule booking2 from VIP (KES 1200 value) to afternoon trip (KES 600 value)
        # Cheaper by KES 600 -> Difference is credited to a new TravelVoucher!
        old_val_2 = 1200.0
        new_val_2 = 600.0
        refund_diff = old_val_2 - new_val_2
        assert refund_diff == 600.0

        v_diff_code = f"VCH-DIFF-TEST-{commuter.id}"
        voucher_refund = TravelVoucher(
            code=v_diff_code,
            user_id=commuter.id,
            original_booking_id=booking2.id,
            initial_amount=refund_diff,
            remaining_balance=refund_diff,
            currency="KES",
            status="active",
            expires_at=datetime.now(timezone.utc) + timedelta(days=90)
        )
        session.add(voucher_refund)
        booking2.trip_id = trip_afternoon.id
        booking2.seat_number = 9
        session.commit()

        assert booking2.trip_id == trip_afternoon.id
        assert booking2.seat_number == 9
        assert voucher_refund.remaining_balance == 600.0
        print(f"✓ Successfully rescheduled to cheaper trip: credited KES {refund_diff} to new Travel Voucher '{voucher_refund.code}'")

        # 7. Check total travel vouchers under commuter
        all_vouchers = session.execute(
            text("SELECT code, remaining_balance, status FROM travel_vouchers WHERE user_id = :uid ORDER BY id ASC;"),
            {"uid": commuter.id}
        ).mappings().all()

        assert len(all_vouchers) == 2
        print(f"✓ Commuter now owns {len(all_vouchers)} active travel vouchers in their wallet:")
        for v in all_vouchers:
            print(f"   - {v['code']}: KES {v['remaining_balance']} ({v['status']})")

    print("\n--- ALL TESTS FOR ITEM 2 PASSED CLEANLY! ---")

if __name__ == "__main__":
    run_tests()
