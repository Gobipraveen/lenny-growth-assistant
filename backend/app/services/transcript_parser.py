import re
import hashlib
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
import yaml
import logging

logger = logging.getLogger(__name__)

# Matches: "Speaker Name (HH:MM:SS): text" or "(HH:MM:SS): text" or with MM:SS
SPEAKER_TURN_PATTERN = re.compile(
    r"^(?:(?P<speaker>[A-Za-z0-9\s\.\'\-–—]+?)\s*)?\((?P<timestamp>\d{1,2}:\d{2}(?::\d{2})?)\):\s*(?P<first_line>.*)$"
)


@dataclass
class SpeakerTurn:
    speaker: Optional[str]
    timestamp: Optional[str]
    text: str


@dataclass
class ParsedTranscript:
    episode_slug: str
    metadata: Dict[str, Any]
    turns: List[SpeakerTurn]
    raw_content: str
    content_hash: str


def compute_content_hash(content: str) -> str:
    """Compute SHA-256 hash of string content."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def parse_transcript_markdown(content: str, episode_slug: str, source_file_path: str = "") -> ParsedTranscript:
    """Parse a Lenny's Podcast transcript Markdown file with YAML frontmatter

    and timestamped speaker turns.
    """
    content_hash = compute_content_hash(content)
    metadata: Dict[str, Any] = {}
    body_text = content

    # 1. Parse YAML Frontmatter
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            raw_frontmatter = parts[1]
            body_text = parts[2]
            try:
                parsed_meta = yaml.safe_load(raw_frontmatter)
                if isinstance(parsed_meta, dict):
                    metadata = parsed_meta
            except Exception as e:
                logger.warning(f"Failed to parse YAML frontmatter for {episode_slug}: {e}")

    # Standardize metadata fields (without inventing data)
    title = metadata.get("title") or episode_slug.replace("-", " ").title()
    guest = metadata.get("guest")
    youtube_url = metadata.get("youtube_url")
    video_id = metadata.get("video_id")
    if video_id is not None:
        video_id = str(video_id)
    publish_date = metadata.get("publish_date")
    if publish_date is not None:
        publish_date = str(publish_date)
    description = metadata.get("description")
    duration_seconds = metadata.get("duration_seconds")
    duration = metadata.get("duration")
    view_count = metadata.get("view_count")
    channel = metadata.get("channel")
    keywords = metadata.get("keywords") or []

    cleaned_metadata = {
        "title": title,
        "guest": guest,
        "youtube_url": youtube_url,
        "video_id": video_id,
        "publish_date": publish_date,
        "description": description,
        "duration_seconds": float(duration_seconds) if duration_seconds is not None else None,
        "duration": str(duration) if duration is not None else None,
        "view_count": int(view_count) if view_count is not None else None,
        "channel": channel,
        "keywords": keywords if isinstance(keywords, list) else [],
    }

    # 2. Parse turns in body text
    turns: List[SpeakerTurn] = []
    current_speaker: Optional[str] = None
    current_timestamp: Optional[str] = None
    current_lines: List[str] = []

    def flush_turn():
        nonlocal current_lines, current_speaker, current_timestamp
        if current_lines:
            text = "\n".join(current_lines).strip()
            if text:
                turns.append(SpeakerTurn(
                    speaker=current_speaker,
                    timestamp=current_timestamp,
                    text=text
                ))
            current_lines = []

    for raw_line in body_text.splitlines():
        line = raw_line.strip()
        if not line:
            if current_lines:
                current_lines.append("")
            continue

        # Skip markdown titles/headers like "# Title" or "## Transcript"
        if line.startswith("#"):
            continue

        match = SPEAKER_TURN_PATTERN.match(line)
        if match:
            flush_turn()
            speaker_name = match.group("speaker")
            timestamp = match.group("timestamp")
            first_line = match.group("first_line")

            if speaker_name and speaker_name.strip():
                current_speaker = speaker_name.strip()
            # If no speaker specified in match (e.g. "(00:01:27):"), keep current_speaker
            current_timestamp = timestamp
            if first_line:
                current_lines.append(first_line)
        else:
            current_lines.append(line)

    flush_turn()

    # Fallback if no speaker turns matched (e.g. plain text or different formatting)
    if not turns and body_text.strip():
        # Split by double newline paragraphs
        paragraphs = [p.strip() for p in body_text.split("\n\n") if p.strip()]
        for p in paragraphs:
            if not p.startswith("#"):
                turns.append(SpeakerTurn(speaker=guest, timestamp=None, text=p))

    return ParsedTranscript(
        episode_slug=episode_slug,
        metadata=cleaned_metadata,
        turns=turns,
        raw_content=content,
        content_hash=content_hash,
    )
