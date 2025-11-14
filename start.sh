#!/bin/bash

echo "Investment Portfolio Management Platform - Startup Script"
echo "=========================================================="
echo ""

if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env and set a secure SECRET_KEY before running in production!"
    echo ""
fi

if [ ! -f backend/.env ]; then
    echo "Creating backend/.env file..."
    cp backend/.env.example backend/.env
fi

# Check if parameter was passed
if [ -n "$1" ]; then
    choice=$1
    echo "Executing option $choice directly..."
    echo ""
else
    echo "Choose an option:"
    echo "1. Quick Restart - Restart app containers only (backend, frontend, workers)"
    echo "2. Start with Docker"
    echo "3. Start with Docker and see console output"
    echo "4. Start Backend Only (Development)"
    echo "5. Start Frontend Only (Development)"
    echo "6. Stop Docker Containers"
    echo "7. View Logs"
    echo "8. Full Restart - Bring down ALL containers and restart (includes infrastructure)"
    echo ""
    read -p "Enter your choice (1-8): " choice
fi

case $choice in
    1)
        echo ""
        echo "Restarting app containers (backend, frontend, workers)..."
        echo ""
        echo "Stopping app containers..."
        docker-compose stop backend frontend expense-worker price-worker statement-worker plaid-worker ticker-mapping-worker
        echo ""
        echo "Removing app containers..."
        docker-compose rm -f backend frontend expense-worker price-worker statement-worker plaid-worker ticker-mapping-worker
        echo ""
        echo "Building and starting app containers..."
        env -u PLAID_CLIENT_ID -u PLAID_SECRET -u PLAID_ENVIRONMENT docker-compose up --build -d backend frontend expense-worker price-worker statement-worker plaid-worker ticker-mapping-worker
        echo ""
        echo "App containers restarted successfully!"
        echo "Infrastructure containers (database, redis, monitoring, ollama) remain running."
        ;;
    2)
        echo ""
        echo "Building and starting Docker containers..."
        env -u PLAID_CLIENT_ID -u PLAID_SECRET -u PLAID_ENVIRONMENT docker-compose up --build -d
        ;;
    3)
        echo ""
        echo "Building and starting Docker containers with console output..."
        env -u PLAID_CLIENT_ID -u PLAID_SECRET -u PLAID_ENVIRONMENT docker-compose up --build
        ;;
    4)
        echo ""
        echo "Starting backend in development mode..."
        cd backend
        if [ ! -d "venv" ]; then
            echo "Creating virtual environment..."
            python3 -m venv venv
        fi
        source venv/bin/activate
        echo "Installing dependencies..."
        pip install -r requirements.txt
        echo "Starting FastAPI server..."
        python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
        ;;
    5)
        echo ""
        echo "Starting frontend in development mode..."
        cd frontend
        if [ ! -d "node_modules" ]; then
            echo "Installing dependencies..."
            npm install
        fi
        echo "Starting Vite dev server..."
        npm run dev
        ;;
    6)
        echo ""
        echo "Stopping Docker containers..."
        docker-compose down
        echo "Containers stopped."
        ;;
    7)
        echo ""
        echo "Showing Docker logs (Ctrl+C to exit)..."
        docker-compose logs -f
        ;;
    8)
        echo ""
        echo "Bringing down ALL Docker containers (including infrastructure)..."
        docker-compose down
        echo ""
        echo "Building and starting all Docker containers fresh..."
        env -u PLAID_CLIENT_ID -u PLAID_SECRET -u PLAID_ENVIRONMENT docker-compose up --build -d
        echo ""
        echo "All containers (app + infrastructure) restarted successfully!"
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac
