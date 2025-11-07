import logging
from datetime import datetime, timezone
from typing import Dict, Optional

from app.services.tradingview_client import tradingview_client
from app.services.yahoo_client import yahoo_client
from app.services.stooq_client import stooq_client
from app.services import price_cache

logger = logging.getLogger(__name__)

class MarketDataService:
    def __init__(self):
        # In-memory cache is no longer needed, using database cache instead
        pass

    def get_current_price(self, ticker: str, use_cache: bool = True) -> Optional[float]:
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
            return 1.0

        # Check cache first if use_cache is True
        if use_cache:
            try:
                cached_price, is_expired = price_cache.get_current_price(ticker)
                if cached_price is not None and not is_expired:
                    logger.debug(f"Using cached current price for {ticker}: {cached_price}")
                    return cached_price
            except Exception as e:
                logger.warning(f"Failed to get cached price for {ticker}: {e}")

        # Fetch fresh price from market
        price = self._fetch_current_price_from_market(ticker)

        # Cache the result if we got a valid price
        if price is not None:
            try:
                price_cache.set_current_price(ticker, price)
                logger.debug(f"Cached current price for {ticker}: {price}")
            except Exception as e:
                logger.warning(f"Failed to cache price for {ticker}: {e}")

        return price

    def _fetch_current_price_from_market(self, ticker: str) -> Optional[float]:
        """Fetch current price from market data sources."""
        tv_price = tradingview_client.get_latest_price(ticker)
        if tv_price is not None:
            if tv_price >= 1:
                return tv_price
            yahoo_price = self._fetch_yahoo_latest(ticker)
            if yahoo_price is not None:
                return yahoo_price
            stooq_price = self._fetch_stooq_latest(ticker)
            if stooq_price is not None:
                return stooq_price
            return tv_price

        yahoo_price = self._fetch_yahoo_latest(ticker)
        if yahoo_price is not None:
            return yahoo_price

        stooq_price = self._fetch_stooq_latest(ticker)
        if stooq_price is not None:
            return stooq_price

        logger.warning("No market price found for %s", ticker)
        return None
    
    def get_multiple_prices(self, tickers: list) -> Dict[str, float]:
        prices = {}
        for ticker in tickers:
            price = self.get_current_price(ticker)
            if price:
                prices[ticker] = price
        return prices
    
    def get_historical_price(self, ticker: str, target_date: datetime) -> Optional[float]:
        """
        Get historical price for a ticker on a specific date.
        If the date is today or future, gets current price instead.
        Historical prices are cached permanently.
        """
        # CASH always has a price of 1.0 (CAD)
        if ticker.upper() == 'CASH':
            return 1.0

        target = target_date
        if target.tzinfo is None:
            target = target.replace(tzinfo=timezone.utc)
        target_midnight = target.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

        today = datetime.utcnow().date()
        if target_midnight.date() >= today:
            return self.get_current_price(ticker)

        # Check cache for historical price
        try:
            cached = price_cache.get_historical_price(ticker, target_midnight)
            if cached is not None and cached >= 1:
                logger.debug(f"Using cached historical price for {ticker} on {target_midnight.date()}: {cached}")
                return cached
        except Exception as e:
            logger.warning(f"Failed to get cached historical price for {ticker}: {e}")

        # Fetch from market data sources
        yahoo_price = self._fetch_yahoo_historical(ticker, target_midnight)
        if yahoo_price is not None:
            try:
                price_cache.set_historical_price(ticker, target_midnight, yahoo_price)
                logger.debug(f"Cached historical price for {ticker} on {target_midnight.date()}: {yahoo_price}")
            except Exception as e:
                logger.warning(f"Failed to cache historical price for {ticker}: {e}")
            return yahoo_price

        stooq_price = self._fetch_stooq_historical(ticker, target_midnight)
        if stooq_price is not None:
            try:
                price_cache.set_historical_price(ticker, target_midnight, stooq_price)
                logger.debug(f"Cached historical price for {ticker} on {target_midnight.date()}: {stooq_price}")
            except Exception as e:
                logger.warning(f"Failed to cache historical price for {ticker}: {e}")
            return stooq_price

        tv_price = tradingview_client.get_price_on(ticker, target_midnight)
        if tv_price is not None:
            try:
                price_cache.set_historical_price(ticker, target_midnight, tv_price)
                logger.debug(f"Cached historical price for {ticker} on {target_midnight.date()}: {tv_price}")
            except Exception as e:
                logger.warning(f"Failed to cache historical price for {ticker}: {e}")
            return tv_price

        logger.warning("No historical market price found for %s on %s", ticker, target_midnight)
        return None

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
        candidates = []
        seen = set()

        def add(symbol: str):
            if symbol and symbol not in seen:
                seen.add(symbol)
                candidates.append(symbol)

        add(ticker)

        upper = ticker.upper()
        base = upper

        if ':' in upper:
            exchange, sym = upper.split(':', 1)
            base = sym
            add(sym)
            for suffix in self._suffixes_for_exchange(exchange):
                add(sym + suffix)
        else:
            if '.' in upper:
                base, suffix = upper.split('.', 1)
                add(base)
                for sfx in self._suffixes_for_exchange(suffix):
                    add(base + sfx)
            else:
                for suffix in ['.TO', '.TSX', '.V', '.NE', '.CN']:
                    add(base + suffix)
                add(base)

        return candidates

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

    def _suffixes_for_exchange(self, exchange: str):
        exchange = exchange.upper()
        mapping = {
            'TSX': ['.TO', '.TSX'],
            'TSXV': ['.V'],
            'NEO': ['.NE'],
            'CSE': ['.CN'],
            'NASDAQ': [''],
            'NYSE': [''],
            'AMEX': [''],
        }
        return mapping.get(exchange, [''])
    

market_service = MarketDataService()
