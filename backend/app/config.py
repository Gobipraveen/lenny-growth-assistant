from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    """Centralized environment configuration for Lenny Growth Assistant backend."""

    APP_NAME: str = "The Lenny Growth Assistant Backend"
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Server configuration
    HOST: str = "127.0.0.1"
    PORT: int = 8000

    # CORS Origins
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

    # Database (PostgreSQL - provisional placeholder for future milestone)
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/lenny_assistant"

    # LLM Settings
    LLM_PROVIDER: str = "ollama"  # 'ollama' or 'gemini'
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen2.5:1.5b"
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.5-flash-lite"
    OPENAI_API_KEY: str = ""

    # Agent Service Configuration (Node.js Pi Agent Service)
    AGENT_SERVICE_URL: str = "http://127.0.0.1:8001"
    AGENT_INTERNAL_SECRET: str = ""
    AGENT_SERVICE_TIMEOUT: int = 60

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
