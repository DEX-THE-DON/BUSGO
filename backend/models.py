from sqlalchemy import Column, Integer, String, Boolean, Text, ForeignKey, TIMESTAMP, Numeric, JSON, Float, func
from sqlalchemy.orm import relationship
from .db import Base


class Sacco(Base):
    __tablename__ = 'saccos'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    slug = Column(String, unique=True, nullable=False)
    registration_no = Column(String, unique=True, nullable=True)
    headquarters = Column(String, nullable=False, default='Nairobi')
    contact_phone = Column(String, nullable=True)
    contact_email = Column(String, nullable=True)
    primary_color = Column(String, nullable=False, default='#06b6d4')
    accent_color = Column(String, nullable=False, default='#f43f5e')
    logo_url = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True))

    vehicles = relationship('Vehicle', back_populates='sacco')
    routes = relationship('Route', back_populates='sacco')
    trips = relationship('Trip', back_populates='sacco')
    users = relationship('User', back_populates='sacco')
    settlements = relationship('SaccoSettlement', back_populates='sacco')


class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    sacco_id = Column(Integer, ForeignKey('saccos.id'), nullable=True)
    full_name = Column(Text, nullable=False)
    phone = Column(String, unique=True, nullable=True)
    email = Column(String, unique=True, nullable=True)
    password_hash = Column(Text, nullable=True)
    role = Column(String, nullable=False, default='user')  # 'admin' | 'sacco_admin' | 'driver' | 'user'
    psv_badge_number = Column(String, nullable=True)
    psv_badge_expiry = Column(TIMESTAMP(timezone=True), nullable=True)
    loyalty_points = Column(Integer, nullable=False, default=0)
    created_at = Column(TIMESTAMP(timezone=True))

    sacco = relationship('Sacco', back_populates='users')
    loyalty_transactions = relationship('LoyaltyTransaction', back_populates='user')


class VehicleType(Base):
    __tablename__ = 'vehicle_types'

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String, unique=True, nullable=False)
    display_name = Column(String, nullable=False)
    seat_capacity = Column(Integer, nullable=False)
    # 'passenger' => commuter transit; 'cargo' => freight logistics (lorries, pickups, trucks)
    purpose = Column(String, nullable=False, default='passenger')
    cargo_tonnage = Column(Float, nullable=True)
    # Optional layout descriptor for the frontend seat grid, e.g.
    # {"columns": 4, "rows": [[1,2,3,4],[5,6,7,8],[9,10,11],[12,13,14]]}
    seat_layout = Column(JSON, nullable=True)

    vehicles = relationship('Vehicle', back_populates='vehicle_type')


class Vehicle(Base):
    __tablename__ = 'vehicles'

    id = Column(Integer, primary_key=True, index=True)
    sacco_id = Column(Integer, ForeignKey('saccos.id'), nullable=True)
    driver_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    plate_number = Column(String, unique=True, nullable=False)
    vehicle_type_id = Column(Integer, ForeignKey('vehicle_types.id'), nullable=False)
    # 'passenger' => commuters; 'cargo' => freight / logistics (lorries, pickups, etc.)
    purpose = Column(String, nullable=False, default='passenger')
    # Specific body type e.g. 'canter_lorry', 'box_lorry', 'tipper_lorry', 'flatbed_lorry', 'pickup_lorry', 'matatu_14', 'nganya_35'
    body_type = Column(String, nullable=True)
    cargo_tonnage_capacity = Column(Float, nullable=True)
    is_electric = Column(Boolean, nullable=False, default=False)
    chassis_number = Column(String, nullable=True)
    manufacture_year = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True))

    sacco = relationship('Sacco', back_populates='vehicles')
    driver = relationship('User', foreign_keys=[driver_id])
    vehicle_type = relationship('VehicleType', back_populates='vehicles')
    trips = relationship('Trip', back_populates='vehicle')
    compliance = relationship('VehicleCompliance', back_populates='vehicle', uselist=False)
    telemetry = relationship('VehicleTelemetry', back_populates='vehicle')


