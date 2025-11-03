from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api import auth, accounts, positions, import_statements, expenses, dividends

app = FastAPI(
    title="Investment Portfolio Management API",
    description="API for managing investment portfolios and tracking expenses",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(positions.router)
app.include_router(import_statements.router)
app.include_router(expenses.router)
app.include_router(dividends.router)

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
