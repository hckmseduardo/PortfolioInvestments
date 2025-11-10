# Investment Portfolio Management Platform

A comprehensive investment portfolio management platform that allows users to import and analyze their Wealthsimple statements, track account performance, and manage checking account expenses.

## Quick Links
- [Features](#features)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [API Documentation](#api-endpoints)
- [Monitoring](#monitoring--observability)
- [Troubleshooting](#troubleshooting)

## Features

- **Multi-Bank Statement Import & Processing**:
  - **Wealthsimple**: PDF, CSV, and Excel statements for investment and checking accounts
  - **Tangerine**: CSV and QFX/OFX formats for checking and savings accounts
  - **NBC (National Bank of Canada)**: CSV format for checking, savings, and credit card accounts
  - Automatic bank detection based on file format and content
- **Transaction Statements**: View and filter all imported transactions with date range filters (last 7 days, month to date, last month, year to date, last year, all time, or custom period)
- **Account Balance Tracking**: Real-time balance calculation based on transaction history
- **Portfolio Dashboard**: View all accounts, positions, and real-time performance metrics
- **Performance Analytics**: Track portfolio value, book value vs market value, and gain/loss over time
- **Asynchronous Quote Fetching**: Positions load instantly while live prices update in the background with multi-source fallbacks
- **Dividend Tracking**: Monitor dividend income by month and security with interactive charts
- **Advanced Expense Management**:
  - Convert checking and credit card transactions to expenses automatically
  - Smart transfer detection: Automatically identifies and excludes transfers between accounts
  - Credit card payment matching: Links payments from checking to credit card accounts
  - **Background expense conversion worker**: Imports now run asynchronously with live status updates
  - Smart auto-categorization with machine learning from your history
  - **Manual category persistence**: Manually assigned categories are preserved when reimporting statements
  - Inline category editing with color-coded tags
  - Visual color picker for category creation and editing
  - Custom category creation with budget limits, all categories can be edited/deleted
  - **Flexible time period filtering**: View expenses by current month, last month, specific month, quarters, or custom ranges
  - Monthly expense comparison with stacked charts
  - Category trend analysis over time
  - Accurate totals excluding inter-account transfers
- **Real-time Market Data**: Automatic price updates with configurable fallbacks (TradingView, Yahoo Finance, Alpha Vantage, TwelveData, Stooq)
- **Expanded Price Providers**: Alpha Vantage fallback plus TradingView, Stooq, and TwelveData (optional API keys) for improved Canadian coverage
- **🆕 PostgreSQL Migration**: Seamless migration from JSON to PostgreSQL with automatic data import on first login
- **Mobile-Optimized Interface**:
  - Responsive design for all screen sizes (desktop, tablet, mobile)
  - Touch-friendly interactions with smart double-tap filtering on pie charts
  - Mobile users can view tooltips before filtering (double-tap), desktop remains single-click
  - Optimized navigation and controls for mobile devices
- **Interactive Data Visualization**:
  - Clickable charts for dynamic filtering
  - Hover tooltips with detailed information
  - Time series analysis with custom date ranges
  - Drill-down capabilities on pie charts
  - Multi-dimensional data comparison
- **Export Capabilities**:
  - PDF reports with formatted data and charts
  - CSV exports for Excel compatibility
  - Excel spreadsheets with multiple sheets
  - Available across Portfolio, Transactions, Dividends, and Expenses pages

## Tech Stack

### Backend
- **FastAPI**: Modern Python web framework
- **PostgreSQL**: Production-ready relational database (with automatic migration from JSON)
- **SQLAlchemy**: ORM for database operations
- **JSON Database**: Legacy file-based storage (for backward compatibility)
- **yfinance**: Real-time market data
- **pdfplumber**: PDF parsing for statements
- **pandas**: Data processing and analysis
- **JWT Authentication**: Secure user authentication

### Frontend
- **React 18**: Modern UI library with hooks and concurrent features
- **Material-UI v5**: Comprehensive component library with theming
- **Recharts**: Interactive and responsive data visualizations
- **React Router v6**: Client-side routing with nested routes
- **Axios**: HTTP client with request/response interceptors
- **jsPDF & html2canvas**: Client-side PDF report generation
- **XLSX**: Excel file generation and parsing
- **DOMPurify**: XSS protection for user-generated content

### Infrastructure
- **Docker**: Containerization for consistent environments
- **Docker Compose**: Multi-container orchestration
- **PostgreSQL 16**: Production database with automatic migration
- **Redis**: In-memory data store for caching and job queues
- **Nginx**: Frontend web server and reverse proxy
- **RQ (Redis Queue)**: Background job processing for async operations

### Monitoring & Observability
- **Prometheus**: Metrics collection and time-series database
- **Grafana**: Visual dashboards and alerting
- **PostgreSQL Exporter**: Database performance metrics
- **Redis Exporter**: Cache and queue monitoring
- **Node Exporter**: System-level metrics
- **cAdvisor**: Container resource usage monitoring

## Quick Start

### Prerequisites
- Docker and Docker Compose installed
- Git

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd PortfolioInvestments
```

2. Create environment file:
```bash
cp .env.example .env
```

3. Edit `.env` and configure:
```bash
# Security
SECRET_KEY=your-very-long-random-secret-key-here

# PostgreSQL Database (production-ready)
DATABASE_URL=postgresql://portfolio_user:your_secure_password@postgres:5432/portfolio
POSTGRES_USER=portfolio_user
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=portfolio
# pgAdmin (database explorer)
PGADMIN_DEFAULT_EMAIL=admin@example.com
PGADMIN_DEFAULT_PASSWORD=supersecurepassword
PGADMIN_PORT=5050
# Optional market data providers
TWELVEDATA_API_KEY=your_twelvedata_key_optional
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key_optional
# Comma-separated fallback order, earliest wins
PRICE_SOURCE_PRIORITY=tradingview,yfinance,alpha_vantage,twelvedata,stooq
# Redis / background jobs
REDIS_URL=redis://redis:6379/0
```

4. Build and start the containers:
```bash
docker-compose up --build
```

5. Access the application:
- **Frontend**: http://localhost
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **pgAdmin** (PostgreSQL explorer): http://localhost:5050 (or the port set in `PGADMIN_PORT`)
- **Grafana** (Monitoring dashboards): http://localhost:3001 (default credentials: admin/admin)
- **Prometheus** (Metrics): http://localhost:9090
- Redis is embedded automatically for background jobs; no manual action required.

**Note**: On first login, your data will be automatically migrated from JSON to PostgreSQL if you have existing data.

### Market Data Providers

- Add optional API keys (`TWELVEDATA_API_KEY`, `ALPHA_VANTAGE_API_KEY`) to your backend `.env`. The file is already gitignored so the keys stay local.
- Control the fallback order with `PRICE_SOURCE_PRIORITY` (comma-separated). Any providers you omit fall back to the remaining defaults.
- Default order prioritizes TradingView, then Yahoo Finance, Alpha Vantage, TwelveData, and finally Stooq. Historical price lookups reuse the same order.

### Exploring PostgreSQL Data with pgAdmin
### Exploring PostgreSQL Data with pgAdmin

1. Ensure `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD`, and `PGADMIN_PORT` are set in your `.env`.
2. Start the stack with `docker-compose up --build` (or `docker-compose up -d`).
3. Open `http://localhost:5050` (or the configured port) and log in with the pgAdmin credentials.
4. Register a new server in pgAdmin:
   - **Name**: `portfolio-postgres` (any label works)
   - **Host**: `postgres` (Docker service name)
   - **Port**: `5432`
   - **Maintenance DB**: value from `POSTGRES_DB` (default `portfolio`)
   - **Username / Password**: values from `POSTGRES_USER` / `POSTGRES_PASSWORD`
5. Once connected, you can browse schemas, tables, and run SQL queries directly against the PostgreSQL data.

### Background Jobs

#### Expense Conversion Worker

1. A Redis instance (`redis` service) and a dedicated worker container (`expense-worker`) are part of the docker-compose stack.
2. When you click “Import from Transactions” in the Expenses page, the backend enqueues a job instead of blocking the request.
3. The frontend shows the live status (`queued`, `starting`, `converting_transactions`, etc.) while the worker processes data.
4. Once the job finishes, the page automatically refreshes the expense charts. If a job fails, the UI surfaces the error.
5. You can query job status manually via:
   - `POST /api/expenses/convert-transactions` → returns `job_id`
   - `GET /api/expenses/convert-transactions/jobs/{job_id}` → returns status/result/error

#### Statement Processing Worker

1. A second worker container (`statement-worker`) listens to the `statement_processing` queue (configurable via `STATEMENT_QUEUE_NAME`).
2. Uploading a statement stores the file immediately; clicking **Process** or **Reprocess** enqueues a background job handled by the worker so the API never blocks.
3. You can reprocess every statement (optionally scoped to one account) via `POST /api/import/statements/reprocess-all`. The worker clears prior transactions/dividends/positions for the impacted account(s) and rebuilds them in chronological order.
4. If a file was assigned to the wrong account, `PUT /api/import/statements/{id}/account` reassigns it, removes the previously imported transactions, recalculates the old account's positions, and queues a fresh job for the new account.
5. Monitor any statement job via `GET /api/import/jobs/{job_id}`. Responses include queue status plus the worker result payload (counts, per-account summaries, or failure trace) so the UI can poll and surface progress.

## Monitoring & Observability

The platform includes comprehensive monitoring tools for production deployments:

### Accessing Monitoring Tools

1. **Grafana** (http://localhost:3001)
   - Visual dashboards for all metrics
   - Default credentials: `admin` / `admin` (change on first login)
   - Pre-configured data sources for Prometheus
   - Create custom dashboards for your needs

2. **Prometheus** (http://localhost:9090)
   - Raw metrics collection interface
   - Query metrics using PromQL
   - View targets and their health status
   - Configure alerting rules

### Available Metrics

- **System Metrics** (via Node Exporter):
  - CPU usage, memory, disk I/O
  - Network traffic and connections
  - System load averages

- **Container Metrics** (via cAdvisor):
  - Per-container resource usage
  - CPU, memory, and network statistics
  - Container health status

- **Database Metrics** (via PostgreSQL Exporter):
  - Connection pool status
  - Query performance
  - Table and index statistics
  - Transaction rates

- **Cache Metrics** (via Redis Exporter):
  - Cache hit/miss rates
  - Memory usage
  - Queue depths for background jobs
  - Key eviction statistics

### Setting Up Custom Dashboards

1. Log into Grafana at http://localhost:3001
2. Navigate to Dashboards → New Dashboard
3. Add panels with Prometheus as the data source
4. Use PromQL queries to visualize your metrics
5. Save and share dashboards with your team

## Performance Optimizations

The platform is built with performance in mind:

- **Async Operations**: Long-running tasks (statement processing, expense conversion) run in background workers
- **Lazy Loading**: Components and routes load on-demand to reduce initial bundle size
- **Memoization**: React.memo, useMemo, and useCallback prevent unnecessary re-renders
- **Background Price Updates**: Portfolio loads instantly while prices fetch asynchronously
- **Database Indexing**: Optimized queries with proper indexes on frequently accessed columns
- **Redis Caching**: Frequently accessed data cached to reduce database load
- **Pagination**: Large datasets handled efficiently with server-side pagination
- **Optimistic Updates**: UI updates immediately before server confirmation for better UX

### Migrating Existing JSON Data

If you have existing JSON data and want to migrate to PostgreSQL:

1. **Backup your data**:
```bash
cp -r backend/data backend/data_backup
```

2. **Configure PostgreSQL** in `.env` (see step 3 above)

3. **Start the application** - PostgreSQL will initialize automatically

4. **Login** - Your data will be automatically migrated on first login

5. **Verify** - Check that all your accounts, transactions, and expenses are visible

See [POSTGRES_MIGRATION.md](POSTGRES_MIGRATION.md) for detailed migration guide and troubleshooting.

### Development Setup (Without Docker)

#### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Create virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Create `.env` file:
```bash
cp .env.example .env
```

5. Run the backend:
```bash
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Run the development server:
```bash
npm run dev
```

4. Access the app at http://localhost:3000

## Usage

### 1. Register/Login
- Create a new account or login with existing credentials
- JWT token is stored in localStorage for authentication

### 2. Import Statements
- Navigate to the "Import" page
- Upload your bank statement:
  - **Wealthsimple**: PDF, CSV, or Excel format
  - **Tangerine**: CSV or QFX/OFX format
  - **NBC**: CSV format
- The system automatically detects the bank and format
- Extracted data includes:
  - Account information
  - Portfolio positions (for investment accounts)
  - Transaction history
  - Dividend payments
- Supported institutions:
  - Wealthsimple (investment, crypto, and checking accounts)
  - Tangerine (checking and savings accounts)
  - NBC - National Bank of Canada (checking, savings, and credit card accounts)

### 3. View Transactions
- Navigate to the "Transactions" page
- View all imported transactions from statements
- Filter by account (all accounts or specific account)
- Filter by date range:
  - Last 7 Days
  - Month to Date
  - Last Month
  - Year to Date
  - Last Year
  - All Time
  - Custom Period (select start and end dates)
- View account balance calculated from transactions
- See total transaction count and imported statements count

### 4. View Portfolio
- **Dashboard**: Overview of all accounts and total portfolio value with customizable layout
- **Portfolio Page**: Detailed position table with:
  - Current holdings with real-time prices
  - Book value vs market value comparison
  - Unrealized gains/losses with percentages
  - Performance returns over time
- **Interactive Charts**:
  - Industry allocation pie chart (click/double-tap to filter)
  - Asset type distribution (click/double-tap to filter)
  - Historical performance graphs
- **Date Range Filters**: View portfolio as of specific dates or periods
- **Instrument Classification**: Assign custom types and industries to your holdings
- **Export Options**: Generate PDF reports or download CSV/Excel files

### 5. Track Dividends
- **Summary Overview**: Total dividend income with year-over-year comparison
- **Monthly Bar Chart**: Interactive chart showing dividends by month (double-click to filter)
- **Distribution Charts**:
  - By ticker (click/double-tap to filter)
  - By asset type (click/double-tap to filter)
  - By industry (click/double-tap to filter)
- **Detailed Table**: Sortable dividend payments with filtering options
- **Export Options**: Download dividend reports in PDF, CSV, or Excel format

### 6. Manage Expenses
**NEW: Enhanced Expense Tracking System**
- **Automatic Import**: Convert checking account withdrawal and fee transactions to expenses with one click
- **Smart Categorization**: AI-powered auto-categorization based on transaction descriptions
  - Learns from your existing categorizations
  - Uses intelligent keyword matching for common categories
  - Supports 12 default categories: Groceries, Dining, Transportation, Utilities, Entertainment, Shopping, Healthcare, Bills, Transfer, ATM, Fees, and Uncategorized
- **Interactive Category Management**:
  - Edit expense categories inline with color-coded dropdowns
  - Bulk category assignment: Select multiple expenses and categorize at once
  - Create custom categories with your own colors and budget limits
  - Delete or modify existing categories
  - Visual color picker for category customization
- **Three-Tab Interface**:
  - **Overview Tab**: Total expenses, category breakdown (pie chart), and monthly trends (bar chart)
  - **Expense List Tab**: Detailed table of all expenses with inline category editing and filtering
  - **Monthly Comparison Tab**:
    - Stacked bar chart showing expenses by category over last 6 months
    - Line chart showing category trends over time
    - Month-over-month comparison
- **Advanced Filtering**:
  - Filter by account (all accounts or specific checking account)
  - Filter by category
  - Real-time updates on filter changes
- **Re-categorization Support**: As you manually categorize expenses, the system learns and improves future auto-categorization
- **Mobile Optimization**: Double-tap on pie charts to filter (allows viewing tooltips first)
- **Export Options**: Download expense reports in PDF, CSV, or Excel format

### 7. Export Data
- **PDF Reports**: Generate professional formatted reports with charts and data
  - Includes all visible tables and charts
  - Preserves formatting and colors
  - Print-ready output
- **CSV Export**: Download data for use in Excel or other spreadsheet tools
  - All filtered data included
  - Compatible with Excel, Google Sheets, etc.
- **Excel Export**: Structured spreadsheets with multiple sheets
  - Separate sheets for different data types
  - Formatted headers and data
- **Available On**: Portfolio, Transactions, Dividends, and Expenses pages

### 8. Refresh Market Prices
- Click "Refresh Prices" on Portfolio page
- System fetches current market prices from multiple sources with automatic fallback:
  - TradingView (primary)
  - Yahoo Finance
  - Alpha Vantage
  - TwelveData
  - Stooq
- Updates all position values automatically
- Background processing keeps UI responsive

## API Endpoints

### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login user
- `GET /auth/me` - Get current user

### Accounts
- `GET /accounts` - List all accounts
- `POST /accounts` - Create account
- `GET /accounts/{id}` - Get account details
- `PUT /accounts/{id}` - Update account
- `DELETE /accounts/{id}` - Delete account

### Positions
- `GET /positions` - List all positions
- `GET /positions/aggregated` - Get aggregated positions (supports filters: account_id, as_of_date, instrument_type_id, instrument_industry_id)
- `GET /positions/summary` - Get portfolio summary
- `GET /positions/industry-breakdown` - Get market value grouped by industry (same optional filters as aggregated)
- `GET /positions/type-breakdown` - Get market value grouped by instrument type (same optional filters as aggregated)
- `POST /positions` - Create position
- `PUT /positions/{id}` - Update position
- `POST /positions/refresh-prices` - Refresh market prices
- `DELETE /positions/{id}` - Delete position

### Transactions
- `GET /transactions` - List transactions with optional filters (account_id, start_date, end_date)
- `GET /transactions/balance` - Calculate account balance (with optional account_id and as_of_date)
- `POST /transactions` - Create transaction
- `DELETE /transactions/{id}` - Delete transaction

### Dividends
- `GET /dividends` - List dividends
- `GET /dividends/summary` - Get dividend summary
- `POST /dividends` - Create dividend
- `DELETE /dividends/{id}` - Delete dividend

### Expenses
- `GET /expenses` - List expenses (with optional filters: account_id, category)
- `GET /expenses/summary` - Get expense summary with totals by category and month
- `GET /expenses/monthly-comparison` - Get monthly expense comparison for last N months
- `POST /expenses` - Create expense
- `PUT /expenses/{id}` - Update expense
- `PATCH /expenses/{id}/category` - Update only the category of an expense
- `DELETE /expenses/{id}` - Delete expense
- `GET /expenses/categories` - List all categories for user
- `POST /expenses/categories` - Create new category
- `PUT /expenses/categories/{id}` - Update category
- `DELETE /expenses/categories/{id}` - Delete category
- `POST /expenses/categories/init-defaults` - Initialize default expense categories
- `POST /expenses/convert-transactions` - Convert checking and credit card transactions to expenses with auto-categorization (excludes transfers)
- `POST /expenses/detect-transfers` - Detect and mark transfers between accounts

### Import
- `POST /import/statement` - Upload and parse statement (Wealthsimple, Tangerine, or NBC)
  - Supported formats: PDF, CSV, Excel (.xlsx/.xls), QFX/OFX
  - Automatic bank detection
- `GET /import/statements` - List all uploaded statements
- `POST /import/statements/{id}/process` - Process uploaded statement
- `POST /import/statements/{id}/reprocess` - Reprocess statement
- `POST /import/statements/reprocess-all` - Rebuild statements for every file (optionally restricted to one account)
- `PUT /import/statements/{id}/account` - Reassign the statement to another account and queue reprocessing
- `DELETE /import/statements/{id}` - Delete statement
- `GET /import/jobs/{job_id}` - Poll statement processing job status/result

### Instruments & Classifications
- `GET /instruments/types` - List instrument types for the current user
- `POST /instruments/types` - Create a new instrument type (with color)
- `PUT /instruments/types/{id}` - Update an instrument type
- `DELETE /instruments/types/{id}` - Delete an instrument type (existing classifications fall back to unassigned)
- `GET /instruments/industries` - List instrument industries for the current user
- `POST /instruments/industries` - Create a new instrument industry (with color)
- `PUT /instruments/industries/{id}` - Update an instrument industry
- `DELETE /instruments/industries/{id}` - Delete an instrument industry
- `GET /instruments/classifications` - List ticker classifications (type & industry)
- `PUT /instruments/classifications/{ticker}` - Assign/Update the type and industry for a ticker
- `DELETE /instruments/classifications/{ticker}` - Remove stored classification for a ticker

## Data Models

### User
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "created_at": "2024-01-01T00:00:00"
}
```

### Account
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "account_type": "investment|checking|savings",
  "account_number": "12345",
  "institution": "Wealthsimple",
  "balance": 10000.00
}
```

### Position
```json
{
  "id": "uuid",
  "account_id": "uuid",
  "type": "buy|sell|dividend|deposit|withdrawal|fee|bonus|transfer",
  "ticker": "AAPL",
  "quantity": 10,
  "price": 150.00,
  "fees": 0.00,
  "total": 1500.00,
  "description": "Transaction description"
}
```

### Transaction
```json
{
  "id": "uuid",
  "account_id": "uuid",
  "date": "2024-01-01T00:00:00",
  "type": "buy|sell|dividend|deposit|withdrawal|fee|bonus|transfer|tax",
  "ticker": "AAPL",
  "quantity": 10,
  "price": 150.00,
  "fees": 0.00,
  "total": 1500.00,
  "description": "Transaction description"
}
```

### Expense
```json
{
  "id": "uuid",
  "account_id": "uuid",
  "date": "2024-01-01T00:00:00",
  "description": "Grocery shopping at Metro",
  "amount": 125.50,
  "category": "Groceries",
  "notes": "Imported from transaction (type: withdrawal)"
}
```

### Category
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "name": "Groceries",
  "type": "expense|transfer",
  "color": "#4CAF50",
  "budget_limit": 500.00
}
```

## Supported File Formats

### Wealthsimple Statements
- **PDF**: Full account statements with positions and transactions
- **CSV**: Transaction history with crypto support
- **Excel (.xlsx, .xls)**: Multi-sheet statements with detailed breakdowns

**Transaction Types Supported:**
- Buy, Sell, Dividend, Deposit, Withdrawal, Fee, Bonus, Tax, Transfer

### Tangerine Statements
- **CSV**: Checking and savings account transaction history
  - Format: Date, Transaction, Nom, Description, Montant
  - Encoding: UTF-8
- **QFX/OFX**: Open Financial Exchange format
  - Standard banking format used by many financial software
  - Includes account information and full transaction history

**Transaction Types Detected:**
- EFT Deposits/Withdrawals
- INTERAC e-Transfer (in/out)
- Bill Payments
- Interest Payments
- Account Transfers
- Fees and Service Charges
- Bonus/Reward Payouts

### NBC (National Bank of Canada) Statements
- **CSV (Checking/Savings)**: Account transaction history
  - Format: Date;Description;Category;Debit;Credit;Balance (semicolon delimiter)
  - Date format: YYYY-MM-DD (ISO format)
  - Encoding: UTF-8
  - Includes merchant categories and separate debit/credit columns

- **CSV (Credit Card)**: Credit card transaction history
  - Format: Date;card Number;Description;Category;Debit;Credit (semicolon delimiter)
  - Automatically detected by "card Number" column
  - All purchases automatically categorized as expenses
  - Payments received tracked as deposits

**Transaction Types Detected:**
- Salary/Payroll deposits
- Government payments (tax refunds, benefits)
- INTERAC e-Transfer (in/out)
- Credit card payments and purchases
- Mortgage and rent payments
- Insurance payments
- Bill payments and utilities
- Mobile deposits
- Investments and transfers
- Fees and service charges
- Restaurant and shopping transactions

### Automatic Bank Detection
The system automatically detects which bank a statement is from based on:
1. Filename (e.g., "Tangerine", "Wealthsimple", "BNC", or "NBC" in the name)
2. File extension (.qfx/.ofx always uses Tangerine parser)
3. File content (CSV header format and delimiter):
   - NBC: Semicolon-delimited with "Debit;Credit;Balance" headers
   - Tangerine: Comma-delimited with "Nom,Montant" headers
   - Wealthsimple: Standard CSV format

## Project Structure

```
PortfolioInvestments/
├── backend/
│   ├── app/
│   │   ├── api/              # API endpoints (FastAPI routes)
│   │   ├── database/         # Database layer (PostgreSQL + legacy JSON)
│   │   ├── models/           # Pydantic schemas and SQLAlchemy models
│   │   ├── parsers/          # Statement parsers (Wealthsimple, Tangerine, NBC)
│   │   ├── services/         # Business logic and external APIs
│   │   ├── workers/          # Background job workers (RQ)
│   │   ├── config.py         # Configuration and environment variables
│   │   └── main.py           # FastAPI application entry point
│   ├── data/                 # Legacy JSON database files
│   ├── uploads/              # Uploaded statement files
│   ├── alembic/              # Database migrations
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── components/       # Reusable React components
│   │   ├── context/          # React context providers (Auth, etc.)
│   │   ├── pages/            # Page components (Portfolio, Dividends, etc.)
│   │   ├── services/         # API service layer (Axios)
│   │   ├── utils/            # Utility functions and hooks
│   │   ├── App.jsx           # Main app component with routing
│   │   └── main.jsx          # React entry point
│   ├── public/               # Static assets
│   ├── Dockerfile            # Multi-stage build (Node + Nginx)
│   ├── nginx.conf            # Nginx configuration
│   ├── vite.config.js        # Vite build configuration
│   └── package.json
│
├── workers/
│   ├── expense_worker/       # Expense conversion background worker
│   ├── statement_worker/     # Statement processing background worker
│   ├── price_worker/         # Price update background worker
│   └── plaid_worker/         # Plaid integration worker
│
├── monitoring/
│   ├── prometheus/           # Prometheus configuration
│   └── grafana/              # Grafana dashboards and provisioning
│
├── docker-compose.yml        # Multi-container orchestration
├── .env.example              # Environment variables template
├── README.md                 # This file
└── POSTGRES_MIGRATION.md     # PostgreSQL migration guide
```

## Security Considerations

- **Authentication & Authorization**:
  - JWT tokens with secure token-based authentication
  - Automatic token refresh mechanism
  - Session management with expiration
  - User-scoped data access control

- **Password Security**:
  - bcrypt hashing with appropriate salt rounds
  - No plaintext password storage
  - Secure password reset flows (when implemented)

- **Data Protection**:
  - SQL injection prevention via SQLAlchemy ORM with parameterized queries
  - XSS protection with input sanitization (DOMPurify)
  - CORS configuration for restricted cross-origin requests
  - File upload validation (type, size, and content checks)

- **Infrastructure Security**:
  - Environment variables for sensitive configuration
  - No secrets committed to repository (.env in .gitignore)
  - HTTPS/TLS ready with nginx configuration
  - Container isolation via Docker
  - Network segmentation in docker-compose

- **Best Practices**:
  - Regular dependency updates
  - Secure default configurations
  - Audit logging for sensitive operations
  - Rate limiting on API endpoints (recommended for production)
  - Database connection pooling with limits

- **Production Recommendations**:
  - Enable HTTPS/SSL certificates (Let's Encrypt recommended)
  - Configure firewall rules
  - Set up regular database backups
  - Enable Prometheus alerting for security events
  - Use strong SECRET_KEY and database passwords
  - Restrict pgAdmin access in production

## Future Enhancements

- **Advanced Features**:
  - Multi-currency support with real-time conversion
  - Tax loss harvesting suggestions and tracking
  - Portfolio rebalancing recommendations based on target allocations
  - What-if scenarios and portfolio modeling
  - Tax reporting and capital gains calculations

- **Notifications & Alerts**:
  - Email notifications for dividends, price alerts, and portfolio milestones
  - Push notifications for mobile devices
  - Custom alert rules based on portfolio performance

- **Data & Analytics**:
  - Benchmark comparisons (S&P 500, TSX, custom indices)
  - Time-weighted and money-weighted returns (IRR)
  - Sector correlation analysis
  - Risk metrics (Sharpe ratio, beta, standard deviation)
  - Monte Carlo simulations for retirement planning

- **Integrations**:
  - Plaid integration for automatic bank syncing
  - Direct broker API connections (Questrade, Interactive Brokers)
  - Calendar integration for dividend dates
  - Automated scheduled imports

- **User Experience**:
  - Native mobile apps (iOS/Android)
  - Dark mode theme
  - Customizable dashboard widgets
  - Multi-user support with family accounts
  - Internationalization (i18n) for multiple languages

- **Advanced Tools**:
  - AI-powered investment insights
  - Automated portfolio analysis reports
  - Goals tracking (retirement, savings targets)
  - Debt tracking and payoff calculators
  - Net worth tracking across all assets

## Troubleshooting

### Backend not starting
- Check if port 8000 is available
- Verify Python dependencies are installed
- Check `.env` file configuration

### Frontend not loading
- Ensure backend is running
- Check if port 80/3000 is available
- Verify npm dependencies are installed

### Statement import failing
- Verify file format (PDF, CSV, Excel, QFX/OFX)
- Check file size limits
- Review backend logs for parsing errors
- Ensure background workers are running: `docker-compose ps`
- Check worker logs: `docker-compose logs statement-worker`

### Monitoring tools not accessible
- Verify all containers are running: `docker-compose ps`
- Check Grafana logs: `docker-compose logs grafana`
- Check Prometheus logs: `docker-compose logs prometheus`
- Ensure ports are not blocked by firewall
- Default ports: Grafana (3001), Prometheus (9090)

### Background jobs not processing
- Check Redis is running: `docker-compose ps redis`
- Verify workers are running: `docker-compose ps | grep worker`
- Check Redis connection: `docker-compose exec redis redis-cli ping`
- Review worker logs: `docker-compose logs expense-worker`
- Clear stuck jobs: Connect to Redis and inspect queues

### Performance issues
- Check container resource usage: `docker stats`
- Review Grafana dashboards for bottlenecks
- Ensure database indexes are created
- Check Redis memory usage
- Consider increasing container resource limits in docker-compose.yml

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License

## Support

For issues and questions, please open an issue on GitHub.
