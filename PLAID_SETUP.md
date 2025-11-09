# Plaid Integration Setup Guide

This guide will help you set up and configure the Plaid integration in your Portfolio Investments application for automatic bank account linking and transaction syncing.

## Table of Contents

- [Overview](#overview)
- [Getting Plaid API Credentials](#getting-plaid-api-credentials)
- [Configuration](#configuration)
- [Testing in Sandbox](#testing-in-sandbox)
- [Production Deployment](#production-deployment)
- [Usage](#usage)
- [Troubleshooting](#troubleshooting)

## Overview

The Plaid integration allows users to:
- Connect their bank accounts securely using Plaid Link
- Automatically sync transactions from checking, savings, credit card, and investment accounts
- View transaction sources (Manual, Plaid, or Import) in the Transactions page
- Manually trigger transaction syncs from the Account Management page
- Manage connected bank accounts (disconnect/reconnect)

### Architecture

- **Backend**: FastAPI with Plaid Python SDK
- **Frontend**: React with `react-plaid-link`
- **Database**: PostgreSQL (stores access tokens, account mappings, sync cursors)
- **Background Jobs**: Redis + RQ for asynchronous transaction syncing

## Getting Plaid API Credentials

### Step 1: Create a Plaid Account

1. Go to [Plaid Dashboard](https://dashboard.plaid.com/signup)
2. Sign up for a free account
3. Complete email verification

### Step 2: Get Your Credentials

1. Log in to the [Plaid Dashboard](https://dashboard.plaid.com/)
2. Navigate to **Team Settings** → **Keys**
3. You'll see your credentials for each environment:
   - **Sandbox**: For development and testing
   - **Development**: For internal testing with real credentials
   - **Production**: For live users

4. Copy the following credentials:
   - `client_id` (same across all environments)
   - `secret` (different for each environment)

### Step 3: Request Product Access (Optional)

By default, Sandbox has access to all products. For Production:

1. Go to **Team Settings** → **Product Access**
2. Request access to:
   - **Auth** (for account verification)
   - **Transactions** (for transaction data)

## Configuration

### Backend Configuration

1. **Environment Variables**

   Create or update your `.env` file in the backend directory:

   ```bash
   # Plaid Configuration
   PLAID_CLIENT_ID=your_client_id_here
   PLAID_SECRET=your_secret_here
   PLAID_ENVIRONMENT=sandbox  # Options: sandbox, development, production
   ```

2. **Verify Configuration**

   The configuration is automatically loaded from `backend/app/config.py`:

   ```python
   # Plaid configuration
   PLAID_CLIENT_ID: Optional[str] = None
   PLAID_SECRET: Optional[str] = None
   PLAID_ENVIRONMENT: str = "sandbox"
   PLAID_QUEUE_NAME: str = "plaid_sync"
   PLAID_JOB_TIMEOUT: int = 1800  # 30 minutes
   ```

3. **Install Dependencies**

   ```bash
   cd backend
   pip install -r requirements.txt
   ```

   This will install `plaid-python==20.0.0` and other dependencies.

### Frontend Configuration

1. **Install Dependencies**

   ```bash
   cd frontend
   npm install
   ```

   This will install `react-plaid-link` and other dependencies.

2. **No Frontend Environment Variables Needed**

   The frontend automatically fetches the link token from the backend, so no additional configuration is required.

### Database Migration

The database models are already set up. When you start the application, the following tables will be created automatically:

- `plaid_items` - Stores Plaid connections (access tokens, institution info)
- `plaid_accounts` - Maps Plaid accounts to your Account model
- `plaid_sync_cursors` - Stores sync cursors for incremental updates
- `accounts` - Extended with `is_plaid_linked` field
- `transactions` - Extended with `source` and `plaid_transaction_id` fields

## Testing in Sandbox

### Sandbox Test Credentials

Plaid provides test credentials for Sandbox mode. Use these when testing:

**Successful Connection:**
- Username: `user_good`
- Password: `pass_good`
- MFA Code: `1234` (if prompted)

**Other Test Scenarios:**
- `user_bad` / `pass_bad` - Invalid credentials error
- `user_custom` / `pass_good` - Allows custom test data

### Testing the Integration

1. **Start the Backend**

   ```bash
   cd backend
   python -m app.main
   ```

   The API will be available at `http://localhost:8000`

2. **Start the Redis Worker**

   In a separate terminal:

   ```bash
   cd backend
   rq worker plaid_sync --url redis://localhost:6379/0
   ```

3. **Start the Frontend**

   In another terminal:

   ```bash
   cd frontend
   npm run dev
   ```

   The app will be available at `http://localhost:5173`

4. **Test Account Linking**

   - Navigate to **Account Management**
   - Click **"Connect Bank Account"** (Plaid Link button)
   - Select any test institution (e.g., "Chase", "Bank of America")
   - Enter test credentials: `user_good` / `pass_good`
   - Select accounts to link
   - Verify accounts appear in the Account Management page

5. **Test Transaction Sync**

   - In Account Management, find your connected bank
   - Click **"Sync Now"**
   - Wait for the sync to complete
   - Navigate to **Transactions** page
   - Filter by Source = "Plaid" to see synced transactions

### Sandbox Limitations

- Sandbox transactions are synthetic/test data
- No real financial data is accessed
- Rate limits are more generous than Production
- Some features may behave differently than Production

## Production Deployment

### Step 1: Request Production Access

1. Log in to [Plaid Dashboard](https://dashboard.plaid.com/)
2. Complete your company profile
3. Navigate to **Team Settings** → **Product Access**
4. Request Production access for:
   - Transactions
   - Auth (if using account verification)
5. Wait for Plaid's approval (usually 1-2 business days)

### Step 2: Update Environment Variables

Update your production `.env` file:

```bash
PLAID_CLIENT_ID=your_production_client_id
PLAID_SECRET=your_production_secret
PLAID_ENVIRONMENT=production
```

### Step 3: Security Best Practices

1. **Encrypt Access Tokens**

   Consider encrypting Plaid access tokens at rest in your database. You can use:
   - AWS KMS
   - Database-level encryption
   - Application-level encryption (e.g., `cryptography` library)

2. **Secure Environment Variables**

   - Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
   - Never commit credentials to version control
   - Rotate secrets periodically

3. **Monitor API Usage**

   - Set up monitoring for Plaid API errors
   - Track rate limits in the Plaid Dashboard
   - Set up alerts for unusual activity

4. **HTTPS Only**

   - Ensure your application is served over HTTPS
   - Plaid requires HTTPS for Production webhooks

### Step 4: Set Up Webhooks (Optional but Recommended)

Webhooks enable automatic transaction updates without manual syncing.

1. **Configure Webhook URL** in the link token creation:

   Edit `backend/app/services/plaid_client.py`:

   ```python
   request = LinkTokenCreateRequest(
       user=LinkTokenCreateRequestUser(client_user_id=str(user_id)),
       client_name=client_name,
       products=[Products("transactions"), Products("auth")],
       country_codes=[CountryCode("US"), CountryCode("CA")],
       language="en",
       webhook="https://yourdomain.com/api/plaid/webhooks",  # Add this line
   )
   ```

2. **Create Webhook Endpoint**

   The webhook handler is already implemented in `backend/app/api/plaid.py`. You just need to expose it and handle the events in your background worker.

3. **Verify Webhook Signature** (Recommended)

   Implement webhook signature verification for security. See [Plaid's documentation](https://plaid.com/docs/api/webhooks/#webhook-verification).

### Step 5: Test in Production

1. Start with a small test group of users
2. Monitor error rates and sync success
3. Gradually roll out to all users

## Usage

### For End Users

#### Connecting a Bank Account

1. Navigate to **Account Management**
2. Click **"Connect Bank Account"**
3. Search for your bank in Plaid Link
4. Enter your online banking credentials
5. Select accounts to link
6. Confirm connection

#### Syncing Transactions

**Manual Sync:**
1. Go to **Account Management**
2. Find your connected bank
3. Click **"Sync Now"**
4. Wait for sync to complete

**Automatic Sync (if webhooks enabled):**
- Transactions sync automatically 1-4 times per day
- No manual action required

#### Viewing Transactions

1. Navigate to **Transactions** page
2. Use the **Source** filter to view:
   - **Manual**: Manually entered transactions
   - **Plaid**: Automatically synced from Plaid
   - **Import**: Imported from statement files

#### Disconnecting a Bank

1. Go to **Account Management**
2. Find your connected bank
3. Click **"Disconnect"**
4. Confirm disconnection
5. Note: This doesn't delete your accounts or transactions, only stops syncing

### For Developers

#### API Endpoints

All Plaid endpoints are under `/api/plaid`:

- `POST /api/plaid/create-link-token` - Get link token for Plaid Link
- `POST /api/plaid/exchange-token` - Exchange public token for access token
- `GET /api/plaid/items` - List connected Plaid items
- `POST /api/plaid/sync/{item_id}` - Trigger transaction sync
- `GET /api/plaid/sync-status/{job_id}` - Check sync job status
- `DELETE /api/plaid/disconnect/{item_id}` - Disconnect Plaid item

#### Database Schema

**PlaidItem:**
- Stores access token and item ID
- Links to user
- Tracks sync status and errors

**PlaidAccount:**
- Maps Plaid account to your Account model
- Stores account mask and name

**PlaidSyncCursor:**
- Stores cursor for incremental transaction updates
- One cursor per Plaid item

## Troubleshooting

### Common Issues

#### 1. "Plaid is not configured" Error

**Cause**: Missing or incorrect environment variables

**Solution**:
- Verify `PLAID_CLIENT_ID` and `PLAID_SECRET` are set in `.env`
- Restart the backend server after changing environment variables
- Check for typos in variable names

#### 2. Link Token Creation Fails

**Cause**: Invalid credentials or environment mismatch

**Solution**:
- Verify credentials in Plaid Dashboard
- Ensure `PLAID_ENVIRONMENT` matches your credentials (sandbox/development/production)
- Check Plaid Dashboard for API errors

#### 3. Transactions Not Syncing

**Cause**: Multiple possible reasons

**Solution**:
- Check if Redis is running: `redis-cli ping` (should return "PONG")
- Check if RQ worker is running: `rq info --url redis://localhost:6379/0`
- Check job status: View job logs in RQ worker terminal
- Check Plaid Dashboard for API errors
- Verify the Plaid item status in database

#### 4. Duplicate Transactions

**Cause**: Transaction imported both manually and via Plaid

**Solution**:
- The system has duplicate detection logic
- Check if transactions have different timestamps or descriptions
- If duplicates persist, delete manual transactions for Plaid-linked accounts

#### 5. "Invalid Credentials" in Production

**Cause**: Using wrong credentials or environment

**Solution**:
- Verify you're using Production credentials (not Sandbox)
- Ensure `PLAID_ENVIRONMENT=production` in `.env`
- Check if bank requires re-authentication (happens periodically)

### Getting Help

1. **Plaid Documentation**: [https://plaid.com/docs/](https://plaid.com/docs/)
2. **Plaid Support**: [https://dashboard.plaid.com/support/new](https://dashboard.plaid.com/support/new)
3. **Application Logs**:
   - Backend: Check console output or log files
   - Frontend: Check browser console (F12 → Console)
4. **Plaid Dashboard**: Monitor API usage, errors, and webhooks

### Rate Limits

**Sandbox:**
- Generous limits for testing
- Typically 200 requests per second

**Development:**
- Lower limits than Sandbox
- 1 request per second per endpoint

**Production:**
- Varies by plan
- Standard: 10 requests per second
- Monitor usage in Plaid Dashboard

### Support

For issues specific to this implementation:
1. Check application logs
2. Review this documentation
3. Check the Plaid Dashboard for API errors
4. Contact your development team

For Plaid-specific issues:
- Visit [Plaid Support](https://plaid.com/docs/support/)
- Check [Plaid Status Page](https://status.plaid.com/)

## Additional Resources

- [Plaid Quickstart Guide](https://plaid.com/docs/quickstart/)
- [Plaid API Reference](https://plaid.com/docs/api/)
- [Plaid Link Customization](https://plaid.com/docs/link/customization/)
- [Plaid Transactions Product](https://plaid.com/docs/transactions/)
- [Plaid Webhooks](https://plaid.com/docs/api/webhooks/)

---

**Last Updated**: 2025-01-09

**Integration Version**: 1.0.0
