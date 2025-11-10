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
    echo "1. Fresh Start - Bring down all containers and restart (Recommended)"
    echo "2. Start with Docker"
    echo "3. Start with Docker and see console output"
    echo "4. Start Backend Only (Development)"
    echo "5. Start Frontend Only (Development)"
    echo "6. Stop Docker Containers"
    echo "7. View Logs"
    echo ""
    read -p "Enter your choice (1-7): " choice
fi

case $choice in
    1)
        echo ""
        echo "Bringing down all Docker containers..."
        docker-compose down
        echo ""
        echo "Building and starting Docker containers fresh..."
        docker-compose up --build -d
        echo ""
        echo "All containers restarted successfully!"
        ;;
    2)
        echo ""
        echo "Building and starting Docker containers..."
        docker-compose up --build -d
        ;;
    3)
        echo ""
        echo "Building and starting Docker containers with console output..."
        docker-compose up --build
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
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac
