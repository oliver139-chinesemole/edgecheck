"""
Human Trading Simulator API.

REST endpoints:
  GET  /api/sim/state          — full SimState
  POST /api/sim/order          — submit an order
  DELETE /api/sim/order/{id}   — cancel pending order
  POST /api/sim/reset          — reset to $100k

WebSocket:
  WS /ws/sim                   — pushes portfolio + price ticks every 1 second
    Without Alpaca key: replays seed prices (one daily bar per second)
    With Alpaca key:    streams live prices via alpaca-py

Tick message format:
  {"type": "tick", "prices": {...}, "portfolio": {...}, "timestamp": "..."}
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict

from app.config import get_settings
from app.database import get_session, SimSessionRecord, SimOrderRecord
from app.services.sim_core import SimCore
from app.services.seed_loader import load_prices

logger = logging.getLogger(__name__)

router = APIRouter()

# ─── Shared SimCore instance (Feature A) ─────────────────────────────────

_sim = SimCore(initial_capital=100_000.0, realism_mode=True)
_session_id: str = str(uuid4())
_replay_lock = threading.Lock()


# ─── Pydantic request models ──────────────────────────────────────────────

class OrderRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    ticker: str
    side: str       # buy | sell | short | cover
    order_type: str = "market"  # market | limit | stop
    qty: float
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None
    prices: Optional[Dict[str, float]] = None  # optional current prices to update sim


# ─── REST endpoints ───────────────────────────────────────────────────────

@router.get("/state")
def get_state() -> dict:
    """Return full portfolio state."""
    portfolio = _sim.get_portfolio()
    orders = _sim.get_orders(limit=20)
    settings = get_settings()
    return {
        "portfolio": portfolio,
        "orders": orders,
        "session_id": _session_id,
        "data_source": "alpaca" if settings.has_alpaca else "seed",
        "realism_mode": True,
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "disclaimer": "Virtual account — not real money — not financial advice.",
    }


@router.post("/order")
def submit_order(req: OrderRequest) -> dict:
    """Submit a new order."""
    # If caller provides current prices, update sim first
    if req.prices:
        _sim.update_prices(req.prices)

    try:
        order = _sim.submit_order(
            ticker=req.ticker.upper(),
            side=req.side,  # type: ignore[arg-type]
            order_type=req.order_type,  # type: ignore[arg-type]
            qty=req.qty,
            limit_price=req.limit_price,
            stop_price=req.stop_price,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Persist to DB
    _save_order_to_db(order.to_dict())

    return {"order": order.to_dict(), "portfolio": _sim.get_portfolio()}


@router.delete("/order/{order_id}")
def cancel_order(order_id: str) -> dict:
    """Cancel a pending order."""
    cancelled = _sim.cancel_order(order_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="Order not found or already filled")
    return {"cancelled": True, "order_id": order_id}


@router.post("/reset")
def reset_simulator() -> dict:
    """Reset simulator to $100k cash.  Saves session snapshot first."""
    global _session_id
    portfolio = _sim.get_portfolio()
    _save_session_snapshot(portfolio)

    _sim.reset()
    _session_id = str(uuid4())
    return {
        "reset": True,
        "session_id": _session_id,
        "portfolio": _sim.get_portfolio(),
    }


# ─── WebSocket price replay ───────────────────────────────────────────────

class _ReplayState:
    """Shared state for the seed-price replay loop."""
    def __init__(self) -> None:
        self._prices_df = None
        self._dates = None
        self._price_matrix: Dict[str, List[float]] = {}
        self._idx = 0
        self._loaded = False
        self._lock = threading.Lock()

    def load(self) -> None:
        with self._lock:
            if self._loaded:
                return
            df = load_prices()
            if df.empty:
                self._loaded = True
                return
            tickers = list(df["ticker"].unique())
            dates = sorted(df["date"].unique())
            self._dates = dates
            for t in tickers:
                sub = df[df["ticker"] == t].set_index("date")["close"]
                sub = sub.reindex(dates).ffill().bfill()
                self._price_matrix[t] = list(sub.values.astype(float))
            # Start halfway through for a decent initial spread
            self._idx = max(0, len(dates) // 2)
            self._loaded = True

    def next_tick(self) -> Dict[str, float]:
        with self._lock:
            if not self._dates:
                return {}
            snap: Dict[str, float] = {}
            for t, prices in self._price_matrix.items():
                if self._idx < len(prices):
                    v = prices[self._idx]
                    if v == v:  # not NaN
                        snap[t] = float(v)
            self._idx = (self._idx + 1) % max(len(self._dates), 1)
            return snap


_replay_state = _ReplayState()
_active_ws: List[WebSocket] = []
_replay_task_started = False
_replay_task_lock = asyncio.Lock()


async def _get_prices_tick() -> Dict[str, float]:
    """Return the next price snapshot."""
    settings = get_settings()
    if settings.has_alpaca:
        return await _alpaca_tick()
    return _replay_state.next_tick()


async def _alpaca_tick() -> Dict[str, float]:
    """Attempt to get live prices from Alpaca; fall back to replay."""
    settings = get_settings()
    try:
        import asyncio as _asyncio
        from alpaca.data.historical import StockHistoricalDataClient
        from alpaca.data.requests import StockLatestBarRequest

        def _fetch() -> Dict[str, float]:
            client = StockHistoricalDataClient(
                settings.alpaca_api_key, settings.alpaca_secret_key
            )
            tickers = ["AAPL", "MSFT", "NVDA", "META", "AMZN", "SPY"]
            req = StockLatestBarRequest(symbol_or_symbols=tickers)
            bars = client.get_stock_latest_bar(req)
            return {sym: float(bar.close) for sym, bar in bars.items()}

        return await asyncio.get_event_loop().run_in_executor(None, _fetch)
    except Exception as exc:
        logger.warning("Alpaca tick failed, using replay: %s", exc)
        return _replay_state.next_tick()


@router.websocket("/ws")
async def websocket_sim(ws: WebSocket) -> None:
    """
    WebSocket endpoint — pushes tick + portfolio JSON every 1 second.
    """
    await ws.accept()
    _replay_state.load()
    _active_ws.append(ws)
    settings = get_settings()
    data_source = "alpaca" if settings.has_alpaca else "seed"

    try:
        while True:
            prices = await _get_prices_tick()
            if prices:
                _sim.update_prices(prices)
            portfolio = _sim.get_portfolio()

            payload = {
                "type": "tick",
                "prices": prices,
                "portfolio": portfolio,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data_source": data_source,
            }
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                break
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("WebSocket closed: %s", exc)
    finally:
        if ws in _active_ws:
            _active_ws.remove(ws)


# ─── DB helpers ───────────────────────────────────────────────────────────

def _save_order_to_db(order_dict: dict) -> None:
    try:
        sess = get_session()
        rec = SimOrderRecord(
            order_id=order_dict["order_id"],
            session_id=_session_id,
            ticker=order_dict["ticker"],
            side=order_dict["side"],
            order_type=order_dict["order_type"],
            qty=order_dict["qty"],
            limit_price=order_dict.get("limit_price"),
            stop_price=order_dict.get("stop_price"),
            status=order_dict["status"],
            submitted_at=order_dict["submitted_at"],
            filled_at=order_dict.get("filled_at"),
            fill_price=order_dict.get("fill_price"),
            fill_qty=order_dict.get("fill_qty"),
            message=order_dict.get("message", ""),
        )
        sess.add(rec)
        sess.commit()
        sess.close()
    except Exception as exc:
        logger.warning("Failed to persist order to DB: %s", exc)


def _save_session_snapshot(portfolio: dict) -> None:
    try:
        sess = get_session()
        rec = SimSessionRecord(
            session_id=_session_id,
            created_at=datetime.now(timezone.utc).isoformat(),
            final_equity=portfolio.get("equity", 100_000.0),
            n_trades=portfolio.get("trade_count", 0),
        )
        sess.add(rec)
        sess.commit()
        sess.close()
    except Exception as exc:
        logger.warning("Failed to persist session snapshot to DB: %s", exc)
