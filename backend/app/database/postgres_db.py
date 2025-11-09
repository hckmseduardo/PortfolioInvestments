"""
PostgreSQL Database Connection and Session Management
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import NullPool
from contextlib import contextmanager
from typing import Generator
import logging

from app.database.models import Base

logger = logging.getLogger(__name__)

# Global engine and session factory
engine = None
SessionLocal = None
_is_initialized = False


def init_db(database_url: str):
    """
    Initialize the database connection and create tables.

    Args:
        database_url: PostgreSQL connection URL
    """
    global engine, SessionLocal, _is_initialized

    logger.info(f"Initializing database connection...")

    # Create engine
    engine = create_engine(
        database_url,
        pool_pre_ping=True,  # Verify connections before using them
        echo=False,  # Set to True for SQL query logging
    )

    # Create session factory
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Create all tables
    logger.info("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    logger.info("Database initialized successfully")
    _is_initialized = True


def ensure_db_initialized():
    """Lazily initialize the database connection if it hasn't been set up yet."""
    global _is_initialized
    if _is_initialized and SessionLocal is not None:
        return
    from app.config import settings
    if not settings.DATABASE_URL:
        raise RuntimeError("DATABASE_URL must be set to use PostgreSQL storage")
    init_db(settings.DATABASE_URL)


def get_db() -> Generator[Session, None, None]:
    """
    Dependency for FastAPI to get database session.

    Yields:
        Database session
    """
    ensure_db_initialized()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def get_db_context():
    """
    Context manager for database sessions outside of FastAPI.

    Usage:
        with get_db_context() as db:
            user = db.query(User).first()

    Yields:
        Database session
    """
    ensure_db_initialized()
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def close_db():
    """Close database connection."""
    global engine, SessionLocal, _is_initialized
    if engine:
        engine.dispose()
        logger.info("Database connection closed")
    engine = None
    SessionLocal = None
    _is_initialized = False
