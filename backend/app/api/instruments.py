from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.auth import get_current_user
from app.database.json_db import get_db
from app.models.schemas import (
    InstrumentClassification,
    InstrumentClassificationUpdate,
    InstrumentIndustry,
    InstrumentIndustryCreate,
    InstrumentType,
    InstrumentTypeCreate,
    User,
)

router = APIRouter(prefix="/instruments", tags=["instruments"])


def _normalize_color(color: Optional[str], fallback: str) -> str:
    if not color:
        return fallback
    value = color.strip()
    if not value.startswith("#"):
        value = f"#{value}"
    if len(value) not in (4, 7):
        return fallback
    return value


def _normalize_name(name: str) -> str:
    value = (name or "").strip()
    if not value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name is required"
        )
    return value


@router.get("/types", response_model=List[InstrumentType])
async def list_instrument_types(current_user: User = Depends(get_current_user)):
    db = get_db()
    types = db.find("instrument_types", {"user_id": current_user.id})
    return sorted(types, key=lambda item: item.get("name", "").lower())


@router.post("/types", response_model=InstrumentType, status_code=status.HTTP_201_CREATED)
async def create_instrument_type(
    payload: InstrumentTypeCreate,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    name = _normalize_name(payload.name)
    existing = db.find_one("instrument_types", {"user_id": current_user.id, "name": name})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An instrument type with this name already exists"
        )
    doc = db.insert("instrument_types", {
        "user_id": current_user.id,
        "name": name,
        "color": _normalize_color(payload.color, "#8884d8")
    })
    return doc


@router.put("/types/{type_id}", response_model=InstrumentType)
async def update_instrument_type(
    type_id: str,
    payload: InstrumentTypeCreate,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    record = db.find_one("instrument_types", {"id": type_id, "user_id": current_user.id})
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instrument type not found")

    name = _normalize_name(payload.name)
    duplicate = db.find_one("instrument_types", {"user_id": current_user.id, "name": name})
    if duplicate and duplicate["id"] != type_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Another instrument type already uses this name"
        )

    db.update("instrument_types", type_id, {
        "name": name,
        "color": _normalize_color(payload.color, record.get("color", "#8884d8"))
    })
    return db.find_one("instrument_types", {"id": type_id})


@router.delete("/types/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_instrument_type(
    type_id: str,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    deleted = db.delete("instrument_types", {"id": type_id, "user_id": current_user.id})
    if deleted == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instrument type not found")
    # Remove references from classifications
    db.update(
        "instrument_metadata",
        {"user_id": current_user.id, "instrument_type_id": type_id},
        {"instrument_type_id": None}
    )
    return None


@router.get("/industries", response_model=List[InstrumentIndustry])
async def list_instrument_industries(current_user: User = Depends(get_current_user)):
    db = get_db()
    industries = db.find("instrument_industries", {"user_id": current_user.id})
    return sorted(industries, key=lambda item: item.get("name", "").lower())


@router.post("/industries", response_model=InstrumentIndustry, status_code=status.HTTP_201_CREATED)
async def create_instrument_industry(
    payload: InstrumentIndustryCreate,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    name = _normalize_name(payload.name)
    existing = db.find_one("instrument_industries", {"user_id": current_user.id, "name": name})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An instrument industry with this name already exists"
        )
    doc = db.insert("instrument_industries", {
        "user_id": current_user.id,
        "name": name,
        "color": _normalize_color(payload.color, "#82ca9d")
    })
    return doc


@router.put("/industries/{industry_id}", response_model=InstrumentIndustry)
async def update_instrument_industry(
    industry_id: str,
    payload: InstrumentIndustryCreate,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    record = db.find_one("instrument_industries", {"id": industry_id, "user_id": current_user.id})
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instrument industry not found")

    name = _normalize_name(payload.name)
    duplicate = db.find_one("instrument_industries", {"user_id": current_user.id, "name": name})
    if duplicate and duplicate["id"] != industry_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Another instrument industry already uses this name"
        )

    db.update("instrument_industries", industry_id, {
        "name": name,
        "color": _normalize_color(payload.color, record.get("color", "#82ca9d"))
    })
    return db.find_one("instrument_industries", {"id": industry_id})


@router.delete("/industries/{industry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_instrument_industry(
    industry_id: str,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    deleted = db.delete("instrument_industries", {"id": industry_id, "user_id": current_user.id})
    if deleted == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instrument industry not found")
    db.update(
        "instrument_metadata",
        {"user_id": current_user.id, "instrument_industry_id": industry_id},
        {"instrument_industry_id": None}
    )
    return None


@router.get("/classifications", response_model=List[InstrumentClassification])
async def list_classifications(current_user: User = Depends(get_current_user)):
    db = get_db()
    records = db.find("instrument_metadata", {"user_id": current_user.id})
    return sorted(records, key=lambda item: item.get("ticker", ""))


@router.put("/classifications/{ticker}", response_model=InstrumentClassification)
async def upsert_classification(
    ticker: str,
    payload: InstrumentClassificationUpdate,
    current_user: User = Depends(get_current_user)
):
    normalized_ticker = (ticker or "").strip().upper()
    if not normalized_ticker:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ticker is required")

    db = get_db()

    if payload.instrument_type_id:
        type_record = db.find_one("instrument_types", {"id": payload.instrument_type_id, "user_id": current_user.id})
        if not type_record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instrument type not found")

    if payload.instrument_industry_id:
        industry_record = db.find_one(
            "instrument_industries",
            {"id": payload.instrument_industry_id, "user_id": current_user.id}
        )
        if not industry_record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instrument industry not found")

    existing = db.find_one("instrument_metadata", {
        "user_id": current_user.id,
        "ticker": normalized_ticker
    })

    update_doc = {
        "instrument_type_id": payload.instrument_type_id,
        "instrument_industry_id": payload.instrument_industry_id
    }

    if existing:
        db.update("instrument_metadata", existing["id"], update_doc)
        return db.find_one("instrument_metadata", {"id": existing["id"]})

    doc = db.insert("instrument_metadata", {
        "user_id": current_user.id,
        "ticker": normalized_ticker,
        **update_doc
    })
    return doc


@router.delete("/classifications/{ticker}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_classification(
    ticker: str,
    current_user: User = Depends(get_current_user)
):
    normalized_ticker = (ticker or "").strip().upper()
    if not normalized_ticker:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ticker is required")

    db = get_db()
    db.delete("instrument_metadata", {"user_id": current_user.id, "ticker": normalized_ticker})
    return None
