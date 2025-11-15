from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from datetime import timedelta
from sqlalchemy.orm import Session
from app.models.schemas import User, UserCreate, UserLogin, Token, TwoFactorSetup, TwoFactorVerify, TwoFactorDisable
from app.services.auth import verify_password, get_password_hash, create_access_token, decode_access_token
from app.services.two_factor import TwoFactorService
from app.database.postgres_db import get_db as get_session
from app.database.db_service import get_db_service
from app.config import settings
from slowapi import Limiter
from slowapi.util import get_remote_address
import secrets

router = APIRouter(prefix="/auth", tags=["authentication"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

# Security: Initialize rate limiter to prevent brute force attacks
limiter = Limiter(key_func=get_remote_address)

async def get_current_user(token: str = Depends(oauth2_scheme), session: Session = Depends(get_session)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_data = decode_access_token(token)
    if token_data is None or token_data.email is None:
        raise credentials_exception

    db = get_db_service(session)
    user_doc = db.find_one("users", {"email": token_data.email})

    if user_doc is None:
        raise credentials_exception

    return User(**user_doc)

@router.post("/register", response_model=User)
@limiter.limit("3/hour")
async def register(request: Request, user: UserCreate, session: Session = Depends(get_session)):
    db = get_db_service(session)

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
    session.commit()

    return User(**created_user)

@router.post("/login", response_model=Token)
@limiter.limit("5/15minutes")
async def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), session: Session = Depends(get_session)):
    db = get_db_service(session)

    user_doc = db.find_one("users", {"email": form_data.username})

    if not user_doc or not verify_password(form_data.password, user_doc["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if 2FA is enabled
    if user_doc.get("two_factor_enabled", False):
        # Generate a temporary token for 2FA verification (valid for 5 minutes)
        temp_token = create_access_token(
            data={"sub": user_doc["email"], "temp": True},
            expires_delta=timedelta(minutes=5)
        )
        return {
            "access_token": "",
            "token_type": "bearer",
            "requires_2fa": True,
            "temp_token": temp_token
        }

    # No 2FA - proceed with normal login
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_doc["email"]}, expires_delta=access_token_expires
    )

    return {"access_token": access_token, "token_type": "bearer", "requires_2fa": False}

@router.get("/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

# 2FA Endpoints

@router.post("/2fa/setup", response_model=TwoFactorSetup)
async def setup_2fa(current_user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Generate a new 2FA secret and QR code for setup"""
    db = get_db_service(session)

    # Generate secret and QR code
    secret = TwoFactorService.generate_secret()
    qr_code_url = TwoFactorService.generate_qr_code(current_user.email, secret)

    # Generate backup codes
    backup_codes = TwoFactorService.generate_backup_codes()
    hashed_backup_codes = TwoFactorService.hash_backup_codes(backup_codes)

    # Store the secret temporarily (not enabled yet)
    db.update(
        "users",
        {"email": current_user.email},
        {
            "two_factor_secret": secret,
            "two_factor_backup_codes": hashed_backup_codes,
            "two_factor_enabled": False
        }
    )
    session.commit()

    return {
        "secret": secret,
        "qr_code_url": qr_code_url,
        "backup_codes": backup_codes  # Show these only once!
    }

@router.post("/2fa/enable")
async def enable_2fa(verify_data: TwoFactorVerify, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Verify the setup code and enable 2FA"""
    db = get_db_service(session)

    user_doc = db.find_one("users", {"email": current_user.email})

    if not user_doc or not user_doc.get("two_factor_secret"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA setup not initiated. Call /2fa/setup first."
        )

    # Verify the code
    if not TwoFactorService.verify_totp(user_doc["two_factor_secret"], verify_data.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code"
        )

    # Enable 2FA
    db.update(
        "users",
        {"email": current_user.email},
        {"two_factor_enabled": True}
    )
    session.commit()

    return {"message": "2FA enabled successfully"}

@router.post("/2fa/verify", response_model=Token)
@limiter.limit("5/15minutes")
async def verify_2fa(request: Request, verify_data: TwoFactorVerify, temp_token: str, session: Session = Depends(get_session)):
    """Verify 2FA code during login"""
    db = get_db_service(session)

    # Decode temp token
    token_data = decode_access_token(temp_token)
    if not token_data or not token_data.email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired temporary token"
        )

    user_doc = db.find_one("users", {"email": token_data.email})

    if not user_doc or not user_doc.get("two_factor_enabled"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is not enabled for this user"
        )

    # Try to verify TOTP code
    is_valid = TwoFactorService.verify_totp(user_doc["two_factor_secret"], verify_data.code)

    # If TOTP fails, try backup codes
    used_backup_code = False
    if not is_valid and user_doc.get("two_factor_backup_codes"):
        is_valid, backup_idx = TwoFactorService.verify_backup_code(
            verify_data.code,
            user_doc["two_factor_backup_codes"]
        )
        if is_valid:
            used_backup_code = True
            # Remove used backup code
            backup_codes = user_doc["two_factor_backup_codes"]
            backup_codes.pop(backup_idx)
            db.update(
                "users",
                {"email": token_data.email},
                {"two_factor_backup_codes": backup_codes}
            )
            session.commit()

    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid verification code"
        )

    # Generate full access token
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_doc["email"]},
        expires_delta=access_token_expires
    )

    return {"access_token": access_token, "token_type": "bearer", "requires_2fa": False}

@router.post("/2fa/disable")
async def disable_2fa(disable_data: TwoFactorDisable, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Disable 2FA (requires password + current 2FA code)"""
    db = get_db_service(session)

    user_doc = db.find_one("users", {"email": current_user.email})

    if not user_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify password
    if not verify_password(disable_data.password, user_doc["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password"
        )

    # Verify 2FA code
    if not user_doc.get("two_factor_enabled"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is not enabled"
        )

    if not TwoFactorService.verify_totp(user_doc["two_factor_secret"], disable_data.code):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid verification code"
        )

    # Disable 2FA and clear secrets
    db.update(
        "users",
        {"email": current_user.email},
        {
            "two_factor_enabled": False,
            "two_factor_secret": None,
            "two_factor_backup_codes": None
        }
    )
    session.commit()

    return {"message": "2FA disabled successfully"}

@router.get("/2fa/status")
async def get_2fa_status(current_user: User = Depends(get_current_user)):
    """Check if 2FA is enabled for the current user"""
    return {
        "enabled": current_user.two_factor_enabled,
        "email": current_user.email
    }
