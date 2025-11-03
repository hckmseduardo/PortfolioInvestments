import csv
import io
import logging
from datetime import datetime
from typing import Optional

import requests


logger = logging.getLogger(__name__)


class StooqClient:
    BASE_URL = "https://stooq.com/q/d/l/"
    USER_AGENT = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/118.0.0.0 Safari/537.36"
    )

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": self.USER_AGENT})

    def get_latest_close(self, symbol: str) -> Optional[float]:
        data = self._fetch_csv(symbol)
        if not data:
            return None
        try:
            last = data[-1]
            return float(last["Close"])
        except Exception:
            return None

    def get_close_on(self, symbol: str, target_date: datetime) -> Optional[float]:
        data = self._fetch_csv(symbol)
        if not data:
            return None
        target_str = target_date.strftime("%Y-%m-%d")
        for row in data:
            if row.get("Date") == target_str:
                try:
                    return float(row["Close"])
                except Exception:
                    return None
        return None

    def _fetch_csv(self, symbol: str):
        try:
            response = self.session.get(
                self.BASE_URL,
                params={"s": symbol.lower(), "i": "d"},
                timeout=10
            )
            response.raise_for_status()
            content = response.content.decode("utf-8", errors="ignore")
            reader = csv.DictReader(io.StringIO(content))
            rows = [row for row in reader if row.get("Date")]
            return rows
        except Exception as exc:
            logger.debug("Stooq request failed for %s: %s", symbol, exc)
            return None


stooq_client = StooqClient()
