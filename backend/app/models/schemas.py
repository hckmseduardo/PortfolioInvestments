from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from enum import Enum

class AccountType(str, Enum):
    INVESTMENT = "investment"
    CHECKING = "checking"
    SAVINGS = "savings"

class TransactionType(str, Enum):
    BUY = "buy"
    SELL = "sell"
    DIVIDEND = "dividend"
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    FEE = "fee"
    BONUS = "bonus"

class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class User(UserBase):
    id: str
    created_at: datetime

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class AccountBase(BaseModel):
    account_type: AccountType
    account_number: str
    institution: str
    balance: float

class AccountCreate(AccountBase):
    pass

class Account(AccountBase):
    id: str
    user_id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class PositionBase(BaseModel):
    ticker: str
    name: str
    quantity: float
    book_value: float
    market_value: float

class PositionCreate(PositionBase):
    account_id: str

class Position(PositionBase):
    id: str
    account_id: str
    last_updated: datetime

    @property
    def unrealized_gain_loss(self) -> float:
        return self.market_value - self.book_value

    @property
    def unrealized_gain_loss_percent(self) -> float:
        if self.book_value == 0:
            return 0.0
        return ((self.market_value - self.book_value) / self.book_value) * 100

    class Config:
        from_attributes = True

class TransactionBase(BaseModel):
    date: datetime
    type: TransactionType
    ticker: Optional[str] = None
    quantity: Optional[float] = None
    price: Optional[float] = None
    fees: float = 0.0
    total: float
    description: Optional[str] = None

class TransactionCreate(TransactionBase):
    account_id: str

class Transaction(TransactionBase):
    id: str
    account_id: str

    class Config:
        from_attributes = True

class DividendBase(BaseModel):
    ticker: str
    date: datetime
    amount: float
    currency: str = "CAD"

class DividendCreate(DividendBase):
    account_id: str

class Dividend(DividendBase):
    id: str
    account_id: str

    class Config:
        from_attributes = True

class ExpenseBase(BaseModel):
    date: datetime
    description: str
    amount: float
    category: Optional[str] = None
    notes: Optional[str] = None

class ExpenseCreate(ExpenseBase):
    account_id: str

class Expense(ExpenseBase):
    id: str
    account_id: str

    class Config:
        from_attributes = True

class CategoryBase(BaseModel):
    name: str
    type: str
    color: str
    budget_limit: Optional[float] = None

class CategoryCreate(CategoryBase):
    pass

class Category(CategoryBase):
    id: str
    user_id: str

    class Config:
        from_attributes = True

class PortfolioSummary(BaseModel):
    total_market_value: float
    total_book_value: float
    total_gain_loss: float
    total_gain_loss_percent: float
    positions_count: int
    accounts_count: int

class PerformanceData(BaseModel):
    date: datetime
    portfolio_value: float
    book_value: float

class DividendSummary(BaseModel):
    total_dividends: float
    dividends_by_month: dict
    dividends_by_ticker: dict

class StatementBase(BaseModel):
    filename: str
    file_path: str
    file_size: int
    file_type: str
    status: str
    error_message: Optional[str] = None

class StatementCreate(StatementBase):
    account_id: Optional[str] = None

class Statement(StatementBase):
    id: str
    user_id: str
    account_id: Optional[str] = None
    uploaded_at: datetime
    processed_at: Optional[datetime] = None
    positions_count: int = 0
    transactions_count: int = 0
    dividends_count: int = 0

    class Config:
        from_attributes = True
