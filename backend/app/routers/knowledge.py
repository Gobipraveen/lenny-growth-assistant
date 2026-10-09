from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.database import get_db
from backend.app.schemas.common import APIResponse, ErrorResponse
from backend.app.schemas.knowledge import (
    KnowledgeSearchResponse,
    KnowledgeSearchResult,
    KnowledgeStatusResponse,
    EpisodeSummary,
)
from backend.app.services.retrieval import get_retriever
from backend.app.models.knowledge import Transcript, TranscriptChunk

router = APIRouter(prefix="/api/knowledge", tags=["Knowledge"])


@router.get(
    "/search",
    response_model=APIResponse[KnowledgeSearchResponse],
    responses={
        400: {"model": ErrorResponse, "description": "Empty or invalid query"},
        500: {"model": ErrorResponse, "description": "Database or retrieval error"},
    },
)
def search_knowledge(
    q: str = Query(..., description="Search query string"),
    limit: int = Query(5, ge=1, le=50, description="Maximum number of results to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    guest: Optional[str] = Query(None, description="Filter results by guest name"),
    episode: Optional[str] = Query(None, description="Filter results by episode slug"),
    db: Session = Depends(get_db),
):
    """Search ingested Lenny's Podcast transcripts using PostgreSQL full-text search.

    Returns ranked relevant passages with full provenance and source citation metadata.
    """
    cleaned_query = q.strip()
    if not cleaned_query:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Search query cannot be empty or contain only whitespace.",
        )

    try:
        retriever = get_retriever(db)
        results = retriever.search(
            query=cleaned_query,
            limit=limit,
            offset=offset,
            guest=guest,
            episode_slug=episode,
        )

        return APIResponse(
            success=True,
            message="Search completed successfully",
            data=KnowledgeSearchResponse(
                query=cleaned_query,
                total_results=len(results),
                results=results,
            ),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during retrieval: {str(e)}",
        )


@router.get(
    "/status",
    response_model=APIResponse[KnowledgeStatusResponse],
)
def get_knowledge_status(db: Session = Depends(get_db)):
    """Retrieve indexed transcript and chunk counts, plus search engine status."""
    try:
        total_transcripts = db.query(func.count(Transcript.id)).scalar() or 0
        total_chunks = db.query(func.count(TranscriptChunk.id)).scalar() or 0

        episodes = (
            db.query(Transcript)
            .order_by(Transcript.title.asc())
            .all()
        )

        summaries = [
            EpisodeSummary(
                slug=ep.episode_slug,
                title=ep.title,
                guest=ep.guest,
                chunk_count=ep.chunk_count,
                publish_date=ep.publish_date,
            )
            for ep in episodes
        ]

        return APIResponse(
            success=True,
            message="Knowledge base status retrieved successfully",
            data=KnowledgeStatusResponse(
                total_transcripts=total_transcripts,
                total_chunks=total_chunks,
                search_engine="postgresql_full_text",
                pgvector_available=False,
                episodes=summaries,
            ),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to query knowledge status: {str(e)}",
        )
