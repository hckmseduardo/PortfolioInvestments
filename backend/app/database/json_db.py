import json
import os
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid
from pathlib import Path

class JSONDatabase:
    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        self.db_path.mkdir(parents=True, exist_ok=True)
        
        self.collections = {
            'users': self.db_path / 'users.json',
            'accounts': self.db_path / 'accounts.json',
            'positions': self.db_path / 'positions.json',
            'transactions': self.db_path / 'transactions.json',
            'dividends': self.db_path / 'dividends.json',
            'expenses': self.db_path / 'expenses.json',
            'categories': self.db_path / 'categories.json',
            'statements': self.db_path / 'statements.json',
        }
        
        for collection_file in self.collections.values():
            if not collection_file.exists():
                self._write_file(collection_file, [])
    
    def _read_file(self, file_path: Path) -> List[Dict[str, Any]]:
        try:
            with open(file_path, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return []
    
    def _write_file(self, file_path: Path, data: List[Dict[str, Any]]):
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=2, default=str)
    
    def insert(self, collection: str, document: Dict[str, Any]) -> Dict[str, Any]:
        if collection not in self.collections:
            raise ValueError(f"Collection {collection} not found")
        
        file_path = self.collections[collection]
        data = self._read_file(file_path)
        
        if 'id' not in document:
            document['id'] = str(uuid.uuid4())
        
        if 'created_at' not in document:
            document['created_at'] = datetime.utcnow().isoformat()
        
        data.append(document)
        self._write_file(file_path, data)
        
        return document
    
    def find(self, collection: str, query: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        if collection not in self.collections:
            raise ValueError(f"Collection {collection} not found")
        
        file_path = self.collections[collection]
        data = self._read_file(file_path)
        
        if query is None:
            return data
        
        results = []
        for doc in data:
            match = True
            for key, value in query.items():
                if key not in doc or doc[key] != value:
                    match = False
                    break
            if match:
                results.append(doc)
        
        return results
    
    def find_one(self, collection: str, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        results = self.find(collection, query)
        return results[0] if results else None
    
    def update(self, collection: str, document_id_or_query, update_data: Dict[str, Any] = None) -> int:
        if collection not in self.collections:
            raise ValueError(f"Collection {collection} not found")
        
        if update_data is None:
            raise ValueError("update_data is required")
        
        if isinstance(document_id_or_query, str):
            query = {"id": document_id_or_query}
        else:
            query = document_id_or_query
        
        file_path = self.collections[collection]
        data = self._read_file(file_path)
        
        updated_count = 0
        for doc in data:
            match = True
            for key, value in query.items():
                if key not in doc or doc[key] != value:
                    match = False
                    break
            
            if match:
                doc.update(update_data)
                doc['updated_at'] = datetime.utcnow().isoformat()
                updated_count += 1
        
        if updated_count > 0:
            self._write_file(file_path, data)
        
        return updated_count
    
    def delete(self, collection: str, document_id_or_query) -> int:
        if collection not in self.collections:
            raise ValueError(f"Collection {collection} not found")
        
        if isinstance(document_id_or_query, str):
            query = {"id": document_id_or_query}
        else:
            query = document_id_or_query
        
        file_path = self.collections[collection]
        data = self._read_file(file_path)
        
        original_length = len(data)
        
        filtered_data = []
        for doc in data:
            match = True
            for key, value in query.items():
                if key not in doc or doc[key] != value:
                    match = False
                    break
            
            if not match:
                filtered_data.append(doc)
        
        deleted_count = original_length - len(filtered_data)
        
        if deleted_count > 0:
            self._write_file(file_path, filtered_data)
        
        return deleted_count
    
    def delete_many(self, collection: str, query: Dict[str, Any]) -> int:
        return self.delete(collection, query)
    
    def count(self, collection: str, query: Optional[Dict[str, Any]] = None) -> int:
        return len(self.find(collection, query))

db = None

def get_db() -> JSONDatabase:
    global db
    if db is None:
        from app.config import settings
        db = JSONDatabase(settings.DATABASE_PATH)
    return db
