from pydantic_settings import BaseSettings
from typing import List, Optional

class Settings(BaseSettings):
    SECRET_KEY: str = "your-secret-key-change-this-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Database configuration
    DATABASE_URL: Optional[str] = None  # PostgreSQL URL
    DATABASE_PATH: str = "./data"  # Legacy JSON path (kept for backward compatibility)
    LEGACY_DATA_PATH: str = "./data"  # Path to JSON files for migration

    UPLOAD_PATH: str = "./uploads"
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173,http://localhost,http://localhost:80,http://app.home,https://app.home"
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000

    # PostgreSQL-specific settings (with defaults for docker-compose)
    POSTGRES_DB: str = "portfolio"
    POSTGRES_USER: str = "portfolio_user"
    POSTGRES_PASSWORD: str = "portfolio_pass_change_in_production"

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
