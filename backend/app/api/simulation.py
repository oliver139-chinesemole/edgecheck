from fastapi import APIRouter
from typing import List, Optional
from app.models.schemas import SimState
from app.services import simulator

router = APIRouter()


@router.get("/state", response_model=SimState)
def get_sim_state() -> SimState:
    return simulator.get_state()


@router.post("/start")
def start_sim(tickers: Optional[List[str]] = None):
    simulator.start_simulation(tickers)
    return {"message": "Simulation started", "using_frozen_model": True}


@router.post("/stop")
def stop_sim():
    simulator.stop_simulation()
    return {"message": "Simulation stopped"}
