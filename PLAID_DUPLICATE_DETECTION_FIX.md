# Plaid Duplicate Detection Fix

## Problem Summary

After importing a statement file and running Plaid sync, 30 non-duplicate transactions were incorrectly removed as "duplicates" when they should not have been. Only 13 INTERAC e-Transfers were actual duplicates that should have been removed.

### Issues Identified

1. **Absolute Amount Matching**: The duplicate detector used `abs(plaid_txn['amount'])` which matched $200 Money In transactions with $200 Money Out transactions
2. **Overly Broad Description Matching**: Multiple loose matching rules caused unrelated transactions to be flagged as duplicates:
   - Substring matching: "INTERAC" matched any transaction containing "INTERAC"
   - Word subset matching: "Mortgage Payment" matched "Mortgage"
   - Low similarity threshold: 70-80% word similarity was too loose
   - Stripping parentheses: All "(Other)" suffixes were removed, making different transactions appear identical
3. **24-Hour Time Window**: Could match transactions from different calendar days

### Example of False Positive

Before the fix, these would be incorrectly flagged as duplicates:
- Plaid: "INTERAC e-Transfer (Other)" - $200 (Money In)
- Statement: "Mortgage Payment (Transfer)" - $200 (Money Out)

Why they matched (incorrectly):
- ✗ Absolute amount: abs(200) == abs(-200) = 200
- ✗ Same date (within 24-hour window)
- ✗ Description similarity after stripping parentheses

## Fixes Applied

### 1. Signed Amount Matching (Line 210-215, 232)

**Before:**
```python
amount = abs(plaid_txn['amount'])  # Uses absolute value
# ...
Transaction.total == amount or Transaction.total == -amount  # Matches both signs
```

**After:**
```python
plaid_amount = plaid_txn['amount']
our_amount = -plaid_amount  # Convert to our convention (negate)
# ...
Transaction.total == our_amount  # Exact signed match only
```

**Result**: Money In only matches Money In, Money Out only matches Money Out

### 2. Same-Day Matching (Lines 219-224)

**Before:**
```python
window_hours = 24
start_date = date - timedelta(hours=window_hours)
end_date = date + timedelta(hours=window_hours)
```

**After:**
```python
date_only = date.date() if isinstance(date, datetime) else date
start_of_day = datetime.combine(date_only, datetime.min.time())
end_of_day = datetime.combine(date_only, datetime.max.time())
```

**Result**: Only matches transactions on the exact same calendar date

### 3. Stricter Description Matching (Lines 342-404)

**Removed:**
- ✗ Substring matching: `if desc1 in desc2 or desc2 in desc1`
- ✗ Word subset matching: `if words_base1.issubset(words_base2)`
- ✗ Low threshold (70-80%) fallback matching

**Kept (with improvements):**
- ✓ Exact match
- ✓ Base description match after removing payment channel suffix like "(Online)", "(Other)"
- ✓ Very high similarity (95%+) for word-based matching

**Result**: Only near-identical descriptions are considered duplicates

## File Modified

- `backend/app/services/plaid_transaction_mapper.py`
  - `is_duplicate()` method (lines 180-248)
  - `_descriptions_match()` method (lines 342-404)

## Testing Recommendations

1. **Delete all Plaid transactions** from the BNC checking account
2. **Re-import the statement file** to get a clean baseline
3. **Run Plaid sync** again
4. **Verify results**:
   - Only 13 INTERAC e-Transfers should be removed (actual duplicates)
   - All other statement transactions (Mortgage, Mastercard, fees, etc.) should remain
   - Balance should match Plaid's current balance: $2,453.84

## Expected Outcome

### Before Fix
- ✗ 43 transactions removed (13 correct + 30 incorrect)
- ✗ Balance discrepancy of ~$24,000

### After Fix
- ✓ Only 13 transactions removed (all INTERAC e-Transfers)
- ✓ Balance matches Plaid: $2,453.84
- ✓ No false positives

## Additional Notes

### Why "(Other)" Appears in Descriptions

Plaid returns `payment_channel: "other"` for many transactions. The code appends this to descriptions:
- "INTERAC e-Transfer (Other)"
- "Mortgage Payment (Other)"

This is correct behavior. The fix ensures that these "(Other)" suffixes don't cause false duplicate matches.

### Transaction Sign Convention

- **Plaid API**: Positive = debit (money out), Negative = credit (money in)
- **Our System**: Positive = money in, Negative = money out
- **Conversion**: We negate Plaid's amount: `our_amount = -plaid_amount`

This is handled correctly in the code and should not be changed.