class VehicleCompliance(Base):
    __tablename__ = 'vehicle_compliance'

    id = Column(Integer, primary_key=True, index=True)
    vehicle_id = Column(Integer, ForeignKey('vehicles.id'), unique=True, nullable=False)
    speed_governor_vendor = Column(String, nullable=True)
    speed_governor_cert = Column(String, nullable=True)
    speed_governor_expiry = Column(TIMESTAMP(timezone=True), nullable=True)
    ntsa_inspection_cert = Column(String, nullable=True)
    ntsa_inspection_expiry = Column(TIMESTAMP(timezone=True), nullable=True)
    insurance_underwriter = Column(String, nullable=True)
    insurance_policy_no = Column(String, nullable=True)
    insurance_expiry = Column(TIMESTAMP(timezone=True), nullable=True)
    is_grounded = Column(Boolean, nullable=False, default=False)
    grounded_reason = Column(Text, nullable=True)
    last_inspected_at = Column(TIMESTAMP(timezone=True), nullable=True)
    updated_at = Column(TIMESTAMP(timezone=True), nullable=True)

    vehicle = relationship('Vehicle', back_populates='compliance')


class Route(Base):
    __tablename__ = 'routes'

    id = Column(Integer, primary_key=True, index=True)
    sacco_id = Column(Integer, ForeignKey('saccos.id'), nullable=True)
    name = Column(String, nullable=False)
    country = Column(String, nullable=False, default='KE')
    # 'direct' => origin→destination non-stop; 'stopwise' => pickups/dropoffs anywhere
    route_type = Column(String, nullable=False, default='stopwise')
    # Custom pricing: Base boarding fee and rate per corridor hop
    base_fare = Column(Float, nullable=False, default=200.0)
    per_hop_fare = Column(Float, nullable=False, default=150.0)
    # Optional stop-to-stop price matrix: {"1-4": 1200, "1-2": 350, "2-4": 900}
    fare_matrix = Column(JSON, nullable=True)

    sacco = relationship('Sacco', back_populates='routes')
    trips = relationship('Trip', back_populates='route')
    stops = relationship('RouteStop', back_populates='route', order_by='RouteStop.stop_order')


class Trip(Base):
    __tablename__ = 'trips'

    id = Column(Integer, primary_key=True, index=True)
    route_id = Column(Integer, ForeignKey('routes.id'), nullable=False)
    vehicle_id = Column(Integer, ForeignKey('vehicles.id'), nullable=True)
    driver_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    name = Column(String, nullable=False)
    scheduled_at = Column(TIMESTAMP(timezone=True))
    status = Column(String, nullable=False, default='scheduled')
    # Driver-reported bus position: which stop the bus is currently at.
    current_stop_order = Column(Integer, nullable=True)

    # Pricing overrides & driver tier governance
    # Optional fixed flat trip price (e.g. flat KES 1,200 for express direct trips)
    fixed_price = Column(Float, nullable=True)
    # Admin governance flag: whether driver can select an operational pricing tier
    allow_driver_tier = Column(Boolean, nullable=False, default=False)
    # Maximum allowed surcharge percentage governed by admin (e.g. up to +25%)
    max_surcharge_pct = Column(Float, nullable=False, default=25.0)
    # Active operational driver tier ('off_peak', 'standard', 'peak_rush', 'rush_hour_rain')
    driver_tier = Column(String, nullable=False, default='standard')

    # Live GPS Telemetry (Driver Real-time Geolocation Streaming)
    current_lat = Column(Float, nullable=True)
    current_lng = Column(Float, nullable=True)
    current_speed = Column(Float, nullable=True)
    current_heading = Column(Float, nullable=True)
    last_gps_at = Column(TIMESTAMP(timezone=True), nullable=True)

    sacco_id = Column(Integer, ForeignKey('saccos.id'), nullable=True)

    sacco = relationship('Sacco', back_populates='trips')
    route = relationship('Route', back_populates='trips')
    vehicle = relationship('Vehicle', back_populates='trips')
    driver = relationship('User', foreign_keys=[driver_id])
    bookings = relationship('Booking', back_populates='trip')
    parcels = relationship('Parcel', back_populates='trip')


