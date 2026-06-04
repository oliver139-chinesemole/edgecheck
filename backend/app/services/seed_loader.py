"""
Load seed CSV data from /data directory.
All public functions return DataFrames; callers handle the None case.
"""
from __future__ import annotations
import logging
import pandas as pd
from pathlib import Path
from functools import lru_cache

from app.config import get_settings

logger = logging.getLogger(__name__)


def _data_path(filename: str) -> Path:
    return Path(get_settings().data_dir) / filename


def _try_read(filename: str) -> pd.DataFrame | None:
    p = _data_path(filename)
    if not p.exists():
        logger.warning("Seed file missing: %s — run 'python3 data/generate_seed.py'", p)
        return None
    try:
        return pd.read_csv(p)
    except Exception as exc:
        logger.error("Failed to read %s: %s", p, exc)
        return None


@lru_cache(maxsize=1)
def load_prices() -> pd.DataFrame:
    df = _try_read("prices.csv")
    if df is None:
        return pd.DataFrame(columns=["date", "ticker", "open", "high", "low", "close", "volume"])
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values(["ticker", "date"]).reset_index(drop=True)


@lru_cache(maxsize=1)
def load_holdings() -> pd.DataFrame:
    df = _try_read("holdings.csv")
    if df is None:
        return pd.DataFrame(columns=["fund_name", "ticker", "shares", "value_usd", "quarter", "period_of_report", "portfolio_pct"])
    return df


@lru_cache(maxsize=1)
def load_insider_trades() -> pd.DataFrame:
    df = _try_read("insider_trades.csv")
    if df is None:
        return pd.DataFrame(columns=["insider_name", "title", "ticker", "transaction_type", "shares", "price", "date"])
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values("date", ascending=False).reset_index(drop=True)


@lru_cache(maxsize=1)
def load_congressional_trades() -> pd.DataFrame:
    df = _try_read("congressional_trades.csv")
    if df is None:
        return pd.DataFrame(columns=["politician", "chamber", "ticker", "transaction_type", "amount_range", "trade_date", "disclosure_date"])
    df["trade_date"] = pd.to_datetime(df["trade_date"])
    df["disclosure_date"] = pd.to_datetime(df["disclosure_date"])
    return df.sort_values("disclosure_date", ascending=False).reset_index(drop=True)


def seed_data_present() -> bool:
    return all(
        _data_path(f).exists()
        for f in ["prices.csv", "holdings.csv", "insider_trades.csv", "congressional_trades.csv"]
    )


def clear_cache():
    load_prices.cache_clear()
    load_holdings.cache_clear()
    load_insider_trades.cache_clear()
    load_congressional_trades.cache_clear()
