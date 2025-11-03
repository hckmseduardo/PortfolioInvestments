import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import requests


logger = logging.getLogger(__name__)


class YahooFinanceClient:
    BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    USER_AGENT = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/118.0.0.0 Safari/537.36"
    )

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": self.USER_AGENT})

    def get_latest_close(self, symbol: str) -> Optional[float]:
        try:
            response = self.session.get(
                self.BASE_URL.format(symbol=symbol),
                params={"range": "5d", "interval": "1d"},
                timeout=10
            )
            response.raise_for_status()
            return self._extract_last_close(response.json())
        except Exception as exc:
            logger.debug("Yahoo latest price lookup failed for %s: %s", symbol, exc)
            return None

    def get_close_on(self, symbol: str, target_date: datetime) -> Optional[float]:
        period1, period2 = self._build_period_window(target_date)
        try:
            response = self.session.get(
                self.BASE_URL.format(symbol=symbol),
                params={
                    "interval": "1d",
                    "period1": str(period1),
                    "period2": str(period2)
                },
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            return self._extract_close_on(data, target_date)
        except Exception as exc:
            logger.debug(
                "Yahoo historical price lookup failed for %s (%s): %s",
                symbol,
                target_date,
                exc
            )
            return None

    def _build_period_window(self, target_date: datetime) -> Tuple[int, int]:
        if target_date.tzinfo is None:
            target_date = target_date.replace(tzinfo=timezone.utc)
        start = target_date - timedelta(days=2)
        end = target_date + timedelta(days=2)
        return int(start.timestamp()), int(end.timestamp())

    def _extract_last_close(self, payload) -> Optional[float]:
        try:
            results = payload["chart"]["result"]
            if not results:
                return None
            quote = results[0]["indicators"]["quote"][0]
            closes = quote.get("close") or []
            for price in reversed(closes):
                if price is not None:
                    return float(price)
            return None
        except Exception:
            return None

    def _extract_close_on(self, payload, target_date: datetime) -> Optional[float]:
        try:
            results = payload["chart"]["result"]
            if not results:
                return None
            result = results[0]
            timestamps = result.get("timestamp") or []
            quote = result["indicators"]["quote"][0]
            closes = quote.get("close") or []
            if not timestamps or not closes:
                return None

            if target_date.tzinfo is None:
                target_ts = target_date.replace(tzinfo=timezone.utc).timestamp()
            else:
                target_ts = target_date.astimezone(timezone.utc).timestamp()

            closest_price = None
            smallest_diff = None
            for ts, price in zip(timestamps, closes):
                if price is None:
                    continue
                diff = abs(float(ts) - target_ts)
                if smallest_diff is None or diff < smallest_diff:
                    smallest_diff = diff
                    closest_price = float(price)

            return closest_price
        except Exception:
            return None


yahoo_client = YahooFinanceClient()