class RouteStop(Base):
    __tablename__ = 'route_stops'

    id = Column(Integer, primary_key=True, index=True)
    route_id = Column(Integer, ForeignKey('routes.id'), nullable=False)
    stop_name = Column(String, nullable=False)
    stop_order = Column(Integer, nullable=False)

    route = relationship('Route', back_populates='stops')


class Booking(Base):
    __tablename__ = 'bookings'

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey('trips.id'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    seat_number = Column(Integer, nullable=False)
    board_stop_order = Column(Integer, nullable=False)
    alight_stop_order = Column(Integer, nullable=False)
    status = Column(String, nullable=False, default='pending')
    payment_status = Column(String, nullable=False, default='unpaid')
    # Luggage / Accompanied Mzigo Add-ons
    has_luggage = Column(Boolean, nullable=False, default=False)
    luggage_count = Column(Integer, nullable=False, default=0)
    luggage_fee = Column(Float, nullable=False, default=0.0)
    luggage_description = Column(String, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True))

    trip = relationship('Trip', back_populates='bookings')
    payments = relationship('Payment', back_populates='booking')


class Payment(Base):
    __tablename__ = 'payments'

    id = Column(Integer, primary_key=True, index=True)
    booking_id = Column(Integer, ForeignKey('bookings.id'), nullable=False)
    provider = Column(String, nullable=False)
    provider_payload = Column(JSON, nullable=True)
    # Real-provider tracking (M-Pesa Daraja STK push)
    provider_reference = Column(String, nullable=True)   # e.g. CheckoutRequestID
    receipt_number = Column(String, nullable=True, index=True) # e.g. M-Pesa Receipt Number QKA451JK92
    callback_payload = Column(JSON, nullable=True)       # raw webhook body
    callback_verified = Column(Boolean, nullable=False, default=False)
    phone_number = Column(String, nullable=True)
    amount = Column(Numeric(10, 2), nullable=False)
    status = Column(String, nullable=False, default='initiated')
    created_at = Column(TIMESTAMP(timezone=True))

    booking = relationship('Booking', back_populates='payments')


class SeatChain(Base):
    """A chain of segment bookings sharing one physical seat on a trip.

    The chain is the backbone of the relay/transfer feature: passengers on
    seat 7 board/alight at consecutive stops (A→B 🔗 B→C 🔗 C→D), and each
    passenger is notified when the seat frees up at their stop.
    """
    __tablename__ = 'seat_chains'

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey('trips.id'), nullable=False)
    seat_number = Column(Integer, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True))

    links = relationship('SeatChainLink', back_populates='chain', order_by='SeatChainLink.position')


class SeatChainLink(Base):
    __tablename__ = 'seat_chain_links'

    id = Column(Integer, primary_key=True, index=True)
    chain_id = Column(Integer, ForeignKey('seat_chains.id'), nullable=False)
    booking_id = Column(Integer, ForeignKey('bookings.id'), nullable=False)
    position = Column(Integer, nullable=False)
    board_stop_order = Column(Integer, nullable=False)
    alight_stop_order = Column(Integer, nullable=False)

    chain = relationship('SeatChain', back_populates='links')


class SeatInterest(Base):
    """Waitlist entry: "notify me when a seat frees for this segment"."""
    __tablename__ = 'seat_interests'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    trip_id = Column(Integer, ForeignKey('trips.id'), nullable=False)
    board_stop_order = Column(Integer, nullable=False)
    alight_stop_order = Column(Integer, nullable=False)
    seat_number = Column(Integer, nullable=True)   # NULL = any seat
    status = Column(String, nullable=False, default='active')  # active | notified | filled | cancelled | expired
    notified_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True))


