from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from enum import Enum

class AccountType(str, Enum):
    INVESTMENT = "investment"
    CHECKING = "checking"
    SAVINGS = "savings"
    CREDIT_CARD = "credit_card"

class TransactionType(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    DIVIDEND = "DIVIDEND"
    INTEREST = "INTEREST"
    DEPOSIT = "DEPOSIT"
    WITHDRAWAL = "WITHDRAWAL"
    FEE = "FEE"
    BONUS = "BONUS"
    TRANSFER = "TRANSFER"
    TAX = "TAX"

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
    two_factor_enabled: bool = False

    # Authentication provider
    auth_provider: str = "local"  # "local", "entra", or "hybrid"

    # Microsoft Entra ID fields
    entra_id: Optional[str] = None
    entra_tenant_id: Optional[str] = None
    entra_email_verified: bool = False
    entra_linked_at: Optional[datetime] = None

    # Account linking
    account_linked: bool = False
    linked_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    requires_2fa: bool = False
    temp_token: Optional[str] = None

class TokenData(BaseModel):
    email: Optional[str] = None

class TwoFactorSetup(BaseModel):
    secret: str
    qr_code_url: str
    backup_codes: List[str]

class TwoFactorVerify(BaseModel):
    code: str

class TwoFactorDisable(BaseModel):
    password: str
    code: str

class AccountBase(BaseModel):
    account_type: AccountType
    account_number: str
    institution: str
    balance: float
    label: Optional[str] = None

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

class AggregatedPosition(BaseModel):
    ticker: str
    name: str
    quantity: float
    book_value: float
    market_value: float
    price: Optional[float] = None
    price_source: Optional[str] = None
    price_fetched_at: Optional[datetime] = None
    has_live_price: bool = False
    price_pending: bool = False
    price_failed: bool = False
    instrument_type_id: Optional[str] = None
    instrument_type_name: Optional[str] = None
    instrument_type_color: Optional[str] = None
    instrument_industry_id: Optional[str] = None
    instrument_industry_name: Optional[str] = None
    instrument_industry_color: Optional[str] = None

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
    transaction_id: Optional[str] = None  # Link to source transaction
    paired_transaction_id: Optional[str] = None  # ID of the paired transaction in a transfer
    paired_account_id: Optional[str] = None  # Account ID of the paired side of the transfer
    is_transfer_primary: Optional[bool] = True  # True if this is the primary expense record for a transfer pair

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
    dividends_by_type: dict = {}
    dividends_by_industry: dict = {}
    period_start: Optional[str] = None
    period_end: Optional[str] = None

class InstrumentTypeBase(BaseModel):
    name: str
    color: str = "#8884d8"

class InstrumentTypeCreate(InstrumentTypeBase):
    pass

class InstrumentType(InstrumentTypeBase):
    id: str
    user_id: str

    class Config:
        from_attributes = True

class InstrumentIndustryBase(BaseModel):
    name: str
    color: str = "#82ca9d"

class InstrumentIndustryCreate(InstrumentIndustryBase):
    pass

class InstrumentIndustry(InstrumentIndustryBase):
    id: str
    user_id: str

    class Config:
        from_attributes = True

class InstrumentClassificationBase(BaseModel):
    ticker: str
    instrument_type_id: Optional[str] = None
    instrument_industry_id: Optional[str] = None

class InstrumentClassification(InstrumentClassificationBase):
    id: str
    user_id: str

    class Config:
        from_attributes = True

class InstrumentClassificationUpdate(BaseModel):
    instrument_type_id: Optional[str] = None
    instrument_industry_id: Optional[str] = None

class IndustryBreakdownSlice(BaseModel):
    industry_id: Optional[str] = None
    industry_name: str
    color: str
    market_value: float
    percentage: float
    position_count: int

class TypeBreakdownSlice(BaseModel):
    type_id: Optional[str] = None
    type_name: str
    color: str
    market_value: float
    percentage: float
    position_count: int

class StatementBase(BaseModel):
    filename: str
    file_path: str
    file_type: str
    file_size: int = 0  # Computed from file on disk
    status: str = "completed"  # Status for frontend compatibility

class StatementCreate(StatementBase):
    account_id: Optional[str] = None

class Statement(StatementBase):
    id: str
    user_id: str  # Computed from account.user_id for frontend
    account_id: str
    account_label: Optional[str] = None  # Computed field for API response
    account_institution: Optional[str] = None  # Computed field for API response
    uploaded_at: datetime  # Map from upload_date for frontend compatibility
    upload_date: Optional[datetime] = None  # Database field
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    transactions_count: int = 0
    processed_at: Optional[datetime] = None  # For frontend compatibility
    positions_count: int = 0  # For frontend compatibility
    dividends_count: int = 0  # For frontend compatibility
    transaction_first_date: Optional[datetime] = None  # Map from start_date
    transaction_last_date: Optional[datetime] = None  # Map from end_date
    credit_volume: float = 0  # For frontend compatibility
    debit_volume: float = 0  # For frontend compatibility
    error_message: Optional[str] = None  # For frontend compatibility

    class Config:
        from_attributes = True
