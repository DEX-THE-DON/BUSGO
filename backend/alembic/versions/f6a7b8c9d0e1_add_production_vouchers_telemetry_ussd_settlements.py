"""add production vouchers telemetry ussd and settlements

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-10-10 01:00:00.000000

Adds:
  - travel_vouchers table for commuter credit & rescheduling
  - ussd_sessions and ussd_logs tables for Africa's Talking / Telco USSD engine
  - gps_telemetry_logs table for hardware Teltonika / Concox packet ingestion
  - sacco_settlements table for Treasury and owner dividend payouts
  - stage_reconciliations table for conductor physical cash reconciliation
  - audit_logs table for immutable ticket void/override audits
  - hardware GPS columns on vehicles (tracker_imei, tracker_model, last_ping_at, etc.)
  - owner fields on vehicles (owner_id, owner_name, owner_phone)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Vehicles table extensions
    conn.execute(sa.text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);"))
    conn.execute(sa.text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_name VARCHAR;"))
    conn.execute(sa.text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_phone VARCHAR;"))
    conn.execute(sa.text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tracker_imei VARCHAR;"))
    conn.execute(sa.text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tracker_model VARCHAR;"))
    conn.execute(sa.text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_ping_at TIMESTAMPTZ;"))
    conn.execute(sa.text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_lat DOUBLE PRECISION;"))
    conn.execute(sa.text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_lng DOUBLE PRECISION;"))
    conn.execute(sa.text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_speed DOUBLE PRECISION;"))
    conn.execute(sa.text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_heading DOUBLE PRECISION;"))

    conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_vehicles_tracker_imei ON vehicles (tracker_imei);"))

    # 2. Trips table extensions
    conn.execute(sa.text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION;"))
    conn.execute(sa.text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS current_lng DOUBLE PRECISION;"))

    # 3. Travel Vouchers table
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS travel_vouchers (
            id SERIAL PRIMARY KEY,
            code VARCHAR NOT NULL UNIQUE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            original_booking_id INTEGER REFERENCES bookings(id),
            initial_amount DOUBLE PRECISION NOT NULL,
            remaining_balance DOUBLE PRECISION NOT NULL,
            currency VARCHAR NOT NULL DEFAULT 'KES',
            status VARCHAR NOT NULL DEFAULT 'active',
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            redeemed_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS ix_travel_vouchers_code ON travel_vouchers(code);
        CREATE INDEX IF NOT EXISTS ix_travel_vouchers_user_id ON travel_vouchers(user_id);
    """))

    # 4. USSD Sessions & Logs
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS ussd_sessions (
            id SERIAL PRIMARY KEY,
            session_id VARCHAR NOT NULL UNIQUE,
            phone_number VARCHAR NOT NULL,
            language VARCHAR NOT NULL DEFAULT 'en',
            current_menu VARCHAR NOT NULL DEFAULT 'MAIN_MENU',
            session_data JSONB,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ix_ussd_sessions_session_id ON ussd_sessions(session_id);
        CREATE INDEX IF NOT EXISTS ix_ussd_sessions_phone_number ON ussd_sessions(phone_number);

        CREATE TABLE IF NOT EXISTS ussd_logs (
            id SERIAL PRIMARY KEY,
            session_id VARCHAR NOT NULL,
            phone_number VARCHAR NOT NULL,
            input_text VARCHAR,
            menu_state VARCHAR NOT NULL,
            response_text TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ix_ussd_logs_session_id ON ussd_logs(session_id);
        CREATE INDEX IF NOT EXISTS ix_ussd_logs_phone_number ON ussd_logs(phone_number);
    """))

    # 5. GPS Telemetry Logs
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS gps_telemetry_logs (
            id SERIAL PRIMARY KEY,
            vehicle_id INTEGER REFERENCES vehicles(id),
            trip_id INTEGER REFERENCES trips(id),
            imei VARCHAR NOT NULL,
            lat DOUBLE PRECISION NOT NULL,
            lng DOUBLE PRECISION NOT NULL,
            speed_kmh DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            heading DOUBLE PRECISION,
            is_overspeed BOOLEAN NOT NULL DEFAULT FALSE,
            raw_payload TEXT,
            recorded_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ix_gps_telemetry_logs_vehicle_id ON gps_telemetry_logs(vehicle_id);
        CREATE INDEX IF NOT EXISTS ix_gps_telemetry_logs_recorded_at ON gps_telemetry_logs(recorded_at);
    """))

    # 6. Sacco Settlements & Treasury
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS sacco_settlements (
            id SERIAL PRIMARY KEY,
            sacco_id INTEGER NOT NULL REFERENCES saccos(id),
            date VARCHAR NOT NULL,
            gross_revenue DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            sacco_commission_fee DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            system_platform_fee DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            driver_split DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            vehicle_owner_split DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            payout_status VARCHAR NOT NULL DEFAULT 'pending',
            b2c_conversation_id VARCHAR,
            disbursed_at TIMESTAMPTZ,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ix_sacco_settlements_sacco_id ON sacco_settlements(sacco_id);
    """))

    # 7. Stage Reconciliations
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS stage_reconciliations (
            id SERIAL PRIMARY KEY,
            trip_id INTEGER NOT NULL REFERENCES trips(id),
            conductor_id INTEGER NOT NULL REFERENCES users(id),
            reconciled_by_id INTEGER REFERENCES users(id),
            expected_cash_amount DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            collected_cash_amount DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            cash_variance DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            variance_status VARCHAR NOT NULL DEFAULT 'balanced',
            notes TEXT,
            supervisor_pin_verified BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    """))

    # 8. Audit Logs
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            action VARCHAR NOT NULL,
            entity_type VARCHAR NOT NULL,
            entity_id INTEGER NOT NULL,
            actor_user_id INTEGER REFERENCES users(id),
            actor_role VARCHAR NOT NULL,
            supervisor_pin_verified BOOLEAN NOT NULL DEFAULT FALSE,
            supervisor_user_id INTEGER REFERENCES users(id),
            previous_state JSONB,
            new_state JSONB,
            reason TEXT,
            ip_address VARCHAR,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON audit_logs(action);
        CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs(created_at);
    """))


def downgrade() -> None:
    op.drop_table('audit_logs')
    op.drop_table('stage_reconciliations')
    op.drop_table('sacco_settlements')
    op.drop_table('gps_telemetry_logs')
    op.drop_table('ussd_logs')
    op.drop_table('ussd_sessions')
    op.drop_table('travel_vouchers')

    op.drop_column('trips', 'current_lng')
    op.drop_column('trips', 'current_lat')

    op.drop_column('vehicles', 'last_heading')
    op.drop_column('vehicles', 'last_speed')
    op.drop_column('vehicles', 'last_lng')
    op.drop_column('vehicles', 'last_lat')
    op.drop_column('vehicles', 'last_ping_at')
    op.drop_column('vehicles', 'tracker_model')
    op.drop_column('vehicles', 'tracker_imei')
    op.drop_column('vehicles', 'owner_phone')
    op.drop_column('vehicles', 'owner_name')
    op.drop_column('vehicles', 'owner_id')
