from fastapi import FastAPI, APIRouter, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
from app.config import settings
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from app.api import (
    auth,
    auth_entra,
    accounts,
    positions,
    import_statements,
    expenses,
    dividends,
    transactions,
    dashboard,
    instruments,
    plaid,
    ticker_mappings,
    security_metadata,
)

logger = logging.getLogger(__name__)

# Security: Initialize rate limiter to prevent brute force attacks
limiter = Limiter(key_func=get_remote_address)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events."""
    # Startup
    logger.info("Starting Investment Portfolio Management API")
    logger.info("Initializing PostgreSQL database...")
    from app.database.postgres_db import init_db
    init_db(settings.DATABASE_URL)
    logger.info("PostgreSQL database initialized")

    yield

    # Shutdown
    logger.info("Shutting down...")
    from app.database.postgres_db import close_db
    close_db()


app = FastAPI(
    title="Investment Portfolio Management API",
    description="API for managing investment portfolios and tracking expenses",
    version="1.0.0",
    lifespan=lifespan
)

# Security: Add rate limiter to app state and register exception handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

api_router = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router.include_router(auth.router)
api_router.include_router(auth_entra.router)
api_router.include_router(accounts.router)
api_router.include_router(positions.router)
api_router.include_router(import_statements.router)
api_router.include_router(expenses.router)
api_router.include_router(dividends.router)
api_router.include_router(transactions.router)
api_router.include_router(dashboard.router)
api_router.include_router(instruments.router)
api_router.include_router(plaid.router)
api_router.include_router(ticker_mappings.router)
api_router.include_router(security_metadata.router, prefix="/security-metadata", tags=["security-metadata"])

app.include_router(api_router)

# Initialize Prometheus metrics instrumentation
Instrumentator().instrument(app).expose(app)

@app.get("/")
async def root():
    return {
        "message": "Investment Portfolio Management API",
        "version": "1.0.0",
        "docs": "/docs"
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=True
    )
