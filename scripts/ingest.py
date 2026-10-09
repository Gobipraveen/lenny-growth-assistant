import sys
import os
import argparse
import logging
from pathlib import Path
from typing import List, Optional

# Ensure project root is on PYTHONPATH
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.database import SessionLocal, engine
from backend.app.models.knowledge import Transcript, TranscriptChunk
from backend.app.services.ingestion import (
    IngestionOptions,
    run_ingestion_pipeline,
    download_and_extract_transcripts,
    discover_local_transcripts,
    SOURCE_REPO_NAME,
)
from sqlalchemy import func

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("lenny.ingestion")

# Documented deterministic flagship episodes covering core growth & product topics
FLAGSHIP_EPISODES = [
    "brian-chesky",
    "shreyas-doshi",
    "elena-verna",
    "sean-ellis",
    "april-dunford",
    "julie-zhuo",
    "casey-winters",
    "gibson-biddle",
    "marty-cagan",
    "adam-fishman",
]


def display_status(session):
    total_transcripts = session.query(func.count(Transcript.id)).scalar() or 0
    total_chunks = session.query(func.count(TranscriptChunk.id)).scalar() or 0
    episodes = session.query(Transcript.episode_slug, Transcript.title, Transcript.guest, Transcript.chunk_count).order_by(Transcript.episode_slug).all()

    print("\n" + "=" * 60)
    print("LENNY GROWTH ASSISTANT - KNOWLEDGE BASE STATUS")
    print("=" * 60)
    print(f"Total Indexed Transcripts: {total_transcripts}")
    print(f"Total Searchable Chunks:   {total_chunks}")
    print("-" * 60)
    if episodes:
        print(f"{'SLUG':<25} | {'CHUNKS':<6} | {'GUEST':<20} | TITLE")
        print("-" * 60)
        for ep in episodes:
            guest_str = ep.guest or "Lenny Rachitsky"
            print(f"{ep.episode_slug:<25} | {ep.chunk_count:<6} | {guest_str[:20]:<20} | {ep.title[:35]}")
    else:
        print("No transcripts indexed yet.")
    print("=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Ingest Lenny's Podcast transcripts into PostgreSQL with full-text search indexing."
    )
    parser.add_argument(
        "--source",
        type=str,
        default="data/transcripts",
        help="Local directory path containing episode transcripts (default: data/transcripts)",
    )
    parser.add_argument(
        "--download",
        action="store_true",
        help=f"Download transcripts from {SOURCE_REPO_NAME} before ingestion",
    )
    parser.add_argument(
        "--flagship",
        action="store_true",
        help="Ingest only the curated 10-episode flagship growth & product dataset",
    )
    parser.add_argument(
        "--subset",
        type=int,
        default=None,
        help="Limit number of transcripts to ingest (deterministic alphabetical order)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Ingest all available transcripts (all 300+ episodes)",
    )
    parser.add_argument(
        "--episodes",
        nargs="+",
        help="Specific episode slug(s) to ingest (e.g. --episodes brian-chesky shreyas-doshi)",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=1200,
        help="Target chunk size in characters (default: 1200)",
    )
    parser.add_argument(
        "--chunk-overlap",
        type=int,
        default=200,
        help="Target chunk overlap in characters (default: 200)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-chunking and re-ingesting even if content hash matches existing record",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Display current database index counts and exit",
    )

    args = parser.parse_args()

    session = SessionLocal()
    try:
        if args.status:
            display_status(session)
            return

        source_dir = Path(args.source)
        if not source_dir.is_absolute():
            source_dir = PROJECT_ROOT / source_dir

        target_slugs: Optional[List[str]] = None
        if args.flagship:
            target_slugs = FLAGSHIP_EPISODES
        elif args.episodes:
            target_slugs = args.episodes

        if args.download:
            logger.info(f"Downloading from authoritative repository: {SOURCE_REPO_NAME}")
            try:
                download_and_extract_transcripts(
                    dest_dir=source_dir,
                    target_slugs=target_slugs,
                    max_episodes=args.subset if not args.all else None,
                )
            except Exception as e:
                logger.error(f"Download failed: {e}")
                print(f"\n[ERROR] Unable to download transcripts from {SOURCE_REPO_NAME}: {e}")
                print("If you are offline or the remote repository is unreachable, provide pre-downloaded transcript files locally using --source <path>.\n")
                return

        # Check if source directory exists and has files
        discovered = discover_local_transcripts(source_dir)
        if not discovered:
            logger.warning(
                f"No transcript files found in {source_dir}. "
                "Use --download to fetch transcripts from GitHub, or specify a valid --source path."
            )
            return

        options = IngestionOptions(
            source_dir=source_dir,
            chunk_size=args.chunk_size,
            chunk_overlap=args.chunk_overlap,
            force=args.force,
            limit=args.subset if not args.all else None,
            episode_slugs=target_slugs,
        )

        logger.info(f"Starting ingestion with options: chunk_size={options.chunk_size}, overlap={options.chunk_overlap}, force={options.force}")
        report = run_ingestion_pipeline(session, options)

        print("\n" + "=" * 60)
        print("INGESTION PIPELINE COMPLETED")
        print("=" * 60)
        print(f"Total Discovered:   {report.total_discovered}")
        print(f"Episodes Processed: {report.episodes_processed}")
        print(f"Episodes Skipped:   {report.episodes_skipped} (already up to date)")
        print(f"Episodes Failed:    {report.episodes_failed}")
        print(f"New Chunks Created: {report.chunks_created}")
        if report.errors:
            print("\nErrors encountered:")
            for err in report.errors:
                print(f"  - [{err['slug']}]: {err['error']}")
        print("=" * 60)

        display_status(session)

    finally:
        session.close()


if __name__ == "__main__":
    main()
