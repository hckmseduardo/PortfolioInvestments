# Quick Start Guide

## Prerequisites
- Docker and Docker Compose (recommended)
- OR Python 3.11+ and Node.js 18+ (for development)

## Option 1: Docker (Recommended)

### Start the Application
```bash
# Linux/Mac
./start.sh

# Windows
start.bat
```

Choose option 1 to start with Docker.

The application will be available at:
- Frontend: http://localhost
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Stop the Application
```bash
docker-compose down
```

## Option 2: Development Mode

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (in a new terminal)
```bash
cd frontend
npm install
npm run dev
```

Access at http://localhost:3000

## First Steps

1. **Register an Account**
   - Open http://localhost (or http://localhost:3000 in dev mode)
   - Click "Register" tab
   - Enter email and password
   - Click "Register"

2. **Import Your First Statement**
   - Click "Import" in the navigation
   - Upload a Wealthsimple statement (PDF, CSV, or Excel)
   - Click "Upload Statement"
   - Wait for processing

3. **View Your Portfolio**
   - Click "Dashboard" to see overview
   - Click "Portfolio" to see detailed positions
   - Click "Refresh Prices" to update market values

4. **Track Dividends**
   - Click "Dividends" to see dividend income
   - View charts by month and ticker

5. **Manage Expenses**
   - Click "Expenses" to see spending analysis
   - View by category and monthly trends

## Troubleshooting

### Port Already in Use
If port 8000 or 80 is already in use, edit `docker-compose.yml`:
```yaml
services:
  backend:
    ports:
      - "8001:8000"  # Change 8000 to 8001
  frontend:
    ports:
      - "8080:80"    # Change 80 to 8080
```

### Backend Not Starting
- Check Python version: `python --version` (should be 3.11+)
- Verify all dependencies installed: `pip list`
- Check logs: `docker-compose logs backend`

### Frontend Not Loading
- Check Node version: `node --version` (should be 18+)
- Clear npm cache: `npm cache clean --force`
- Reinstall: `rm -rf node_modules && npm install`

### Statement Import Failing
- Verify file format (PDF, CSV, or Excel)
- Check file size (should be < 10MB)
- Try a different file format
- Check backend logs for errors

## Sample Data Structure

### CSV Format Example
```csv
Symbol,Name,Quantity,Book Value,Market Value
AAPL,Apple Inc.,10,1500.00,1800.00
MSFT,Microsoft Corporation,5,1200.00,1400.00
```

### Transaction CSV Example
```csv
Date,Type,Symbol,Quantity,Price,Fees,Amount,Description
2024-01-15,buy,AAPL,10,150.00,0.00,1500.00,Purchase
2024-02-01,dividend,AAPL,,,0.00,25.00,Dividend Payment
```

## Next Steps

- Explore the API documentation at http://localhost:8000/docs
- Set up automatic price refresh (cron job)
- Configure email notifications
- Customize expense categories
- Export reports

## Support

For issues and questions:
- Check the main README.md
- Review API documentation
- Check Docker logs: `docker-compose logs -f`
- Open an issue on GitHub
