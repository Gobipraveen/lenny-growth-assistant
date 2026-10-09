from abc import ABC, abstractmethod
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import text
import logging
import re

from backend.app.schemas.knowledge import KnowledgeSearchResult
from backend.app.models.knowledge import Transcript, TranscriptChunk

logger = logging.getLogger(__name__)


class BaseRetriever(ABC):
    """Abstract base class for transcript retrieval systems,

    allowing pluggable retrieval strategies (PostgreSQL FTS, pgvector, hybrid).
    """

    @abstractmethod
    def search(
        self,
        query: str,
        limit: int = 5,
        offset: int = 0,
        guest: Optional[str] = None,
        episode_slug: Optional[str] = None,
    ) -> List[KnowledgeSearchResult]:
        pass


class PostgresFtsRetriever(BaseRetriever):
    """PostgreSQL Full-Text Search retriever using tsvector, GIN indexing,

    websearch_to_tsquery, and ts_rank_cd ranking.
    Includes a fallback for SQLite in-memory environments (unit tests).
    """

    def __init__(self, db: Session):
        self.db = db
        dialect = db.bind.dialect.name if db.bind else "postgresql"
        self.is_postgresql = dialect == "postgresql"

    def search(
        self,
        query: str,
        limit: int = 5,
        offset: int = 0,
        guest: Optional[str] = None,
        episode_slug: Optional[str] = None,
    ) -> List[KnowledgeSearchResult]:
        cleaned_query = query.strip()
        if not cleaned_query:
            return []

        if self.is_postgresql:
            return self._search_postgresql(
                cleaned_query, limit=limit, offset=offset, guest=guest, episode_slug=episode_slug
            )
        else:
            return self._search_sqlite(
                cleaned_query, limit=limit, offset=offset, guest=guest, episode_slug=episode_slug
            )

    def _search_postgresql(
        self,
        query: str,
        limit: int,
        offset: int,
        guest: Optional[str],
        episode_slug: Optional[str],
    ) -> List[KnowledgeSearchResult]:
        # Filter clauses
        where_conditions = []
        params = {"q": query, "limit": limit, "offset": offset}

        if guest:
            where_conditions.append("LOWER(t.guest) = LOWER(:guest)")
            params["guest"] = guest

        if episode_slug:
            where_conditions.append("t.episode_slug = :episode_slug")
            params["episode_slug"] = episode_slug

        extra_where = (" AND " + " AND ".join(where_conditions)) if where_conditions else ""

        # Tier 1: websearch_to_tsquery (strict phrase & boolean)
        sql_websearch = f"""
            SELECT
                tc.id AS chunk_id,
                t.id AS transcript_id,
                t.episode_slug,
                t.title AS episode_title,
                t.guest,
                t.youtube_url AS source_url,
                t.source_file_path,
                tc.speaker,
                tc.start_timestamp,
                tc.end_timestamp,
                tc.chunk_index,
                tc.content,
                ts_rank_cd(tc.tsv, q) AS score
            FROM transcript_chunks tc
            JOIN transcripts t ON t.id = tc.transcript_id,
            websearch_to_tsquery('english', :q) q
            WHERE tc.tsv @@ q {extra_where}
            ORDER BY score DESC, tc.chunk_index ASC
            LIMIT :limit OFFSET :offset;
        """

        try:
            rows = self.db.execute(text(sql_websearch), params).fetchall()
            if rows:
                return self._rows_to_results(rows)
        except Exception as e:
            logger.debug(f"websearch_to_tsquery produced no results or failed: {e}")

        # Tier 2: plainto_tsquery
        sql_plain = f"""
            SELECT
                tc.id AS chunk_id,
                t.id AS transcript_id,
                t.episode_slug,
                t.title AS episode_title,
                t.guest,
                t.youtube_url AS source_url,
                t.source_file_path,
                tc.speaker,
                tc.start_timestamp,
                tc.end_timestamp,
                tc.chunk_index,
                tc.content,
                ts_rank_cd(tc.tsv, q) AS score
            FROM transcript_chunks tc
            JOIN transcripts t ON t.id = tc.transcript_id,
            plainto_tsquery('english', :q) q
            WHERE tc.tsv @@ q {extra_where}
            ORDER BY score DESC, tc.chunk_index ASC
            LIMIT :limit OFFSET :offset;
        """
        try:
            rows = self.db.execute(text(sql_plain), params).fetchall()
            if rows:
                return self._rows_to_results(rows)
        except Exception as e:
            logger.debug(f"plainto_tsquery produced no results: {e}")

        # Tier 3: Multi-term OR query with ranking for natural language questions
        stop_words = {
            "a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "of", "with",
            "is", "was", "are", "what", "how", "why", "who", "when", "does", "did", "say", "about"
        }
        tokens = [
            re.sub(r"[^\w]", "", word).strip()
            for word in query.replace("-", " ").split()
        ]
        meaningful_tokens = [t for t in tokens if len(t) > 2 and t.lower() not in stop_words]

        if meaningful_tokens:
            or_expr = " | ".join(meaningful_tokens)
            params["or_query"] = or_expr
            min_match = min(2, len(meaningful_tokens))
            sql_or = f"""
                SELECT
                    tc.id AS chunk_id,
                    t.id AS transcript_id,
                    t.episode_slug,
                    t.title AS episode_title,
                    t.guest,
                    t.youtube_url AS source_url,
                    t.source_file_path,
                    tc.speaker,
                    tc.start_timestamp,
                    tc.end_timestamp,
                    tc.chunk_index,
                    tc.content,
                    ts_rank_cd(tc.tsv, q) AS score
                FROM transcript_chunks tc
                JOIN transcripts t ON t.id = tc.transcript_id,
                to_tsquery('english', :or_query) q
                WHERE tc.tsv @@ q {extra_where}
                ORDER BY score DESC, tc.chunk_index ASC
                LIMIT :limit OFFSET :offset;
            """
            try:
                rows = self.db.execute(text(sql_or), params).fetchall()
                if rows:
                    valid_rows = []
                    for row in rows:
                        corpus = (
                            row.content
                            + " "
                            + (row.episode_title or "")
                            + " "
                            + (row.guest or "")
                            + " "
                            + (row.speaker or "")
                        ).lower()
                        match_count = sum(1 for t in meaningful_tokens if t.lower() in corpus)
                        if match_count >= min_match:
                            valid_rows.append(row)
                    if valid_rows:
                        return self._rows_to_results(valid_rows)
            except Exception as e:
                logger.debug(f"to_tsquery OR search failed: {e}")

        return []

    def _rows_to_results(self, rows) -> List[KnowledgeSearchResult]:
        return [
            KnowledgeSearchResult(
                chunk_id=row.chunk_id,
                transcript_id=row.transcript_id,
                episode_slug=row.episode_slug,
                episode_title=row.episode_title,
                guest=row.guest,
                source_url=row.source_url,
                source_file_path=row.source_file_path,
                speaker=row.speaker,
                start_timestamp=row.start_timestamp,
                end_timestamp=row.end_timestamp,
                chunk_index=row.chunk_index,
                content=row.content,
                score=round(float(row.score), 4) if row.score is not None else None,
            )
            for row in rows
        ]

    def _search_sqlite(
        self,
        query: str,
        limit: int,
        offset: int,
        guest: Optional[str],
        episode_slug: Optional[str],
    ) -> List[KnowledgeSearchResult]:
        """Fallback search implementation for SQLite test fixtures."""
        terms = [t.lower() for t in query.split() if len(t) > 2]
        if not terms:
            terms = [query.lower()]

        q = (
            self.db.query(TranscriptChunk, Transcript)
            .join(Transcript, Transcript.id == TranscriptChunk.transcript_id)
        )
        if guest:
            q = q.filter(Transcript.guest.ilike(f"%{guest}%"))
        if episode_slug:
            q = q.filter(Transcript.episode_slug == episode_slug)

        candidates = q.all()
        scored_results = []

        for chunk, transcript in candidates:
            content_lower = chunk.content.lower()
            title_lower = transcript.title.lower()
            guest_lower = (transcript.guest or "").lower()
            speaker_lower = (chunk.speaker or "").lower()

            matches = sum(
                1 for term in terms
                if term in content_lower or term in title_lower or term in guest_lower or term in speaker_lower
            )
            if matches > 0:
                score = matches / len(terms)
                scored_results.append((score, chunk, transcript))

        scored_results.sort(key=lambda x: (x[0], -x[1].chunk_index), reverse=True)
        paginated = scored_results[offset : offset + limit]

        return [
            KnowledgeSearchResult(
                chunk_id=chunk.id,
                transcript_id=transcript.id,
                episode_slug=transcript.episode_slug,
                episode_title=transcript.title,
                guest=transcript.guest,
                source_url=transcript.youtube_url,
                source_file_path=transcript.source_file_path,
                speaker=chunk.speaker,
                start_timestamp=chunk.start_timestamp,
                end_timestamp=chunk.end_timestamp,
                chunk_index=chunk.chunk_index,
                content=chunk.content,
                score=round(float(score), 4),
            )
            for score, chunk, transcript in paginated
        ]


def get_retriever(db: Session) -> BaseRetriever:
    """Factory function to provide the active retriever instance."""
    return PostgresFtsRetriever(db)
