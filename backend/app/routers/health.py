from fastapi import APIRouter, status
from backend.app.schemas.health import HealthResponse
from backend.app.config import settings

router = APIRouter(tags=["Health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="Health check endpoint",
    description="Returns service health status, service name, version, and environment."
)
async def get_health() -> HealthResponse:
    """Return explicit healthy status for service health inspection."""
    return HealthResponse(
        status="healthy",
        service=settings.APP_NAME,
        version=settings.APP_VERSION,
        environment=settings.ENVIRONMENT,
    )
