from pydantic import BaseModel, Field
from typing import Optional


class HealthResponse(BaseModel):
    """Schema for health check endpoint."""
    status: str = Field("healthy", description="Current operational status of service")
    service: str = Field(..., description="Service identifier")
    version: str = Field(..., description="Application version")
    environment: str = Field(..., description="Deployment environment")
