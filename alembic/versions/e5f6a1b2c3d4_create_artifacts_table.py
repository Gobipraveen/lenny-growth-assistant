"""create_artifacts_table

Revision ID: e5f6a1b2c3d4
Revises: d4e5f6a1b2c3
Create Date: 2026-10-11 02:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a1b2c3d4'
down_revision: Union[str, None] = 'd4e5f6a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'artifacts',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('session_id', sa.Uuid(), nullable=False),
        sa.Column('title', sa.String(length=500), nullable=False),
        sa.Column('artifact_type', sa.String(length=50), nullable=False),
        sa.Column('source_content', sa.Text(), nullable=True),
        sa.Column('generation_status', sa.String(length=50), nullable=False, server_default='pending'),
        sa.Column('provider', sa.String(length=50), nullable=False, server_default='ollama'),
        sa.Column('model', sa.String(length=100), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('validation_results', sa.JSON(), nullable=True),
        sa.Column('citations', sa.JSON(), nullable=True),
        sa.Column('meta_info', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['chat_sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_artifacts_session_id'), 'artifacts', ['session_id'], unique=False)
    op.create_index(op.f('ix_artifacts_artifact_type'), 'artifacts', ['artifact_type'], unique=False)
    op.create_index(op.f('ix_artifacts_generation_status'), 'artifacts', ['generation_status'], unique=False)
    op.create_index(op.f('ix_artifacts_created_at'), 'artifacts', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_artifacts_created_at'), table_name='artifacts')
    op.drop_index(op.f('ix_artifacts_generation_status'), table_name='artifacts')
    op.drop_index(op.f('ix_artifacts_artifact_type'), table_name='artifacts')
    op.drop_index(op.f('ix_artifacts_session_id'), table_name='artifacts')
    op.drop_table('artifacts')
