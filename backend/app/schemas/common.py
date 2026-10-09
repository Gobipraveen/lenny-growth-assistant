from typing import Generic, TypeVar, Optional, Any
from pydantic import BaseModel, Field

DataT = TypeVar("DataT")


class APIResponse(BaseModel, Generic[DataT]):
    """Standardized API response envelope."""
    success: bool = Field(True, description="Indicates whether the request was successful")
    message: Optional[str] = Field(None, description="Human-readable status or message")
    data: Optional[DataT] = Field(None, description="Response payload")


class ErrorResponse(BaseModel):
    """Standardized error response payload."""
    success: bool = Field(False, description="Failure indicator")
    error_code: str = Field(..., description="Machine-readable error identifier")
    detail: str = Field(..., description="Human-readable explanation of error")
    details: Optional[Any] = Field(None, description="Additional context or validation details")
