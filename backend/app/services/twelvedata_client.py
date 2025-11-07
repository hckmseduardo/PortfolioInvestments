import logging
from datetime import datetime
from typing import Optional

import requests

from app.config import settings
from app.services.symbol_utils import generate_equity_symbol_variants

logger = logging.getLogger(__name__)


class TwelveDataClient:
    BASE_URL = "https://api.twelvedata.com/time_series"

    def __init__(self) -> None:
        self.api_key = settings.TWELVEDATA_API_KEY
        self.session = requests.Session()

    def _enabled(self) -> bool:
        return bool(self.api_key)

    def get_latest_price(self, ticker: str) -> Optional[float]:
        if not self._enabled():
            return None

        for symbol in self._generate_symbols(ticker):
            price = self._fetch_latest(symbol)
            if price is not None:
                if symbol != ticker:
                    logger.debug("TwelveData latest price for %s via %s", ticker, symbol)
                return price
        return None

    def get_price_on(self, ticker: str, target_date: datetime) -> Optional[float]:
        if not self._enabled():
            return None

        target_str = target_date.strftime("%Y-%m-%d")
        for symbol in self._generate_symbols(ticker):
            price = self._fetch_historical(symbol, target_str)
            if price is not None:
                if symbol != ticker:
                    logger.debug("TwelveData historical price for %s via %s", ticker, symbol)
                return price
        return None

    def _fetch_latest(self, symbol: str) -> Optional[float]:
        try:
            response = self.session.get(
                self.BASE_URL,
                params={
                    "symbol": symbol,
                    "interval": "1day",
                    "outputsize": 1,
                    "apikey": self.api_key
                },
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            values = data.get("values") or []
            if not values:
                return None
            return float(values[0].get("close"))
        except Exception as exc:
            logger.debug("TwelveData latest price lookup failed for %s: %s", symbol, exc)
            return None

    def _fetch_historical(self, symbol: str, target_date: str) -> Optional[float]:
        try:
            response = self.session.get(
                self.BASE_URL,
                params={
                    "symbol": symbol,
                    "interval": "1day",
                    "start_date": target_date,
                    "end_date": target_date,
                    "apikey": self.api_key
                },
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            values = data.get("values") or []
            if not values:
                return None
            for item in values:
                if item.get("datetime", "").startswith(target_date):
                    return float(item.get("close"))
            return None
        except Exception as exc:
            logger.debug("TwelveData historical lookup failed for %s (%s): %s", symbol, target_date, exc)
            return None

    def _generate_symbols(self, ticker: str):
        # TwelveData expects exchange suffix using colon notation (e.g., RCI.B:TSX)
        variants = generate_equity_symbol_variants(ticker)
        for variant in variants:
            if ':' in variant:
                yield variant
        for variant in variants:
            if ':' not in variant:
                yield variant


twelvedata_client = TwelveDataClient()
