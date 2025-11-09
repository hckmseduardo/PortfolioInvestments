# Database Migrations

This directory contains SQL migration scripts for the Portfolio Investments database.

## Running Migrations

### Manual PostgreSQL Migration

To run a migration manually:

```bash
# Connect to your PostgreSQL database
psql -h localhost -U your_username -d portfolio_investments

# Run the migration
\i migrations/001_add_entra_id_auth.sql

# Verify the migration
\d users
```

### Using psql Command Line

```bash
psql postgresql://user:password@host:port/database -f migrations/001_add_entra_id_auth.sql
```

### Using Environment Variables

```bash
# Set DATABASE_URL in your .env file
export $(cat .env | xargs)

# Extract connection details and run
psql $DATABASE_URL -f migrations/001_add_entra_id_auth.sql
```

## Available Migrations

### 001_add_entra_id_auth.sql
**Date:** 2025-11-09
**Description:** Adds Microsoft Entra ID authentication support

**Changes:**
- Makes `hashed_password` nullable for Entra-only users
- Adds `auth_provider` column (local, entra, hybrid)
- Adds Entra ID fields (`entra_id`, `entra_tenant_id`, etc.)
- Adds account linking fields
- Adds 2FA fields (if not already present)
- Creates indexes for performance

**Rollback:** See commented section at bottom of migration file

### 002_add_plaid_integration.sql
**Date:** 2025-11-09
**Description:** Adds Plaid bank account integration support

**Changes:**
- Adds `is_plaid_linked` column to accounts table
- Adds `source` and `plaid_transaction_id` columns to transactions table
- Creates `plaid_items` table for Plaid connections
- Creates `plaid_accounts` table for account mappings
- Creates `plaid_sync_cursors` table for incremental syncing
- Creates indexes for performance and deduplication

**Rollback:** See commented section at bottom of migration file

## Migration Status

Check which migrations have been applied:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;
```

## Best Practices

1. **Backup First:** Always backup your database before running migrations
   ```bash
   pg_dump -h localhost -U your_username portfolio_investments > backup_$(date +%Y%m%d).sql
   ```

2. **Test in Development:** Run migrations in development environment first

3. **Use Transactions:** All migrations are wrapped in BEGIN/COMMIT for safety

4. **Document Changes:** Each migration includes comments and descriptions

## Future: Alembic Integration

For automated migrations, we can integrate Alembic:

```bash
# Initialize Alembic (future enhancement)
alembic init alembic
alembic revision --autogenerate -m "Add Entra ID support"
alembic upgrade head
```
