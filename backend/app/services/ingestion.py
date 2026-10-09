import os
import io
import re
import urllib.request
import zipfile
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.models.knowledge import Transcript, TranscriptChunk
from backend.app.services.transcript_parser import (
    parse_transcript_markdown,
    compute_content_hash,
)
from backend.app.services.chunker import (
    create_chunks_from_transcript,
    generate_deterministic_transcript_id,
)

logger = logging.getLogger(__name__)

REPO_ZIP_URL = "https://github.com/ChatPRD/lennys-podcast-transcripts/archive/refs/heads/main.zip"
SOURCE_REPO_NAME = "ChatPRD/lennys-podcast-transcripts"


@dataclass
class IngestionOptions:
    source_dir: Path
    chunk_size: int = 1200
    chunk_overlap: int = 200
    force: bool = False
    limit: Optional[int] = None
    episode_slugs: Optional[List[str]] = None


@dataclass
class IngestionReport:
    total_discovered: int = 0
    episodes_processed: int = 0
    episodes_skipped: int = 0
    episodes_failed: int = 0
    chunks_created: int = 0
    errors: List[Dict[str, str]] = field(default_factory=list)


def download_and_extract_transcripts(
    dest_dir: Path,
    target_slugs: Optional[List[str]] = None,
    max_episodes: Optional[int] = None,
) -> List[Tuple[str, Path]]:
    """Download the authoritative archive from ChatPRD/lennys-podcast-transcripts

    and extract transcript markdown files to dest_dir.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    logger.info(f"Downloading transcript archive from {REPO_ZIP_URL}...")

    try:
        req = urllib.request.Request(REPO_ZIP_URL, headers={"User-Agent": "LennyGrowthAssistant/1.0"})
        with urllib.request.urlopen(req) as resp:
            zip_bytes = resp.read()
    except Exception as e:
        logger.error(f"Network error downloading transcript archive: {e}")
        raise RuntimeError(
            f"Failed to download transcript archive from {REPO_ZIP_URL} ({e}). "
            "Verify your internet connection or use pre-downloaded files with --source."
        ) from e

    resolved_dest = dest_dir.resolve()
    extracted_files: List[Tuple[str, Path]] = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        namelist = zf.namelist()
        # Pattern in zip: lennys-podcast-transcripts-main/episodes/<slug>/transcript.md
        pattern = re.compile(r"^lennys-podcast-transcripts-main/episodes/([^/]+)/transcript\.md$")

        candidates = []
        for name in namelist:
            m = pattern.match(name)
            if m:
                slug = m.group(1)
                candidates.append((slug, name))

        candidates.sort(key=lambda x: x[0])

        if target_slugs:
            targets_set = set(target_slugs)
            candidates = [c for c in candidates if c[0] in targets_set]

        if max_episodes is not None and max_episodes > 0:
            candidates = candidates[:max_episodes]

        for slug, zip_path in candidates:
            episode_dir = dest_dir / slug
            target_path = (episode_dir / "transcript.md").resolve()

            # Security: Prevent Zip-Slip / path traversal
            if not target_path.is_relative_to(resolved_dest):
                logger.warning(f"Skipping suspicious zip member outside destination root: {zip_path}")
                continue

            episode_dir.mkdir(parents=True, exist_ok=True)
            content = zf.read(zip_path)
            target_path.write_bytes(content)
            extracted_files.append((slug, target_path))

    logger.info(f"Successfully extracted {len(extracted_files)} transcripts to {dest_dir}.")
    return extracted_files


def discover_local_transcripts(source_dir: Path) -> List[Tuple[str, Path]]:
    """Discover transcript.md files in a local directory tree.

    Expects either episodes/<slug>/transcript.md or <slug>/transcript.md or <slug>.md.
    """
    discovered: List[Tuple[str, Path]] = []
    if not source_dir.exists():
        return discovered

    # 1. Search for episodes/*/transcript.md or */transcript.md
    for transcript_file in source_dir.glob("**/transcript.md"):
        slug = transcript_file.parent.name
        if slug and slug != "episodes":
            discovered.append((slug, transcript_file))

    # 2. Search for direct markdown files in source_dir
    for md_file in source_dir.glob("*.md"):
        if md_file.name.lower() not in ("readme.md", "claude.md", "license.md", "transcript.md"):
            slug = md_file.stem
            discovered.append((slug, md_file))

    # Deduplicate and sort by slug
    seen = set()
    unique: List[Tuple[str, Path]] = []
    for slug, path in sorted(discovered, key=lambda x: x[0]):
        if slug not in seen:
            seen.add(slug)
            unique.append((slug, path))

    return unique


def ingest_single_transcript(
    db: Session,
    file_path: Path,
    episode_slug: str,
    options: IngestionOptions,
) -> Tuple[bool, int, Optional[str]]:
    """Ingest or incrementally update a single transcript file into PostgreSQL.

    Returns (was_processed, chunks_count, error_message).
    """
    try:
        content = file_path.read_text(encoding="utf-8")
    except Exception as e:
        return False, 0, f"Failed to read file: {e}"

    content_hash = compute_content_hash(content)
    is_postgresql = db.bind.dialect.name == "postgresql" if db.bind else True

    existing = db.query(Transcript).filter_by(episode_slug=episode_slug).first()

    # Incremental re-ingestion check: skip if hash unchanged and not force
    if existing and existing.content_hash == content_hash and not options.force:
        return False, 0, None

    # Parse markdown and frontmatter
    relative_path = f"episodes/{episode_slug}/transcript.md"
    parsed = parse_transcript_markdown(content, episode_slug, source_file_path=relative_path)

    # Determine transcript ID
    transcript_id = existing.id if existing else generate_deterministic_transcript_id(episode_slug)

    # Generate chunks
    chunk_dtos = create_chunks_from_transcript(
        parsed,
        transcript_id=transcript_id,
        chunk_size=options.chunk_size,
        chunk_overlap=options.chunk_overlap,
    )

    try:
        if existing:
            # Update existing transcript
            existing.title = parsed.metadata.get("title") or episode_slug
            existing.guest = parsed.metadata.get("guest")
            existing.youtube_url = parsed.metadata.get("youtube_url")
            existing.video_id = parsed.metadata.get("video_id")
            existing.publish_date = parsed.metadata.get("publish_date")
            existing.description = parsed.metadata.get("description")
            existing.duration_seconds = parsed.metadata.get("duration_seconds")
            existing.duration = parsed.metadata.get("duration")
            existing.view_count = parsed.metadata.get("view_count")
            existing.channel = parsed.metadata.get("channel")
            existing.keywords = parsed.metadata.get("keywords")
            existing.source_repo = SOURCE_REPO_NAME
            existing.source_file_path = relative_path
            existing.content_hash = content_hash
            existing.raw_content = content
            existing.chunk_count = len(chunk_dtos)

            # Delete old chunks
            db.query(TranscriptChunk).filter_by(transcript_id=existing.id).delete()
            transcript_record = existing
        else:
            # Create new transcript record
            transcript_record = Transcript(
                id=transcript_id,
                episode_slug=episode_slug,
                title=parsed.metadata.get("title") or episode_slug,
                guest=parsed.metadata.get("guest"),
                youtube_url=parsed.metadata.get("youtube_url"),
                video_id=parsed.metadata.get("video_id"),
                publish_date=parsed.metadata.get("publish_date"),
                description=parsed.metadata.get("description"),
                duration_seconds=parsed.metadata.get("duration_seconds"),
                duration=parsed.metadata.get("duration"),
                view_count=parsed.metadata.get("view_count"),
                channel=parsed.metadata.get("channel"),
                keywords=parsed.metadata.get("keywords"),
                source_repo=SOURCE_REPO_NAME,
                source_file_path=relative_path,
                content_hash=content_hash,
                raw_content=content,
                chunk_count=len(chunk_dtos),
            )
            db.add(transcript_record)

        db.flush()

        # Insert chunks
        title_str = parsed.metadata.get("title") or episode_slug
        guest_str = parsed.metadata.get("guest") or ""

        for dto in chunk_dtos:
            speaker_str = dto.speaker or ""
            if is_postgresql:
                # PostgreSQL weighted tsvector:
                # A: Title, Guest (strongest metadata relevance)
                # B: Speaker
                # C: Chunk passage content
                tsv_a1 = func.setweight(func.to_tsvector("english", title_str), "A")
                tsv_a2 = func.setweight(func.to_tsvector("english", guest_str), "A")
                tsv_b = func.setweight(func.to_tsvector("english", speaker_str), "B")
                tsv_c = func.setweight(func.to_tsvector("english", dto.content), "C")
                tsv_expr = tsv_a1.op("||")(tsv_a2).op("||")(tsv_b).op("||")(tsv_c)
            else:
                tsv_expr = None

            chunk = TranscriptChunk(
                id=dto.id,
                transcript_id=transcript_id,
                chunk_index=dto.chunk_index,
                speaker=dto.speaker,
                start_timestamp=dto.start_timestamp,
                end_timestamp=dto.end_timestamp,
                content=dto.content,
                content_hash=dto.content_hash,
                char_count=dto.char_count,
                word_count=dto.word_count,
                tsv=tsv_expr,
            )
            db.add(chunk)

        db.commit()
        return True, len(chunk_dtos), None

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to persist transcript {episode_slug}: {e}")
        return False, 0, str(e)


def run_ingestion_pipeline(db: Session, options: IngestionOptions) -> IngestionReport:
    """Run transcript discovery, parsing, chunking, and database persistence."""
    report = IngestionReport()

    discovered = discover_local_transcripts(options.source_dir)
    report.total_discovered = len(discovered)

    if options.episode_slugs:
        slugs_set = set(options.episode_slugs)
        discovered = [item for item in discovered if item[0] in slugs_set]

    if options.limit is not None and options.limit > 0:
        discovered = discovered[:options.limit]

    logger.info(f"Discovered {len(discovered)} transcripts to process from {options.source_dir}.")

    for slug, path in discovered:
        processed, chunk_count, err = ingest_single_transcript(db, path, slug, options)
        if err:
            report.episodes_failed += 1
            report.errors.append({"slug": slug, "path": str(path), "error": err})
            logger.error(f"Error ingesting {slug}: {err}")
        elif processed:
            report.episodes_processed += 1
            report.chunks_created += chunk_count
            logger.info(f"Ingested {slug}: {chunk_count} chunks created.")
        else:
            report.episodes_skipped += 1
            logger.debug(f"Skipped {slug} (up to date).")

    return report
