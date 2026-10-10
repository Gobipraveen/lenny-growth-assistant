"""create_essays_table

Revision ID: d4e5f6a1b2c3
Revises: 37c50a7f838d
Create Date: 2026-10-10 18:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a1b2c3'
down_revision: Union[str, None] = '37c50a7f838d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'essays',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('session_id', sa.Uuid(), nullable=False),
        sa.Column('topic', sa.String(length=500), nullable=False),
        sa.Column('audience', sa.String(length=255), nullable=True),
        sa.Column('intended_outcome', sa.String(length=500), nullable=True),
        sa.Column('proven_approach', sa.String(length=100), nullable=True),
        sa.Column('four_a_path', sa.String(length=100), nullable=True),
        sa.Column('target_word_count', sa.Integer(), nullable=False, server_default='1250'),
        sa.Column('title', sa.String(length=500), nullable=True),
        sa.Column('markdown', sa.Text(), nullable=True),
        sa.Column('word_count', sa.Integer(), nullable=True),
        sa.Column('generation_status', sa.String(length=50), nullable=False, server_default='pending'),
        sa.Column('validation_results', sa.JSON(), nullable=True),
        sa.Column('citations', sa.JSON(), nullable=True),
        sa.Column('provider', sa.String(length=50), nullable=False, server_default='ollama'),
        sa.Column('model', sa.String(length=100), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['chat_sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_essays_session_id'), 'essays', ['session_id'], unique=False)
    op.create_index(op.f('ix_essays_created_at'), 'essays', ['created_at'], unique=False)
    op.create_index(op.f('ix_essays_generation_status'), 'essays', ['generation_status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_essays_generation_status'), table_name='essays')
    op.drop_index(op.f('ix_essays_created_at'), table_name='essays')
    op.drop_index(op.f('ix_essays_session_id'), table_name='essays')
    op.drop_table('essays')
