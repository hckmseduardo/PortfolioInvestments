# Investment Portfolio Management Platform

A comprehensive investment portfolio management platform that allows users to import and analyze their Wealthsimple statements, track account performance, and manage checking account expenses.

## Features

- **Statement Import & Processing**: Upload Wealthsimple statements (PDF/CSV/Excel) and automatically extract portfolio data
- **Portfolio Dashboard**: View all accounts, positions, and real-time performance metrics
- **Performance Analytics**: Track portfolio value, book value vs market value, and gain/loss over time
- **Dividend Tracking**: Monitor dividend income by month and security with interactive charts
- **Expense Management**: Categorize and analyze checking account transactions
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
- Upload your Wealthsimple statement (PDF, CSV, or Excel)
- The system will automatically extract:
  - Account information
  - Portfolio positions
  - Transaction history
  - Dividend payments

### 3. View Portfolio
- Dashboard shows overview of all accounts and total portfolio value
- Portfolio page displays detailed position table with:
  - Current holdings
  - Book value vs market value
  - Unrealized gains/losses
  - Percentage returns

### 4. Track Dividends
- View total dividend income
- Bar chart showing dividends by month
- Pie chart showing dividend distribution by ticker

### 5. Manage Expenses
- Track checking account transactions
- Categorize expenses
- View spending by category (pie chart)
- Monitor monthly spending trends (bar chart)

### 6. Refresh Market Prices
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

### Dividends
- `GET /dividends` - List dividends
- `GET /dividends/summary` - Get dividend summary
- `POST /dividends` - Create dividend
- `DELETE /dividends/{id}` - Delete dividend

### Expenses
- `GET /expenses` - List expenses
- `GET /expenses/summary` - Get expense summary
- `POST /expenses` - Create expense
- `PUT /expenses/{id}` - Update expense
- `DELETE /expenses/{id}` - Delete expense
- `GET /expenses/categories` - List categories
- `POST /expenses/categories` - Create category

### Import
- `POST /import/statement` - Upload and parse statement

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
  "ticker": "AAPL",
  "name": "Apple Inc.",
  "quantity": 10,
  "book_value": 1500.00,
  "market_value": 1800.00
}
```

### Transaction
```json
{
  "id": "uuid",
  "account_id": "uuid",
  "date": "2024-01-01T00:00:00",
  "type": "buy|sell|dividend|deposit|withdrawal",
  "ticker": "AAPL",
  "quantity": 10,
  "price": 150.00,
  "fees": 0.00,
  "total": 1500.00
}
```

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
