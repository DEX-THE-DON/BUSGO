"""reconcile bookings columns and add trips.driver_id

Revision ID: a1b2c3d4e5f6
Revises: None  (new baseline)
Create Date: 2026-08-18 00:00:00.000000

Reconciles the live schema (which was created before Alembic was tracking
migrations, and where the previous initial migration was never actually
applied to the database) with the current ORM models:
  - bookings.status         (missing from live DB, required by the code)
  - bookings.created_at     (missing from live DB)
  - trips.driver_id         (new FK to users, needed for driver manifests)

NOTE: this deliberately REVERSES the alembic chain (down_revision = None)
so it becomes the new baseline. The old `c861d38ec0fb` file is left in the
directory as historical reference but is NOT part of the active chain,
because running its `upgrade()` against this database would fail
(`bookings.status` does not exist yet, so `alter_column` on it errors).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing rows: backfill a sane default for status so the NOT NULL
    # column can be added, then drop the server default to keep future
    # inserts explicit (code always supplies status).
    op.add_column('bookings', sa.Column('status', sa.String(), nullable=True))
    op.execute("UPDATE bookings SET status = 'confirmed' WHERE status IS NULL;")
    op.alter_column('bookings', 'status', existing_type=sa.String(), nullable=False)

    op.add_column('bookings', sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=True))
    op.execute('UPDATE bookings SET created_at = NOW() WHERE created_at IS NULL;')

    op.add_column('trips', sa.Column('driver_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_trips_driver_id_users', 'trips', 'users', ['driver_id'], ['id'],
    )


def downgrade() -> None:
    op.drop_constraint('fk_trips_driver_id_users', 'trips', type_='foreignkey')
    op.drop_column('trips', 'driver_id')
    op.drop_column('bookings', 'created_at')
    op.drop_column('bookings', 'status')
