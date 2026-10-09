import pytest
import uuid
from backend.app.services.transcript_parser import ParsedTranscript, SpeakerTurn
from backend.app.services.chunker import (
    create_chunks_from_transcript,
    generate_deterministic_chunk_id,
    generate_deterministic_transcript_id,
)


@pytest.fixture
def sample_parsed_transcript():
    turns = [
        SpeakerTurn(
            speaker="Brian Chesky",
            timestamp="00:00:00",
            text="Way too many founders apologize for how they want to run the company. They need clarity.",
        ),
        SpeakerTurn(
            speaker="Lenny",
            timestamp="00:01:00",
            text="Welcome Brian. What is going on with product management at Airbnb?",
        ),
        SpeakerTurn(
            speaker="Brian Chesky",
            timestamp="00:01:30",
            text="We combined product development with outbound product marketing. Designers cheered at Config.",
        ),
    ]
    return ParsedTranscript(
        episode_slug="brian-chesky-test",
        metadata={"title": "Brian Chesky Test", "guest": "Brian Chesky"},
        turns=turns,
        raw_content="dummy",
        content_hash="dummyhash",
    )


def test_chunker_deterministic_identifiers(sample_parsed_transcript):
    t_id = generate_deterministic_transcript_id("brian-chesky-test")
    chunks1 = create_chunks_from_transcript(sample_parsed_transcript, transcript_id=t_id, chunk_size=500)
    chunks2 = create_chunks_from_transcript(sample_parsed_transcript, transcript_id=t_id, chunk_size=500)

    assert len(chunks1) == len(chunks2)
    for c1, c2 in zip(chunks1, chunks2):
        assert c1.id == c2.id
        assert c1.content_hash == c2.content_hash
        assert c1.chunk_index == c2.chunk_index


def test_chunker_speaker_and_timestamp_preservation(sample_parsed_transcript):
    t_id = uuid.uuid4()
    chunks = create_chunks_from_transcript(sample_parsed_transcript, transcript_id=t_id, chunk_size=1000)

    assert len(chunks) == 1
    chunk = chunks[0]
    assert chunk.start_timestamp == "00:00:00"
    assert chunk.end_timestamp == "00:01:30"
    assert "Brian Chesky (00:00:00)" in chunk.content
    assert "Lenny (00:01:00)" in chunk.content
    assert chunk.chunk_index == 0


def test_chunker_small_chunk_size_creates_multiple_chunks(sample_parsed_transcript):
    t_id = uuid.uuid4()
    # Setting small chunk_size forces splitting into multiple chunks
    chunks = create_chunks_from_transcript(
        sample_parsed_transcript,
        transcript_id=t_id,
        chunk_size=120,
        chunk_overlap=30,
    )

    assert len(chunks) >= 2
    for i, c in enumerate(chunks):
        assert c.chunk_index == i
        assert c.transcript_id == t_id
        assert c.char_count == len(c.content)
        assert c.word_count == len(c.content.split())


def test_long_turn_splitting():
    long_text = "This is a key product management lesson. " * 30  # ~1230 characters
    turns = [
        SpeakerTurn(
            speaker="Shreyas Doshi",
            timestamp="00:10:00",
            text=long_text,
        )
    ]
    parsed = ParsedTranscript(
        episode_slug="shreyas-long",
        metadata={"title": "Shreyas Long", "guest": "Shreyas Doshi"},
        turns=turns,
        raw_content=long_text,
        content_hash="hash",
    )

    chunks = create_chunks_from_transcript(parsed, chunk_size=400, chunk_overlap=50)
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.speaker == "Shreyas Doshi"
        assert chunk.start_timestamp == "00:10:00"
