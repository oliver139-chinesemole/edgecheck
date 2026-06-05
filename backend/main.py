"""
EdgeCheck FastAPI application.
NOT financial advice. Research and educational use only.
"""
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db
from app.api import health, smart_money, backtest, simulation, improvement
from app.api import human_sim, agent, market, sim_games, sim_trading

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
        # Local development
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:3000",
        # GitHub Pages — update the username if the repo is forked
        "https://oliver139-chinesemole.github.io",
        # Allow any custom domain if configured via environment variable
        *([os.environ["ALLOWED_ORIGIN"]] if os.environ.get("ALLOWED_ORIGIN") else []),
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
app.include_router(human_sim.router, prefix="/api/sim")
app.include_router(agent.router, prefix="/api/agent")
app.include_router(market.router, prefix="/api/market", tags=["market"])
app.include_router(sim_games.router, prefix="/api/ms", tags=["market-sim"])
app.include_router(sim_trading.router, prefix="/api/ms", tags=["market-sim"])


@app.get("/")
def root():
    return {
        "name": "EdgeCheck",
        "docs": "/docs",
        "health": "/health",
        "disclaimer": "NOT financial advice. Research tool only.",
    }
