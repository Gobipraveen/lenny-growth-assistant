"""Regression test for backend ORM model registration.
Verifies that canonical importing from backend.app.models does not raise
SQLAlchemy mapper InvalidRequestError and that relationship mappings resolve.
"""
import pytest
from sqlalchemy.orm import configure_mappers


def test_canonical_models_import():
    """Verify that all application models are cleanly importable from backend.app.models."""
    from backend.app.models import (
        ChatSession,
        ChatMessage,
        Essay,
        Artifact,
        Transcript,
        TranscriptChunk,
        TSVectorType,
    )

    assert ChatSession is not None
    assert ChatMessage is not None
    assert Essay is not None
    assert Artifact is not None
    assert Transcript is not None
    assert TranscriptChunk is not None
    assert TSVectorType is not None


def test_sqlalchemy_mappers_configure_cleanly():
    """Verify that configure_mappers() resolves all inter-model relationships without error.
    Previously failed with: 'expression Artifact.created_at failed to locate a name'.
    """
    from backend.app.models import (
        ChatSession,
        ChatMessage,
        Essay,
        Artifact,
        Transcript,
        TranscriptChunk,
    )

    # Force SQLAlchemy to configure all mappers and resolve all relationship string names
    configure_mappers()

    # Verify relationship attributes exist
    assert hasattr(ChatSession, "artifacts")
    assert hasattr(ChatSession, "messages")
    assert hasattr(ChatSession, "essays")
    assert hasattr(Artifact, "session")
    assert hasattr(ChatMessage, "session")
    assert hasattr(Essay, "session")
