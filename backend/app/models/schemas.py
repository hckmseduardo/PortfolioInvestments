from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from enum import Enum

class AccountType(str, Enum):
    # Depository accounts
    CHECKING = "checking"
    SAVINGS = "savings"
    MONEY_MARKET = "money_market"
    CD = "cd"
    CASH_MANAGEMENT = "cash_management"
    PREPAID = "prepaid"
    PAYPAL = "paypal"
    HSA = "hsa"
    EBT = "ebt"

    # Credit accounts
    CREDIT_CARD = "credit_card"

    # Loan accounts
    MORTGAGE = "mortgage"
    AUTO_LOAN = "auto_loan"
    STUDENT_LOAN = "student_loan"
    HOME_EQUITY = "home_equity"
    PERSONAL_LOAN = "personal_loan"
    BUSINESS_LOAN = "business_loan"
    LINE_OF_CREDIT = "line_of_credit"

    # Investment & Retirement accounts
    INVESTMENT = "investment"
    BROKERAGE = "brokerage"
    RETIREMENT_401K = "401k"
    RETIREMENT_403B = "403b"
    RETIREMENT_457B = "457b"
    RETIREMENT_529 = "529"
    IRA = "ira"
    ROTH_IRA = "roth_ira"
    SEP_IRA = "sep_ira"
    SIMPLE_IRA = "simple_ira"
    PENSION = "pension"
    STOCK_PLAN = "stock_plan"

    # Canadian retirement accounts
    TFSA = "tfsa"
    RRSP = "rrsp"
    RRIF = "rrif"
    RESP = "resp"
    RDSP = "rdsp"
    LIRA = "lira"

    # Other specialized accounts
    CRYPTO = "crypto"
    MUTUAL_FUND = "mutual_fund"
    ANNUITY = "annuity"
    LIFE_INSURANCE = "life_insurance"
    TRUST = "trust"

    # Catch-all
    OTHER = "other"

class TransactionType(str, Enum):
    MONEY_IN = "Money In"
    MONEY_OUT = "Money Out"

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

    # Plaid connection information
    is_plaid_linked: bool = False
    plaid_item_id: Optional[str] = None
    plaid_institution_name: Optional[str] = None

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
    # Plaid holdings metadata
    security_type: Optional[str] = None
    security_subtype: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    institution_price: Optional[float] = None
    price_as_of: Optional[datetime] = None
    sync_date: Optional[datetime] = None
    # Frontend compatibility fields
    price: Optional[float] = None  # Maps to institution_price for frontend
    has_live_price: bool = False  # Indicates if position has a valid price
    price_source: Optional[str] = None  # Source of the price (e.g., 'plaid', 'yfinance')

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
    source: str = "manual"  # Transaction source: manual, plaid, import
    # Plaid Personal Finance Category (PFC) fields
    pfc_primary: Optional[str] = None
    pfc_detailed: Optional[str] = None
    pfc_confidence: Optional[str] = None
    # Balance validation fields
    actual_balance: Optional[float] = None  # Balance from source (Plaid, statement, etc.)
    expected_balance: Optional[float] = None  # Calculated balance
    has_balance_inconsistency: bool = False  # Flag for inconsistency
    balance_discrepancy: Optional[float] = None  # Difference between expected and actual
    # Transaction ordering field
    import_sequence: Optional[int] = None  # Preserves order from import source

class TransactionCreate(TransactionBase):
    account_id: str

class Transaction(TransactionBase):
    id: str
    account_id: str
    running_balance: Optional[float] = None  # Computed field, not stored in DB

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
    confidence: Optional[float] = None  # Categorization confidence (0.0 to 1.0)
    suggested_category: Optional[str] = None  # AI-suggested category if different from current
    # Plaid Personal Finance Category (PFC) fields
    pfc_primary: Optional[str] = None
    pfc_detailed: Optional[str] = None
    pfc_confidence: Optional[str] = None

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

class MerchantMemoryBase(BaseModel):
    merchant_name: str
    category: str
    confidence: float = 1.0
    occurrence_count: int = 1

class MerchantMemory(MerchantMemoryBase):
    id: str
    user_id: str
    last_updated: datetime
    created_at: datetime

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
    transactions_created: int = 0  # Number of transactions successfully imported
    transactions_skipped: int = 0  # Number of transactions skipped/ignored
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
