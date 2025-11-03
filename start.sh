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

echo "Choose an option:"
echo "1. Start with Docker (Recommended)"
echo "2. Start Backend Only (Development)"
echo "3. Start Frontend Only (Development)"
echo "4. Stop Docker Containers"
echo "5. View Logs"
echo ""
read -p "Enter your choice (1-5): " choice

case $choice in
    1)
        echo ""
        echo "Building and starting Docker containers..."
        docker-compose up --build
        ;;
    2)
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
    3)
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
    4)
        echo ""
        echo "Stopping Docker containers..."
        docker-compose down
        echo "Containers stopped."
        ;;
    5)
        echo ""
        echo "Showing Docker logs (Ctrl+C to exit)..."
        docker-compose logs -f
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac
