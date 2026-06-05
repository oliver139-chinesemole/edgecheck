"""
Market Simulator — Trading, Portfolio, and Leaderboard API.

Routes:
  POST /games/{id}/trade         — buy or sell
  GET  /games/{id}/portfolio     — holdings + cash + equity
  GET  /games/{id}/transactions  — trade history
  GET  /games/{id}/leaderboard   — sorted standings
  GET  /games/{id}/watchlist     — watchlist tickers
  POST /games/{id}/watchlist     — add ticker
  DELETE /games/{id}/watchlist/{ticker} — remove ticker
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from app.database import (
    get_session,
    MsGameRecord, MsParticipantRecord,
    MsHoldingRecord, MsTransactionRecord, MsWatchlistRecord,
)
from app.services import market_data as md

logger = logging.getLogger(__name__)
router = APIRouter()

_DISCLAIMER = "Virtual money only — not financial advice — educational simulator."


# ── Helpers ───────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _today() -> str:
    return date.today().isoformat()

def _require_user(x: str | None) -> str:
    if not x or not x.strip():
        raise HTTPException(401, detail="X-Username header required.")
    return x.strip()

def _game_status(g: MsGameRecord) -> str:
    t = _today()
    if t < g.start_date: return "pending"
    if t > g.end_date:   return "ended"
    return "active"


# ── Trade request ─────────────────────────────────────────────────────────

class TradeRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    ticker:      str
    side:        str    # "buy" | "sell"
    order_type:  str = "market"  # "market" | "limit"
    qty:         float
    limit_price: Optional[float] = None


# ── POST /games/{id}/trade ────────────────────────────────────────────────

@router.post("/games/{game_id}/trade")
def place_trade(
    game_id: str,
    req: TradeRequest,
    x_username: Optional[str] = Header(None),
):
    username = _require_user(x_username)
    ticker   = req.ticker.upper()

    if req.qty <= 0:
        raise HTTPException(400, detail="Quantity must be positive.")
    if req.side not in ("buy", "sell"):
        raise HTTPException(400, detail="Side must be 'buy' or 'sell'.")
    if req.order_type not in ("market", "limit"):
        raise HTTPException(400, detail="Order type must be 'market' or 'limit'.")

    with get_session() as sess:
        g = sess.get(MsGameRecord, game_id)
        if not g:
            raise HTTPException(404, detail="Game not found.")

        status = _game_status(g)
        if status == "pending":
            raise HTTPException(400, detail="Game has not started yet.")
        if status == "ended":
            raise HTTPException(400, detail="This game has ended.")

        p = sess.query(MsParticipantRecord).filter_by(
            game_id=game_id, username=username
        ).first()
        if not p:
            raise HTTPException(403, detail="You are not a participant in this game.")

        # Get current market price
        quote = md.get_quote(ticker)
        if quote is None:
            raise HTTPException(422, detail=f"Could not get price for '{ticker}'. Check the symbol.")

        if req.order_type == "limit":
            if req.limit_price is None or req.limit_price <= 0:
                raise HTTPException(400, detail="Limit price required for limit orders.")
            # For simulator: fill limit orders immediately if price is favorable
            if req.side == "buy" and quote.price > req.limit_price:
                raise HTTPException(422, detail=f"Limit price ${req.limit_price:.2f} is below current price ${quote.price:.2f}. Order not filled.")
            if req.side == "sell" and quote.price < req.limit_price:
                raise HTTPException(422, detail=f"Limit price ${req.limit_price:.2f} is above current price ${quote.price:.2f}. Order not filled.")
            fill_price = req.limit_price
        else:
            fill_price = quote.price

        commission = g.commission
        total_cost: float

        holding = sess.query(MsHoldingRecord).filter_by(
            game_id=game_id, username=username, ticker=ticker
        ).first()

        if req.side == "buy":
            total_cost = fill_price * req.qty + commission
            if p.cash < total_cost:
                raise HTTPException(400, detail=f"Insufficient cash. Need ${total_cost:,.2f}, have ${p.cash:,.2f}.")

            # Max position size check
            if g.max_position_pct < 1.0:
                portfolio_val = _calc_portfolio_value(sess, game_id, username, p.cash)
                new_position_val = fill_price * (req.qty + (holding.shares if holding else 0))
                if new_position_val / portfolio_val > g.max_position_pct:
                    raise HTTPException(400, detail=f"Position would exceed {g.max_position_pct*100:.0f}% max size limit.")

            p.cash = round(p.cash - total_cost, 6)
            if holding:
                total_qty = holding.shares + req.qty
                holding.avg_cost = round(
                    (holding.avg_cost * holding.shares + fill_price * req.qty) / total_qty, 6
                )
                holding.shares = round(total_qty, 6)
                holding.updated_at = _now()
            else:
                sess.add(MsHoldingRecord(
                    game_id=game_id, username=username, ticker=ticker,
                    shares=round(req.qty, 6),
                    avg_cost=round(fill_price, 6),
                    updated_at=_now(),
                ))

        else:  # sell
            if not g.allow_short and (not holding or holding.shares < req.qty):
                have = holding.shares if holding else 0
                raise HTTPException(400, detail=f"Insufficient shares. Have {have:.4f}, selling {req.qty:.4f}.")

            proceeds = fill_price * req.qty - commission
            p.cash = round(p.cash + proceeds, 6)

            if holding:
                holding.shares = round(holding.shares - req.qty, 6)
                holding.updated_at = _now()
                if holding.shares <= 1e-9:
                    sess.delete(holding)
            total_cost = -proceeds   # negative means cash received

        # Record transaction
        sess.add(MsTransactionRecord(
            game_id=game_id, username=username, ticker=ticker,
            side=req.side, order_type=req.order_type,
            qty=round(req.qty, 6), fill_price=round(fill_price, 6),
            commission=commission, total_cost=round(total_cost, 6),
            executed_at=_now(),
        ))
        sess.commit()

    md.invalidate(ticker)
    return {
        "message":    f"{'Bought' if req.side == 'buy' else 'Sold'} {req.qty} {ticker} @ ${fill_price:.2f}",
        "fill_price": fill_price,
        "qty":        req.qty,
        "side":       req.side,
        "ticker":     ticker,
        "disclaimer": _DISCLAIMER,
    }


def _calc_portfolio_value(sess, game_id: str, username: str, cash: float) -> float:
    """Quick portfolio value without market call (uses avg_cost as proxy)."""
    holdings = sess.query(MsHoldingRecord).filter_by(
        game_id=game_id, username=username
    ).all()
    value = cash
    for h in holdings:
        value += h.shares * h.avg_cost
    return value


# ── GET /games/{id}/portfolio ─────────────────────────────────────────────

@router.get("/games/{game_id}/portfolio")
def get_portfolio(
    game_id: str,
    x_username: Optional[str] = Header(None),
):
    username = _require_user(x_username)

    with get_session() as sess:
        p = sess.query(MsParticipantRecord).filter_by(
            game_id=game_id, username=username
        ).first()
        if not p:
            raise HTTPException(403, detail="You are not in this game.")

        g = sess.get(MsGameRecord, game_id)
        holdings = sess.query(MsHoldingRecord).filter_by(
            game_id=game_id, username=username
        ).all()

        # Batch-fetch prices
        tickers = [h.ticker for h in holdings]
        quotes = md.get_quotes(tickers) if tickers else {}

        positions = []
        market_value_total = 0.0
        for h in holdings:
            q = quotes.get(h.ticker)
            curr_price = q.price if q else h.avg_cost
            mkt_val = h.shares * curr_price
            cost_basis = h.shares * h.avg_cost
            gain = mkt_val - cost_basis
            gain_pct = (gain / cost_basis * 100) if cost_basis else 0.0
            market_value_total += mkt_val
            positions.append({
                "ticker":     h.ticker,
                "name":       q.name if q else h.ticker,
                "shares":     round(h.shares, 4),
                "avg_cost":   round(h.avg_cost, 4),
                "curr_price": round(curr_price, 4),
                "market_value": round(mkt_val, 2),
                "gain":       round(gain, 2),
                "gain_pct":   round(gain_pct, 4),
                "weight_pct": 0.0,   # computed below
            })

        total_equity = round(p.cash + market_value_total, 2)
        for pos in positions:
            pos["weight_pct"] = round(
                pos["market_value"] / total_equity * 100 if total_equity else 0, 2
            )

        total_return = round((total_equity / g.starting_cash - 1) * 100, 4)

        return {
            "game_id":      game_id,
            "username":     username,
            "cash":         round(p.cash, 2),
            "market_value": round(market_value_total, 2),
            "total_equity": total_equity,
            "starting_cash":g.starting_cash,
            "total_return_pct": total_return,
            "positions":    sorted(positions, key=lambda x: -x["market_value"]),
            "data_source":  "delayed_15min",
            "disclaimer":   _DISCLAIMER,
        }


# ── GET /games/{id}/transactions ──────────────────────────────────────────

@router.get("/games/{game_id}/transactions")
def get_transactions(
    game_id: str,
    limit: int = Query(50, ge=1, le=200),
    x_username: Optional[str] = Header(None),
):
    username = _require_user(x_username)
    with get_session() as sess:
        txns = (
            sess.query(MsTransactionRecord)
            .filter_by(game_id=game_id, username=username)
            .order_by(MsTransactionRecord.executed_at.desc())
            .limit(limit)
            .all()
        )
        return {
            "transactions": [
                {
                    "id":          t.id,
                    "ticker":      t.ticker,
                    "side":        t.side,
                    "order_type":  t.order_type,
                    "qty":         t.qty,
                    "fill_price":  t.fill_price,
                    "commission":  t.commission,
                    "total_cost":  t.total_cost,
                    "executed_at": t.executed_at,
                }
                for t in txns
            ]
        }


# ── GET /games/{id}/leaderboard ───────────────────────────────────────────

@router.get("/games/{game_id}/leaderboard")
def get_leaderboard(game_id: str, x_username: Optional[str] = Header(None)):
    caller = (x_username or "").strip()

    with get_session() as sess:
        g = sess.get(MsGameRecord, game_id)
        if not g:
            raise HTTPException(404, detail="Game not found.")

        participants = sess.query(MsParticipantRecord).filter_by(game_id=game_id).all()

        # Gather all tickers in the game
        all_holdings = sess.query(MsHoldingRecord).filter_by(game_id=game_id).all()
        all_tickers = list({h.ticker for h in all_holdings})
        quotes = md.get_quotes(all_tickers) if all_tickers else {}

        rows = []
        for p in participants:
            p_holdings = [h for h in all_holdings if h.username == p.username]
            mkt_val = sum(
                h.shares * (quotes[h.ticker].price if quotes.get(h.ticker) else h.avg_cost)
                for h in p_holdings
            )
            equity = p.cash + mkt_val
            ret_pct = round((equity / g.starting_cash - 1) * 100, 4)
            n_trades = sess.query(MsTransactionRecord).filter_by(
                game_id=game_id, username=p.username
            ).count()
            rows.append({
                "username":    p.username,
                "total_equity": round(equity, 2),
                "return_pct":  ret_pct,
                "cash":        round(p.cash, 2),
                "n_trades":    n_trades,
                "is_me":       p.username == caller,
            })

        # Sort by chosen metric
        key = "return_pct" if g.rank_by == "return_pct" else "total_equity"
        rows.sort(key=lambda r: -r[key])
        for i, row in enumerate(rows):
            row["rank"] = i + 1

        my_rank = next((r["rank"] for r in rows if r["is_me"]), None)
        return {
            "game_id":    game_id,
            "rank_by":    g.rank_by,
            "entries":    rows,
            "my_rank":    my_rank,
            "data_source": "delayed_15min",
        }


# ── Watchlist ─────────────────────────────────────────────────────────────

class WatchlistAddRequest(BaseModel):
    ticker: str


@router.get("/games/{game_id}/watchlist")
def get_watchlist(game_id: str, x_username: Optional[str] = Header(None)):
    username = _require_user(x_username)
    with get_session() as sess:
        items = sess.query(MsWatchlistRecord).filter_by(
            game_id=game_id, username=username
        ).all()
        tickers = [w.ticker for w in items]
        quotes = md.get_quotes(tickers) if tickers else {}
        return {
            "watchlist": [
                {
                    "ticker":     w.ticker,
                    "name":       quotes[w.ticker].name if quotes.get(w.ticker) else w.ticker,
                    "price":      quotes[w.ticker].price if quotes.get(w.ticker) else None,
                    "change_pct": quotes[w.ticker].change_pct if quotes.get(w.ticker) else None,
                    "added_at":   w.added_at,
                }
                for w in items
            ]
        }


@router.post("/games/{game_id}/watchlist")
def add_watchlist(
    game_id: str,
    req: WatchlistAddRequest,
    x_username: Optional[str] = Header(None),
):
    username = _require_user(x_username)
    ticker = req.ticker.upper()
    with get_session() as sess:
        existing = sess.query(MsWatchlistRecord).filter_by(
            game_id=game_id, username=username, ticker=ticker
        ).first()
        if not existing:
            sess.add(MsWatchlistRecord(
                game_id=game_id, username=username,
                ticker=ticker, added_at=_now(),
            ))
            sess.commit()
    return {"message": f"Added {ticker} to watchlist."}


@router.delete("/games/{game_id}/watchlist/{ticker}")
def remove_watchlist(
    game_id: str, ticker: str,
    x_username: Optional[str] = Header(None),
):
    username = _require_user(x_username)
    with get_session() as sess:
        item = sess.query(MsWatchlistRecord).filter_by(
            game_id=game_id, username=username, ticker=ticker.upper()
        ).first()
        if item:
            sess.delete(item)
            sess.commit()
    return {"message": f"Removed {ticker.upper()} from watchlist."}
