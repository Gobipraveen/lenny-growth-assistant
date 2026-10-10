from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID

class ChatMessageBase(BaseModel):
    role: str = Field(..., description="Role of the sender (e.g., 'user', 'assistant')")
    content: str = Field(..., description="Content of the message")
    structured_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Optional metadata for the message")

class ChatMessageCreate(ChatMessageBase):
    pass

class ChatMessageResponse(ChatMessageBase):
    id: UUID
    session_id: UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatSessionBase(BaseModel):
    title: Optional[str] = Field(None, description="Optional title for the session")
    user_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Optional user metadata")

class ChatSessionCreate(ChatSessionBase):
    pass

class ChatSessionResponse(ChatSessionBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class ChatSessionWithMessages(ChatSessionResponse):
    messages: List[ChatMessageResponse] = []


class ChatTurnRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000, description="User question or follow-up prompt")
    provider: Optional[str] = Field(None, description="Optional LLM provider override ('ollama' or 'anthropic')")


class VerifiedCitation(BaseModel):
    chunk_id: UUID = Field(..., description="Unique chunk UUID cited")
    transcript_id: Optional[UUID] = Field(None, description="Transcript episode UUID")
    episode_slug: str = Field(..., description="Episode identifier slug")
    episode_title: str = Field(..., description="Title of the episode")
    guest: Optional[str] = Field(None, description="Guest speaker name")
    speaker: Optional[str] = Field(None, description="Primary speaker in the chunk")
    source_url: Optional[str] = Field(None, description="Canonical YouTube link")
    start_timestamp: Optional[str] = Field(None, description="Passage start timestamp")
    end_timestamp: Optional[str] = Field(None, description="Passage end timestamp")
    snippet: Optional[str] = Field(None, description="Supporting passage snippet")

    model_config = ConfigDict(from_attributes=True)


class ChatTurnResponse(BaseModel):
    session_id: UUID = Field(..., description="Session identifier")
    user_message_id: UUID = Field(..., description="Persisted user message ID")
    assistant_message_id: UUID = Field(..., description="Persisted assistant message ID")
    answer: str = Field(..., description="Grounded AI assistant answer")
    citations: List[VerifiedCitation] = Field(default_factory=list, description="Verified source citations")
    provider: str = Field(..., description="LLM provider utilized")
    model: str = Field(..., description="LLM model identifier utilized")
    trace_id: str = Field(..., description="Request correlation trace ID")
    created_at: datetime = Field(..., description="Completion timestamp")

    model_config = ConfigDict(from_attributes=True)


class ProviderStatusInfo(BaseModel):
    provider: str
    available: bool
    model: str
    is_default: bool
    details: Optional[str] = None


class ChatStatusResponse(BaseModel):
    providers: List[ProviderStatusInfo]
    active_provider: str
    active_model: str
    agent_service_online: bool
