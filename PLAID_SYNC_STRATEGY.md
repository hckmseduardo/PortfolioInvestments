# Plaid Sync Strategy

## Overview

The Plaid sync uses a **simplified upsert strategy** with **cleanup overlapping** to ensure Plaid data takes precedence over statement data.

## Core Strategy

### 1. **Upsert with plaid_transaction_id**
- **No duplicate detection** - Removed all fuzzy matching logic
- **Pure upsert**: If `plaid_transaction_id` exists → UPDATE, otherwise → INSERT
- **Reimport all**: Every sync updates existing Plaid transactions with latest data from Plaid API

### 2. **Cleanup Overlapping Transactions**
- After importing Plaid transactions, the system **deletes ALL non-Plaid transactions** on or after the first Plaid transaction date
- This ensures **Plaid data takes precedence** over statement imports for the covered period
- Statement data before the first Plaid transaction date remains untouched

## How It Works

### Example Scenario

**Initial State:**
- Statement transactions from Feb 2023 to Nov 2025 (482 transactions)
- No Plaid transactions

**After First Plaid Sync:**
1. Plaid imports 305 transactions from Aug 29, 2025 to Nov 20, 2025
2. First Plaid transaction date: **Aug 29, 2025**
3. Cleanup deletes **ALL non-Plaid transactions on or after Aug 29, 2025**
4. Statement transactions **before Aug 29, 2025** remain unchanged

**Result:**
- Statement transactions: Feb 2023 → Aug 28, 2025
- Plaid transactions: Aug 29, 2025 → Nov 20, 2025
- Balance: Correct ($2,453.84 from Plaid)

### On Subsequent Syncs

- Plaid updates existing transactions (by `plaid_transaction_id`)
- New Plaid transactions are inserted
- Cleanup runs again (usually no effect since non-Plaid transactions were already removed)

## Benefits

### ✓ Simple and Reliable
- No complex fuzzy matching
- No risk of false positives or false negatives
- Clear separation: Statement data (old) + Plaid data (new)

### ✓ Always Up-to-Date
- Every sync updates existing Plaid transactions
- Plaid description changes, category changes, etc. are reflected

### ✓ Clear Data Ownership
- **Plaid owns**: Transactions from first Plaid date onwards
- **Statement owns**: Historical transactions before Plaid coverage

## Code Changes

### Removed
- `is_duplicate()` method call in [plaid_sync.py](backend/app/tasks/plaid_sync.py:371-372)
- Fuzzy description matching
- Amount/date/description duplicate detection
- `duplicate_count` tracking (always 0 now)

### Kept
- Upsert logic with `plaid_transaction_id`
- Cleanup overlapping logic (`_cleanup_overlapping_transactions`)
- Balance validation and recalculation

## Configuration

No configuration needed. The strategy is hardcoded and works automatically:

1. **Import statement** → Creates statement transactions
2. **Run Plaid sync** → Imports Plaid transactions, removes overlapping statement transactions
3. **Balance validated** → Plaid current balance used as anchor

## Expected Behavior

### First Plaid Sync
```
Before: 482 statement transactions
After:  439 statement + 6 Plaid = 445 total
Removed: 43 statement transactions (overlapping with Plaid date range)
```

### Subsequent Syncs
```
Before: 439 statement + 6 Plaid = 445 total
After:  439 statement + 10 Plaid = 449 total (4 new Plaid transactions)
Removed: 0 (no overlapping non-Plaid transactions)
Updated: 6 (existing Plaid transactions refreshed)
```

## Troubleshooting

### If statement transactions are removed unexpectedly
This is **expected behavior**. The system assumes:
- Statements provide historical data (before Plaid coverage starts)
- Plaid provides current data (from first Plaid transaction onwards)
- **Plaid always wins** for the overlapping period

### If you want to keep statement data
**Solution**: Don't use Plaid, or only import statements for dates before Plaid coverage starts.

### If Plaid transaction descriptions look wrong
They will be **automatically updated** on the next sync. Plaid transaction data is refreshed every sync using the `plaid_transaction_id` as the key.

## Technical Details

### Files Modified
- [backend/app/tasks/plaid_sync.py](backend/app/tasks/plaid_sync.py:371-372) - Removed duplicate detection
- [backend/app/services/plaid_transaction_mapper.py](backend/app/services/plaid_transaction_mapper.py) - Duplicate detection methods remain but unused

### Cleanup Logic Location
- [backend/app/tasks/plaid_sync.py](backend/app/tasks/plaid_sync.py:1673-1752) - `_cleanup_overlapping_transactions()`

### Upsert Logic
- Lines 352-369: Check if `plaid_transaction_id` exists → UPDATE
- Lines 374-394: Otherwise → INSERT
