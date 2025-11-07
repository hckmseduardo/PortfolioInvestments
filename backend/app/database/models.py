"""
SQLAlchemy ORM Models for PostgreSQL
"""
from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Text, Enum as SQLEnum, Integer
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

Base = declarative_base()


class AccountTypeEnum(str, enum.Enum):
    INVESTMENT = "investment"
    CHECKING = "checking"
    SAVINGS = "savings"
    CREDIT_CARD = "credit_card"


class TransactionTypeEnum(str, enum.Enum):
    BUY = "buy"
    SELL = "sell"
    DIVIDEND = "dividend"
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    FEE = "fee"
    BONUS = "bonus"
    TRANSFER = "transfer"
    TAX = "tax"


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    migrated_from_json = Column(DateTime, nullable=True)  # Track when data was migrated

    # Relationships
    accounts = relationship("Account", back_populates="user", cascade="all, delete-orphan")
    categories = relationship("Category", back_populates="user", cascade="all, delete-orphan")
    dashboard_layouts = relationship("DashboardLayout", back_populates="user", cascade="all, delete-orphan")


class Account(Base):
    __tablename__ = "accounts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    account_type = Column(SQLEnum(AccountTypeEnum), nullable=False)
    account_number = Column(String, nullable=False)
    institution = Column(String, nullable=False)
    balance = Column(Float, nullable=False, default=0.0)
    label = Column(String, nullable=True)
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
    ticker = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    book_value = Column(Float, nullable=False)
    market_value = Column(Float, nullable=False)
    last_updated = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    account = relationship("Account", back_populates="positions")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(String, primary_key=True)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(DateTime, nullable=False, index=True)
    type = Column(SQLEnum(TransactionTypeEnum), nullable=False, index=True)
    ticker = Column(String, nullable=True)
    quantity = Column(Float, nullable=True)
    price = Column(Float, nullable=True)
    fees = Column(Float, default=0.0, nullable=False)
    total = Column(Float, nullable=False)
    description = Column(Text, nullable=True)

    # Relationships
    account = relationship("Account", back_populates="transactions")
    expense = relationship("Expense", back_populates="transaction", uselist=False)


class Dividend(Base):
    __tablename__ = "dividends"

    id = Column(String, primary_key=True)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    ticker = Column(String, nullable=False, index=True)
    date = Column(DateTime, nullable=False, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String, default="CAD", nullable=False)

    # Relationships
    account = relationship("Account", back_populates="dividends")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(String, primary_key=True)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    transaction_id = Column(String, ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True, index=True)
    date = Column(DateTime, nullable=False, index=True)
    description = Column(Text, nullable=False)
    amount = Column(Float, nullable=False)
    category = Column(String, nullable=True, index=True)
    notes = Column(Text, nullable=True)

    # Relationships
    account = relationship("Account", back_populates="expenses")
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


class Statement(Base):
    __tablename__ = "statements"

    id = Column(String, primary_key=True)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String, nullable=False)
    upload_date = Column(DateTime, default=datetime.utcnow, nullable=False)
    start_date = Column(DateTime, nullable=True)
    end_date = Column(DateTime, nullable=True)
    file_type = Column(String, nullable=False)
    transactions_count = Column(Integer, default=0, nullable=False)

    # Relationships
    account = relationship("Account", back_populates="statements")


class DashboardLayout(Base):
    __tablename__ = "dashboard_layouts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    layout_data = Column(Text, nullable=False)  # JSON string
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, onupdate=datetime.utcnow, nullable=True)

    # Relationships
    user = relationship("User", back_populates="dashboard_layouts")


class StockPrice(Base):
    __tablename__ = "price_cache"

    id = Column(String, primary_key=True)
    ticker = Column(String, nullable=False, index=True)
    date = Column(DateTime, nullable=False, index=True)  # Date at midnight UTC for historical, or exact timestamp for current
    price = Column(Float, nullable=False)
    is_current = Column(Integer, default=0, nullable=False)  # 1 for current prices, 0 for historical (closed days)
    cached_at = Column(DateTime, default=datetime.utcnow, nullable=False)  # When this price was cached

    __table_args__ = (
        # Unique constraint on ticker + date combination
        # This ensures we don't store duplicate prices for the same ticker on the same date
        {'sqlite_autoincrement': True}
    )
