import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple, List

from app.services.tradingview_client import tradingview_client
from app.services.yahoo_client import yahoo_client
from app.services.stooq_client import stooq_client
from app.services.symbol_utils import generate_equity_symbol_variants
from app.services import price_cache
from app.services.twelvedata_client import twelvedata_client

logger = logging.getLogger(__name__)


@dataclass
class PriceQuote:
    price: Optional[float]
    source: Optional[str] = None
    fetched_at: Optional[datetime] = None
    is_live: bool = False

class MarketDataService:
    def __init__(self):
        # In-memory cache is no longer needed, using database cache instead
        pass

    def get_current_price_quote(self, ticker: str, use_cache: bool = True) -> PriceQuote:
        """
        Get current price for a ticker.

        Args:
            ticker: Stock ticker symbol
            use_cache: If True, check cache first and only fetch if expired or missing.
                      If False, always fetch fresh from market and update cache.

        Returns:
            Current price or None if not available
        """
        # CASH always has a price of 1.0 (CAD)
        if ticker.upper() == 'CASH':
            return PriceQuote(price=1.0, source='cash', fetched_at=datetime.utcnow(), is_live=True)

        # Check cache first if use_cache is True
        if use_cache:
            try:
                cached_price, is_expired, meta = price_cache.get_current_price(ticker)
                if cached_price is not None and not is_expired:
                    logger.debug(f"Using cached current price for {ticker}: {cached_price}")
                    fetched_at = None
                    if meta and meta.get("cached_at"):
                        try:
                            fetched_at = datetime.fromisoformat(meta["cached_at"].replace('Z', '+00:00'))
                        except ValueError:
                            fetched_at = None
                    source = meta.get("source") if meta else None
                    return PriceQuote(
                        price=cached_price,
                        source=source,
                        fetched_at=fetched_at,
                        is_live=self._is_live_source(source)
                    )
            except Exception as e:
                logger.warning(f"Failed to get cached price for {ticker}: {e}")

        # Fetch fresh price from market
        price, source = self._fetch_current_price_from_market(ticker)

        # Cache the result if we got a valid price
        if price is not None:
            try:
                price_cache.set_current_price(ticker, price, source=source)
                logger.debug(f"Cached current price for {ticker}: {price}")
            except Exception as e:
                logger.warning(f"Failed to cache price for {ticker}: {e}")

        return PriceQuote(
            price=price,
            source=source,
            fetched_at=datetime.utcnow(),
            is_live=self._is_live_source(source)
        )

    def get_current_price(self, ticker: str, use_cache: bool = True) -> Optional[float]:
        return self.get_current_price_quote(ticker, use_cache=use_cache).price

    def _fetch_current_price_from_market(self, ticker: str) -> Tuple[Optional[float], Optional[str]]:
        """Fetch current price from market data sources."""
        tv_price = tradingview_client.get_latest_price(ticker)
        if tv_price is not None:
            if tv_price >= 1:
                return tv_price, "tradingview"
            yahoo_price = self._fetch_yahoo_latest(ticker)
            if yahoo_price is not None:
                return yahoo_price, "yfinance"
            stooq_price = self._fetch_stooq_latest(ticker)
            if stooq_price is not None:
                return stooq_price, "stooq"
            return tv_price, "tradingview"

        yahoo_price = self._fetch_yahoo_latest(ticker)
        if yahoo_price is not None:
            return yahoo_price, "yfinance"

        td_price = twelvedata_client.get_latest_price(ticker)
        if td_price is not None:
            return td_price, "twelvedata"

        stooq_price = self._fetch_stooq_latest(ticker)
        if stooq_price is not None:
            return stooq_price, "stooq"

        logger.warning("No market price found for %s", ticker)
        return None, None
    
    def get_multiple_prices(self, tickers: list) -> Dict[str, float]:
        prices = {}
        for ticker in tickers:
            price = self.get_current_price(ticker)
            if price:
                prices[ticker] = price
        return prices
    
    def get_historical_price_quote(self, ticker: str, target_date: datetime) -> PriceQuote:
        """
        Get historical price for a ticker on a specific date.
        If the date is today or future, gets current price instead.
        Historical prices are cached permanently.
        """
        # CASH always has a price of 1.0 (CAD)
        if ticker.upper() == 'CASH':
            return PriceQuote(price=1.0, source='cash', fetched_at=datetime.utcnow(), is_live=True)

        target = target_date
        if target.tzinfo is None:
            target = target.replace(tzinfo=timezone.utc)
        target_midnight = target.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

        today = datetime.utcnow().date()
        if target_midnight.date() >= today:
            return self.get_current_price_quote(ticker)

        # Check cache for historical price
        try:
            cached, meta = price_cache.get_historical_price(ticker, target_midnight)
            if cached is not None and cached >= 1:
                logger.debug(f"Using cached historical price for {ticker} on {target_midnight.date()}: {cached}")
                fetched_at = None
                if meta and meta.get("cached_at"):
                    try:
                        fetched_at = datetime.fromisoformat(meta["cached_at"].replace('Z', '+00:00'))
                    except ValueError:
                        fetched_at = None
                source = meta.get("source") if meta else None
                return PriceQuote(
                    price=cached,
                    source=source,
                    fetched_at=fetched_at,
                    is_live=self._is_live_source(source)
                )
        except Exception as e:
            logger.warning(f"Failed to get cached historical price for {ticker}: {e}")

        # Fetch from market data sources
        price = None
        source = None

        yahoo_price = self._fetch_yahoo_historical(ticker, target_midnight)
        if yahoo_price is not None:
            price = yahoo_price
            source = "yfinance"
        else:
            td_price = twelvedata_client.get_price_on(ticker, target_midnight)
            if td_price is not None:
                price = td_price
                source = "twelvedata"
            else:
                stooq_price = self._fetch_stooq_historical(ticker, target_midnight)
                if stooq_price is not None:
                    price = stooq_price
                    source = "stooq"
                else:
                    tv_price = tradingview_client.get_price_on(ticker, target_midnight)
                    if tv_price is not None:
                        price = tv_price
                        source = "tradingview"

        if price is not None:
            try:
                price_cache.set_historical_price(ticker, target_midnight, price, source=source)
                logger.debug(f"Cached historical price for {ticker} on {target_midnight.date()}: {price}")
            except Exception as e:
                logger.warning(f"Failed to cache historical price for {ticker}: {e}")
            return PriceQuote(
                price=price,
                source=source,
                fetched_at=datetime.utcnow(),
                is_live=self._is_live_source(source)
            )

        logger.warning("No historical market price found for %s on %s", ticker, target_midnight)
        return PriceQuote(price=None, source=None, fetched_at=None, is_live=False)

    def get_historical_price(self, ticker: str, target_date: datetime) -> Optional[float]:
        return self.get_historical_price_quote(ticker, target_date).price

    def get_cached_quotes(self, tickers: List[str], as_of: Optional[datetime]) -> Dict[str, PriceQuote]:
        if not tickers:
            return {}

        records = price_cache.get_cached_prices(tickers, as_of)
        quotes: Dict[str, PriceQuote] = {}
        for ticker in tickers:
            record = records.get(ticker.upper())
            if not record:
                continue
            price = record.get("price")
            if price is None:
                continue
            cached_at = record.get("cached_at")
            fetched_at = None
            if cached_at:
                try:
                    fetched_at = datetime.fromisoformat(cached_at.replace('Z', '+00:00'))
                except ValueError:
                    fetched_at = None
            source = record.get("source")
            quotes[ticker.upper()] = PriceQuote(
                price=price,
                source=source,
                fetched_at=fetched_at,
                is_live=self._is_live_source(source)
            )
        return quotes

    @staticmethod
    def _is_live_source(source: Optional[str]) -> bool:
        if not source:
            return False
        return source.lower() in {"yfinance", "tradingview", "twelvedata", "cash"}

    def _fetch_stooq_latest(self, ticker: str) -> Optional[float]:
        for symbol in self._generate_stooq_symbols(ticker):
            price = stooq_client.get_latest_close(symbol)
            if price is not None:
                logger.info("Using Stooq price for %s via symbol %s", ticker, symbol)
                return price
        return None

    def _fetch_stooq_historical(self, ticker: str, target_date: datetime) -> Optional[float]:
        for symbol in self._generate_stooq_symbols(ticker):
            price = stooq_client.get_close_on(symbol, target_date)
            if price is not None:
                logger.info(
                    "Using Stooq historical price for %s via symbol %s",
                    ticker,
                    symbol
                )
                return price
        return None

    def _fetch_yahoo_latest(self, ticker: str) -> Optional[float]:
        for symbol in self._generate_symbol_candidates(ticker):
            price = yahoo_client.get_latest_close(symbol)
            if price is not None:
                if symbol != ticker:
                    logger.info("Using Yahoo price for %s via symbol %s", ticker, symbol)
                return price
        return None

    def _fetch_yahoo_historical(self, ticker: str, target_date: datetime) -> Optional[float]:
        for symbol in self._generate_symbol_candidates(ticker):
            price = yahoo_client.get_close_on(symbol, target_date)
            if price is not None:
                if symbol != ticker:
                    logger.info(
                        "Using Yahoo historical price for %s via symbol %s",
                        ticker,
                        symbol
                    )
                return price
        return None

    def _generate_symbol_candidates(self, ticker: str):
        variants = generate_equity_symbol_variants(ticker)
        # Filter out colon variants because Yahoo expects suffix format
        return [v for v in variants if ':' not in v]

    def _generate_stooq_symbols(self, ticker: str):
        symbols = []
        seen = set()

        def add(symbol: str):
            if symbol and symbol not in seen:
                seen.add(symbol)
                symbols.append(symbol.lower())

        upper = ticker.upper()

        if ':' in upper:
            exchange, sym = upper.split(':', 1)
            add(self._map_stooq_symbol(sym, exchange))
        else:
            add(self._map_stooq_symbol(upper, None))
            if '.' in upper:
                base, suffix = upper.split('.', 1)
                add(self._map_stooq_symbol(base, suffix))
            else:
                for suffix in ['TO', 'TSX', 'V', 'NE', 'CN', 'US']:
                    add(self._map_stooq_symbol(upper, suffix))

        return [s for s in symbols if s]

    def _map_stooq_symbol(self, symbol: str, exchange: Optional[str]) -> Optional[str]:
        if not symbol:
            return None
        exchange = (exchange or '').upper()
        mapping = {
            'TSX': '.to',
            'TO': '.to',
            'TSXV': '.v',
            'V': '.v',
            'NE': '.ne',
            'NEO': '.ne',
            'CN': '.cn',
            'CSE': '.cn',
            'US': '.us',
            'NASDAQ': '.us',
            'NYSE': '.us',
            'AMEX': '.us',
        }
        suffix = mapping.get(exchange, '.us' if symbol.isalpha() and len(symbol) <= 4 else '')
        return (symbol + suffix).lower()

market_service = MarketDataService()
