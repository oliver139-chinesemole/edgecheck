"""
EdgeCheck FastAPI application.
NOT financial advice. Research and educational use only.
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db
from app.api import health, smart_money, backtest, simulation, improvement

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_db()
    logger.info("EdgeCheck backend ready. Alpaca: %s | FMP: %s | Model: ",
                "✓" if settings.has_alpaca else "✗ (seed)",
                "✓" if settings.has_fmp else "✗ (seed)")
    yield
    logger.info("EdgeCheck backend shutting down.")


app = FastAPI(
    title="EdgeCheck API",
    description="Smart-Money Signal & Paper-Trading Research Platform. NOT financial advice.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(smart_money.router, prefix="/api/smart-money")
app.include_router(backtest.router, prefix="/api/backtest")
app.include_router(simulation.router, prefix="/api/simulation")
app.include_router(improvement.router, prefix="/api/improvement")


@app.get("/")
def root():
    return {
        "name": "EdgeCheck",
        "docs": "/docs",
        "health": "/health",
        "disclaimer": "NOT financial advice. Research tool only.",
    }
