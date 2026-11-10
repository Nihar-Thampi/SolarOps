"""Settings, read from environment variables (and backend/.env)."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    app_name: str = "SolarOps"
    # SQLite needs no setup; point this at Postgres for a real deployment, e.g.
    # postgresql+psycopg://solarops:solarops@localhost:5432/solarops
    database_url: str = f"sqlite:///{BACKEND_DIR / 'data' / 'solarops.db'}"

    jwt_secret: str = "dev-only-secret-change-me-in-production-0123456789"
    jwt_expires_minutes: int = 60 * 12

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    # Base URL of the frontend, used to build customer feedback links.
    frontend_url: str = "http://localhost:5173"

    # AI: a local LLM served by Ollama (https://ollama.com).
    #   "auto"  = use the local model when the server is up and the model is downloaded,
    #             otherwise offline rules ("demo").
    #   "local" = always use it; failed calls fall back to the rules and are logged.
    #   "demo"  = offline rules only.
    ai_provider: str = "auto"
    local_llm_url: str = "http://localhost:11434"
    local_llm_model: str = "qwen2.5:7b-instruct-q4_K_M"
    # Tokens of prompt plus answer the model can see at once.
    local_llm_context: int = 20480
    local_llm_max_output: int = 4096
    local_llm_timeout_seconds: float = 300.0
    # How long Ollama keeps the model loaded between calls.
    local_llm_keep_alive: str = "30m"


@lru_cache
def get_settings() -> Settings:
    return Settings()
