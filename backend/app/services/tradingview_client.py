import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

import requests


logger = logging.getLogger(__name__)


EXCHANGE_SCREENERS = {
    "TSX": "canada",
    "TSXV": "canada",
    "CSE": "canada",
    "NEO": "canada",
    "NASDAQ": "america",
    "NYSE": "america",
    "AMEX": "america",
    "NYSEARCA": "america",
    "ARCA": "america",
}

DEFAULT_SCREENERS = [
    ("TSX", "canada"),
    ("TSXV", "canada"),
    ("NEO", "canada"),
    ("CSE", "canada"),
    ("NASDAQ", "america"),
    ("NYSE", "america"),
    ("AMEX", "america"),
    ("NYSEARCA", "america"),
]

SCANNER_TEMPLATE = "https://scanner.tradingview.com/{screener}/scan"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/118.0.0.0 Safari/537.36"
)


class TradingViewClient:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": USER_AGENT,
            "Referer": "https://www.tradingview.com/",
            "Origin": "https://www.tradingview.com",
        })

    def get_latest_price(self, ticker: str) -> Optional[float]:
        for symbol, screener in self._generate_symbols(ticker):
            price = self._fetch_latest(symbol, screener)
            if price is not None:
                if symbol != ticker:
                    logger.debug("TradingView price for %s via %s", ticker, symbol)
                return price
        return None

    def get_price_on(self, ticker: str, target_date: datetime) -> Optional[float]:
        for symbol, screener in self._generate_symbols(ticker):
            price = self._fetch_historical(symbol, screener, target_date)
            if price is not None:
                if symbol != ticker:
                    logger.debug("TradingView historical price for %s via %s", ticker, symbol)
                return price
        return None

    def _fetch_latest(self, symbol: str, screener: str) -> Optional[float]:
        payload = {
            "symbols": {
                "tickers": [symbol],
                "query": {"types": []}
            },
            "columns": ["close", "pricescale"]
        }
        try:
            response = self.session.post(
                SCANNER_TEMPLATE.format(screener=screener),
                json=payload,
                timeout=10
            )
            response.raise_for_status()
            data = response.json().get("data") or []
            if not data:
                return None
            close, pricescale = data[0]["d"][:2]
            return self._normalize_price(close, pricescale)
        except Exception as exc:
            logger.debug("TradingView latest lookup failed for %s (%s): %s", symbol, screener, exc)
            return None

    def _fetch_historical(self, symbol: str, screener: str, target_date: datetime) -> Optional[float]:
        start = (target_date - timedelta(days=2)).strftime("%Y-%m-%d")
        end = (target_date + timedelta(days=2)).strftime("%Y-%m-%d")
        payload = {
            "symbols": {
                "tickers": [symbol],
                "query": {"types": []}
            },
            "columns": [f"history.close|{start}|{end}", "pricescale"]
        }
        try:
            response = self.session.post(
                SCANNER_TEMPLATE.format(screener=screener),
                json=payload,
                timeout=10
            )
            response.raise_for_status()
            data = response.json().get("data") or []
            if not data:
                return None
            history, pricescale = data[0]["d"]
            if not history:
                return None
            closest = self._closest_price(history, target_date)
            if closest is None:
                return None
            return self._normalize_price(closest, pricescale)
        except Exception as exc:
            logger.debug(
                "TradingView historical lookup failed for %s (%s): %s",
                symbol,
                screener,
                exc
            )
            return None

    def _closest_price(self, history: Iterable, target: datetime) -> Optional[float]:
        if not history:
            return None
        if target.tzinfo is None:
            target_ts = target.replace(tzinfo=timezone.utc).timestamp()
        else:
            target_ts = target.astimezone(timezone.utc).timestamp()

        best = None
        diff_best = None
        for item in history:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            ts, price = item[0], item[1]
            if price is None:
                continue
            diff = abs(float(ts) - target_ts)
            if diff_best is None or diff < diff_best:
                diff_best = diff
                best = price
        if best is None:
            return None
        return float(best)

    def _normalize_price(self, close, pricescale) -> Optional[float]:
        if close is None:
            return None
        try:
            close_val = float(close)
            scale = float(pricescale or 1)
            if scale <= 1:
                return close_val
            candidate = close_val / scale
            if close_val >= 1 and candidate < 1:
                return close_val
            return candidate
        except Exception:
            return None

    def _generate_symbols(self, ticker: str):
        upper = ticker.upper()
        base = upper

        if ':' in upper:
            exchange, symbol = upper.split(':', 1)
            screener = EXCHANGE_SCREENERS.get(exchange)
            if screener:
                yield f"{exchange}:{symbol}", screener
            return

        if '.' in upper:
            base = upper
        else:
            base = upper

        yielded = set()

        def emit(exchange: str, symbol: str):
            screener = EXCHANGE_SCREENERS.get(exchange)
            if not screener:
                return
            tv_symbol = f"{exchange}:{symbol}"
            if tv_symbol not in yielded:
                yielded.add(tv_symbol)
                yield tv_symbol, screener

        # If ticker already has '.', TradingView expects same
        if '.' in base:
            for exchange, screener in DEFAULT_SCREENERS:
                tv_symbol = f"{exchange}:{base}"
                if tv_symbol not in yielded:
                    yielded.add(tv_symbol)
                    yield tv_symbol, screener
        else:
            # Try Canadian exchanges first
            for exchange, screener in DEFAULT_SCREENERS:
                tv_symbol = f"{exchange}:{base}"
                if tv_symbol not in yielded:
                    yielded.add(tv_symbol)
                    yield tv_symbol, screener

        # Finally emit bare ticker with global screener (less reliable)
        if base not in yielded:
            yield base, "global"


tradingview_client = TradingViewClient()
