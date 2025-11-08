from pydantic_settings import BaseSettings
from pydantic import Field, field_validator
from typing import List, Optional
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_PATH = BASE_DIR / "data"

class Settings(BaseSettings):
    SECRET_KEY: str = "your-secret-key-change-this-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Database configuration
    DATABASE_URL: Optional[str] = None  # PostgreSQL URL
    DATABASE_PATH: str = str(DEFAULT_DATA_PATH)  # Legacy JSON path (kept for backward compatibility)
    LEGACY_DATA_PATH: str = str(DEFAULT_DATA_PATH)  # Path to JSON files for migration

    UPLOAD_PATH: str = "./uploads"
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173,http://localhost,http://localhost:80,http://app.home,https://app.home"
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000

    # PostgreSQL-specific settings (with defaults for docker-compose)
    POSTGRES_DB: str = "portfolio"
    POSTGRES_USER: str = "portfolio_user"
    POSTGRES_PASSWORD: str = "portfolio_pass_change_in_production"

    # Background job / Redis configuration
    REDIS_URL: str = "redis://redis:6379/0"
    EXPENSE_QUEUE_NAME: str = "expense_conversion"
    EXPENSE_JOB_TIMEOUT: int = 1800  # 30 minutes
    PRICE_QUEUE_NAME: str = "price_fetch"
    PRICE_JOB_TIMEOUT: int = 600  # 10 minutes
    STATEMENT_QUEUE_NAME: str = "statement_processing"
    STATEMENT_JOB_TIMEOUT: int = 3600  # 60 minutes
    PRICE_FETCH_MAX_ATTEMPTS: int = 3

    # Market data providers
    TWELVEDATA_API_KEY: Optional[str] = None
    ALPHA_VANTAGE_API_KEY: Optional[str] = None
    PRICE_SOURCE_PRIORITY: List[str] = Field(
        default_factory=lambda: [
            "tradingview",
            "yfinance",
            "alpha_vantage",
            "twelvedata",
            "stooq",
        ]
    )

    @field_validator("PRICE_SOURCE_PRIORITY", mode="before")
    @classmethod
    def _split_price_priority(cls, value):
        if value is None:
            return value
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        if isinstance(value, (list, tuple)):
            cleaned = []
            for item in value:
                if item is None:
                    continue
                text = str(item).strip()
                if text:
                    cleaned.append(text)
            return cleaned
        return value

    @property
    def price_source_priority(self) -> List[str]:
        normalized = []
        seen = set()
        for entry in self.PRICE_SOURCE_PRIORITY or []:
            key = entry.strip().lower()
            if not key or key in seen:
                continue
            seen.add(key)
            normalized.append(key)
        return normalized

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    @property
    def use_postgres(self) -> bool:
        """Check if PostgreSQL should be used instead of JSON."""
        return self.DATABASE_URL is not None

    class Config:
        env_file = ".env"


settings = Settings()
