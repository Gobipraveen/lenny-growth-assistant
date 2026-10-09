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

    # LLM Settings (provisional placeholders for future milestone)
    LLM_PROVIDER: str = "ollama"  # 'ollama' or 'anthropic' or 'openai'
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3"
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
