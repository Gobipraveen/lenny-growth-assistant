import uuid
import hashlib
from typing import List, Optional, Tuple
from dataclasses import dataclass
from backend.app.services.transcript_parser import ParsedTranscript, SpeakerTurn, compute_content_hash


@dataclass
class TranscriptChunkDTO:
    id: uuid.UUID
    transcript_id: uuid.UUID
    chunk_index: int
    speaker: Optional[str]
    start_timestamp: Optional[str]
    end_timestamp: Optional[str]
    content: str
    content_hash: str
    char_count: int
    word_count: int


def generate_deterministic_chunk_id(transcript_id: uuid.UUID, chunk_index: int) -> uuid.UUID:
    """Generate a stable, deterministic UUID for a chunk based on the transcript UUID and index."""
    return uuid.uuid5(transcript_id, f"chunk:{chunk_index}")


def generate_deterministic_transcript_id(episode_slug: str) -> uuid.UUID:
    """Generate a stable, deterministic UUID for a transcript based on its episode slug."""
    return uuid.uuid5(uuid.NAMESPACE_URL, f"lenny-podcast:{episode_slug}")


def split_long_turn(
    turn: SpeakerTurn,
    max_size: int,
    overlap: int
) -> List[Tuple[Optional[str], Optional[str], str]]:
    """Split a single speaker turn that exceeds max_size into smaller passages

    along paragraph or sentence boundaries.
    """
    paragraphs = [p.strip() for p in turn.text.split("\n\n") if p.strip()]
    sub_turns: List[Tuple[Optional[str], Optional[str], str]] = []

    current_text = ""
    for para in paragraphs:
        if len(para) > max_size:
            # Split long paragraph by sentences
            sentences = [s.strip() for s in para.replace(".\n", ". ").split(". ") if s.strip()]
            for s in sentences:
                s_with_dot = s if s.endswith(".") else s + "."
                if len(current_text) + len(s_with_dot) + 1 > max_size and current_text:
                    sub_turns.append((turn.speaker, turn.timestamp, current_text.strip()))
                    # Overlap from current text
                    tail = current_text[-overlap:] if overlap < len(current_text) else current_text
                    current_text = tail + " " + s_with_dot
                else:
                    current_text = (current_text + " " + s_with_dot).strip()
        else:
            if len(current_text) + len(para) + 2 > max_size and current_text:
                sub_turns.append((turn.speaker, turn.timestamp, current_text.strip()))
                tail = current_text[-overlap:] if overlap < len(current_text) else current_text
                current_text = tail + "\n\n" + para
            else:
                current_text = (current_text + "\n\n" + para).strip() if current_text else para

    if current_text.strip():
        sub_turns.append((turn.speaker, turn.timestamp, current_text.strip()))

    return sub_turns


def create_chunks_from_transcript(
    parsed: ParsedTranscript,
    transcript_id: Optional[uuid.UUID] = None,
    chunk_size: int = 1200,
    chunk_overlap: int = 200,
) -> List[TranscriptChunkDTO]:
    """Chunk a parsed transcript in a speaker-aware and paragraph-aware manner

    with configurable chunk size and overlap.
    """
    if transcript_id is None:
        transcript_id = generate_deterministic_transcript_id(parsed.episode_slug)

    # 1. Flatten/normalize turns, splitting oversized turns
    flattened_turns: List[Tuple[Optional[str], Optional[str], str]] = []
    for turn in parsed.turns:
        if len(turn.text) > chunk_size:
            splits = split_long_turn(turn, chunk_size, chunk_overlap)
            flattened_turns.extend(splits)
        else:
            flattened_turns.append((turn.speaker, turn.timestamp, turn.text))

    chunks: List[TranscriptChunkDTO] = []
    chunk_index = 0

    current_parts: List[Tuple[Optional[str], Optional[str], str]] = []
    current_length = 0

    def format_part(spk: Optional[str], ts: Optional[str], txt: str) -> str:
        if spk and ts:
            return f"{spk} ({ts}): {txt}"
        elif spk:
            return f"{spk}: {txt}"
        elif ts:
            return f"({ts}): {txt}"
        return txt

    i = 0
    total_turns = len(flattened_turns)

    while i < total_turns:
        spk, ts, txt = flattened_turns[i]
        formatted = format_part(spk, ts, txt)
        part_len = len(formatted)

        if current_parts and (current_length + part_len + 2 > chunk_size):
            # Assemble current chunk
            chunk_content = "\n\n".join(
                format_part(s, t, x) for s, t, x in current_parts
            ).strip()

            # Identify primary speaker
            speaker_chars: dict = {}
            for s, t, x in current_parts:
                if s:
                    speaker_chars[s] = speaker_chars.get(s, 0) + len(x)
            primary_speaker = (
                max(speaker_chars, key=speaker_chars.get) if speaker_chars else parsed.metadata.get("guest")
            )

            start_ts = next((t for s, t, x in current_parts if t), None)
            end_ts = next((t for s, t, x in reversed(current_parts) if t), None)

            chunk_dto = TranscriptChunkDTO(
                id=generate_deterministic_chunk_id(transcript_id, chunk_index),
                transcript_id=transcript_id,
                chunk_index=chunk_index,
                speaker=primary_speaker,
                start_timestamp=start_ts,
                end_timestamp=end_ts,
                content=chunk_content,
                content_hash=compute_content_hash(chunk_content),
                char_count=len(chunk_content),
                word_count=len(chunk_content.split()),
            )
            chunks.append(chunk_dto)
            chunk_index += 1

            # Setup overlap: keep trailing turn if overlap is enabled and current_parts has > 1 item
            if chunk_overlap > 0 and len(current_parts) > 1:
                # Keep last turn for overlap
                last_turn = current_parts[-1]
                current_parts = [last_turn]
                current_length = len(format_part(*last_turn))
            else:
                current_parts = []
                current_length = 0

        current_parts.append((spk, ts, txt))
        current_length += part_len + 2
        i += 1

    # Flush final chunk if any content remains
    if current_parts:
        chunk_content = "\n\n".join(
            format_part(s, t, x) for s, t, x in current_parts
        ).strip()
        speaker_chars = {}
        for s, t, x in current_parts:
            if s:
                speaker_chars[s] = speaker_chars.get(s, 0) + len(x)
        primary_speaker = (
            max(speaker_chars, key=speaker_chars.get) if speaker_chars else parsed.metadata.get("guest")
        )

        start_ts = next((t for s, t, x in current_parts if t), None)
        end_ts = next((t for s, t, x in reversed(current_parts) if t), None)

        chunk_dto = TranscriptChunkDTO(
            id=generate_deterministic_chunk_id(transcript_id, chunk_index),
            transcript_id=transcript_id,
            chunk_index=chunk_index,
            speaker=primary_speaker,
            start_timestamp=start_ts,
            end_timestamp=end_ts,
            content=chunk_content,
            content_hash=compute_content_hash(chunk_content),
            char_count=len(chunk_content),
            word_count=len(chunk_content.split()),
        )
        chunks.append(chunk_dto)

    return chunks
