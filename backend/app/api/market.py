"""
Market data API — quote, search, chart.
Data is ~15-min delayed (yfinance free tier).  Label is included in every response.
"""
from __future__ import annotations

from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
from app.services import market_data as md

router = APIRouter()


@router.get("/quote/{ticker}")
def get_quote(ticker: str):
    q = md.get_quote(ticker.upper())
    if q is None:
        raise HTTPException(404, detail=f"No data for ticker '{ticker.upper()}'. Check the symbol.")
    return {
        "ticker":      q.ticker,
        "name":        q.name,
        "price":       q.price,
        "prev_close":  q.prev_close,
        "change":      q.change,
        "change_pct":  q.change_pct,
        "volume":      q.volume,
        "market_cap":  q.market_cap,
        "currency":    q.currency,
        "data_source": q.data_source,
        "as_of":       q.as_of,
    }


@router.get("/quotes")
def get_quotes(tickers: str = Query(..., description="Comma-separated ticker symbols")):
    syms = [t.strip().upper() for t in tickers.split(",") if t.strip()][:20]
    results = md.get_quotes(syms)
    out = {}
    for ticker, q in results.items():
        if q:
            out[ticker] = {
                "ticker":     q.ticker,
                "name":       q.name,
                "price":      q.price,
                "change":     q.change,
                "change_pct": q.change_pct,
                "data_source": q.data_source,
            }
    return {"quotes": out, "data_source": "delayed_15min"}


@router.get("/search")
def search_tickers(q: str = Query("", description="Search query")):
    results = md.search(q)
    return {
        "results": [
            {"ticker": r.ticker, "name": r.name, "type": r.type, "exchange": r.exchange}
            for r in results
        ]
    }


@router.get("/chart/{ticker}")
def get_chart(ticker: str, period: str = Query("1mo")):
    bars = md.get_history(ticker.upper(), period)
    return {
        "ticker": ticker.upper(),
        "period": period,
        "bars": [
            {"date": b.date, "open": b.open, "high": b.high,
             "low": b.low, "close": b.close, "volume": b.volume}
            for b in bars
        ],
        "data_source": "delayed_15min",
    }
