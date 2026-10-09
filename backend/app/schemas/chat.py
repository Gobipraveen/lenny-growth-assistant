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
