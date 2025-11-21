# Plaid Investment Product Support

## Problem

Not all financial institutions support Plaid's `investments` product. For example:
- ✅ **Wealthsimple**: Supports both `transactions` and `investments`
- ✅ **TD**: Supports both `transactions` and `investments`
- ❌ **National Bank of Canada**: Only supports `transactions` (NOT investments)

If you request the `investments` product for an institution that doesn't support it, the connection will fail with "Connectivity not supported".

## Solution

We use a **two-step approach**:

### Step 1: Initial Connection (Transactions Only)
- When users first connect their bank, we request only the `transactions` product
- This ensures compatibility with ALL institutions
- Users can connect National Bank of Canada, TD, Wealthsimple, etc.

### Step 2: Enable Investments (Optional Upgrade)
- After successful connection, check if the institution supports `investments`
- For institutions that support it, offer an "Enable Investment Tracking" button
- This uses Plaid's **Update Mode** to add the `investments` product
- The user goes through Plaid Link again to grant investment access

## How It Works

### Initial Connection
```python
# Link token for initial connection
products = [Products("transactions")]  # Transactions only
```

### Upgrade to Investments
```python
# Link token for upgrading existing connection
products = [Products("transactions"), Products("investments")]  # Both products
access_token = existing_plaid_item.access_token  # Existing connection
```

## API Endpoints

### Check Institution Support
```bash
GET /api/plaid/institution/{institution_id}/products
```

Returns:
```json
{
  "institution_id": "ins_48",
  "name": "National Bank of Canada",
  "products": ["transactions", "auth", "balance"],
  "supports_transactions": true,
  "supports_investments": false
}
```

### Enable Investments for Existing Connection
```bash
POST /api/plaid/update-link-token/{plaid_item_id}
```

Returns a link token in update mode to add investments product.

## UI Implementation

### Account Management Page

For each connected bank account, show:

```jsx
{account.is_plaid_linked && (
  <div>
    {account.supports_investments ? (
      account.has_investments_enabled ? (
        <Badge>Investment Tracking Enabled</Badge>
      ) : (
        <Button onClick={() => enableInvestments(account.plaid_item_id)}>
          Enable Investment Tracking
        </Button>
      )
    ) : (
      <Tooltip content="This institution doesn't support investment tracking">
        <Badge variant="secondary">Transactions Only</Badge>
      </Tooltip>
    )}
  </div>
)}
```

### Implementation Steps

1. **After User Connects Bank** (in `exchange-token` callback):
   ```python
   # Save institution_id from metadata
   plaid_item.institution_id = metadata['institution']['institution_id']

   # Check if institution supports investments
   inst_info = plaid_client.check_institution_products(institution_id)
   plaid_item.supports_investments = inst_info['supports_investments']
   ```

2. **"Enable Investment Tracking" Button Click**:
   ```javascript
   async function enableInvestments(plaidItemId) {
     // Get update mode link token
     const response = await fetch(`/api/plaid/update-link-token/${plaidItemId}`)
     const { link_token } = await response.json()

     // Open Plaid Link in update mode
     const plaid = Plaid.create({
       token: link_token,
       onSuccess: async () => {
         // Mark investments as enabled
         await fetch(`/api/plaid/items/${plaidItemId}/enable-investments`, {
           method: 'POST'
         })
         // Trigger investment holdings sync
         await fetch(`/api/plaid/sync/${plaidItemId}`, { method: 'POST' })
       }
     })
     plaid.open()
   }
   ```

3. **Automatic Investment Sync**:
   - After investments enabled, the sync job will automatically fetch:
     - Investment transactions (buys, sells, dividends)
     - Current holdings (stocks, ETFs, mutual funds)
     - Cash positions

## Database Schema Updates

Add to `PlaidItem` model:
```python
supports_investments = Column(Boolean, default=False)
investments_enabled = Column(Boolean, default=False)
investments_enabled_at = Column(DateTime, nullable=True)
```

## Benefits

✅ **Universal Compatibility**: Works with all institutions
✅ **Progressive Enhancement**: Users can opt-in to investment tracking
✅ **Better UX**: Clear communication about what's supported
✅ **Flexible**: Easy to add new products in the future

## Example Institutions

| Institution | Transactions | Investments | Notes |
|-------------|-------------|-------------|-------|
| National Bank of Canada | ✅ | ❌ | Transactions only |
| Wealthsimple | ✅ | ✅ | Full support |
| TD Bank | ✅ | ✅ | Full support |
| RBC | ✅ | ✅ | Full support |
| Scotiabank | ✅ | ✅ | Full support |
| CIBC | ✅ | ✅ | Full support |

## Testing

### Test with National Bank of Canada
1. Connect account → Should succeed (transactions only)
2. Click "Enable Investment Tracking" → Should show "Not supported" message

### Test with Wealthsimple
1. Connect account → Should succeed (transactions only)
2. Click "Enable Investment Tracking" → Should open Plaid Link
3. Re-authenticate → Should succeed
4. Investment holdings should sync automatically

---

**Last Updated**: 2025-01-18
