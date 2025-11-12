"""
Ticker Mapping Background Task

Daily job to discover and update ticker symbol mappings across data sources.
"""
import logging
from typing import Optional, Set, Dict, Any, List
from datetime import datetime
import uuid

from rq import get_current_job

from app.database.postgres_db import get_db_context
from app.database.models import Position, Account, TickerMapping
from app.services.ticker_mapping import ticker_mapping_service

logger = logging.getLogger(__name__)


def run_ticker_mapping_job():
    """
    Background job to discover and update ticker mappings.

    This job:
    1. Collects all unique tickers from user positions
    2. Tests each ticker across different data sources
    3. Uses Ollama to resolve tickers that don't work anywhere
    4. Stores successful mappings for future use

    Returns:
        Dictionary with job results
    """
    job = get_current_job()

    def update_stage(stage: str, progress: dict = None):
        if job:
            job.meta["stage"] = stage
            if progress:
                job.meta["progress"] = progress
            job.save_meta()
            logger.info(f"Ticker mapping job {job.id} stage: {stage} progress: {progress}")

    try:
        update_stage("starting", {"message": "Initializing ticker mapping discovery...", "current": 0, "total": 0})

        with get_db_context() as db:
            # Step 1: Collect all unique tickers with their institutions
            update_stage("collecting", {"message": "Collecting tickers from portfolios...", "current": 0, "total": 0})

            tickers_info = _collect_tickers_with_context(db)

            if not tickers_info:
                logger.info("No tickers found to map")
                update_stage("completed", {
                    "message": "No tickers found",
                    "discovered": 0,
                    "resolved": 0,
                    "failed": 0
                })
                return {
                    "status": "success",
                    "discovered": 0,
                    "resolved": 0,
                    "failed": 0
                }

            total_tickers = len(tickers_info)
            update_stage("processing", {
                "message": f"Processing {total_tickers} unique tickers...",
                "current": 0,
                "total": total_tickers,
                "discovered": 0,
                "resolved": 0,
                "failed": 0
            })

            discovered_count = 0
            resolved_count = 0
            failed_count = 0
            data_sources = ['yfinance', 'alpha_vantage', 'tradingview', 'twelvedata']

            # Step 2: Process each ticker
            for idx, ticker_info in enumerate(tickers_info, 1):
                ticker = ticker_info['ticker']
                institution = ticker_info['institution']

                try:
                    # Skip CASH and other special symbols
                    if ticker.upper() in ['CASH', 'USD', 'CAD', 'EUR', 'GBP']:
                        logger.debug(f"Skipping special ticker: {ticker}")
                        continue

                    # Check if we already have mappings for this ticker
                    existing_mappings = _get_existing_mappings(db, ticker, institution)

                    if existing_mappings and len(existing_mappings) >= 2:
                        logger.debug(f"Ticker {ticker} already has {len(existing_mappings)} mappings, skipping")
                        continue

                    # Discover mapping across sources
                    logger.info(f"Discovering mapping for {ticker} (institution: {institution})")

                    discovery_result = ticker_mapping_service.discover_ticker_mapping(
                        original_ticker=ticker,
                        institution=institution,
                        test_sources=data_sources,
                        session=db
                    )

                    if discovery_result and discovery_result.get('sources'):
                        # Create mappings for successful sources
                        for source_result in discovery_result['sources']:
                            if source_result.get('success'):
                                source = source_result['source']

                                # Check if mapping already exists for this source
                                existing = db.query(TickerMapping).filter(
                                    TickerMapping.original_ticker == ticker.upper(),
                                    TickerMapping.data_source == source,
                                    TickerMapping.institution == institution
                                ).first()

                                if not existing:
                                    ticker_mapping_service.create_mapping(
                                        original_ticker=ticker,
                                        mapped_ticker=discovery_result['mapped_ticker'],
                                        data_source=source,
                                        institution=institution,
                                        mapped_by='auto',
                                        confidence=discovery_result['confidence'],
                                        metadata={
                                            'price': source_result.get('price'),
                                            'discovered_at': datetime.utcnow().isoformat()
                                        },
                                        session=db
                                    )

                        discovered_count += 1
                        logger.info(f"Discovered {len(discovery_result['sources'])} mappings for {ticker}")

                    else:
                        # Discovery failed, try Ollama resolution
                        logger.info(f"Discovery failed for {ticker}, trying Ollama resolution")

                        ollama_result = ticker_mapping_service.resolve_ticker_with_ollama(
                            original_ticker=ticker,
                            institution=institution,
                            context=f"Found in user portfolios but not working with standard data sources"
                        )

                        if ollama_result:
                            new_ticker, confidence, reason = ollama_result

                            # Verify the new ticker works
                            verification = ticker_mapping_service.discover_ticker_mapping(
                                original_ticker=new_ticker,
                                institution=institution,
                                test_sources=data_sources,
                                session=db
                            )

                            if verification and verification.get('sources'):
                                # Ollama resolution successful and verified!
                                for source_result in verification['sources']:
                                    if source_result.get('success'):
                                        source = source_result['source']

                                        ticker_mapping_service.create_mapping(
                                            original_ticker=ticker,
                                            mapped_ticker=new_ticker,
                                            data_source=source,
                                            institution=institution,
                                            mapped_by='ollama',
                                            confidence=confidence,
                                            metadata={
                                                'reason': reason,
                                                'resolved_at': datetime.utcnow().isoformat(),
                                                'verified': True
                                            },
                                            session=db
                                        )

                                resolved_count += 1
                                logger.info(
                                    f"Ollama resolved {ticker} -> {new_ticker} "
                                    f"and verified on {len(verification['sources'])} sources"
                                )
                            else:
                                # Ollama suggested a ticker but it doesn't work
                                logger.warning(
                                    f"Ollama suggested {new_ticker} for {ticker} but it doesn't work"
                                )
                                failed_count += 1
                        else:
                            # Ollama couldn't resolve it
                            logger.warning(f"Ollama could not resolve ticker {ticker}")
                            failed_count += 1

                except Exception as e:
                    logger.error(f"Error processing ticker {ticker}: {e}", exc_info=True)
                    failed_count += 1

                # Update progress every ticker or every 10 tickers
                if idx % 10 == 0 or idx == total_tickers:
                    update_stage("processing", {
                        "message": f"Processing tickers ({idx}/{total_tickers})...",
                        "current": idx,
                        "total": total_tickers,
                        "discovered": discovered_count,
                        "resolved": resolved_count,
                        "failed": failed_count
                    })

            # Commit all changes
            db.commit()

            update_stage("completed", {
                "message": "Ticker mapping completed successfully!",
                "discovered": discovered_count,
                "resolved": resolved_count,
                "failed": failed_count,
                "total_processed": total_tickers
            })

            result = {
                "status": "success",
                "discovered": discovered_count,
                "resolved": resolved_count,
                "failed": failed_count,
                "total_processed": total_tickers
            }

            logger.info(
                f"Ticker mapping job completed: {discovered_count} discovered, "
                f"{resolved_count} resolved via Ollama, {failed_count} failed"
            )

            return result

    except Exception as exc:
        update_stage("failed", {"message": f"Ticker mapping failed: {str(exc)}"})
        logger.exception("Ticker mapping job failed")
        raise exc


