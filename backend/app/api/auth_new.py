from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from datetime import timedelta
import logging
from typing import Generator

from app.models.schemas import User, UserCreate, UserLogin, Token
from app.services.auth import verify_password, get_password_hash, create_access_token, decode_access_token
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["authentication"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")


def get_db() -> Generator:
    """Get database service (JSON or PostgreSQL)."""
    if settings.use_postgres:
        from app.database.postgres_db import get_db as get_pg_db
        from app.database.db_service import get_db_service

        db_session = next(get_pg_db())
        db_service = get_db_service(db_session)
        try:
            yield db_service
            db_session.commit()
        except Exception:
            db_session.rollback()
            raise
        finally:
            db_session.close()
    else:
        from app.database.json_db import get_db as get_json_db
        yield get_json_db()


async def get_current_user(token: str = Depends(oauth2_scheme), db = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_data = decode_access_token(token)
    if token_data is None or token_data.email is None:
        raise credentials_exception

    user_doc = db.find_one("users", {"email": token_data.email})

    if user_doc is None:
        raise credentials_exception

    return User(**user_doc)


@router.post("/register", response_model=User)
async def register(user: UserCreate, db = Depends(get_db)):
    existing_user = db.find_one("users", {"email": user.email})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    hashed_password = get_password_hash(user.password)

    user_doc = {
        "email": user.email,
        "hashed_password": hashed_password
    }

    created_user = db.insert("users", user_doc)

    return User(**created_user)


@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db = Depends(get_db)):
    """
    Login endpoint with automatic data migration from JSON to PostgreSQL.

    On first login with PostgreSQL enabled, automatically migrates user data
    from JSON files to PostgreSQL database.
    """
    user_doc = db.find_one("users", {"email": form_data.username})

    if not user_doc or not verify_password(form_data.password, user_doc.get("hashed_password") or user_doc.get("password_hash", "")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Perform migration if using PostgreSQL and user hasn't been migrated yet
    if settings.use_postgres:
        try:
            from app.database.postgres_db import get_db_context
            from app.database.migration import migrate_user_on_login

            with get_db_context() as migration_session:
                was_migrated = migrate_user_on_login(
                    email=form_data.username,
                    json_db_path=settings.LEGACY_DATA_PATH,
                    db_session=migration_session
                )

                if was_migrated:
                    logger.info(f"Successfully migrated data for user: {form_data.username}")

        except Exception as e:
            # Log but don't fail login if migration fails
            logger.error(f"Migration failed for user {form_data.username}: {e}", exc_info=True)
            # Continue with login - user can still access their data

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_doc["email"]}, expires_delta=access_token_expires
    )

    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user
