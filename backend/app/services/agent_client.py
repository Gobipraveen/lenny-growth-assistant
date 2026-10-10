"""HTTP client for communicating with the Node.js Pi Agent Service."""

import logging
from typing import Any, Dict, List, Optional
from uuid import UUID
import httpx

from backend.app.config import settings

logger = logging.getLogger(__name__)


class AgentClientError(Exception):
    """Base exception for Agent Client communication issues."""

    def __init__(self, message: str, status_code: int = 502, code: str = "AGENT_ERROR"):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


class AgentConnectionError(AgentClientError):
    """Raised when the Agent Service cannot be reached or connection fails."""

    def __init__(self, message: str = "Agent service is unavailable or connection was refused"):
        super().__init__(message=message, status_code=502, code="AGENT_UNAVAILABLE")


class AgentTimeoutError(AgentClientError):
    """Raised when the Agent Service times out while waiting for a response."""

    def __init__(self, message: str = "Agent service request timed out"):
        super().__init__(message=message, status_code=504, code="AGENT_TIMEOUT")


class AgentResponseError(AgentClientError):
    """Raised when the Agent Service returns an error status code or invalid payload."""

    def __init__(self, message: str, status_code: int = 502, code: str = "AGENT_RESPONSE_ERROR"):
        super().__init__(message=message, status_code=status_code, code=code)


class AgentClient:
    """Asynchronous client connecting FastAPI to the Node.js Pi Agent Service."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        internal_secret: Optional[str] = None,
        timeout: Optional[float] = None,
    ):
        self.base_url = (base_url or settings.AGENT_SERVICE_URL).rstrip("/")
        self._internal_secret = internal_secret or settings.AGENT_INTERNAL_SECRET
        self.timeout = timeout if timeout is not None else float(settings.AGENT_SERVICE_TIMEOUT)

    def _get_headers(self) -> Dict[str, str]:
        """Produce request headers without logging or exposing the secret token."""
        return {
            "Content-Type": "application/json",
            "X-Internal-Token": self._internal_secret,
        }

    async def check_health(self) -> Dict[str, Any]:
        """Check health and status of the Node.js Pi Agent Service."""
        url = f"{self.base_url}/health"
        try:
            async with httpx.AsyncClient(timeout=min(self.timeout, 5.0)) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    return response.json()
                return {"status": "unhealthy", "status_code": response.status_code}
        except httpx.TimeoutException:
            logger.warning("Agent service health check timed out")
            return {"status": "timeout"}
        except httpx.RequestError as exc:
            logger.warning(f"Agent service health check failed: {type(exc).__name__}")
            return {"status": "unreachable"}
        except Exception as exc:
            logger.warning(f"Unexpected error in agent health check: {type(exc).__name__}")
            return {"status": "error"}

    async def execute_chat_turn(
        self,
        session_id: UUID,
        message: str,
        history: Optional[List[Dict[str, str]]] = None,
        candidate_passages: Optional[List[Dict[str, Any]]] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        system_instructions: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send chat turn request to Agent Service and return validated response data payload."""
        url = f"{self.base_url}/chat"
        payload: Dict[str, Any] = {
            "session_id": str(session_id),
            "message": message,
            "history": history or [],
            "candidate_passages": candidate_passages or [],
        }
        if provider:
            payload["provider"] = provider
        if model:
            payload["model"] = model
        if system_instructions:
            payload["system_instructions"] = system_instructions

        secret = (self._internal_secret or "").strip()
        if not secret:
            raise AgentResponseError(
                message="Security configuration error: AGENT_INTERNAL_SECRET must be configured and non-empty",
                status_code=500,
                code="SECRET_NOT_CONFIGURED",
            )

        logger.info(
            f"Calling Agent Service at {self.base_url}/chat for session {session_id} "
            f"(history={len(payload['history'])}, candidates={len(payload['candidate_passages'])})"
        )

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers=self._get_headers(),
                )
        except httpx.TimeoutException as exc:
            logger.error(f"Agent service timed out after {self.timeout}s: {type(exc).__name__}")
            raise AgentTimeoutError(f"Agent service timed out after {self.timeout}s") from exc
        except (httpx.ConnectError, httpx.NetworkError) as exc:
            logger.error(f"Agent service connection failed: {type(exc).__name__}")
            raise AgentConnectionError("Agent service is unavailable or connection was refused") from exc
        except httpx.RequestError as exc:
            logger.error(f"Agent service request error: {type(exc).__name__}")
            raise AgentConnectionError(f"Agent service request failed: {type(exc).__name__}") from exc

        # Handle non-200 responses
        if response.status_code == 401:
            logger.error("Agent service rejected internal token")
            raise AgentResponseError("Unauthorized: Agent bridge authentication failed", status_code=502, code="AUTH_FAILED")

        try:
            data = response.json()
        except Exception as exc:
            logger.error(f"Agent service returned non-JSON response (status {response.status_code})")
            raise AgentResponseError(f"Agent service returned invalid non-JSON response: HTTP {response.status_code}") from exc

        if response.status_code != 200:
            err_msg = data.get("error", f"Agent service error with HTTP {response.status_code}")
            err_code = data.get("code", "AGENT_ERROR")
            logger.error(f"Agent service returned error (HTTP {response.status_code}): {err_msg}")
            raise AgentResponseError(
                err_msg,
                status_code=502 if response.status_code >= 500 else response.status_code,
                code=err_code,
            )

        if not isinstance(data, dict) or not data.get("success", False) or "data" not in data:
            raise AgentResponseError("Agent service response missing successful data envelope", status_code=502)

        return data["data"]


def get_agent_client() -> AgentClient:
    """Factory dependency for AgentClient."""
    return AgentClient()
