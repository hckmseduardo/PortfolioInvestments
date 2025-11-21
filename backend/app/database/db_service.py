"""
Database Service Layer - PostgreSQL interface
"""
from typing import List, Optional, Dict, Any, Union
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import and_
import uuid
import logging

from app.database.models import (
    User as UserModel, Account as AccountModel, Position as PositionModel,
    Transaction as TransactionModel, Dividend as DividendModel,
    Expense as ExpenseModel, Category as CategoryModel,
    Statement as StatementModel, DashboardLayout as DashboardLayoutModel,
    StockPrice as StockPriceModel,
    InstrumentType as InstrumentTypeModel,
    InstrumentIndustry as InstrumentIndustryModel,
    InstrumentMetadata as InstrumentMetadataModel,
    MerchantMemory as MerchantMemoryModel,
    UserCategorizationRule as UserCategorizationRuleModel,
    PlaidAuditLog as PlaidAuditLogModel,
    AccountTypeEnum, TransactionTypeEnum
)

logger = logging.getLogger(__name__)

# Collection to model mapping
COLLECTION_MODEL_MAP = {
    "users": UserModel,
    "accounts": AccountModel,
    "positions": PositionModel,
    "transactions": TransactionModel,
    "dividends": DividendModel,
    "cashflow": ExpenseModel,
    "categories": CategoryModel,
    "statements": StatementModel,
    "dashboard_layouts": DashboardLayoutModel,
    "price_cache": StockPriceModel,
    "instrument_types": InstrumentTypeModel,
    "instrument_industries": InstrumentIndustryModel,
    "instrument_metadata": InstrumentMetadataModel,
    "merchant_memory": MerchantMemoryModel,
    "user_categorization_rules": UserCategorizationRuleModel,
    "plaid_audit_logs": PlaidAuditLogModel
}


class DatabaseService:
    """Database service for PostgreSQL operations."""

    def __init__(self, session: Session):
        """
        Initialize database service.

        Args:
            session: SQLAlchemy session (required)
        """
        if session is None:
            raise ValueError("Session is required")
        self.session = session

    def _model_to_dict(self, model_instance) -> Dict[str, Any]:
        """Convert SQLAlchemy model instance to dictionary."""
        if model_instance is None:
            return None

        result = {}
        for column in model_instance.__table__.columns:
            value = getattr(model_instance, column.name)
            # Convert datetime to ISO format string
            if isinstance(value, datetime):
                value = value.isoformat()
            # Convert enums to string
            elif hasattr(value, 'value'):
                value = value.value
            result[column.name] = value
        return result

    def _build_query_filters(self, model_class, query: Dict[str, Any]):
        """Build SQLAlchemy filter conditions from query dict."""
        filters = []
        for key, value in query.items():
            if hasattr(model_class, key):
                filters.append(getattr(model_class, key) == value)
        return filters

    def insert(self, collection: str, document: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a document into the collection."""
        model_class = COLLECTION_MODEL_MAP.get(collection)
        if not model_class:
            raise ValueError(f"Unknown collection: {collection}")

        # Add ID if not present
        if 'id' not in document:
            document['id'] = str(uuid.uuid4())

        # Add created_at timestamp only if the model has this field
        if 'created_at' not in document and hasattr(model_class, 'created_at'):
            document['created_at'] = datetime.utcnow()

        # Convert enum strings to enum types (case-insensitive)
        if collection == "accounts" and 'account_type' in document:
            account_type_value = document['account_type']
            if isinstance(account_type_value, str):
                account_type_value = account_type_value.lower()
            document['account_type'] = AccountTypeEnum(account_type_value)
        elif collection == "transactions" and 'type' in document:
            type_value = document['type']
            # TransactionTypeEnum values are title case ("Money In", "Money Out")
            document['type'] = TransactionTypeEnum(type_value)

        # Create model instance
        instance = model_class(**document)
        self.session.add(instance)
        self.session.flush()

        return self._model_to_dict(instance)

    def find(self, collection: str, query: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Find documents matching the query."""
        model_class = COLLECTION_MODEL_MAP.get(collection)
        if not model_class:
            raise ValueError(f"Unknown collection: {collection}")

        q = self.session.query(model_class)

        if query:
            filters = self._build_query_filters(model_class, query)
            if filters:
                q = q.filter(and_(*filters))

        results = q.all()
        return [self._model_to_dict(r) for r in results]

    def find_one(self, collection: str, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Find the first document matching the query."""
        model_class = COLLECTION_MODEL_MAP.get(collection)
        if not model_class:
            raise ValueError(f"Unknown collection: {collection}")

        q = self.session.query(model_class)
        filters = self._build_query_filters(model_class, query)

        if filters:
            q = q.filter(and_(*filters))

        result = q.first()
        return self._model_to_dict(result) if result else None

    def update(self, collection: str, document_id_or_query: Union[str, Dict[str, Any]],
               update_data: Dict[str, Any] = None) -> int:
        """Update documents matching the query."""
        if update_data is None:
            raise ValueError("update_data is required")

        model_class = COLLECTION_MODEL_MAP.get(collection)
        if not model_class:
            raise ValueError(f"Unknown collection: {collection}")

        # Build query
        if isinstance(document_id_or_query, str):
            query = {"id": document_id_or_query}
        else:
            query = document_id_or_query

        q = self.session.query(model_class)
        filters = self._build_query_filters(model_class, query)

        if filters:
            q = q.filter(and_(*filters))

        # Add updated_at timestamp
        if 'updated_at' not in update_data and hasattr(model_class, 'updated_at'):
            update_data['updated_at'] = datetime.utcnow()

        # Convert enum strings
        if collection == "accounts" and 'account_type' in update_data:
            update_data['account_type'] = AccountTypeEnum(update_data['account_type'])
        elif collection == "transactions" and 'type' in update_data:
            update_data['type'] = TransactionTypeEnum(update_data['type'])

        count = q.update(update_data, synchronize_session=False)
        self.session.flush()

        return count

    def delete(self, collection: str, document_id_or_query: Union[str, Dict[str, Any]]) -> int:
        """Delete documents matching the query."""
        model_class = COLLECTION_MODEL_MAP.get(collection)
        if not model_class:
            raise ValueError(f"Unknown collection: {collection}")

        # Build query
        if isinstance(document_id_or_query, str):
            query = {"id": document_id_or_query}
        else:
            query = document_id_or_query

        q = self.session.query(model_class)
        filters = self._build_query_filters(model_class, query)

        if filters:
            q = q.filter(and_(*filters))

        count = q.delete(synchronize_session=False)
        self.session.flush()

        return count

    def delete_many(self, collection: str, query: Dict[str, Any]) -> int:
        """Delete multiple documents matching the query."""
        return self.delete(collection, query)

    def count(self, collection: str, query: Optional[Dict[str, Any]] = None) -> int:
        """Count documents matching the query."""
        return len(self.find(collection, query))


def get_db_service(session: Session) -> DatabaseService:
    """
    Get database service instance.

    Args:
        session: SQLAlchemy session (required)

    Returns:
        DatabaseService instance
    """
    return DatabaseService(session)
