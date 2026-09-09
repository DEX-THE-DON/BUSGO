"""add route pricing and trip driver tier columns

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-09-07 10:00:00.000000

Adds custom base_fare, per_hop_fare, and fare_matrix to routes.
Adds fixed_price, allow_driver_tier, max_surcharge_pct, and driver_tier to trips.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE routes ADD COLUMN IF NOT EXISTS base_fare DOUBLE PRECISION NOT NULL DEFAULT 200.0;"))
    conn.execute(sa.text("ALTER TABLE routes ADD COLUMN IF NOT EXISTS per_hop_fare DOUBLE PRECISION NOT NULL DEFAULT 150.0;"))
    conn.execute(sa.text("ALTER TABLE routes ADD COLUMN IF NOT EXISTS fare_matrix JSONB;"))

    conn.execute(sa.text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS fixed_price DOUBLE PRECISION;"))
    conn.execute(sa.text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS allow_driver_tier BOOLEAN NOT NULL DEFAULT FALSE;"))
    conn.execute(sa.text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS max_surcharge_pct DOUBLE PRECISION NOT NULL DEFAULT 25.0;"))
    conn.execute(sa.text("ALTER TABLE trips ADD COLUMN IF NOT EXISTS driver_tier VARCHAR NOT NULL DEFAULT 'standard';"))


def downgrade() -> None:
    op.drop_column('trips', 'driver_tier')
    op.drop_column('trips', 'max_surcharge_pct')
    op.drop_column('trips', 'allow_driver_tier')
    op.drop_column('trips', 'fixed_price')

    op.drop_column('routes', 'fare_matrix')
    op.drop_column('routes', 'per_hop_fare')
    op.drop_column('routes', 'base_fare')
