"""add route types, seat chains, waitlist, notifications, payment refs

Revision ID: c3d4e5f6a7b8
Revises: b7c8d9e0f1a2
Create Date: 2026-08-19 00:00:00.000000

Implements the relay/chain seating model:
  - routes.route_type ('direct' | 'stopwise')
  - vehicle_types.seat_layout (JSON grid descriptor for the UI)
  - payments: provider_reference / callback_payload / callback_verified / phone_number
  - seat_chains + seat_chain_links (per trip+seat, ordered booking segments)
  - seat_interests (waitlist: "notify me when this segment frees up")
  - notifications (per-user in-app + WS push)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import json


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _build_layout(capacity: int, columns: int = 4) -> dict:
    """Build a simple N-column seat grid descriptor for a capacity."""
    rows: list[list[int]] = []
    seat = 1
    while seat <= capacity:
        take = min(columns, capacity - seat + 1)
        rows.append(list(range(seat, seat + take)))
        seat += take
    return {"columns": columns, "rows": rows}


def upgrade() -> None:
    bind = op.get_bind()

    # --- routes.route_type ---------------------------------------------------
    op.add_column('routes', sa.Column('route_type', sa.String(20), nullable=True))
    bind.execute(sa.text("UPDATE routes SET route_type = 'stopwise' WHERE route_type IS NULL;"))
    op.alter_column('routes', 'route_type', existing_type=sa.String(20), nullable=False)

    # --- vehicle_types.seat_layout -------------------------------------------
    op.add_column('vehicle_types', sa.Column('seat_layout', sa.JSON(), nullable=True))
    vt_rows = bind.execute(sa.text("SELECT id, seat_capacity FROM vehicle_types;")).mappings().all()
    for r in vt_rows:
        bind.execute(
            sa.text("UPDATE vehicle_types SET seat_layout = CAST(:layout AS jsonb) WHERE id = :id;"),
            {"layout": json.dumps(_build_layout(int(r["seat_capacity"]))), "id": r["id"]},
        )

    # --- payments: real-provider tracking --------------------------------------
    op.add_column('payments', sa.Column('provider_reference', sa.String(200), nullable=True))
    op.add_column('payments', sa.Column('callback_payload', sa.JSON(), nullable=True))
    op.add_column('payments', sa.Column('callback_verified', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('payments', sa.Column('phone_number', sa.String(30), nullable=True))
    op.create_index('idx_payments_booking', 'payments', ['booking_id'])

    # --- seat_chains -----------------------------------------------------------
    op.create_table(
        'seat_chains',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('trip_id', sa.Integer(), sa.ForeignKey('trips.id'), nullable=False),
        sa.Column('seat_number', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()')),
        sa.UniqueConstraint('trip_id', 'seat_number', name='uq_seat_chains_trip_seat'),
    )

    op.create_table(
        'seat_chain_links',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('chain_id', sa.Integer(), sa.ForeignKey('seat_chains.id'), nullable=False),
        sa.Column('booking_id', sa.Integer(), sa.ForeignKey('bookings.id'), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('board_stop_order', sa.Integer(), nullable=False),
        sa.Column('alight_stop_order', sa.Integer(), nullable=False),
        sa.UniqueConstraint('chain_id', 'position', name='uq_seat_chain_links_chain_position'),
    )
    op.create_index('idx_seat_chain_links_booking', 'seat_chain_links', ['booking_id'])
    op.create_index('idx_seat_chain_links_chain', 'seat_chain_links', ['chain_id'])

    # --- seat_interests (waitlist) ----------------------------------------------
    op.create_table(
        'seat_interests',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('trip_id', sa.Integer(), sa.ForeignKey('trips.id'), nullable=False),
        sa.Column('board_stop_order', sa.Integer(), nullable=False),
        sa.Column('alight_stop_order', sa.Integer(), nullable=False),
        sa.Column('seat_number', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()')),
    )
    op.create_index('idx_seat_interests_lookup', 'seat_interests', ['trip_id', 'board_stop_order', 'alight_stop_order'])
    op.create_index('idx_seat_interests_user', 'seat_interests', ['user_id'])

    # --- notifications ------------------------------------------------------------
    op.create_table(
        'notifications',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('kind', sa.String(50), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('read', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()')),
    )
    op.create_index('idx_notifications_user', 'notifications', ['user_id', sa.text('created_at DESC')])


def downgrade() -> None:
    op.drop_index('idx_notifications_user', table_name='notifications')
    op.drop_table('notifications')
    op.drop_index('idx_seat_interests_user', table_name='seat_interests')
    op.drop_index('idx_seat_interests_lookup', table_name='seat_interests')
    op.drop_table('seat_interests')
    op.drop_index('idx_seat_chain_links_chain', table_name='seat_chain_links')
    op.drop_index('idx_seat_chain_links_booking', table_name='seat_chain_links')
    op.drop_table('seat_chain_links')
    op.drop_table('seat_chains')
    op.drop_index('idx_payments_booking', table_name='payments')
    op.drop_column('payments', 'phone_number')
    op.drop_column('payments', 'callback_verified')
    op.drop_column('payments', 'callback_payload')
    op.drop_column('payments', 'provider_reference')
    op.drop_column('vehicle_types', 'seat_layout')
    op.drop_column('routes', 'route_type')

