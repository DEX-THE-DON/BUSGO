"""dedupe route_stops and enforce unique (route_id, stop_order)

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
Create Date: 2026-08-18 00:00:00.000000

The demo seed could previously run against a partially-seeded database,
creating duplicate stops for the same route/order. Duplicate (route_id,
stop_order) rows break scalar-subquery lookups of stop names (e.g. the
driver manifest and user booking history).

This migration removes duplicates and adds a unique constraint so the
condition cannot recur.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Keep the lowest id per (route_id, stop_order), delete the rest.
    op.execute("""
        DELETE FROM route_stops a
        USING route_stops b
        WHERE a.id > b.id
          AND a.route_id = b.route_id
          AND a.stop_order = b.stop_order;
    """)
    op.create_unique_constraint(
        'uq_route_stops_route_order', 'route_stops', ['route_id', 'stop_order'],
    )


def downgrade() -> None:
    op.drop_constraint('uq_route_stops_route_order', 'route_stops', type_='unique')
