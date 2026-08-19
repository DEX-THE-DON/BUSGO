"""add trips.current_stop_order for driver stop-progress reporting

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-08-19 00:00:01.000000

Lets the driver report which stop the bus is currently at; the chain engine
uses it to release seats (and notify the next passengers) as the bus moves.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('trips', sa.Column('current_stop_order', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('trips', 'current_stop_order')
