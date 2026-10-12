from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID

from backend.app.schemas.chat import VerifiedCitation


class EssayGenerateRequest(BaseModel):
    topic: str = Field(
        ...,
        min_length=3,
        max_length=500,
        description="Product, growth, or strategy topic to write about",
    )
    audience: Optional[str] = Field(
        None,
        max_length=255,
        description="Target audience (e.g. 'Founders', 'Product Managers')",
    )
    intended_outcome: Optional[str] = Field(
        None,
        max_length=500,
        description="Intended reader transformation or actionable outcome",
    )
    proven_approach: Optional[str] = Field(
        "framework",
        description="Structural format ('framework', 'lessons', 'mistakes', 'steps')",
    )
    four_a_path: Optional[str] = Field(
        "actionable",
        description="Editorial lens ('actionable', 'analytical', 'aspirational', 'anthropological')",
    )
    target_word_count: Optional[int] = Field(
        1250,
        ge=500,
        le=3000,
        description="Target word count (~1,250 words)",
    )
    provider: Optional[str] = Field(
        None,
        description="Optional provider override ('ollama' or 'gemini')",
    )
    model: Optional[str] = Field(
        None,
        description="Optional model override",
    )


class EssayResponse(BaseModel):
    essay_id: UUID = Field(..., description="Unique essay UUID")
    session_id: UUID = Field(..., description="Associated chat session UUID")
    topic: str = Field(..., description="Essay topic")
    audience: Optional[str] = Field(None, description="Intended audience")
    intended_outcome: Optional[str] = Field(None, description="Intended outcome")
    proven_approach: Optional[str] = Field(None, description="Organization approach")
    four_a_path: Optional[str] = Field(None, description="Editorial lens")
    target_word_count: int = Field(1250, description="Target word count")
    title: Optional[str] = Field(None, description="H1 headline of the essay")
    markdown: Optional[str] = Field(None, description="Complete Markdown content of the essay")
    word_count: Optional[int] = Field(None, description="Exact word count of generated essay")
    generation_status: str = Field(
        ...,
        description="Status: 'pending', 'generating', 'completed', 'failed', 'insufficient_evidence', 'validation_failed'",
    )
    validation_results: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Deterministic validation results",
    )
    citations: List[VerifiedCitation] = Field(
        default_factory=list,
        description="Verified transcript citations cited in the essay",
    )
    provider: str = Field(..., description="LLM provider used")
    model: Optional[str] = Field(None, description="LLM model used")
    error: Optional[str] = Field(None, description="Actionable error description if generation failed")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    model_config = ConfigDict(from_attributes=True)


class EssaySummaryResponse(BaseModel):
    essay_id: UUID = Field(..., description="Unique essay UUID")
    session_id: UUID = Field(..., description="Associated chat session UUID")
    topic: str = Field(..., description="Essay topic")
    title: Optional[str] = Field(None, description="H1 headline")
    word_count: Optional[int] = Field(None, description="Exact word count")
    generation_status: str = Field(..., description="Generation status")
    provider: str = Field(..., description="LLM provider")
    created_at: datetime = Field(..., description="Creation timestamp")

    model_config = ConfigDict(from_attributes=True)
