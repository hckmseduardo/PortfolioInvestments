import logging
from datetime import datetime
from typing import List, Optional

from app.config import settings
from app.services.market_data import market_service
from app.services import price_cache

logger = logging.getLogger(__name__)


def run_price_fetch_job(tickers: List[str], as_of_date: Optional[str] = None):
    if not tickers:
        return {"updated": 0}

    as_of = None
    if as_of_date:
        try:
            as_of = datetime.fromisoformat(as_of_date)
        except ValueError:
            logger.warning("Invalid as_of_date passed to price job: %s", as_of_date)
            as_of = None

    max_attempts = settings.PRICE_FETCH_MAX_ATTEMPTS
    updated = 0

    for ticker in tickers:
        try:
            attempts = price_cache.get_price_retry_count(ticker, as_of)
            success = False

            while attempts < max_attempts:
                if as_of:
                    quote = market_service.get_historical_price_quote(ticker, as_of)
                    if quote.price is not None:
                        price_cache.set_historical_price(ticker, as_of, quote.price, source=quote.source)
                        price_cache.reset_price_retry_count(ticker, as_of)
                        updated += 1
                        success = True
                        break
                else:
                    quote = market_service.get_current_price_quote(ticker, use_cache=False)
                    if quote.price is not None:
                        price_cache.set_current_price(ticker, quote.price, source=quote.source)
                        price_cache.reset_price_retry_count(ticker, as_of)
                        updated += 1
                        success = True
                        break

                attempts = price_cache.increment_price_retry_count(ticker, as_of)
                if attempts >= max_attempts:
                    logger.warning("Price fetch attempts exhausted for %s (as_of=%s)", ticker, as_of_date)
                    break

            if not success and attempts < max_attempts:
                # Schedule another job attempt for remaining tickers
                pass

        except Exception as exc:
            logger.warning("Failed to fetch price for %s in background job: %s", ticker, exc)

    return {
        "updated": updated,
        "tickers": tickers,
        "as_of": as_of_date
    }