def _collect_tickers_with_context(db) -> List[Dict[str, Any]]:
    """
    Collect all unique tickers with their institution context.

    Returns:
        List of dicts with ticker and institution info
    """
    # Get all positions with account information
    positions = db.query(Position, Account).join(
        Account, Position.account_id == Account.id
    ).all()

    ticker_set = {}  # ticker -> institution mapping

    for position, account in positions:
        ticker = position.ticker.upper().strip()

        # Skip CASH and empty tickers
        if not ticker or ticker in ['CASH', 'USD', 'CAD', 'EUR', 'GBP']:
            continue

        # Use institution from account as context
        institution = account.institution

        # Store ticker with institution (prefer first seen institution)
        if ticker not in ticker_set:
            ticker_set[ticker] = institution

    # Convert to list of dicts
    result = [
        {'ticker': ticker, 'institution': institution}
        for ticker, institution in ticker_set.items()
    ]

    logger.info(f"Collected {len(result)} unique tickers for mapping")

    return result


def _get_existing_mappings(db, ticker: str, institution: Optional[str]) -> List[TickerMapping]:
    """Get existing mappings for a ticker."""
    query = db.query(TickerMapping).filter(
        TickerMapping.original_ticker == ticker.upper(),
        TickerMapping.status == 'active'
    )

    if institution:
        query = query.filter(TickerMapping.institution == institution)

    return query.all()
