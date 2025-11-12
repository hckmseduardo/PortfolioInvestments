"""
Ticker Mapping API Endpoints

Provides endpoints for managing ticker symbol mappings, discovering new mappings,
and handling obsolete/renamed tickers.
"""
from typing import List, Optional, Dict, Any
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.database.postgres_db import get_db as get_session
from app.database.models import TickerMapping, User
from app.services.ticker_mapping import ticker_mapping_service
from app.services.job_queue import enqueue_ticker_mapping_job, get_job_info

router = APIRouter(prefix="/ticker-mappings", tags=["ticker-mappings"])


# Pydantic models for request/response
class TickerMappingCreate(BaseModel):
    original_ticker: str = Field(..., description="Original ticker symbol")
    mapped_ticker: str = Field(..., description="Mapped ticker symbol")
    data_source: Optional[str] = Field(None, description="Data source (yfinance, alpha_vantage, etc.)")
    institution: Optional[str] = Field(None, description="Institution/broker")
    confidence: float = Field(1.0, ge=0.0, le=1.0, description="Confidence score")
    notes: Optional[str] = Field(None, description="Additional notes")


class TickerMappingResponse(BaseModel):
    id: str
    original_ticker: str
    mapped_ticker: str
    data_source: Optional[str]
    institution: Optional[str]
    mapped_by: str
    confidence: float
    status: str
    created_at: datetime
    last_verified: Optional[datetime]

    class Config:
        from_attributes = True


class TickerDiscoveryRequest(BaseModel):
    ticker: str = Field(..., description="Ticker to discover mapping for")
    institution: Optional[str] = Field(None, description="Institution context")
    test_sources: Optional[List[str]] = Field(None, description="Data sources to test")


class TickerResolutionRequest(BaseModel):
    ticker: str = Field(..., description="Obsolete ticker to resolve")
    institution: Optional[str] = Field(None, description="Institution context")
    context: Optional[str] = Field(None, description="Additional context")


@router.get("/", response_model=List[TickerMappingResponse])
async def list_ticker_mappings(
    ticker: Optional[str] = None,
    data_source: Optional[str] = None,
    institution: Optional[str] = None,
    status_filter: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    List all ticker mappings with optional filters.
    """
    query = session.query(TickerMapping)

    if ticker:
        query = query.filter(TickerMapping.original_ticker == ticker.upper())

    if data_source:
        query = query.filter(TickerMapping.data_source == data_source)

    if institution:
        query = query.filter(TickerMapping.institution == institution)

    if status_filter:
        query = query.filter(TickerMapping.status == status_filter)

    mappings = query.order_by(
        TickerMapping.original_ticker,
        TickerMapping.confidence.desc()
    ).all()

    return mappings


@router.get("/{ticker}", response_model=List[TickerMappingResponse])
async def get_ticker_mappings(
    ticker: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Get all mappings for a specific ticker.
    """
    mappings = session.query(TickerMapping).filter(
        TickerMapping.original_ticker == ticker.upper()
    ).order_by(TickerMapping.confidence.desc()).all()

    if not mappings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No mappings found for ticker {ticker}"
        )

    return mappings


@router.post("/", response_model=TickerMappingResponse, status_code=status.HTTP_201_CREATED)
async def create_ticker_mapping(
    mapping: TickerMappingCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Create a new ticker mapping manually.
    """
    result = ticker_mapping_service.create_mapping(
        original_ticker=mapping.original_ticker,
        mapped_ticker=mapping.mapped_ticker,
        data_source=mapping.data_source,
        institution=mapping.institution,
        mapped_by='user',
        confidence=mapping.confidence,
        metadata={'notes': mapping.notes} if mapping.notes else None,
        session=session
    )

    return result


@router.post("/discover", response_model=Dict[str, Any])
async def discover_ticker_mapping(
    request: TickerDiscoveryRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Discover ticker mapping by testing across different data sources.
    """
    result = ticker_mapping_service.discover_ticker_mapping(
        original_ticker=request.ticker,
        institution=request.institution,
        test_sources=request.test_sources,
        session=session
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Could not discover valid mapping for ticker {request.ticker}"
        )

    return result


@router.post("/resolve", response_model=Dict[str, Any])
async def resolve_ticker_with_ollama(
    request: TickerResolutionRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Use Ollama AI to resolve an obsolete/renamed ticker.
    """
    result = ticker_mapping_service.resolve_ticker_with_ollama(
        original_ticker=request.ticker,
        institution=request.institution,
        context=request.context
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Could not resolve ticker {request.ticker} using AI"
        )

    new_ticker, confidence, reason = result

    return {
        "original_ticker": request.ticker,
        "new_ticker": new_ticker,
        "confidence": confidence,
        "reason": reason
    }


@router.delete("/{mapping_id}")
async def delete_ticker_mapping(
    mapping_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    Mark a ticker mapping as inactive (soft delete).
    """
    mapping = session.query(TickerMapping).filter(
        TickerMapping.id == mapping_id
    ).first()

    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mapping not found"
        )

    mapping.status = 'inactive'
    mapping.updated_at = datetime.utcnow()
    session.commit()

    return {"message": "Mapping deactivated successfully"}


@router.post("/jobs/discover-all")
async def run_ticker_discovery_job(
    current_user: User = Depends(get_current_user),
):
    """
    Queue a background job to discover mappings for all tickers in the portfolio.
    """
    job = enqueue_ticker_mapping_job()

    return {
        "message": "Ticker mapping discovery job queued",
        "job_id": job.id,
        "status": "queued"
    }


@router.get("/jobs/{job_id}")
async def get_ticker_mapping_job_status(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    """
    Get status of a ticker mapping discovery job.
    """
    try:
        job_info = get_job_info(job_id)
        return job_info
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job not found: {str(e)}"
        )
