@echo off
echo Investment Portfolio Management Platform - Startup Script
echo ==========================================================
echo.

if not exist .env (
    echo Creating .env file from .env.example...
    copy .env.example .env
    echo WARNING: Please edit .env and set a secure SECRET_KEY before running in production!
    echo.
)

if not exist backend\.env (
    echo Creating backend\.env file...
    copy backend\.env.example backend\.env
)

echo Choose an option:
echo 1. Start with Docker (Recommended)
echo 2. Start Backend Only (Development)
echo 3. Start Frontend Only (Development)
echo 4. Stop Docker Containers
echo 5. View Logs
echo.
set /p choice="Enter your choice (1-5): "

if "%choice%"=="1" (
    echo.
    echo Building and starting Docker containers...
    docker-compose up --build
) else if "%choice%"=="2" (
    echo.
    echo Starting backend in development mode...
    cd backend
    if not exist venv (
        echo Creating virtual environment...
        python -m venv venv
    )
    call venv\Scripts\activate
    echo Installing dependencies...
    pip install -r requirements.txt
    echo Starting FastAPI server...
    python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) else if "%choice%"=="3" (
    echo.
    echo Starting frontend in development mode...
    cd frontend
    if not exist node_modules (
        echo Installing dependencies...
        npm install
    )
    echo Starting Vite dev server...
    npm run dev
) else if "%choice%"=="4" (
    echo.
    echo Stopping Docker containers...
    docker-compose down
    echo Containers stopped.
) else if "%choice%"=="5" (
    echo.
    echo Showing Docker logs (Ctrl+C to exit)...
    docker-compose logs -f
) else (
    echo Invalid choice. Exiting.
    exit /b 1
)
