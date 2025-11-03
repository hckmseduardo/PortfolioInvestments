import yfinance as yf
from typing import Dict, Optional
from datetime import datetime
import pandas as pd

class MarketDataService:
    def __init__(self):
        self.cache = {}
        self.cache_expiry = {}
    
    def get_current_price(self, ticker: str) -> Optional[float]:
        try:
            stock = yf.Ticker(ticker)
            data = stock.history(period="1d")
            if not data.empty:
                return float(data['Close'].iloc[-1])
            return None
        except Exception as e:
            print(f"Error fetching price for {ticker}: {e}")
            return None
    
    def get_multiple_prices(self, tickers: list) -> Dict[str, float]:
        prices = {}
        for ticker in tickers:
            price = self.get_current_price(ticker)
            if price:
                prices[ticker] = price
        return prices
    
    def get_historical_data(self, ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
        try:
            stock = yf.Ticker(ticker)
            data = stock.history(start=start_date, end=end_date)
            return data
        except Exception as e:
            print(f"Error fetching historical data for {ticker}: {e}")
            return pd.DataFrame()
    
    def get_dividend_history(self, ticker: str) -> pd.DataFrame:
        try:
            stock = yf.Ticker(ticker)
            dividends = stock.dividends
            return dividends
        except Exception as e:
            print(f"Error fetching dividend history for {ticker}: {e}")
            return pd.DataFrame()

market_service = MarketDataService()
