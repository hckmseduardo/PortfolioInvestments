# PostgreSQL Migration Plan

## Overview

This document outlines the migration from JSON file-based storage to PostgreSQL database.

## Current Status

### ✅ Completed
1. **PostgreSQL Infrastructure**
   - Added PostgreSQL 16 to docker-compose.yml
   - Configured environment variables and health checks
   - Added dependencies: SQLAlchemy, psycopg2-binary, alembic

2. **Database Models**
   - Created SQLAlchemy ORM models in `backend/app/database/models.py`
   - Models for: User, Account, Position, Transaction, Dividend, Expense, Category, Statement, DashboardLayout
   - Proper foreign key relationships and cascading deletes
   - Enum types for AccountType and TransactionType

3. **Database Connection**
   - Created `backend/app/database/postgres_db.py` for connection management
   - Session management with context managers
   - Automatic table creation on startup

4. **Migration Utility**
   - Created `backend/app/database/migration.py`
   - Automatic migration from JSON to PostgreSQL on first user login
   - Preserves all data: users, accounts, positions, transactions, dividends, expenses, categories, statements
   - Tracks migration status with `migrated_from_json` timestamp
   - Idempotent: won't re-migrate already migrated users

5. **Database Service Layer**
   - Created `backend/app/database/db_service.py`
   - Unified interface that works with both JSON and PostgreSQL
   - Drop-in replacement for json_db with same API

6. **Configuration**
   - Updated `backend/app/config.py` with PostgreSQL settings
   - `DATABASE_URL` for PostgreSQL connection string
   - `LEGACY_DATA_PATH` for JSON files during migration
   - `use_postgres` property to check database type

7. **Application Lifecycle**
   - Updated `backend/app/main.py` with lifespan management
   - Initializes PostgreSQL on startup
   - Cleans up connections on shutdown

## Implementation Plan

### Phase 1: Core Infrastructure (DONE)
- ✅ Set up PostgreSQL in docker-compose
- ✅ Create SQLAlchemy models
- ✅ Implement database connection management
- ✅ Create migration utility
- ✅ Create unified database service layer

### Phase 2: Authentication Integration (IN PROGRESS)
- ✅ Created new auth endpoint with migration support (`auth_new.py`)
- ⏳ Replace old auth.py with new implementation
- ⏳ Test user login with automatic migration

### Phase 3: API Endpoints Migration (TODO)
Update all API endpoints to use the unified database service:
- ⏳ `backend/app/api/accounts.py`
- ⏳ `backend/app/api/positions.py`
- ⏳ `backend/app/api/transactions.py`
- ⏳ `backend/app/api/dividends.py`
- ⏳ `backend/app/api/expenses.py`
- ⏳ `backend/app/api/import_statements.py`
- ⏳ `backend/app/api/dashboard.py`

### Phase 4: Testing & Validation (TODO)
- ⏳ Test all endpoints with PostgreSQL
- ⏳ Verify data migration accuracy
- ⏳ Test performance improvements
- ⏳ Test concurrent access
- ⏳ Backward compatibility testing with JSON mode

### Phase 5: Production Deployment (TODO)
- ⏳ Update documentation
- ⏳ Create backup strategy
- ⏳ Set up database monitoring
- ⏳ Migration rollback plan

## How to Use

### For New Installations

1. Set environment variables in `.env`:
```bash
# PostgreSQL Configuration
DATABASE_URL=postgresql://portfolio_user:your_password@postgres:5432/portfolio
POSTGRES_DB=portfolio
POSTGRES_USER=portfolio_user
POSTGRES_PASSWORD=your_secure_password_here
```

2. Start with docker-compose:
```bash
docker-compose up --build
```

PostgreSQL will be used automatically.

### For Existing Installations (Migration)

1. **Backup your JSON data**:
```bash
cp -r backend/data backend/data_backup
```

2. **Add PostgreSQL configuration** to `.env`:
```bash
DATABASE_URL=postgresql://portfolio_user:your_password@localhost:5432/portfolio
LEGACY_DATA_PATH=./backend/data  # Path to your JSON files
```

3. **Start the services**:
```bash
docker-compose up --build
```

4. **Login to trigger migration**:
   - Login with your existing credentials
   - On first login, all your data will be automatically migrated from JSON to PostgreSQL
   - You'll see log messages confirming the migration
   - Subsequent logins will use PostgreSQL directly

5. **Verify migration**:
   - Check that all your accounts, transactions, and expenses are visible
   - The JSON files remain untouched (for backup purposes)

### Development Without Docker

