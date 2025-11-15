from pydantic_settings import BaseSettings
from pydantic import Field, field_validator
from typing import List, Optional


class Settings(BaseSettings):
    # Security: SECRET_KEY must be provided via environment variable
    # Generate with: python -c "import secrets; print(secrets.token_urlsafe(32))"
    SECRET_KEY: str  # REQUIRED - no default for security
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 120  # Increased to 2 hours to accommodate OAuth flows

    # Microsoft Entra ID Configuration
    ENTRA_CLIENT_ID: Optional[str] = None
    ENTRA_CLIENT_SECRET: Optional[str] = None
    ENTRA_TENANT_ID: Optional[str] = None
    ENTRA_AUTHORITY: Optional[str] = None  # Auto-constructed if not provided
    ENTRA_REDIRECT_URI: str = "http://localhost:3000/api/auth/entra/callback"
    ENTRA_SCOPES: str = "User.Read email profile openid"

    # Authentication Strategy
    AUTH_ALLOW_TRADITIONAL: bool = True  # Allow email/password login
    AUTH_ALLOW_ENTRA: bool = True  # Allow Entra ID login
    AUTH_REQUIRE_ENTRA: bool = False  # Force Entra ID authentication (for future migration)

    # Database configuration
    DATABASE_URL: str  # PostgreSQL URL (required)

    UPLOAD_PATH: str = "./uploads"
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173,http://localhost,http://localhost:80,http://app.home,https://app.home"
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000

    # PostgreSQL-specific settings (with defaults for docker-compose)
    POSTGRES_DB: str = "portfolio"
    POSTGRES_USER: str = "portfolio_user"
    # Security: Use strong passwords in production
    POSTGRES_PASSWORD: str  # REQUIRED - no default for security

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

    # Plaid configuration
    PLAID_CLIENT_ID: Optional[str] = None
    PLAID_SECRET: Optional[str] = None
    PLAID_ENVIRONMENT: str = "production"  # sandbox, development, or production
    PLAID_QUEUE_NAME: str = "plaid_sync"
    PLAID_JOB_TIMEOUT: int = 1800  # 30 minutes
    PLAID_DEBUG_MODE: bool = False  # Enable debug file writing (disable in production)

    # Ticker mapping configuration
    TICKER_MAPPING_QUEUE_NAME: str = "ticker_mapping"
    TICKER_MAPPING_JOB_TIMEOUT: int = 3600  # 60 minutes (can be slow with Ollama)

    @field_validator("SECRET_KEY")
    @classmethod
    def _validate_secret_key(cls, value):
        """
        Validate SECRET_KEY for security best practices.
        """
        if not value or len(value) < 32:
            raise ValueError(
                "SECRET_KEY must be at least 32 characters long. "
                "Generate with: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
            )

        # Prevent use of obvious insecure values
        insecure_values = [
            "your-secret-key",
            "change-this",
            "secret",
            "password",
            "123456",
            "changeme"
        ]
        value_lower = value.lower()
        for insecure in insecure_values:
            if insecure in value_lower:
                raise ValueError(
                    f"SECRET_KEY contains insecure pattern '{insecure}'. "
                    "Please generate a secure random key."
                )

        return value

    @field_validator("POSTGRES_PASSWORD")
    @classmethod
    def _validate_postgres_password(cls, value):
        """
        Validate PostgreSQL password for security best practices.
        """
        if not value or len(value) < 12:
            raise ValueError("POSTGRES_PASSWORD must be at least 12 characters long")

        # Prevent use of obvious insecure values
        insecure_values = [
            "change-in-production",
            "password",
            "123456",
            "changeme",
            "postgres",
            "admin"
        ]
        value_lower = value.lower()
        for insecure in insecure_values:
            if insecure in value_lower:
                raise ValueError(
                    f"POSTGRES_PASSWORD contains insecure pattern '{insecure}'. "
                    "Please use a secure random password."
                )

        return value

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
    def entra_authority_url(self) -> Optional[str]:
        """Get the Entra ID authority URL."""
        if self.ENTRA_AUTHORITY:
            return self.ENTRA_AUTHORITY
        if self.ENTRA_TENANT_ID:
            return f"https://login.microsoftonline.com/{self.ENTRA_TENANT_ID}"
        return None

    @property
    def entra_scopes_list(self) -> List[str]:
        """Get Entra ID scopes as a list."""
        return [scope.strip() for scope in self.ENTRA_SCOPES.split(",") if scope.strip()]

    @property
    def is_entra_configured(self) -> bool:
        """Check if Entra ID is properly configured."""
        return all([
            self.ENTRA_CLIENT_ID,
            self.ENTRA_CLIENT_SECRET,
            self.ENTRA_TENANT_ID,
        ])

    class Config:
        env_file = ".env"
        extra = "ignore"  # Ignore extra environment variables not defined in the model


settings = Settings()