class Notification(Base):
    __tablename__ = 'notifications'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    kind = Column(String, nullable=False)          # seat_freed | chain_updated | booking_confirmed | payment_* | system
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    payload = Column(JSON, nullable=True)
    read = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP(timezone=True))


class Dispatch(Base):
    """Log and outbox for SMS and WhatsApp passenger dispatch notifications."""
    __tablename__ = 'dispatches'

    id = Column(Integer, primary_key=True, index=True)
    booking_id = Column(Integer, ForeignKey('bookings.id'), nullable=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    channel = Column(String, nullable=False)               # 'whatsapp' | 'sms'
    recipient = Column(String, nullable=False)             # e.g. '+254716314831'
    message_body = Column(Text, nullable=False)
    status = Column(String, nullable=False, default='sent') # 'sent' | 'delivered' | 'simulated' | 'failed'
    provider = Column(String, nullable=False, default='simulator')
    provider_reference = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True))


class Parcel(Base):
    """Unaccompanied cargo / parcel dispatch (Mzigo Service)."""
    __tablename__ = 'parcels'

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey('trips.id'), nullable=False)
    sender_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    sender_name = Column(String, nullable=False)
    sender_phone = Column(String, nullable=False)
    recipient_name = Column(String, nullable=False)
    recipient_phone = Column(String, nullable=False)
    pickup_stop_order = Column(Integer, nullable=False)
    dropoff_stop_order = Column(Integer, nullable=False)
    tracking_code = Column(String, unique=True, index=True, nullable=False)
    security_pin = Column(String, nullable=False) # 4-digit PIN required for collection
    category = Column(String, nullable=False, default='medium_box') # small_envelope, small_box, medium_box, heavy_sack, special_fragile
    description = Column(String, nullable=False)
    weight_kg = Column(Float, nullable=True)
    fee = Column(Float, nullable=False)
    base_fare = Column(Float, nullable=False, default=300.0)
    pickup_type = Column(String, nullable=False, default='station') # 'station' | 'doorstep'
    delivery_type = Column(String, nullable=False, default='station') # 'station' | 'doorstep'
    pickup_fee = Column(Float, nullable=False, default=0.0)
    delivery_fee = Column(Float, nullable=False, default=0.0)
    sender_address = Column(String, nullable=True)
    sender_city_or_area = Column(String, nullable=True)
    sender_pickup_notes = Column(Text, nullable=True)
    recipient_address = Column(String, nullable=True)
    recipient_city_or_area = Column(String, nullable=True)
    recipient_delivery_notes = Column(Text, nullable=True)
    declared_value = Column(Float, nullable=True, default=0.0)
    courier_rider_phone = Column(String, nullable=True)
    payment_status = Column(String, nullable=False, default='unpaid')
    status = Column(String, nullable=False, default='registered') # registered, pickup_dispatched, received_at_hub, loaded, in_transit, arrived_at_hub, out_for_delivery, ready_for_collection, delivered, returned
    loaded_at = Column(TIMESTAMP(timezone=True), nullable=True)
    delivered_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True))

    trip = relationship('Trip', back_populates='parcels')
    sender = relationship('User', foreign_keys=[sender_id])


class LoyaltyTransaction(Base):
    """Accrual and redemption ledger for commuter Safari Points."""
    __tablename__ = 'loyalty_transactions'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    points = Column(Integer, nullable=False)
    booking_id = Column(Integer, ForeignKey('bookings.id'), nullable=True)
    description = Column(String, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), default=func.now())

    user = relationship('User', back_populates='loyalty_transactions')
    booking = relationship('Booking')


