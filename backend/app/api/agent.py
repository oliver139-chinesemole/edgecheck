"""
Background Learning Engine API.

GET  /api/agent/status      — AgentRun status (episodes, dataset size, champion card)
POST /api/agent/start       — start background learning (target_episodes param)
POST /api/agent/stop        — stop background loop
GET  /api/agent/champion    — champion ModelCard + live vs backtest metrics
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.services.learning_engine import get_learning_engine

logger = logging.getLogger(__name__)

router = APIRouter()


class StartRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    target_episodes: int = 100


@router.get("/status")
def get_status() -> dict:
    """Return learning engine status."""
    engine = get_learning_engine()
    status = engine.get_status()
    status["disclaimer"] = (
        "Most likely result: no durable edge / underperforming SPY. "
        "A strategy that looks brilliant across 1000 replayed simulations "
        "is the textbook overfitting trap. "
        "Only the frozen forward track record counts."
    )
    return status


@router.post("/start")
def start_learning(req: StartRequest) -> dict:
    """Start the background learning loop."""
    engine = get_learning_engine()
    engine.start(target_episodes=req.target_episodes)
    return {
        "started": True,
        "target_episodes": req.target_episodes,
        "message": "Background learning started.",
    }


@router.post("/stop")
def stop_learning() -> dict:
    """Stop the background learning loop."""
    engine = get_learning_engine()
    engine.stop()
    return {"stopped": True, "message": "Stop signal sent."}


@router.get("/champion")
def get_champion() -> dict:
    """Return champion model card and live vs backtest metrics."""
    engine = get_learning_engine()
    status = engine.get_status()
    champion = status.get("champion")
    live_stats = status.get("live_stats", {})

    return {
        "champion": champion,
        "live_stats": live_stats,
        "honest_note": (
            "The model never trains on forward data. "
            "Every observation in the live track record is genuinely out-of-sample. "
            "Most likely result is underperformance vs SPY — that is a valid finding."
        ),
        "has_champion": champion is not None,
    }