1. **Start PostgreSQL**:
```bash
# Using docker
docker run --name portfolio-postgres \
  -e POSTGRES_DB=portfolio \
  -e POSTGRES_USER=portfolio_user \
  -e POSTGRES_PASSWORD=portfolio_pass \
  -p 5432:5432 \
  -v $(pwd)/backend/data:/app/legacy_data:ro \
  -d postgres:16-alpine
```

2. **Configure backend**:
```bash
cd backend
export DATABASE_URL="postgresql://portfolio_user:portfolio_pass@localhost:5432/portfolio"
export LEGACY_DATA_PATH="./data"
python -m uvicorn app.main:app --reload
```

## Database Schema

### Users Table
- `id` (PK, String)
- `email` (Unique, Indexed)
- `hashed_password`
- `created_at`
- `migrated_from_json` - Timestamp of when JSON data was migrated

### Accounts Table
- `id` (PK, String)
- `user_id` (FK to users, Indexed)
- `account_type` (Enum: investment, checking, savings, credit_card)
- `account_number`
- `institution`
- `balance`
- `label`
- `created_at`, `updated_at`

### Transactions Table
- `id` (PK, String)
- `account_id` (FK to accounts, Indexed)
- `date` (Indexed)
- `type` (Enum, Indexed)
- `ticker`, `quantity`, `price`
- `fees`, `total`
- `description`

### Expenses Table
- `id` (PK, String)
- `account_id` (FK to accounts, Indexed)
- `transaction_id` (FK to transactions, Nullable, Indexed)
- `date` (Indexed)
- `description`
- `amount`
- `category` (Indexed)
- `notes`

**Note**: The `transaction_id` foreign key enables manual category persistence across reimports.

### Additional Tables
- **positions**: Portfolio holdings
- **dividends**: Dividend income tracking
- **categories**: Expense categories
- **statements**: Uploaded statement metadata
- **dashboard_layouts**: User dashboard configurations

## Benefits of PostgreSQL

1. **Performance**
   - Indexed queries for fast lookups
   - Efficient joins and aggregations
   - Connection pooling

2. **Data Integrity**
   - Foreign key constraints
   - Transactions with ACID guarantees
   - Data validation at database level

3. **Scalability**
   - Handles thousands of transactions efficiently
   - Concurrent user access
   - Future-proof for multi-user scenarios

4. **Features**
   - Complex queries with SQL
   - Backup and restore capabilities
   - Database-level security

5. **Manual Category Persistence**
   - Foreign key relationship between expenses and transactions
   - Automatically preserves manual categorizations on reimport
   - No data loss when updating statements

## Rollback Plan

If issues arise, you can rollback to JSON mode:

1. Remove `DATABASE_URL` from environment variables
2. Restart the application
3. The system will automatically use JSON files

Your JSON data files are never deleted during migration, so they remain available as a backup.

## Next Steps

1. **Complete Phase 2**: Replace `auth.py` with `auth_new.py`
2. **Update All API Endpoints**: Modify each endpoint to use `get_db()` dependency
3. **Testing**: Comprehensive testing of migration and all operations
4. **Documentation**: Update README with PostgreSQL setup instructions
5. **Deploy**: Roll out to production with migration guide

## Technical Notes

### Migration Strategy
- **On First Login**: Automatic, transparent migration
- **Idempotent**: Safe to run multiple times
- **Non-Destructive**: JSON files remain untouched
- **Per-User**: Each user's data migrates independently

### Database Service Layer
The `DatabaseService` class provides a unified interface:
- Same methods as JSONDatabase: `insert()`, `find()`, `find_one()`, `update()`, `delete()`
- Automatically converts between dictionaries and SQLAlchemy models
- Handles enum conversions
- Manages timestamps

### Connection Management
- FastAPI dependency injection handles session lifecycle
- Automatic commit on success, rollback on error
- Connection pooling for efficiency
- Health checks ensure database availability

## Troubleshooting

### Migration Fails
- Check logs: `docker-compose logs backend`
- Verify JSON files exist in `LEGACY_DATA_PATH`
- Check PostgreSQL is running: `docker-compose ps postgres`
- Verify database credentials

### Connection Issues
- Ensure PostgreSQL container is healthy
- Check `DATABASE_URL` format
- Verify network connectivity
- Check firewall settings

### Performance Issues
- Add database indexes (already included)
- Enable connection pooling
- Monitor query performance
- Consider database tuning

## Support

For issues or questions:
1. Check logs: `docker-compose logs`
2. Verify configuration in `.env`
3. Review this migration guide
4. Check database connectivity: `docker-compose exec postgres pg_isready`
