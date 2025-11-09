#!/usr/bin/env python3
"""
One-time migration script to import data from JSON files to PostgreSQL.
This script reads all JSON data files and imports them into the PostgreSQL database.
"""

import json
import sys
from pathlib import Path
from datetime import datetime
from sqlalchemy.orm import Session

# Add app to path
sys.path.insert(0, str(Path(__file__).parent))

from app.database.postgres_db import get_db_context
from app.database.db_service import get_db_service
from app.config import settings

# JSON data directory
DATA_DIR = Path(__file__).parent / "data"

# Collections to migrate (in order due to foreign key dependencies)
COLLECTIONS = [
    "users",
    "accounts",
    "categories",
    "instrument_types",
    "instrument_industries",
    "instrument_metadata",
    "positions",
    "transactions",
    "dividends",
    "expenses",
    "statements",
    "dashboard_layouts",
]

def read_json_file(filename: str):
    """Read a JSON file and return its contents."""
    filepath = DATA_DIR / filename
    if not filepath.exists():
        print(f"  ⚠️  File not found: {filename}")
        return []

    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except json.JSONDecodeError as e:
        print(f"  ❌ Error reading {filename}: {e}")
        return []

def parse_datetime(value):
    """Parse datetime string to datetime object."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value

    # Try different datetime formats
    for fmt in [
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]:
        try:
            return datetime.strptime(value, fmt)
        except (ValueError, TypeError):
            continue

    # If all else fails, try ISO format
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except:
        return None

def migrate_collection(db, session, collection_name: str, records: list) -> int:
    """Migrate a collection of records to PostgreSQL."""
    migrated = 0
    skipped = 0

    for record in records:
        try:
            # Convert datetime fields
            if 'created_at' in record and isinstance(record['created_at'], str):
                record['created_at'] = parse_datetime(record['created_at'])
            if 'updated_at' in record and isinstance(record['updated_at'], str):
                record['updated_at'] = parse_datetime(record['updated_at'])
            if 'date' in record and isinstance(record['date'], str):
                record['date'] = parse_datetime(record['date'])
            if 'transaction_date' in record and isinstance(record['transaction_date'], str):
                record['transaction_date'] = parse_datetime(record['transaction_date'])

            # Fix password field name if present
            if 'password_hash' in record:
                record['hashed_password'] = record.pop('password_hash')

            # Remove fields not in the models
            fields_to_remove = []

            # Users: no updated_at
            if collection_name == 'users':
                fields_to_remove = ['updated_at']

            # Categories, Positions: no created_at, no updated_at
            elif collection_name in ['categories', 'positions']:
                fields_to_remove = ['created_at', 'updated_at']

            # Transactions: no created_at, no statement_id, no amount, no is_credit
            elif collection_name == 'transactions':
                fields_to_remove = ['created_at', 'statement_id', 'amount', 'is_credit']
                # Map interest type to bonus (not in TransactionTypeEnum)
                if record.get('type') == 'interest':
                    record['type'] = 'bonus'

            # Expenses: no created_at, no updated_at
            elif collection_name == 'expenses':
                fields_to_remove = ['created_at', 'updated_at']

            # Dividends: no created_at, no statement_id
            elif collection_name == 'dividends':
                fields_to_remove = ['created_at', 'statement_id']

            # Statements: field renaming and cleanup
            elif collection_name == 'statements':
                fields_to_remove = ['created_at', 'updated_at', 'file_size',
                                   'status', 'user_id', 'positions_count', 'dividends_count',
                                   'processed_at', 'error_message', 'credit_volume', 'debit_volume']
                # Rename fields to match model
                if 'uploaded_at' in record:
                    record['upload_date'] = record.pop('uploaded_at')
                if 'transaction_first_date' in record:
                    record['start_date'] = record.pop('transaction_first_date')
                if 'transaction_last_date' in record:
                    record['end_date'] = record.pop('transaction_last_date')

            # Dashboard layouts: serialize layout_data to JSON string
            elif collection_name == 'dashboard_layouts':
                fields_to_remove = ['created_at', 'updated_at']
                if 'layout_data' in record and isinstance(record['layout_data'], dict):
                    record['layout_data'] = json.dumps(record['layout_data'])

            # Instrument types, industries, metadata: no created_at, no updated_at
            elif collection_name in ['instrument_types', 'instrument_industries', 'instrument_metadata']:
                fields_to_remove = ['created_at', 'updated_at']

            # Remove unwanted fields
            for field in fields_to_remove:
                if field in record:
                    del record[field]

            # Check if record already exists
            existing = db.find_one(collection_name, {"id": record["id"]})
            if existing:
                print(f"    ⏭️  Skipping existing {collection_name} record: {record.get('id', 'unknown')}")
                skipped += 1
                continue

            # Insert the record
            db.insert(collection_name, record)
            session.flush()  # Flush but don't commit yet
            migrated += 1

        except Exception as e:
            session.rollback()  # Rollback this record's transaction
            print(f"    ❌ Error migrating {collection_name} record {record.get('id', 'unknown')}: {str(e)[:100]}")
            # Continue to next record
            continue

    return migrated, skipped

def main():
    """Main migration function."""
    print("=" * 70)
    print("JSON to PostgreSQL Migration")
    print("=" * 70)
    print(f"Database URL: {settings.DATABASE_URL[:50]}...")
    print(f"Data directory: {DATA_DIR}")
    print()

    # Check if data directory exists
    if not DATA_DIR.exists():
        print(f"❌ Data directory not found: {DATA_DIR}")
        return 1

    total_migrated = 0
    total_skipped = 0

    with get_db_context() as session:
        db = get_db_service(session)

        for collection_name in COLLECTIONS:
            filename = f"{collection_name}.json"
            print(f"📁 Processing {collection_name}...")

            # Read JSON file
            records = read_json_file(filename)

            if not records:
                print(f"  ⚠️  No records found in {filename}")
                continue

            print(f"  📊 Found {len(records)} records")

            # Migrate records
            migrated, skipped = migrate_collection(db, session, collection_name, records)
            total_migrated += migrated
            total_skipped += skipped

            if migrated > 0:
                print(f"  ✅ Migrated {migrated} records")
            if skipped > 0:
                print(f"  ⏭️  Skipped {skipped} existing records")

            # Commit after each collection
            try:
                session.commit()
                print(f"  💾 Committed {collection_name}")
            except Exception as e:
                session.rollback()
                print(f"  ❌ Error committing {collection_name}: {e}")

            print()

        # Final summary
        print("=" * 70)
        print(f"✅ Migration completed!")
        print(f"   Total migrated: {total_migrated} records")
        print(f"   Total skipped: {total_skipped} records")
        print("=" * 70)

    return 0

if __name__ == "__main__":
    sys.exit(main())
