"""
Ticker Symbol Mapping Service

This service handles mapping ticker symbols from user accounts/institutions
to the correct ticker symbols for various market data sources.

Features:
- Database-backed ticker mapping cache
- Auto-discovery of ticker mappings across data sources
- Ollama-powered ticker resolution for changed/renamed tickers
- Confidence scoring for mapping quality
"""
import logging
import json
import uuid
import os
import requests
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Tuple
from sqlalchemy.orm import Session

from app.database.models import TickerMapping
from app.database.postgres_db import get_db_context, ensure_db_initialized
import app.database.postgres_db as db_module

logger = logging.getLogger(__name__)


class TickerMappingService:
    """Service for managing ticker symbol mappings across data sources."""

    def __init__(self):
        self.ollama_url = os.getenv("OLLAMA_URL", "http://ollama:11434")
        self.ollama_model = os.getenv("LLM_MODEL", "mistral:7b")

    def get_mapped_ticker(
        self,
        original_ticker: str,
        data_source: Optional[str] = None,
        institution: Optional[str] = None,
        session: Optional[Session] = None
    ) -> str:
        """
        Get the mapped ticker for a given original ticker and data source.

        Args:
            original_ticker: Original ticker symbol from user's account
            data_source: Target data source (yfinance, alpha_vantage, etc.)
            institution: Institution/broker where ticker originated
            session: Optional database session (creates new if not provided)

        Returns:
            Mapped ticker symbol (returns original if no mapping found)
        """
        original_ticker = original_ticker.strip().upper()

        # Try to find existing mapping
        mapping = self._find_mapping(original_ticker, data_source, institution, session)

        if mapping and mapping.status == 'active':
            logger.debug(
                f"Found mapping: {original_ticker} -> {mapping.mapped_ticker} "
                f"(source: {data_source}, confidence: {mapping.confidence})"
            )
            return mapping.mapped_ticker

        # No mapping found, return original
        logger.debug(f"No mapping found for {original_ticker}, using original")
        return original_ticker

    def create_mapping(
        self,
        original_ticker: str,
        mapped_ticker: str,
        data_source: Optional[str] = None,
        institution: Optional[str] = None,
        mapped_by: str = 'system',
        confidence: float = 1.0,
        metadata: Optional[Dict[str, Any]] = None,
        session: Optional[Session] = None
    ) -> TickerMapping:
        """
        Create a new ticker mapping.

        Args:
            original_ticker: Original ticker symbol
            mapped_ticker: Mapped ticker symbol
            data_source: Data source this mapping applies to
            institution: Institution where original ticker came from
            mapped_by: How mapping was created ('system', 'user', 'ollama', 'auto')
            confidence: Confidence score (0.0 - 1.0)
            metadata: Additional metadata
            session: Optional database session

        Returns:
            Created TickerMapping instance
        """
        should_close = False
        if session is None:
            ensure_db_initialized()
            session = db_module.SessionLocal()
            should_close = True

        try:
            # Check if mapping already exists
            existing = self._find_mapping(original_ticker, data_source, institution, session)

            if existing:
                # Update existing mapping if new one has higher confidence
                if confidence > existing.confidence:
                    existing.mapped_ticker = mapped_ticker
                    existing.confidence = confidence
                    existing.mapped_by = mapped_by
                    existing.last_verified = datetime.utcnow()
                    existing.updated_at = datetime.utcnow()
                    if metadata:
                        existing.mapping_metadata = json.dumps(metadata)
                    session.commit()
                    logger.info(
                        f"Updated mapping: {original_ticker} -> {mapped_ticker} "
                        f"(source: {data_source}, confidence: {confidence})"
                    )
                    return existing
                else:
                    logger.debug(f"Existing mapping has higher confidence, keeping it")
                    return existing

            # Create new mapping
            mapping = TickerMapping(
                id=str(uuid.uuid4()),
                original_ticker=original_ticker.upper(),
                mapped_ticker=mapped_ticker.upper(),
                data_source=data_source,
                institution=institution,
                mapped_by=mapped_by,
                confidence=confidence,
                status='active',
                mapping_metadata=json.dumps(metadata) if metadata else None,
                created_at=datetime.utcnow(),
                last_verified=datetime.utcnow()
            )

            session.add(mapping)
            session.commit()

            logger.info(
                f"Created mapping: {original_ticker} -> {mapped_ticker} "
                f"(source: {data_source}, confidence: {confidence}, mapped_by: {mapped_by})"
            )

            return mapping

        finally:
            if should_close:
                session.close()

    def discover_ticker_mapping(
        self,
        original_ticker: str,
        institution: Optional[str] = None,
        test_sources: Optional[List[str]] = None,
        session: Optional[Session] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Discover ticker mapping by testing across different data sources.

        Args:
            original_ticker: Original ticker to discover mapping for
            institution: Institution where ticker originated
            test_sources: List of sources to test (None = test all)
            session: Optional database session

        Returns:
            Dict with discovery results or None if not found
        """
        from app.services.market_data import market_service

        original_ticker = original_ticker.strip().upper()

        if test_sources is None:
            test_sources = ['yfinance', 'alpha_vantage', 'tradingview', 'twelvedata']

        results = []

        # Test each source
        for source in test_sources:
            try:
                # Try to fetch current price
                # We'll temporarily bypass the mapping to test the raw ticker
                quote = self._test_ticker_on_source(original_ticker, source)

                if quote and quote.get('price') is not None:
                    results.append({
                        'source': source,
                        'ticker': original_ticker,
                        'price': quote['price'],
                        'success': True
                    })
                    logger.info(f"Ticker {original_ticker} works on {source}")
                else:
                    logger.debug(f"Ticker {original_ticker} failed on {source}")

            except Exception as e:
                logger.debug(f"Error testing {original_ticker} on {source}: {e}")

        if not results:
            logger.warning(f"No valid mappings discovered for {original_ticker}")
            return None

        # If ticker works on multiple sources, create mappings
        return {
            'original_ticker': original_ticker,
            'mapped_ticker': original_ticker,  # Works as-is
            'sources': results,
            'institution': institution,
            'confidence': 1.0 if len(results) >= 2 else 0.8
        }

    def resolve_ticker_with_ollama(
        self,
        original_ticker: str,
        institution: Optional[str] = None,
        context: Optional[str] = None
    ) -> Optional[Tuple[str, float, str]]:
        """
        Use Ollama to resolve a ticker that may have changed names/symbols.

        Args:
            original_ticker: Original ticker that's not working
            institution: Institution/broker context
            context: Additional context about the ticker

        Returns:
            Tuple of (new_ticker, confidence, reason) or None if not resolved
        """
        try:
            # Build prompt for Ollama
            prompt = self._build_ticker_resolution_prompt(original_ticker, institution, context)

            logger.info(f"Using Ollama to resolve ticker: {original_ticker}")

            response = requests.post(
                f"{self.ollama_url}/api/generate",
                json={
                    "model": self.ollama_model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.1,
                        "top_p": 0.9,
                        "num_predict": 200
                    }
                },
                timeout=45
            )

            if response.status_code == 200:
                result = response.json()
                llm_output = result.get("response", "").strip()

                # Parse the response
                parsed = self._parse_ticker_resolution_response(llm_output)

                if parsed:
                    new_ticker, confidence, reason = parsed
                    logger.info(
                        f"Ollama resolved {original_ticker} -> {new_ticker} "
                        f"(confidence: {confidence}, reason: {reason})"
                    )
                    return new_ticker, confidence, reason
                else:
                    logger.warning(f"Could not parse Ollama response for {original_ticker}")
                    return None

            else:
                logger.warning(f"Ollama request failed with status {response.status_code}")
                return None

        except requests.exceptions.Timeout:
            logger.warning("Ollama request timed out")
            return None
        except Exception as e:
            logger.error(f"Error in Ollama ticker resolution: {e}")
            return None

    def _find_mapping(
        self,
        original_ticker: str,
        data_source: Optional[str],
        institution: Optional[str],
        session: Optional[Session]
    ) -> Optional[TickerMapping]:
        """Find a ticker mapping in the database."""
        should_close = False
        if session is None:
            ensure_db_initialized()
            session = db_module.SessionLocal()
            should_close = True

        try:
            original_ticker = original_ticker.upper()

            # Try specific mapping first (with data_source and institution)
            if data_source and institution:
                mapping = session.query(TickerMapping).filter(
                    TickerMapping.original_ticker == original_ticker,
                    TickerMapping.data_source == data_source,
                    TickerMapping.institution == institution,
                    TickerMapping.status == 'active'
                ).order_by(TickerMapping.confidence.desc()).first()

                if mapping:
                    return mapping

            # Try with data_source only
            if data_source:
                mapping = session.query(TickerMapping).filter(
                    TickerMapping.original_ticker == original_ticker,
                    TickerMapping.data_source == data_source,
                    TickerMapping.status == 'active'
                ).order_by(TickerMapping.confidence.desc()).first()

                if mapping:
                    return mapping

            # Try with institution only
            if institution:
                mapping = session.query(TickerMapping).filter(
                    TickerMapping.original_ticker == original_ticker,
                    TickerMapping.institution == institution,
                    TickerMapping.status == 'active'
                ).order_by(TickerMapping.confidence.desc()).first()

                if mapping:
                    return mapping

            # Try global mapping (no source or institution specified)
            mapping = session.query(TickerMapping).filter(
                TickerMapping.original_ticker == original_ticker,
                TickerMapping.data_source.is_(None),
                TickerMapping.institution.is_(None),
                TickerMapping.status == 'active'
            ).order_by(TickerMapping.confidence.desc()).first()

            return mapping

        finally:
            if should_close:
                session.close()

    def _test_ticker_on_source(self, ticker: str, source: str) -> Optional[Dict[str, Any]]:
        """Test if a ticker works on a specific data source."""
        try:
            if source == 'yfinance':
                from app.services.yahoo_client import yahoo_client
                price = yahoo_client.get_latest_close(ticker)
                return {'price': price} if price else None

            elif source == 'alpha_vantage':
                from app.services.alpha_vantage_client import alpha_vantage_client
                price = alpha_vantage_client.get_latest_price(ticker)
                return {'price': price} if price else None

            elif source == 'tradingview':
                from app.services.tradingview_client import tradingview_client
                price = tradingview_client.get_latest_price(ticker)
                return {'price': price} if price else None

            elif source == 'twelvedata':
                from app.services.twelvedata_client import twelvedata_client
                price = twelvedata_client.get_latest_price(ticker)
                return {'price': price} if price else None

            return None

        except Exception as e:
            logger.debug(f"Error testing {ticker} on {source}: {e}")
            return None

    def _build_ticker_resolution_prompt(
        self,
        original_ticker: str,
        institution: Optional[str],
        context: Optional[str]
    ) -> str:
        """Build prompt for Ollama to resolve ticker changes."""
        prompt = f"""You are a financial market expert helping to resolve stock ticker symbols that may have changed.

Ticker Symbol: {original_ticker}"""

        if institution:
            prompt += f"\nInstitution/Broker: {institution}"

        if context:
            prompt += f"\nAdditional Context: {context}"

        prompt += """

Task: This ticker symbol is not working with current market data sources. It may have:
1. Changed ticker symbol (company renamed, merger, acquisition)
2. Moved to a different exchange
3. Been delisted
4. Changed suffixes (e.g., .TO to .TSX)

Please provide:
1. The most likely current ticker symbol
2. Your confidence level (0.0 to 1.0)
3. Brief reason for the change

Respond ONLY in this JSON format:
{
    "new_ticker": "NEWticker",
    "confidence": 0.85,
    "reason": "Company merged with XYZ in 2023"
}

If you cannot determine the new ticker, respond with:
{
    "new_ticker": null,
    "confidence": 0.0,
    "reason": "Unable to determine current ticker"
}"""

        return prompt

    def _parse_ticker_resolution_response(self, response: str) -> Optional[Tuple[str, float, str]]:
        """Parse Ollama's ticker resolution response."""
        try:
            # Try to extract JSON from response
            response = response.strip()

            # Sometimes LLM wraps JSON in markdown code blocks
            if response.startswith('```'):
                # Extract content between code blocks
                lines = response.split('\n')
                json_lines = []
                in_code_block = False

                for line in lines:
                    if line.strip().startswith('```'):
                        in_code_block = not in_code_block
                        continue
                    if in_code_block or (not line.strip().startswith('```')):
                        json_lines.append(line)

                response = '\n'.join(json_lines).strip()

            # Parse JSON
            data = json.loads(response)

            new_ticker = data.get('new_ticker')
            confidence = float(data.get('confidence', 0.0))
            reason = data.get('reason', '')

            if new_ticker and confidence > 0.0:
                return new_ticker.upper().strip(), confidence, reason

            return None

        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.debug(f"Error parsing Ollama response: {e}")
            logger.debug(f"Response was: {response}")
            return None


# Global instance
ticker_mapping_service = TickerMappingService()
