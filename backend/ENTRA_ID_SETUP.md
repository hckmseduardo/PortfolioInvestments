# Microsoft Entra ID Authentication - Setup Guide

This guide walks you through setting up Microsoft Entra ID (Azure AD) authentication for the Portfolio Investments application.

## 🎯 What's Been Implemented

The following components have been added to support Microsoft Entra ID authentication:

### Backend Changes

1. **Database Schema** ([backend/app/database/models.py](backend/app/database/models.py:32-62))
   - Added Entra ID fields to User model
   - Made `hashed_password` nullable for Entra-only users
   - Added authentication provider tracking
   - Added 2FA fields to User model

2. **Migration Script** ([backend/migrations/001_add_entra_id_auth.sql](backend/migrations/001_add_entra_id_auth.sql))
   - SQL migration to add new columns
   - Includes rollback script
   - Creates necessary indexes

3. **Configuration** ([backend/app/config.py](backend/app/config.py:14-25))
   - Entra ID client credentials
   - Authentication strategy flags
   - Helper properties for Entra config

4. **Service Layer** ([backend/app/services/entra_auth.py](backend/app/services/entra_auth.py))
   - MSAL integration for OAuth flow
   - Token exchange and validation
   - Microsoft Graph API integration
   - Account linking logic

5. **API Endpoints** ([backend/app/api/auth_entra.py](backend/app/api/auth_entra.py))
   - `GET /api/auth/entra/login` - Initiate OAuth flow
   - `GET /api/auth/entra/callback` - Handle OAuth callback
   - `POST /api/auth/entra/link-account` - Link existing account
   - `POST /api/auth/entra/unlink-account` - Unlink Entra ID
   - `GET /api/auth/entra/status` - Check link status
   - `GET /api/auth/entra/config` - Get public config

6. **Schemas** ([backend/app/models/schemas.py](backend/app/models/schemas.py:34-53))
   - Updated User schema with Entra ID fields

7. **Dependencies** ([backend/requirements.txt](backend/requirements.txt:27-29))
   - `msal==1.26.0` - Microsoft Authentication Library
   - `cryptography==41.0.7` - Token validation

## 📋 Prerequisites

Before you begin, ensure you have:

1. **Azure Account** with permissions to create App Registrations
2. **PostgreSQL Database** (required for Entra ID auth)
3. **Access to Azure Portal** (https://portal.azure.com)

## 🚀 Step-by-Step Setup

### Step 1: Azure App Registration

1. **Navigate to Azure Portal**
   - Go to https://portal.azure.com
   - Sign in with your Azure account

2. **Create App Registration**
   - Navigate to: **Azure Active Directory** → **App registrations**
   - Click **+ New registration**
   - Fill in the details:
     - **Name**: `Portfolio Investments App`
     - **Supported account types**: Select based on your needs
       - `Accounts in this organizational directory only` (Single tenant)
       - `Accounts in any organizational directory` (Multi-tenant)
     - **Redirect URI**:
       - Platform: **Web**
       - URL: `http://localhost:3000/api/auth/entra/callback` (for development)

3. **Note Your IDs**
   After registration, copy these values (you'll need them later):
   - **Application (client) ID** - Found on the Overview page
   - **Directory (tenant) ID** - Found on the Overview page

4. **Create Client Secret**
   - Go to **Certificates & secrets** → **Client secrets**
   - Click **+ New client secret**
   - Description: `Portfolio App Secret`
   - Expires: Choose based on your security policy (24 months recommended)
   - Click **Add**
   - **IMPORTANT**: Copy the secret **Value** immediately (you can't see it again!)

5. **Configure API Permissions**
   - Go to **API permissions**
   - Click **+ Add a permission**
   - Select **Microsoft Graph** → **Delegated permissions**
   - Add these permissions:
     - `User.Read` - Read user profile
     - `email` - Read user email
     - `profile` - Read user profile
     - `openid` - OpenID Connect sign-in
   - Click **Add permissions**
   - (Optional) Click **Grant admin consent** if you have admin rights

6. **Configure Token Settings** (Optional but recommended)
   - Go to **Token configuration**
   - Click **+ Add optional claim**
   - Token type: **ID**
   - Add claims: `email`, `preferred_username`

### Step 2: Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

This will install:
- `msal==1.26.0` - Microsoft Authentication Library
- `cryptography==41.0.7` - Required for token validation

### Step 3: Database Migration

**IMPORTANT**: Backup your database before running migrations!

```bash
# Backup your database first
pg_dump -h localhost -U your_username portfolio > backup_$(date +%Y%m%d).sql

# Run the migration
psql postgresql://user:password@localhost:5432/portfolio -f migrations/001_add_entra_id_auth.sql

# Verify the migration
psql postgresql://user:password@localhost:5432/portfolio -c "\d users"
```

Expected output should show new columns:
- `auth_provider`
- `entra_id`
- `entra_tenant_id`
- `entra_email_verified`
- `entra_linked_at`
- `account_linked`
- `linked_at`
- `two_factor_enabled`
- `two_factor_secret`
- `two_factor_backup_codes`

### Step 4: Configure Environment Variables

Update your `.env` file with the values from Azure:

```bash
# Copy from .env.example if you don't have a .env file
cp .env.example .env

# Edit .env and add your Entra ID credentials
```

**Required Entra ID Settings:**

```env
# Microsoft Entra ID Configuration
ENTRA_CLIENT_ID=<your-application-client-id-from-azure>
ENTRA_CLIENT_SECRET=<your-client-secret-from-azure>
ENTRA_TENANT_ID=<your-tenant-id-from-azure>
ENTRA_REDIRECT_URI=http://localhost:3000/api/auth/entra/callback
ENTRA_SCOPES=User.Read,email,profile,openid

# Authentication Strategy
AUTH_ALLOW_TRADITIONAL=true   # Keep existing email/password login
AUTH_ALLOW_ENTRA=true         # Enable Entra ID login
AUTH_REQUIRE_ENTRA=false      # Don't force Entra (allow both methods)
```

**For Production**, update:
```env
ENTRA_REDIRECT_URI=https://yourdomain.com/api/auth/entra/callback
```

And add this URL to your Azure App Registration's redirect URIs.

### Step 5: Start the Server

```bash
# Make sure you're in the backend directory
cd backend

# Start the FastAPI server
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

You should see:
```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Step 6: Test the Integration

#### Test 1: Check Configuration

```bash
curl http://localhost:8000/api/auth/entra/config
```

Expected response:
```json
{
  "enabled": true,
  "configured": true,
  "traditional_auth_allowed": true,
  "entra_required": false,
  "tenant_id": "your-tenant-id"
}
```

#### Test 2: Initiate Login Flow

Visit in your browser:
```
http://localhost:8000/api/auth/entra/login
```

You should be redirected to Microsoft's login page.

#### Test 3: Complete Authentication

1. Sign in with your Microsoft account
2. Consent to the permissions
3. You'll be redirected back with a JWT token

### Step 7: Verify Database

Check that the user was created with Entra ID fields:

```sql
SELECT
    email,
    auth_provider,
    entra_id,
    entra_email_verified,
    account_linked
FROM users;
```

## 🔄 Authentication Flows

### Flow 1: New User (Entra ID Only)

1. User clicks "Sign in with Microsoft"
2. Redirected to `GET /api/auth/entra/login`
3. Microsoft login page appears
4. User authenticates and consents
5. Redirect to `GET /api/auth/entra/callback?code=...`
6. Backend creates new user with:
   - `auth_provider = "entra"`
   - `entra_id = <object-id>`
   - `hashed_password = NULL`
7. Returns JWT token

### Flow 2: Link Existing Account

1. User logged in with email/password
2. Clicks "Link Microsoft Account" in settings
3. Frontend calls `POST /api/auth/entra/link-account` with JWT
4. Backend returns authorization URL
5. User redirected to Microsoft login
6. After auth, callback updates user:
   - `auth_provider = "hybrid"`
   - `entra_id = <object-id>`
   - `account_linked = true`
   - `hashed_password` retained
7. User can now login with either method

### Flow 3: Hybrid User Login

User with linked account can:
- Login with email/password (traditional)
- Login with Microsoft (Entra ID)

Both methods authenticate the same user record.

## 🔐 Security Considerations

### State Parameter (CSRF Protection)

The OAuth flow uses a cryptographically random `state` parameter to prevent CSRF attacks. This is stored in-memory (use Redis for production multi-instance deployments).

### Token Validation

All Entra ID tokens are validated for:
- Valid signature from Microsoft
- Correct audience (your client ID)
- Correct issuer (your tenant)
- Not expired
- Contains required claims (oid, email)

### Email Matching

When linking accounts, the system validates that:
- Entra ID email matches user's email (case-insensitive)
- User doesn't already have an Entra ID linked
- Entra ID isn't already linked to another user

### Password Requirements for Unlinking

Users can only unlink their Entra ID if they have a local password set. This prevents users from being locked out.

## 📊 User Migration Strategies

### Strategy 1: Opt-In (Recommended)

Let users gradually adopt Entra ID:

1. Enable both auth methods: `AUTH_ALLOW_TRADITIONAL=true` and `AUTH_ALLOW_ENTRA=true`
2. Add "Sign in with Microsoft" button on login page
3. Add account linking in user settings
4. Monitor adoption rate
5. After 6-12 months, consider forcing migration

**Pros**: Low risk, user choice, easy rollback
**Cons**: Slower adoption, maintains two auth systems

### Strategy 2: Email-Based Auto-Linking

Automatically link accounts on first Entra login:

1. User signs in with Entra ID
2. If email exists in database:
   - Show confirmation dialog
   - Require password verification
   - Auto-link accounts

**Pros**: Faster migration, less user friction
**Cons**: Requires email verification, potential confusion

### Strategy 3: Forced Migration

After grace period, require Entra ID:

1. Set deadline (e.g., 6 months)
2. Email notifications at 30/60/90 days
3. In-app banners
4. After deadline: Set `AUTH_REQUIRE_ENTRA=true`
5. Block traditional login (except for admins)

**Pros**: Complete migration, single auth system
**Cons**: May lose users without Microsoft accounts

## 🛠️ Troubleshooting

### Error: "Microsoft Entra ID is not properly configured"

**Solution**: Check that all required environment variables are set:
```bash
echo $ENTRA_CLIENT_ID
echo $ENTRA_CLIENT_SECRET
echo $ENTRA_TENANT_ID
```

### Error: "Invalid redirect URI"

**Cause**: The redirect URI in your request doesn't match Azure configuration.

**Solution**:
1. Check `.env` file: `ENTRA_REDIRECT_URI`
2. Check Azure Portal → App Registration → Authentication
3. Make sure they match exactly (including http vs https)

### Error: "AADSTS50011: The reply URL specified in the request does not match"

**Solution**: Add the redirect URI to Azure:
1. Go to Azure Portal → App Registration → Authentication
2. Click "+ Add a platform" → Web
3. Add: `http://localhost:3000/api/auth/entra/callback`
4. Save

### Error: "Invalid or expired state parameter"

**Cause**: State was used or expired (10-minute timeout)

**Solution**:
1. Restart the auth flow
2. For production, use Redis to store state instead of in-memory

### Users can't link accounts: "Email mismatch"

**Cause**: Entra ID email doesn't match user's registered email

**Solution**:
1. Check user's email in database
2. Check Microsoft profile email
3. Update one to match the other
4. Retry linking

## 📝 Frontend Integration (Next Steps)

To complete the integration, you'll need to:

1. **Add Microsoft Sign-In Button**
   ```javascript
   const handleMicrosoftLogin = () => {
     window.location.href = 'http://localhost:8000/api/auth/entra/login';
   };
   ```

2. **Handle OAuth Callback**
   ```javascript
   // In your callback route component
   const params = new URLSearchParams(window.location.search);
   const token = params.get('access_token');
   if (token) {
     localStorage.setItem('token', token);
     navigate('/dashboard');
   }
   ```

3. **Add Account Linking UI**
   ```javascript
   const linkMicrosoftAccount = async () => {
     const token = localStorage.getItem('token');
     const response = await fetch(
       `/api/auth/entra/link-account?token=${token}`,
       { method: 'POST' }
     );
     const { authorization_url } = await response.json();
     window.location.href = authorization_url;
   };
   ```

4. **Show Auth Provider Badge**
   ```javascript
   const { auth_provider, entra_linked } = userData;
   // Display badge based on auth_provider: "local", "entra", or "hybrid"
   ```

## 🎉 Success Checklist

- [ ] Azure App Registration created
- [ ] Client ID, Secret, and Tenant ID copied
- [ ] Environment variables configured
- [ ] Database migration completed
- [ ] Dependencies installed
- [ ] Server starts without errors
- [ ] `/api/auth/entra/config` returns `configured: true`
- [ ] Can redirect to Microsoft login
- [ ] Can complete OAuth flow
- [ ] User created in database with `auth_provider = "entra"`
- [ ] Can link existing account
- [ ] Can unlink account (if password set)

## 📚 Additional Resources

- [Microsoft Entra ID Documentation](https://learn.microsoft.com/en-us/entra/identity/)
- [MSAL Python Documentation](https://msal-python.readthedocs.io/)
- [OAuth 2.0 Authorization Code Flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Microsoft Graph API](https://learn.microsoft.com/en-us/graph/)

## 🆘 Getting Help

If you encounter issues:

1. Check the logs: `tail -f backend/logs/app.log`
2. Enable debug mode in `.env`: `LOG_LEVEL=DEBUG`
3. Test with Azure's sample apps
4. Review Azure AD sign-in logs in Azure Portal

---

**Congratulations!** You've successfully set up Microsoft Entra ID authentication for your Portfolio Investments application.
