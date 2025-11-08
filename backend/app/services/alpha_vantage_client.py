import logging
from datetime import datetime
from typing import Iterator, Optional

import requests

from app.config import settings
from app.services.symbol_utils import generate_equity_symbol_variants

logger = logging.getLogger(__name__)


class AlphaVantageClient:
    BASE_URL = "https://www.alphavantage.co/query"

    def __init__(self) -> None:
        self.session = requests.Session()

    def _enabled(self) -> bool:
        return bool(settings.ALPHA_VANTAGE_API_KEY)

    def get_latest_price(self, ticker: str) -> Optional[float]:
        if not self._enabled():
            return None

        api_key = settings.ALPHA_VANTAGE_API_KEY
        for symbol in self._generate_symbols(ticker):
            price = self._fetch_global_quote(symbol, api_key)
            if price is not None:
                if symbol != ticker:
                    logger.debug("AlphaVantage latest price for %s via %s", ticker, symbol)
                return price
        return None

    def get_price_on(self, ticker: str, target_date: datetime) -> Optional[float]:
        if not self._enabled():
            return None

        api_key = settings.ALPHA_VANTAGE_API_KEY
        target_str = target_date.strftime("%Y-%m-%d")
        for symbol in self._generate_symbols(ticker):
            price = self._fetch_price_on(symbol, target_str, api_key)
            if price is not None:
                if symbol != ticker:
                    logger.debug(
                        "AlphaVantage historical price for %s via %s",
                        ticker,
                        symbol
                    )
                return price
        return None

    def _fetch_global_quote(self, symbol: str, api_key: str) -> Optional[float]:
        try:
            response = self.session.get(
                self.BASE_URL,
                params={
                    "function": "GLOBAL_QUOTE",
                    "symbol": symbol,
                    "apikey": api_key,
                },
                timeout=10,
            )
            response.raise_for_status()
            payload = response.json()
            if "Note" in payload or "Information" in payload:
                logger.debug("AlphaVantage rate limited for symbol %s", symbol)
                return None
            quote = payload.get("Global Quote") or {}
            price = quote.get("05. price")
            return float(price) if price is not None else None
        except Exception as exc:
            logger.debug("AlphaVantage latest lookup failed for %s: %s", symbol, exc)
            return None

    def _fetch_price_on(self, symbol: str, date_str: str, api_key: str) -> Optional[float]:
        try:
            response = self.session.get(
                self.BASE_URL,
                params={
                    "function": "TIME_SERIES_DAILY_ADJUSTED",
                    "symbol": symbol,
                    "outputsize": "compact",
                    "apikey": api_key,
                },
                timeout=10,
            )
            response.raise_for_status()
            payload = response.json()
            if "Note" in payload or "Information" in payload:
                logger.debug("AlphaVantage rate limited for historical %s", symbol)
                return None
            series = payload.get("Time Series (Daily)") or {}
            day = series.get(date_str)
            if not day:
                return None
            price = day.get("4. close") or day.get("5. adjusted close")
            return float(price) if price is not None else None
        except Exception as exc:
            logger.debug(
                "AlphaVantage historical lookup failed for %s (%s): %s",
                symbol,
                date_str,
                exc,
            )
            return None

    def _generate_symbols(self, ticker: str) -> Iterator[str]:
        seen = set()
        variants = generate_equity_symbol_variants(ticker)
        for variant in variants:
            normalized = variant.strip().upper()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            yield normalized
            if ':' in normalized:
                exchange, symbol = normalized.split(':', 1)
                for candidate in self._colon_variants(symbol, exchange):
                    if candidate not in seen:
                        seen.add(candidate)
                        yield candidate
            if '-' in normalized and normalized.replace('-', '') not in seen:
                candidate = normalized.replace('-', '')
                seen.add(candidate)
                yield candidate

    def _colon_variants(self, symbol: str, exchange: str) -> Iterator[str]:
        if not symbol:
            return
        mapping = {
            "TSX": "TO",
            "TSXV": "V",
            "CSE": "CN",
            "NEO": "NE",
        }
        exchange = exchange.strip().upper()
        yield f"{symbol}.{exchange}"
        suffix = mapping.get(exchange)
        if suffix:
            yield f"{symbol}.{suffix}"


alpha_vantage_client = AlphaVantageClient()
