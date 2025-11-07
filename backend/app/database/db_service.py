"""
Database Service Layer - Unified interface for both JSON and PostgreSQL
"""
from typing import List, Optional, Dict, Any, Union
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
import uuid
import logging

from app.config import settings
from app.database.models import (
    User as UserModel, Account as AccountModel, Position as PositionModel,
    Transaction as TransactionModel, Dividend as DividendModel,
    Expense as ExpenseModel, Category as CategoryModel,
    Statement as StatementModel, DashboardLayout as DashboardLayoutModel,
    StockPrice as StockPriceModel,
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
    "expenses": ExpenseModel,
    "categories": CategoryModel,
    "statements": StatementModel,
    "dashboard_layouts": DashboardLayoutModel,
    "price_cache": StockPriceModel
}


class DatabaseService:
    """Unified database service that works with both JSON and PostgreSQL."""

    def __init__(self, session: Optional[Session] = None):
        """
        Initialize database service.

        Args:
            session: SQLAlchemy session (required if using PostgreSQL)
        """
        self.use_postgres = settings.use_postgres
        self.session = session

        if self.use_postgres and session is None:
            raise ValueError("Session required when using PostgreSQL")

        if not self.use_postgres:
            from app.database.json_db import JSONDatabase
            self.json_db = JSONDatabase(settings.DATABASE_PATH)

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
        if not self.use_postgres:
            return self.json_db.insert(collection, document)

        model_class = COLLECTION_MODEL_MAP.get(collection)
        if not model_class:
            raise ValueError(f"Unknown collection: {collection}")

        # Add ID if not present
        if 'id' not in document:
            document['id'] = str(uuid.uuid4())

        # Add created_at timestamp only if the model has this field
        if 'created_at' not in document and hasattr(model_class, 'created_at'):
            document['created_at'] = datetime.utcnow()

        # Convert enum strings to enum types
        if collection == "accounts" and 'account_type' in document:
            document['account_type'] = AccountTypeEnum(document['account_type'])
        elif collection == "transactions" and 'type' in document:
            document['type'] = TransactionTypeEnum(document['type'])

        # Create model instance
        instance = model_class(**document)
        self.session.add(instance)
        self.session.flush()

        return self._model_to_dict(instance)

    def find(self, collection: str, query: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Find documents matching the query."""
        if not self.use_postgres:
            return self.json_db.find(collection, query)

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
        if not self.use_postgres:
            return self.json_db.find_one(collection, query)

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
        if not self.use_postgres:
            return self.json_db.update(collection, document_id_or_query, update_data)

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
        if not self.use_postgres:
            return self.json_db.delete(collection, document_id_or_query)

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
        if not self.use_postgres:
            return self.json_db.count(collection, query)

        return len(self.find(collection, query))


def get_db_service(session: Optional[Session] = None) -> DatabaseService:
    """
    Get database service instance.

    Args:
        session: SQLAlchemy session (required if using PostgreSQL)

    Returns:
        DatabaseService instance
    """
    return DatabaseService(session)
