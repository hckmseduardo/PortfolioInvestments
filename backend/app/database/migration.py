"""
JSON to PostgreSQL Migration Utility

Automatically migrates data from JSON files to PostgreSQL on first user login.
"""
import json
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any
from sqlalchemy.orm import Session

from app.database.models import (
    User, Account, Position, Transaction, Dividend,
    Expense, Category, Statement, DashboardLayout,
    AccountTypeEnum, TransactionTypeEnum
)

logger = logging.getLogger(__name__)


class JSONToPostgresMigration:
    """Handles migration from JSON files to PostgreSQL."""

    def __init__(self, json_db_path: str, db_session: Session):
        """
        Initialize the migration utility.

        Args:
            json_db_path: Path to directory containing JSON files
            db_session: SQLAlchemy database session
        """
        self.json_db_path = Path(json_db_path)
        self.db = db_session

    def _read_json_file(self, filename: str) -> List[Dict[str, Any]]:
        """Read and parse a JSON file."""
        file_path = self.json_db_path / filename
        if not file_path.exists():
            logger.warning(f"JSON file not found: {file_path}")
            return []

        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except Exception as e:
            logger.error(f"Error reading {filename}: {e}")
            return []

    def _parse_datetime(self, date_str: Any) -> datetime:
        """Parse datetime from various formats."""
        if isinstance(date_str, datetime):
            return date_str

        if not date_str:
            return datetime.utcnow()

        if isinstance(date_str, str):
            # Try multiple formats
            for fmt in ['%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d']:
                try:
                    return datetime.strptime(date_str, fmt)
                except ValueError:
                    continue

        return datetime.utcnow()

    def check_if_user_migrated(self, email: str) -> bool:
        """
        Check if a user's data has already been migrated.

        Args:
            email: User's email address

        Returns:
            True if user was already migrated, False otherwise
        """
        user = self.db.query(User).filter(User.email == email).first()
        return user is not None and user.migrated_from_json is not None

    def migrate_user_data(self, email: str) -> Dict[str, int]:
        """
        Migrate all data for a specific user from JSON to PostgreSQL.

        Args:
            email: User's email address

        Returns:
            Dictionary with counts of migrated records
        """
        logger.info(f"Starting migration for user: {email}")

        stats = {
            "users": 0,
            "accounts": 0,
            "positions": 0,
            "transactions": 0,
            "dividends": 0,
            "expenses": 0,
            "categories": 0,
            "statements": 0,
            "dashboard_layouts": 0
        }

        try:
            # Find user in JSON
            users_json = self._read_json_file("users.json")
            user_json = next((u for u in users_json if u.get("email") == email), None)

            if not user_json:
                logger.warning(f"User {email} not found in JSON files")
                return stats

            user_id = user_json.get("id")

            # Check if user already exists in PostgreSQL
            existing_user = self.db.query(User).filter(User.id == user_id).first()

            if existing_user:
                if existing_user.migrated_from_json:
                    logger.info(f"User {email} already migrated")
                    return stats

                # User exists but wasn't migrated yet - just mark as migrated
                existing_user.migrated_from_json = datetime.utcnow()
                user_db = existing_user
                logger.info(f"Marking existing user {email} as migrated")
            else:
                # Create new user
                user_db = User(
                    id=user_id,
                    email=user_json.get("email"),
                    hashed_password=user_json.get("hashed_password"),
                    created_at=self._parse_datetime(user_json.get("created_at")),
                    migrated_from_json=datetime.utcnow()
                )
                self.db.add(user_db)
                stats["users"] = 1
                logger.info(f"Created new user {email}")

            self.db.flush()  # Get user ID

            # Migrate accounts
            accounts_json = self._read_json_file("accounts.json")
            user_accounts = [a for a in accounts_json if a.get("user_id") == user_id]

            for acc_json in user_accounts:
                if not self.db.query(Account).filter(Account.id == acc_json.get("id")).first():
                    account = Account(
                        id=acc_json.get("id"),
                        user_id=user_id,
                        account_type=AccountTypeEnum(acc_json.get("account_type", "checking")),
                        account_number=acc_json.get("account_number", ""),
                        institution=acc_json.get("institution", ""),
                        balance=float(acc_json.get("balance", 0.0)),
                        label=acc_json.get("label"),
                        created_at=self._parse_datetime(acc_json.get("created_at")),
                        updated_at=self._parse_datetime(acc_json.get("updated_at"))
                    )
                    self.db.add(account)
                    stats["accounts"] += 1

            self.db.flush()

            # Migrate positions
            positions_json = self._read_json_file("positions.json")
            for pos_json in positions_json:
                acc_id = pos_json.get("account_id")
                if acc_id in [a.get("id") for a in user_accounts]:
                    if not self.db.query(Position).filter(Position.id == pos_json.get("id")).first():
                        position = Position(
                            id=pos_json.get("id"),
                            account_id=acc_id,
                            ticker=pos_json.get("ticker", ""),
                            name=pos_json.get("name", ""),
                            quantity=float(pos_json.get("quantity", 0.0)),
                            book_value=float(pos_json.get("book_value", 0.0)),
                            market_value=float(pos_json.get("market_value", 0.0)),
                            last_updated=self._parse_datetime(pos_json.get("last_updated"))
                        )
                        self.db.add(position)
                        stats["positions"] += 1

            # Migrate transactions
            transactions_json = self._read_json_file("transactions.json")
            for txn_json in transactions_json:
                acc_id = txn_json.get("account_id")
                if acc_id in [a.get("id") for a in user_accounts]:
                    if not self.db.query(Transaction).filter(Transaction.id == txn_json.get("id")).first():
                        transaction = Transaction(
                            id=txn_json.get("id"),
                            account_id=acc_id,
                            date=self._parse_datetime(txn_json.get("date")),
                            type=TransactionTypeEnum(txn_json.get("type", "withdrawal")),
                            ticker=txn_json.get("ticker"),
                            quantity=float(txn_json.get("quantity", 0.0)) if txn_json.get("quantity") else None,
                            price=float(txn_json.get("price", 0.0)) if txn_json.get("price") else None,
                            fees=float(txn_json.get("fees", 0.0)),
                            total=float(txn_json.get("total", 0.0)),
                            description=txn_json.get("description")
                        )
                        self.db.add(transaction)
                        stats["transactions"] += 1

            self.db.flush()

            # Migrate dividends
            dividends_json = self._read_json_file("dividends.json")
            for div_json in dividends_json:
                acc_id = div_json.get("account_id")
                if acc_id in [a.get("id") for a in user_accounts]:
                    if not self.db.query(Dividend).filter(Dividend.id == div_json.get("id")).first():
                        dividend = Dividend(
                            id=div_json.get("id"),
                            account_id=acc_id,
                            ticker=div_json.get("ticker", ""),
                            date=self._parse_datetime(div_json.get("date")),
                            amount=float(div_json.get("amount", 0.0)),
                            currency=div_json.get("currency", "CAD")
                        )
                        self.db.add(dividend)
                        stats["dividends"] += 1

            # Migrate expenses
            expenses_json = self._read_json_file("expenses.json")
            for exp_json in expenses_json:
                acc_id = exp_json.get("account_id")
                if acc_id in [a.get("id") for a in user_accounts]:
                    if not self.db.query(Expense).filter(Expense.id == exp_json.get("id")).first():
                        expense = Expense(
                            id=exp_json.get("id"),
                            account_id=acc_id,
                            transaction_id=exp_json.get("transaction_id"),
                            date=self._parse_datetime(exp_json.get("date")),
                            description=exp_json.get("description", ""),
                            amount=float(exp_json.get("amount", 0.0)),
                            category=exp_json.get("category"),
                            notes=exp_json.get("notes")
                        )
                        self.db.add(expense)
                        stats["expenses"] += 1

            # Migrate categories
            categories_json = self._read_json_file("categories.json")
            user_categories = [c for c in categories_json if c.get("user_id") == user_id]

            for cat_json in user_categories:
                if not self.db.query(Category).filter(Category.id == cat_json.get("id")).first():
                    category = Category(
                        id=cat_json.get("id"),
                        user_id=user_id,
                        name=cat_json.get("name", ""),
                        type=cat_json.get("type", "expense"),
                        color=cat_json.get("color", "#4CAF50"),
                        budget_limit=float(cat_json.get("budget_limit")) if cat_json.get("budget_limit") else None
                    )
                    self.db.add(category)
                    stats["categories"] += 1

            # Migrate statements
            statements_json = self._read_json_file("statements.json")
            for stmt_json in statements_json:
                acc_id = stmt_json.get("account_id")
                if acc_id in [a.get("id") for a in user_accounts]:
                    if not self.db.query(Statement).filter(Statement.id == stmt_json.get("id")).first():
                        statement = Statement(
                            id=stmt_json.get("id"),
                            account_id=acc_id,
                            filename=stmt_json.get("filename", ""),
                            upload_date=self._parse_datetime(stmt_json.get("upload_date")),
                            start_date=self._parse_datetime(stmt_json.get("start_date")) if stmt_json.get("start_date") else None,
                            end_date=self._parse_datetime(stmt_json.get("end_date")) if stmt_json.get("end_date") else None,
                            file_type=stmt_json.get("file_type", ""),
                            transactions_count=int(stmt_json.get("transactions_count", 0))
                        )
                        self.db.add(statement)
                        stats["statements"] += 1

            # Migrate dashboard layouts
            layouts_json = self._read_json_file("dashboard_layouts.json")
            user_layouts = [l for l in layouts_json if l.get("user_id") == user_id]

            for layout_json in user_layouts:
                if not self.db.query(DashboardLayout).filter(DashboardLayout.id == layout_json.get("id")).first():
                    layout = DashboardLayout(
                        id=layout_json.get("id"),
                        user_id=user_id,
                        layout_data=json.dumps(layout_json.get("layout_data", {})),
                        created_at=self._parse_datetime(layout_json.get("created_at")),
                        updated_at=self._parse_datetime(layout_json.get("updated_at"))
                    )
                    self.db.add(layout)
                    stats["dashboard_layouts"] += 1

            # Commit all changes
            self.db.commit()
            logger.info(f"Migration completed for user {email}: {stats}")

            return stats

        except Exception as e:
            self.db.rollback()
            logger.error(f"Migration failed for user {email}: {e}", exc_info=True)
            raise


def migrate_user_on_login(email: str, json_db_path: str, db_session: Session) -> bool:
    """
    Migrate user data from JSON to PostgreSQL on login if not already migrated.

    Args:
        email: User's email address
        json_db_path: Path to JSON database files
        db_session: SQLAlchemy database session

    Returns:
        True if migration was performed, False if already migrated or no data found
    """
    migrator = JSONToPostgresMigration(json_db_path, db_session)

    # Check if already migrated
    if migrator.check_if_user_migrated(email):
        logger.debug(f"User {email} already migrated")
        return False

    # Perform migration
    try:
        stats = migrator.migrate_user_data(email)
        total_records = sum(stats.values())

        if total_records > 0:
            logger.info(f"Successfully migrated {total_records} records for user {email}")
            return True
        else:
            logger.info(f"No data to migrate for user {email}")
            return False

    except Exception as e:
        logger.error(f"Failed to migrate user {email}: {e}")
        raise
