from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime
from uuid import UUID

from backend.app.schemas.chat import VerifiedCitation

ArtifactType = Literal["html", "markdown"]


class ArtifactCreateRequest(BaseModel):
    title: str = Field(
        ...,
        min_length=2,
        max_length=500,
        description="Artifact title or headline",
    )
    artifact_type: ArtifactType = Field(
        ...,
        description="Type of artifact: 'html' or 'markdown'",
    )
    instructions: str = Field(
        ...,
        min_length=3,
        max_length=5000,
        description="User instructions defining what the artifact should present",
    )
    topic: Optional[str] = Field(
        None,
        max_length=500,
        description="Optional thematic topic for transcript evidence retrieval",
    )
    provider: Optional[str] = Field(
        None,
        description="Optional provider override ('ollama' or 'anthropic')",
    )
    model: Optional[str] = Field(
        None,
        description="Optional model override",
    )


class ArtifactResponse(BaseModel):
    artifact_id: UUID = Field(..., description="Unique artifact UUID")
    session_id: UUID = Field(..., description="Associated chat session UUID")
    title: str = Field(..., description="Artifact title")
    artifact_type: str = Field(..., description="'html' or 'markdown'")
    source_content: Optional[str] = Field(None, description="HTML document or Markdown content")
    generation_status: str = Field(
        ...,
        description="Status: 'pending', 'generating', 'completed', 'failed', 'insufficient_evidence', 'validation_failed'",
    )
    validation_results: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Sanitization and security validation details",
    )
    citations: List[VerifiedCitation] = Field(
        default_factory=list,
        description="Verified transcript citations associated with the artifact",
    )
    provider: str = Field(..., description="LLM provider used")
    model: Optional[str] = Field(None, description="LLM model used")
    error: Optional[str] = Field(None, description="Actionable error description if generation failed")
    meta_info: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Metadata, instructions, or generation metrics",
    )
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    model_config = ConfigDict(from_attributes=True)


class ArtifactSummaryResponse(BaseModel):
    artifact_id: UUID = Field(..., description="Unique artifact UUID")
    session_id: UUID = Field(..., description="Associated chat session UUID")
    title: str = Field(..., description="Artifact title")
    artifact_type: str = Field(..., description="'html' or 'markdown'")
    generation_status: str = Field(..., description="Generation status")
    provider: str = Field(..., description="LLM provider")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    model_config = ConfigDict(from_attributes=True)
