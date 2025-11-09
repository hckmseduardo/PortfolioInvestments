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
    """Get database service."""
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
    """Login endpoint."""
    user_doc = db.find_one("users", {"email": form_data.username})
    stored_hash = (user_doc or {}).get("hashed_password")

    try:
        password_valid = bool(user_doc) and stored_hash and verify_password(form_data.password, stored_hash)
    except ValueError:
        password_valid = False

    if not password_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_doc["email"]}, expires_delta=access_token_expires
    )

    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user
