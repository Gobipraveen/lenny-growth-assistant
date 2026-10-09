from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any
from uuid import UUID


class KnowledgeSearchResult(BaseModel):
    chunk_id: UUID = Field(..., description="Unique chunk identifier")
    transcript_id: UUID = Field(..., description="Unique transcript identifier")
    episode_slug: str = Field(..., description="Episode identifier slug")
    episode_title: str = Field(..., description="Full title of the episode")
    guest: Optional[str] = Field(None, description="Guest speaker name")
    source_url: Optional[str] = Field(None, description="Canonical source URL (YouTube link)")
    source_file_path: Optional[str] = Field(None, description="Relative path in transcript repository")
    speaker: Optional[str] = Field(None, description="Primary speaker in the chunk")
    start_timestamp: Optional[str] = Field(None, description="Passage start timestamp (HH:MM:SS)")
    end_timestamp: Optional[str] = Field(None, description="Passage end timestamp (HH:MM:SS)")
    chunk_index: int = Field(..., description="Zero-indexed sequence number of the chunk")
    content: str = Field(..., description="Passage content text")
    score: Optional[float] = Field(None, description="Relevance score (higher is more relevant)")

    model_config = ConfigDict(from_attributes=True)


class KnowledgeSearchResponse(BaseModel):
    query: str = Field(..., description="Search query submitted")
    total_results: int = Field(..., description="Number of results returned")
    results: List[KnowledgeSearchResult] = Field(default_factory=list, description="Matching passage results")


class EpisodeSummary(BaseModel):
    slug: str
    title: str
    guest: Optional[str] = None
    chunk_count: int
    publish_date: Optional[str] = None


class KnowledgeStatusResponse(BaseModel):
    total_transcripts: int = Field(..., description="Total indexed transcript episodes")
    total_chunks: int = Field(..., description="Total indexed passages / chunks")
    search_engine: str = Field(..., description="Search engine technology (e.g. postgresql_full_text)")
    pgvector_available: bool = Field(False, description="Whether pgvector extension is available in Postgres")
    episodes: List[EpisodeSummary] = Field(default_factory=list, description="Summary of indexed episodes")
