"""
SQLAlchemy ORM Models for PostgreSQL
"""
from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Text, Enum as SQLEnum, Integer, Boolean, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

Base = declarative_base()


class AccountTypeEnum(str, enum.Enum):
    # Depository accounts (checking, savings, etc.)
    CHECKING = "checking"
    SAVINGS = "savings"
    MONEY_MARKET = "money_market"
    CD = "cd"  # Certificate of Deposit
    CASH_MANAGEMENT = "cash_management"
    PREPAID = "prepaid"
    PAYPAL = "paypal"
    HSA = "hsa"  # Health Savings Account
    EBT = "ebt"  # Electronic Benefits Transfer

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
    INVESTMENT = "investment"  # Generic investment/brokerage
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


class TransactionTypeEnum(str, enum.Enum):
    BUY = "BUY"
    SELL = "SELL"
    DIVIDEND = "DIVIDEND"
    DEPOSIT = "DEPOSIT"
    WITHDRAWAL = "WITHDRAWAL"
    FEE = "FEE"
    BONUS = "BONUS"
    TRANSFER = "TRANSFER"
    TAX = "TAX"
    INTEREST = "INTEREST"


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=True)  # Nullable for Entra-only users
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Authentication provider tracking
    auth_provider = Column(String, default="local", nullable=False)  # "local", "entra", "hybrid"

    # Microsoft Entra ID fields
    entra_id = Column(String, unique=True, nullable=True, index=True)  # Azure AD Object ID
    entra_tenant_id = Column(String, nullable=True)
    entra_email_verified = Column(Boolean, default=False, nullable=False)
    entra_linked_at = Column(DateTime, nullable=True)

    # Account linking
    account_linked = Column(Boolean, default=False, nullable=False)  # Traditional account linked to Entra
    linked_at = Column(DateTime, nullable=True)

    # Two-Factor Authentication (for local auth)
    two_factor_enabled = Column(Boolean, default=False, nullable=False)
    two_factor_secret = Column(String, nullable=True)
    two_factor_backup_codes = Column(Text, nullable=True)  # JSON array stored as text

    # Relationships
    accounts = relationship("Account", back_populates="user", cascade="all, delete-orphan")
    categories = relationship("Category", back_populates="user", cascade="all, delete-orphan")
    merchant_memories = relationship("MerchantMemory", back_populates="user", cascade="all, delete-orphan")
    dashboard_layouts = relationship("DashboardLayout", back_populates="user", cascade="all, delete-orphan")


class Account(Base):
    __tablename__ = "accounts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    account_type = Column(SQLEnum(AccountTypeEnum, values_callable=lambda x: [e.value for e in x]), nullable=False)
    account_number = Column(String, nullable=False)
    institution = Column(String, nullable=False)
    balance = Column(Float, nullable=False, default=0.0)
    label = Column(String, nullable=True)
    is_plaid_linked = Column(Integer, default=0, nullable=False)  # 0 = not linked, 1 = linked
    opening_balance = Column(Float, nullable=True)  # Starting balance before oldest transaction
    opening_balance_date = Column(DateTime, nullable=True)  # Date of the opening balance
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, onupdate=datetime.utcnow, nullable=True)

    # Relationships
    user = relationship("User", back_populates="accounts")
    positions = relationship("Position", back_populates="account", cascade="all, delete-orphan")
    transactions = relationship("Transaction", back_populates="account", cascade="all, delete-orphan")
    dividends = relationship("Dividend", back_populates="account", cascade="all, delete-orphan")
    expenses = relationship("Expense", back_populates="account", cascade="all, delete-orphan")
    statements = relationship("Statement", back_populates="account", cascade="all, delete-orphan")


class Position(Base):
    __tablename__ = "positions"

    id = Column(String, primary_key=True)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    # NOTE: statement_id is deprecated and should not be used
    # Positions are account-wide and represent cumulative state, not per-statement
    # This field is kept for backward compatibility but should always be NULL
    statement_id = Column(String, ForeignKey("statements.id", ondelete="CASCADE"), nullable=True, index=True)
    ticker = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    book_value = Column(Float, nullable=False)
    market_value = Column(Float, nullable=False)
    last_updated = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Plaid holdings metadata
    security_type = Column(String(50), nullable=True)  # equity, etf, cryptocurrency, etc.
    security_subtype = Column(String(50), nullable=True)  # common stock, preferred, etc.
    sector = Column(String(100), nullable=True)  # Finance, Communications, Technology, etc.
    industry = Column(String(100), nullable=True)  # Major Banks, Major Telecommunications, etc.
    institution_price = Column(Float, nullable=True)  # Price from financial institution
    price_as_of = Column(DateTime, nullable=True)  # Date when institution price was captured
    sync_date = Column(DateTime, nullable=True)  # Date when position was last synced from Plaid

    # Frontend compatibility fields
    price = Column(Float, nullable=True)  # Current price (maps to institution_price for Plaid positions)
    has_live_price = Column(Boolean, default=False, nullable=True)  # Whether position has a valid price
    price_source = Column(String(50), nullable=True)  # Source of price (e.g., 'plaid', 'yfinance')

    # Relationships
    account = relationship("Account", back_populates="positions")
    statement = relationship("Statement", back_populates="positions")


