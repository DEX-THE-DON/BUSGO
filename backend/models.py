from sqlalchemy import Column, Integer, String, Boolean, Text, ForeignKey, TIMESTAMP, Numeric, JSON
from sqlalchemy.orm import relationship
from .db import Base


class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(Text, nullable=False)
    phone = Column(String, unique=True, nullable=True)
    email = Column(String, unique=True, nullable=True)
    password_hash = Column(Text, nullable=True)
    role = Column(String, nullable=False, default='user')
    created_at = Column(TIMESTAMP(timezone=True))


class VehicleType(Base):
    __tablename__ = 'vehicle_types'

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String, unique=True, nullable=False)
    display_name = Column(String, nullable=False)
    seat_capacity = Column(Integer, nullable=False)

    vehicles = relationship('Vehicle', back_populates='vehicle_type')


class Vehicle(Base):
    __tablename__ = 'vehicles'

    id = Column(Integer, primary_key=True, index=True)
    plate_number = Column(String, unique=True, nullable=False)
    vehicle_type_id = Column(Integer, ForeignKey('vehicle_types.id'), nullable=False)
    is_electric = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP(timezone=True))

    vehicle_type = relationship('VehicleType', back_populates='vehicles')
    trips = relationship('Trip', back_populates='vehicle')


class Route(Base):
    __tablename__ = 'routes'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    country = Column(String, nullable=False, default='KE')

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

    route = relationship('Route', back_populates='trips')
    vehicle = relationship('Vehicle', back_populates='trips')
    driver = relationship('User', foreign_keys=[driver_id])
    bookings = relationship('Booking', back_populates='trip')


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
    created_at = Column(TIMESTAMP(timezone=True))

    trip = relationship('Trip', back_populates='bookings')
    payments = relationship('Payment', back_populates='booking')


class Payment(Base):
    __tablename__ = 'payments'

    id = Column(Integer, primary_key=True, index=True)
    booking_id = Column(Integer, ForeignKey('bookings.id'), nullable=False)
    provider = Column(String, nullable=False)
    provider_payload = Column(JSON, nullable=True)
    amount = Column(Numeric(10, 2), nullable=False)
    status = Column(String, nullable=False, default='initiated')
    created_at = Column(TIMESTAMP(timezone=True))

    booking = relationship('Booking', back_populates='payments')
