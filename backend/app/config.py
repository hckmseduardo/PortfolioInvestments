from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    SECRET_KEY: str = "your-secret-key-change-this-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    DATABASE_PATH: str = "./data"
    UPLOAD_PATH: str = "./uploads"
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173,http://localhost,http://localhost:80,http://app.home,https://app.home"
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"

settings = Settings()
