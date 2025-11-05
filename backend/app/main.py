from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api import (
    auth,
    accounts,
    positions,
    import_statements,
    expenses,
    dividends,
    transactions,
    dashboard
)

app = FastAPI(
    title="Investment Portfolio Management API",
    description="API for managing investment portfolios and tracking expenses",
    version="1.0.0"
)

api_router = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router.include_router(auth.router)
api_router.include_router(accounts.router)
api_router.include_router(positions.router)
api_router.include_router(import_statements.router)
api_router.include_router(expenses.router)
api_router.include_router(dividends.router)
api_router.include_router(transactions.router)
api_router.include_router(dashboard.router)

app.include_router(api_router)

@app.get("/")
async def root():
    return {
        "message": "Investment Portfolio Management API",
        "version": "1.0.0",
        "docs": "/docs"
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=True
    )