class Incident(Base):
    """Highway incidents, hazards, delays, and emergency SOS alerts."""
    __tablename__ = 'incidents'

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey('trips.id'), nullable=False)
    sacco_id = Column(Integer, ForeignKey('saccos.id'), nullable=True)
    reported_by_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    category = Column(String, nullable=False) # 'traffic_jam' | 'accident' | 'police_inspection' | 'mechanical_breakdown' | 'road_hazard' | 'sos'
    severity = Column(String, nullable=False, default='medium') # 'low' | 'medium' | 'high' | 'critical_sos'
    estimated_delay_mins = Column(Integer, nullable=False, default=0)
    location_name = Column(String, nullable=False) # e.g. "Limuru Escarpment"
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    description = Column(Text, nullable=False)
    status = Column(String, nullable=False, default='active') # 'active' | 'resolved' | 'relief_dispatched'
    relief_trip_id = Column(Integer, ForeignKey('trips.id'), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=func.now())
    resolved_at = Column(TIMESTAMP(timezone=True), nullable=True)

    trip = relationship('Trip', foreign_keys=[trip_id])
    sacco = relationship('Sacco')
    reported_by = relationship('User', foreign_keys=[reported_by_id])


class SaccoSettlement(Base):
    """SACCO revenue withdrawal and Daraja B2C disbursement ledger."""
    __tablename__ = 'sacco_settlements'

    id = Column(Integer, primary_key=True, index=True)
    sacco_id = Column(Integer, ForeignKey('saccos.id'), nullable=False)
    gross_amount = Column(Float, nullable=False)
    platform_fee = Column(Float, nullable=False, default=0.0) # 3% platform commission
    net_payout = Column(Float, nullable=False) # 97% net disbursed
    recipient_phone = Column(String, nullable=False)
    recipient_name = Column(String, nullable=False)
    b2c_conversation_id = Column(String, nullable=True)
    b2c_transaction_id = Column(String, nullable=True)
    status = Column(String, nullable=False, default='completed') # 'pending' | 'completed' | 'failed'
    notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=func.now())

    sacco = relationship('Sacco', back_populates='settlements')


class VehicleTelemetry(Base):
    """Live EV and fleet telemetry: battery SoC %, range, consumption, temp."""
    __tablename__ = 'vehicle_telemetry'

    id = Column(Integer, primary_key=True, index=True)
    vehicle_id = Column(Integer, ForeignKey('vehicles.id'), nullable=False)
    battery_soc_pct = Column(Float, nullable=False, default=100.0) # 0 to 100%
    battery_temp_c = Column(Float, nullable=False, default=28.0)
    estimated_range_km = Column(Float, nullable=False, default=250.0)
    charging_status = Column(String, nullable=False, default='discharging') # 'discharging' | 'charging_dc_fast' | 'charging_ac' | 'idle'
    power_consumption_kwh_per_km = Column(Float, nullable=False, default=0.85)
    co2_saved_kg = Column(Float, nullable=False, default=450.0)
    regen_braking_kwh = Column(Float, nullable=False, default=12.5)
    recorded_at = Column(TIMESTAMP(timezone=True), default=func.now())

    vehicle = relationship('Vehicle', back_populates='telemetry')


class ChargingStation(Base):
    """Kenyan highway EV fast-charging depot hubs."""
    __tablename__ = 'charging_stations'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False) # e.g. "BasiGo Embakasi Central Depot"
    operator = Column(String, nullable=False) # "BasiGo" | "DriveElectric Kenya" | "Roam"
    location_name = Column(String, nullable=False)
    corridor = Column(String, nullable=False) # "A104" | "A109" | "Thika Superhighway"
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    power_kw = Column(Float, nullable=False, default=120.0) # e.g. 120kW DC Fast Charger
    ports_total = Column(Integer, nullable=False, default=4)
    ports_available = Column(Integer, nullable=False, default=3)
    connector_type = Column(String, nullable=False, default='CCS2 / GB/T')
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(TIMESTAMP(timezone=True), default=func.now())


