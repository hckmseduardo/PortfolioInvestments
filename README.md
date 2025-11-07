# Investment Portfolio Management Platform

A comprehensive investment portfolio management platform that allows users to import and analyze their Wealthsimple statements, track account performance, and manage checking account expenses.

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
- **Dividend Tracking**: Monitor dividend income by month and security with interactive charts
- **Advanced Expense Management**:
  - Convert checking and credit card transactions to expenses automatically
  - Smart transfer detection: Automatically identifies and excludes transfers between accounts
  - Credit card payment matching: Links payments from checking to credit card accounts
  - Smart auto-categorization with machine learning from your history
  - **Manual category persistence**: Manually assigned categories are preserved when reimporting statements
  - Inline category editing with color-coded tags
  - Visual color picker for category creation and editing
  - Custom category creation with budget limits, all categories can be edited/deleted
  - **Flexible time period filtering**: View expenses by current month, last month, specific month, quarters, or custom ranges
  - Monthly expense comparison with stacked charts
  - Category trend analysis over time
  - Accurate totals excluding inter-account transfers
- **Real-time Market Data**: Automatic price updates using Yahoo Finance API

## Tech Stack

### Backend
- **FastAPI**: Modern Python web framework
- **JSON Database**: Lightweight file-based storage
- **yfinance**: Real-time market data
- **pdfplumber**: PDF parsing for statements
- **pandas**: Data processing and analysis
- **JWT Authentication**: Secure user authentication

### Frontend
- **React 18**: Modern UI library
- **Material-UI**: Component library
- **Recharts**: Interactive data visualizations
- **React Router**: Client-side routing
- **Axios**: HTTP client

### Infrastructure
- **Docker**: Containerization
- **Docker Compose**: Multi-container orchestration
- **Nginx**: Frontend web server and reverse proxy

## Quick Start

### Prerequisites
- Docker and Docker Compose installed
- Git

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd InvestingPlataform
```

2. Create environment file:
```bash
cp .env.example .env
```

3. Edit `.env` and set a secure SECRET_KEY:
```bash
SECRET_KEY=your-very-long-random-secret-key-here
```

4. Build and start the containers:
```bash
docker-compose up --build
```

5. Access the application:
- Frontend: http://localhost
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs

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
- Dashboard shows overview of all accounts and total portfolio value
- Portfolio page displays detailed position table with:
  - Current holdings
  - Book value vs market value
  - Unrealized gains/losses
  - Percentage returns

### 5. Track Dividends
- View total dividend income
- Bar chart showing dividends by month
- Pie chart showing dividend distribution by ticker

### 6. Manage Expenses
**NEW: Enhanced Expense Tracking System**
- **Automatic Import**: Convert checking account withdrawal and fee transactions to expenses with one click
- **Smart Categorization**: AI-powered auto-categorization based on transaction descriptions
  - Learns from your existing categorizations
  - Uses intelligent keyword matching for common categories
  - Supports 12 default categories: Groceries, Dining, Transportation, Utilities, Entertainment, Shopping, Healthcare, Bills, Transfer, ATM, Fees, and Uncategorized
- **Interactive Category Management**:
  - Edit expense categories inline with color-coded dropdowns
  - Create custom categories with your own colors and budget limits
  - Delete or modify existing categories
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

### 7. Refresh Market Prices
- Click "Refresh Prices" on Portfolio page
- System fetches current market prices from Yahoo Finance
- Updates all position values automatically

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
- `GET /positions/summary` - Get portfolio summary
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
- `DELETE /import/statements/{id}` - Delete statement

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
InvestingPlataform/
├── backend/
│   ├── app/
│   │   ├── api/              # API endpoints
│   │   ├── database/         # JSON database layer
│   │   ├── models/           # Pydantic schemas
│   │   ├── parsers/          # Statement parsers
│   │   ├── services/         # Business logic
│   │   ├── config.py         # Configuration
│   │   └── main.py           # FastAPI app
│   ├── data/                 # JSON database files
│   ├── uploads/              # Uploaded statements
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/       # React components
│   │   ├── context/          # React context
│   │   ├── pages/            # Page components
│   │   ├── services/         # API services
│   │   ├── App.jsx           # Main app component
│   │   └── main.jsx          # Entry point
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
└── README.md
```

## Security Considerations

- JWT tokens for authentication
- Password hashing with bcrypt
- CORS configuration
- File upload validation
- Environment variable configuration
- HTTPS recommended for production

## Future Enhancements

- Multi-currency support
- Tax loss harvesting suggestions
- Portfolio rebalancing recommendations
- Email notifications
- Mobile responsive design improvements
- Export reports to PDF/Excel
- Advanced charting and analytics
- Benchmark comparisons (S&P 500, TSX)
- Time-weighted and money-weighted returns

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
- Verify file format (PDF, CSV, Excel)
- Check file size limits
- Review backend logs for parsing errors

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License

## Support

For issues and questions, please open an issue on GitHub.