class PositionSnapshot(Base):
    """Historical snapshots of positions for tracking portfolio changes over time"""
    __tablename__ = "position_snapshots"

    id = Column(String, primary_key=True)
    position_id = Column(String, nullable=True)  # Reference to current position (can be NULL for deleted positions)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    ticker = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    book_value = Column(Float, nullable=False)
    market_value = Column(Float, nullable=False)

    # Plaid holdings metadata
    security_type = Column(String(50), nullable=True)
    security_subtype = Column(String(50), nullable=True)
    sector = Column(String(100), nullable=True)
    industry = Column(String(100), nullable=True)
    institution_price = Column(Float, nullable=True)
    price_as_of = Column(DateTime, nullable=True)

    # Snapshot metadata
    snapshot_date = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    account = relationship("Account")


# Create composite index for querying snapshots by account and date
Index('ix_position_snapshots_account_date', PositionSnapshot.account_id, PositionSnapshot.snapshot_date.desc())


class SecurityType(Base):
    """Security types (equity, etf, cryptocurrency, etc.) with customizable display"""
    __tablename__ = "security_types"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    color = Column(String(7), default="#808080", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class SecuritySubtype(Base):
    """Security subtypes (common stock, preferred, etc.) with customizable display"""
    __tablename__ = "security_subtypes"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    color = Column(String(7), default="#808080", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class Sector(Base):
    """Economic sectors (Finance, Technology, etc.) with customizable display"""
    __tablename__ = "sectors"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    color = Column(String(7), default="#808080", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class Industry(Base):
    """Industries (Major Banks, Software, etc.) with customizable display"""
    __tablename__ = "industries"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    color = Column(String(7), default="#808080", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class SecurityMetadataOverride(Base):
    """User-defined overrides for security metadata that persist across syncs"""
    __tablename__ = "security_metadata_overrides"
    __table_args__ = (
        Index('ix_security_overrides_ticker', 'ticker'),
    )

    id = Column(String, primary_key=True)
    ticker = Column(String, nullable=False)
    security_name = Column(String, nullable=False)
    custom_type = Column(String(50), nullable=True)
    custom_subtype = Column(String(50), nullable=True)
    custom_sector = Column(String(100), nullable=True)
    custom_industry = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(String, primary_key=True)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    statement_id = Column(String, ForeignKey("statements.id", ondelete="CASCADE"), nullable=True, index=True)
    date = Column(DateTime, nullable=False, index=True)
    type = Column(SQLEnum(TransactionTypeEnum), nullable=False, index=True)
    ticker = Column(String, nullable=True)
    quantity = Column(Float, nullable=True)
    price = Column(Float, nullable=True)
    fees = Column(Float, default=0.0, nullable=False)
    total = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    source = Column(String, default="manual", nullable=False, index=True)  # manual, plaid, import
    plaid_transaction_id = Column(String, nullable=True, unique=True, index=True)  # Plaid's transaction ID for deduplication

    # Plaid Personal Finance Category (PFC) fields
    pfc_primary = Column(String(100), nullable=True, index=True)  # e.g., FOOD_AND_DRINK, TRANSPORTATION
    pfc_detailed = Column(String(100), nullable=True, index=True)  # e.g., FOOD_AND_DRINK_GROCERIES
    pfc_confidence = Column(String(20), nullable=True)  # VERY_HIGH, HIGH, MEDIUM, LOW, UNKNOWN

    # Balance validation fields
    actual_balance = Column(Float, nullable=True)  # Balance from source (Plaid, statement, etc.)
    expected_balance = Column(Float, nullable=True)  # Calculated balance
    has_balance_inconsistency = Column(Boolean, default=False, nullable=False)  # Flag for inconsistency
    balance_discrepancy = Column(Float, nullable=True)  # Difference between expected and actual

    # Transaction ordering field
    import_sequence = Column(Integer, nullable=True)  # Preserves order from import source (Plaid, statement)

    # Relationships
    account = relationship("Account", back_populates="transactions")
    statement = relationship("Statement", back_populates="transactions")
    expense = relationship("Expense", back_populates="transaction", uselist=False)


class Dividend(Base):
    __tablename__ = "dividends"

    id = Column(String, primary_key=True)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    statement_id = Column(String, ForeignKey("statements.id", ondelete="CASCADE"), nullable=True, index=True)
    ticker = Column(String, nullable=False, index=True)
    date = Column(DateTime, nullable=False, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String, default="CAD", nullable=False)

    # Relationships
    account = relationship("Account", back_populates="dividends")
    statement = relationship("Statement", back_populates="dividends")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(String, primary_key=True)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    statement_id = Column(String, ForeignKey("statements.id", ondelete="CASCADE"), nullable=True, index=True)
    transaction_id = Column(String, ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True, index=True)
    date = Column(DateTime, nullable=False, index=True)
    description = Column(Text, nullable=False)
    amount = Column(Float, nullable=False)
    category = Column(String, nullable=True, index=True)
    notes = Column(Text, nullable=True)

    # LLM-enhanced categorization fields
    confidence = Column(Float, nullable=True)  # Categorization confidence (0.0 to 1.0)
    suggested_category = Column(String, nullable=True)  # AI-suggested category if different from current

    # Transfer pair tracking fields
    paired_transaction_id = Column(String, nullable=True, index=True)  # ID of the paired transaction in a transfer
    paired_account_id = Column(String, nullable=True, index=True)  # Account ID of the paired side of the transfer
    is_transfer_primary = Column(Boolean, default=True)  # True if this is the primary expense record for a transfer pair

    # Plaid Personal Finance Category (PFC) fields
    pfc_primary = Column(String(100), nullable=True, index=True)  # e.g., FOOD_AND_DRINK, TRANSPORTATION
    pfc_detailed = Column(String(100), nullable=True, index=True)  # e.g., FOOD_AND_DRINK_GROCERIES
    pfc_confidence = Column(String(20), nullable=True)  # VERY_HIGH, HIGH, MEDIUM, LOW, UNKNOWN

    # Relationships
    account = relationship("Account", back_populates="expenses")
    statement = relationship("Statement", back_populates="expenses")
    transaction = relationship("Transaction", back_populates="expense")


class Category(Base):
    __tablename__ = "categories"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)
    color = Column(String, nullable=False)
    budget_limit = Column(Float, nullable=True)

    # Relationships
    user = relationship("User", back_populates="categories")


class MerchantMemory(Base):
    """Stores learned categorization patterns for merchants based on user behavior."""
    __tablename__ = "merchant_memory"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    merchant_name = Column(String, nullable=False, index=True)  # Normalized merchant name
    category = Column(String, nullable=False)
    confidence = Column(Float, default=1.0)  # 0.0 to 1.0
    occurrence_count = Column(Integer, default=1)  # How many times user categorized this way
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="merchant_memories")

    # Composite index for fast lookups
    __table_args__ = (
        Index('idx_user_merchant', 'user_id', 'merchant_name'),
    )


class Statement(Base):
    __tablename__ = "statements"

    id = Column(String, primary_key=True)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)  # Full path to the uploaded file
    upload_date = Column(DateTime, default=datetime.utcnow, nullable=False)
    start_date = Column(DateTime, nullable=True)
    end_date = Column(DateTime, nullable=True)
    file_type = Column(String, nullable=False)
    transactions_count = Column(Integer, default=0, nullable=False)

    # Relationships
    account = relationship("Account", back_populates="statements")
    positions = relationship("Position", back_populates="statement", cascade="all, delete-orphan")
    transactions = relationship("Transaction", back_populates="statement", cascade="all, delete-orphan")
    dividends = relationship("Dividend", back_populates="statement", cascade="all, delete-orphan")
    expenses = relationship("Expense", back_populates="statement", cascade="all, delete-orphan")


class PlaidItem(Base):
    """Represents a Plaid Item (bank connection) for a user"""
    __tablename__ = "plaid_items"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    access_token = Column(String, nullable=False)  # Encrypted in production
    item_id = Column(String, nullable=False, unique=True, index=True)
    institution_id = Column(String, nullable=False)
    institution_name = Column(String, nullable=False)
    status = Column(String, default="active", nullable=False)  # active, error, disconnected
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_synced = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)

    # Relationships
    user = relationship("User", backref="plaid_items")
    plaid_accounts = relationship("PlaidAccount", back_populates="plaid_item", cascade="all, delete-orphan")
    sync_cursor = relationship("PlaidSyncCursor", back_populates="plaid_item", uselist=False, cascade="all, delete-orphan")


