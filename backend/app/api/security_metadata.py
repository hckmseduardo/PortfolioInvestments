"""
API endpoints for managing security metadata (types, subtypes, sectors, industries)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel
from datetime import datetime

from app.database.postgres_db import get_db as get_session
from app.database.models import SecurityType, SecuritySubtype, Sector, Industry, SecurityMetadataOverride, User
from app.api.auth import get_current_user
import uuid

router = APIRouter()


# Pydantic schemas
class SecurityMetadataBase(BaseModel):
    name: str
    color: str = "#808080"


class SecurityMetadataCreate(SecurityMetadataBase):
    pass


class SecurityMetadataUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


class SecurityMetadataResponse(SecurityMetadataBase):
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ========== Security Types ==========

@router.get("/types", response_model=List[SecurityMetadataResponse])
async def get_security_types(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Get all security types"""
    types = session.query(SecurityType).order_by(SecurityType.name).all()
    return types


@router.post("/types", response_model=SecurityMetadataResponse)
async def create_security_type(
    data: SecurityMetadataCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Create a new security type"""
    # Check if already exists
    existing = session.query(SecurityType).filter(SecurityType.name == data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Security type already exists")

    new_type = SecurityType(
        id=str(uuid.uuid4()),
        name=data.name,
        color=data.color
    )
    session.add(new_type)
    session.commit()
    session.refresh(new_type)
    return new_type


@router.put("/types/{type_id}", response_model=SecurityMetadataResponse)
async def update_security_type(
    type_id: str,
    data: SecurityMetadataUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Update a security type"""
    security_type = session.query(SecurityType).filter(SecurityType.id == type_id).first()
    if not security_type:
        raise HTTPException(status_code=404, detail="Security type not found")

    if data.name is not None:
        # Check if name already exists
        existing = session.query(SecurityType).filter(
            SecurityType.name == data.name,
            SecurityType.id != type_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Security type name already exists")
        security_type.name = data.name

    if data.color is not None:
        security_type.color = data.color

    security_type.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(security_type)
    return security_type


@router.delete("/types/{type_id}")
async def delete_security_type(
    type_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Delete a security type"""
    security_type = session.query(SecurityType).filter(SecurityType.id == type_id).first()
    if not security_type:
        raise HTTPException(status_code=404, detail="Security type not found")

    session.delete(security_type)
    session.commit()
    return {"message": "Security type deleted successfully"}


# ========== Security Subtypes ==========

@router.get("/subtypes", response_model=List[SecurityMetadataResponse])
async def get_security_subtypes(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Get all security subtypes"""
    subtypes = session.query(SecuritySubtype).order_by(SecuritySubtype.name).all()
    return subtypes


@router.post("/subtypes", response_model=SecurityMetadataResponse)
async def create_security_subtype(
    data: SecurityMetadataCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Create a new security subtype"""
    existing = session.query(SecuritySubtype).filter(SecuritySubtype.name == data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Security subtype already exists")

    new_subtype = SecuritySubtype(
        id=str(uuid.uuid4()),
        name=data.name,
        color=data.color
    )
    session.add(new_subtype)
    session.commit()
    session.refresh(new_subtype)
    return new_subtype


@router.put("/subtypes/{subtype_id}", response_model=SecurityMetadataResponse)
async def update_security_subtype(
    subtype_id: str,
    data: SecurityMetadataUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Update a security subtype"""
    subtype = session.query(SecuritySubtype).filter(SecuritySubtype.id == subtype_id).first()
    if not subtype:
        raise HTTPException(status_code=404, detail="Security subtype not found")

    if data.name is not None:
        existing = session.query(SecuritySubtype).filter(
            SecuritySubtype.name == data.name,
            SecuritySubtype.id != subtype_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Security subtype name already exists")
        subtype.name = data.name

    if data.color is not None:
        subtype.color = data.color

    subtype.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(subtype)
    return subtype


@router.delete("/subtypes/{subtype_id}")
async def delete_security_subtype(
    subtype_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Delete a security subtype"""
    subtype = session.query(SecuritySubtype).filter(SecuritySubtype.id == subtype_id).first()
    if not subtype:
        raise HTTPException(status_code=404, detail="Security subtype not found")

    session.delete(subtype)
    session.commit()
    return {"message": "Security subtype deleted successfully"}


# ========== Sectors ==========

@router.get("/sectors", response_model=List[SecurityMetadataResponse])
async def get_sectors(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Get all sectors"""
    sectors = session.query(Sector).order_by(Sector.name).all()
    return sectors


@router.post("/sectors", response_model=SecurityMetadataResponse)
async def create_sector(
    data: SecurityMetadataCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Create a new sector"""
    existing = session.query(Sector).filter(Sector.name == data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Sector already exists")

    new_sector = Sector(
        id=str(uuid.uuid4()),
        name=data.name,
        color=data.color
    )
    session.add(new_sector)
    session.commit()
    session.refresh(new_sector)
    return new_sector


@router.put("/sectors/{sector_id}", response_model=SecurityMetadataResponse)
async def update_sector(
    sector_id: str,
    data: SecurityMetadataUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Update a sector"""
    sector = session.query(Sector).filter(Sector.id == sector_id).first()
    if not sector:
        raise HTTPException(status_code=404, detail="Sector not found")

    if data.name is not None:
        existing = session.query(Sector).filter(
            Sector.name == data.name,
            Sector.id != sector_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Sector name already exists")
        sector.name = data.name

    if data.color is not None:
        sector.color = data.color

    sector.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(sector)
    return sector


@router.delete("/sectors/{sector_id}")
async def delete_sector(
    sector_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Delete a sector"""
    sector = session.query(Sector).filter(Sector.id == sector_id).first()
    if not sector:
        raise HTTPException(status_code=404, detail="Sector not found")

    session.delete(sector)
    session.commit()
    return {"message": "Sector deleted successfully"}


# ========== Industries ==========

@router.get("/industries", response_model=List[SecurityMetadataResponse])
async def get_industries(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Get all industries"""
    industries = session.query(Industry).order_by(Industry.name).all()
    return industries


@router.post("/industries", response_model=SecurityMetadataResponse)
async def create_industry(
    data: SecurityMetadataCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Create a new industry"""
    existing = session.query(Industry).filter(Industry.name == data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Industry already exists")

    new_industry = Industry(
        id=str(uuid.uuid4()),
        name=data.name,
        color=data.color
    )
    session.add(new_industry)
    session.commit()
    session.refresh(new_industry)
    return new_industry


@router.put("/industries/{industry_id}", response_model=SecurityMetadataResponse)
async def update_industry(
    industry_id: str,
    data: SecurityMetadataUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Update an industry"""
    industry = session.query(Industry).filter(Industry.id == industry_id).first()
    if not industry:
        raise HTTPException(status_code=404, detail="Industry not found")

    if data.name is not None:
        existing = session.query(Industry).filter(
            Industry.name == data.name,
            Industry.id != industry_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Industry name already exists")
        industry.name = data.name

    if data.color is not None:
        industry.color = data.color

    industry.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(industry)
    return industry


@router.delete("/industries/{industry_id}")
async def delete_industry(
    industry_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Delete an industry"""
    industry = session.query(Industry).filter(Industry.id == industry_id).first()
    if not industry:
        raise HTTPException(status_code=404, detail="Industry not found")

    session.delete(industry)
    session.commit()
    return {"message": "Industry deleted successfully"}


# ========== Security Metadata Overrides ==========

class SecurityMetadataOverrideUpdate(BaseModel):
    ticker: str
    security_name: str
    custom_type: str | None = None
    custom_subtype: str | None = None
    custom_sector: str | None = None
    custom_industry: str | None = None


class SecurityMetadataOverrideResponse(BaseModel):
    id: str
    ticker: str
    security_name: str
    custom_type: str | None
    custom_subtype: str | None
    custom_sector: str | None
    custom_industry: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


@router.post("/overrides", response_model=SecurityMetadataOverrideResponse)
async def set_security_override(
    data: SecurityMetadataOverrideUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Set or update metadata override for a security"""
    # Check if override already exists
    existing = session.query(SecurityMetadataOverride).filter(
        SecurityMetadataOverride.ticker == data.ticker,
        SecurityMetadataOverride.security_name == data.security_name
    ).first()

    if existing:
        # Update existing override
        if data.custom_type is not None:
            existing.custom_type = data.custom_type
        if data.custom_subtype is not None:
            existing.custom_subtype = data.custom_subtype
        if data.custom_sector is not None:
            existing.custom_sector = data.custom_sector
        if data.custom_industry is not None:
            existing.custom_industry = data.custom_industry
        existing.updated_at = datetime.utcnow()
        session.commit()
        session.refresh(existing)
        return existing
    else:
        # Create new override
        new_override = SecurityMetadataOverride(
            id=str(uuid.uuid4()),
            ticker=data.ticker,
            security_name=data.security_name,
            custom_type=data.custom_type,
            custom_subtype=data.custom_subtype,
            custom_sector=data.custom_sector,
            custom_industry=data.custom_industry
        )
        session.add(new_override)
        session.commit()
        session.refresh(new_override)
        return new_override


@router.get("/overrides/{ticker}/{security_name}", response_model=SecurityMetadataOverrideResponse | None)
async def get_security_override(
    ticker: str,
    security_name: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Get metadata override for a specific security"""
    override = session.query(SecurityMetadataOverride).filter(
        SecurityMetadataOverride.ticker == ticker,
        SecurityMetadataOverride.security_name == security_name
    ).first()
    return override
