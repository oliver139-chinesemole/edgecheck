from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, HTTPException
from app.models.schemas import BacktestConfig, BacktestResult
from app.services.backtest_engine import run_backtest
from app.services.seed_loader import load_prices, load_holdings
from app.services.model_manager import get_model_card, invalidate_cache

router = APIRouter()

_last_result: Optional[BacktestResult] = None


@router.post("/run", response_model=BacktestResult)
def run_backtest_endpoint(config: BacktestConfig) -> BacktestResult:
    global _last_result
    try:
        prices = load_prices()
        holdings = load_holdings()
        result = run_backtest(config, prices, holdings)
        # Invalidate cached model so simulator reloads the new one
        invalidate_cache()
        _last_result = result
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/results", response_model=Optional[BacktestResult])
def get_last_result():
    return _last_result


@router.get("/model-card")
def get_model_card_endpoint():
    card = get_model_card()
    if card is None:
        return {"message": "No model trained yet. Run a backtest first."}
    return card