class PlaidAccount(Base):
    """Maps a Plaid account to our Account model"""
    __tablename__ = "plaid_accounts"

    id = Column(String, primary_key=True)
    plaid_item_id = Column(String, ForeignKey("plaid_items.id", ondelete="CASCADE"), nullable=False, index=True)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    plaid_account_id = Column(String, nullable=False, index=True)  # Plaid's account ID
    mask = Column(String, nullable=True)  # Last 4 digits
    name = Column(String, nullable=False)  # Account name from Plaid
    official_name = Column(String, nullable=True)
    type = Column(String, nullable=False)  # depository, credit, loan, investment
    subtype = Column(String, nullable=True)  # checking, savings, credit card, etc.
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    plaid_item = relationship("PlaidItem", back_populates="plaid_accounts")
    account = relationship("Account", backref="plaid_account")


class PlaidSyncCursor(Base):
    """Stores the sync cursor for incremental transaction updates"""
    __tablename__ = "plaid_sync_cursors"

    id = Column(String, primary_key=True)
    plaid_item_id = Column(String, ForeignKey("plaid_items.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    cursor = Column(String, nullable=False)
    last_sync = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    plaid_item = relationship("PlaidItem", back_populates="sync_cursor")


class DashboardLayout(Base):
    __tablename__ = "dashboard_layouts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    layout_data = Column(Text, nullable=False)  # JSON string
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, onupdate=datetime.utcnow, nullable=True)

    # Relationships
    user = relationship("User", back_populates="dashboard_layouts")


class InstrumentType(Base):
    __tablename__ = "instrument_types"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    color = Column(String, nullable=False)

    # Relationships
    user = relationship("User", backref="instrument_types")


class InstrumentIndustry(Base):
    __tablename__ = "instrument_industries"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    color = Column(String, nullable=False)

    # Relationships
    user = relationship("User", backref="instrument_industries")


class InstrumentMetadata(Base):
    __tablename__ = "instrument_metadata"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    ticker = Column(String, nullable=False, index=True)
    instrument_type_id = Column(String, ForeignKey("instrument_types.id", ondelete="SET NULL"), nullable=True)
    instrument_industry_id = Column(String, ForeignKey("instrument_industries.id", ondelete="SET NULL"), nullable=True)

    # Relationships
    user = relationship("User", backref="instrument_metadata")
    instrument_type = relationship("InstrumentType", backref="metadata")
    instrument_industry = relationship("InstrumentIndustry", backref="metadata")


class StockPrice(Base):
    __tablename__ = "price_cache"

    id = Column(String, primary_key=True)
    ticker = Column(String, nullable=False, index=True)
    date = Column(DateTime, nullable=False, index=True)  # Date at midnight UTC for historical, or exact timestamp for current
    price = Column(Float, nullable=False)
    is_current = Column(Integer, default=0, nullable=False)  # 1 for current prices, 0 for historical (closed days)
    cached_at = Column(DateTime, default=datetime.utcnow, nullable=False)  # When this price was cached
    source = Column(String, nullable=True)

    __table_args__ = (
        # Unique constraint on ticker + date combination
        # This ensures we don't store duplicate prices for the same ticker on the same date
        {'sqlite_autoincrement': True}
    )


class TickerMapping(Base):
    """
    Ticker symbol mapping table for resolving ticker symbols across different data sources.

    This table stores mappings between original ticker symbols (as they appear in user accounts)
    and the correct ticker symbols for various market data sources (Yahoo Finance, Alpha Vantage, etc.).
    """
    __tablename__ = "ticker_mappings"

    id = Column(String, primary_key=True)

    # Original ticker as it appears in the user's account/institution
    original_ticker = Column(String, nullable=False, index=True)

    # Mapped ticker symbol for the data source
    mapped_ticker = Column(String, nullable=False, index=True)

    # Data source this mapping applies to (yfinance, alpha_vantage, tradingview, etc.)
    # NULL means it applies to all sources
    data_source = Column(String, nullable=True, index=True)

    # Institution/broker where the original ticker came from (helps with context)
    institution = Column(String, nullable=True, index=True)

    # How this mapping was created: 'system', 'user', 'ollama', 'auto'
    mapped_by = Column(String, nullable=False, default='system')

    # Confidence score (0.0 - 1.0)
    confidence = Column(Float, nullable=False, default=1.0)

    # Status: 'active', 'deprecated', 'pending_verification'
    status = Column(String, nullable=False, default='active', index=True)

    # Additional mapping info (JSON stored as text) - e.g., reason for mapping, old ticker info
    mapping_metadata = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_verified = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, onupdate=datetime.utcnow, nullable=True)

    __table_args__ = (
        # Composite index for fast lookups
        Index('idx_ticker_mapping_lookup', 'original_ticker', 'data_source', 'institution'),
        {'sqlite_autoincrement': True}
    )