class GroupBooking(Base):
    """'Changa na Marafiki' (Split Fare Harambee) multi-seat reservation."""
    __tablename__ = 'group_bookings'

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey('trips.id'), nullable=False)
    created_by_user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    group_name = Column(String, nullable=False)
    board_stop_order = Column(Integer, nullable=False, default=1)
    alight_stop_order = Column(Integer, nullable=False, default=4)
    total_amount = Column(Float, nullable=False)
    paid_amount = Column(Float, nullable=False, default=0.0)
    status = Column(String, nullable=False, default='pending')  # 'pending', 'completed', 'expired', 'cancelled'
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), default=func.now())

    trip = relationship('Trip')
    created_by = relationship('User')
    members = relationship('GroupBookingMember', back_populates='group_booking', cascade='all, delete-orphan')


class GroupBookingMember(Base):
    """Individual member in a Changa na Marafiki group reservation."""
    __tablename__ = 'group_booking_members'

    id = Column(Integer, primary_key=True, index=True)
    group_booking_id = Column(Integer, ForeignKey('group_bookings.id'), nullable=False)
    seat_number = Column(Integer, nullable=False)
    passenger_name = Column(String, nullable=False)
    phone_number = Column(String, nullable=False)
    share_amount = Column(Float, nullable=False)
    payment_status = Column(String, nullable=False, default='pending')  # 'pending', 'paid'
    mpesa_receipt = Column(String, nullable=True)
    paid_at = Column(TIMESTAMP(timezone=True), nullable=True)
    booking_id = Column(Integer, ForeignKey('bookings.id'), nullable=True)

    group_booking = relationship('GroupBooking', back_populates='members')
    booking = relationship('Booking')


class StageReconciliation(Base):
    """Stage Dispatcher & Conductor end-of-trip 'Mshiko wa Stage' reconciliation."""
    __tablename__ = 'stage_reconciliations'

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey('trips.id'), nullable=False)
    sacco_id = Column(Integer, ForeignKey('saccos.id'), nullable=True)
    dispatcher_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    gross_cash = Column(Float, nullable=False, default=0.0)
    gross_mpesa = Column(Float, nullable=False, default=0.0)
    total_revenue = Column(Float, nullable=False, default=0.0)
    fuel_deduction = Column(Float, nullable=False, default=0.0)
    conductor_commission = Column(Float, nullable=False, default=0.0)
    other_expenses = Column(Float, nullable=False, default=0.0)
    net_sacco_cash = Column(Float, nullable=False, default=0.0)
    passenger_count = Column(Integer, nullable=False, default=0)
    notes = Column(Text, nullable=True)
    reconciled_at = Column(TIMESTAMP(timezone=True), default=func.now())

    trip = relationship('Trip')
    sacco = relationship('Sacco')
    dispatcher = relationship('User')


class LostFoundItem(Base):
    """'Nipe Shugli' - Highway and Terminal Lost & Found item registry."""
    __tablename__ = 'lost_found_items'

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey('trips.id'), nullable=True)
    sacco_id = Column(Integer, ForeignKey('saccos.id'), nullable=True)
    reported_by_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    category = Column(String, nullable=False)  # 'luggage', 'electronics', 'wallet_id', 'clothing', 'documents', 'other'
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    item_type = Column(String, nullable=False, default='lost')  # 'lost' | 'found'
    status = Column(String, nullable=False, default='open')      # 'open', 'claimed', 'resolved'
    location_or_station = Column(String, nullable=False)       # e.g. "Tea Room Nairobi" or "Vehicle KDD 123X"
    contact_phone = Column(String, nullable=False)
    contact_name = Column(String, nullable=False)
    claimant_phone = Column(String, nullable=True)
    claimant_notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=func.now())
    resolved_at = Column(TIMESTAMP(timezone=True), nullable=True)

    trip = relationship('Trip')
    sacco = relationship('Sacco')





