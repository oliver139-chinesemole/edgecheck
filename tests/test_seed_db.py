"""
Verify the database initializes correctly from seed data.
"""
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))


def test_db_creates_tables(tmp_path):
    import os
    os.environ["DB_PATH"] = str(tmp_path / "test.db")

    from app.database import init_db, get_engine, Base
    from app.config import get_settings

    # Reinitialize with fresh engine
    import app.database as db_module
    db_module._engine = None
    os.environ["DB_PATH"] = str(tmp_path / "test.db")

    init_db()

    from sqlalchemy import inspect
    inspector = inspect(get_engine())
    tables = inspector.get_table_names()
    assert "sim_trades" in tables, "sim_trades table must exist after init_db()"
    assert "retrain_log" in tables, "retrain_log table must exist after init_db()"


def test_seed_data_loads():
    """Seed CSVs must load without raising errors."""
    from app.services.seed_loader import (
        load_prices, load_holdings, load_insider_trades, load_congressional_trades
    )
    # Clear cache
    from app.services.seed_loader import clear_cache
    clear_cache()

    prices = load_prices()
    # If seed data exists, check shape. If not, verify graceful empty return.
    assert hasattr(prices, "columns"), "load_prices() must return a DataFrame"

    holdings = load_holdings()
    assert hasattr(holdings, "columns"), "load_holdings() must return a DataFrame"

    if len(prices) > 0:
        assert "ticker" in prices.columns
        assert "close" in prices.columns
        assert "date" in prices.columns
        tickers = prices["ticker"].unique()
        assert "SPY" in tickers, "SPY must be present in seed prices"

    if len(holdings) > 0:
        assert "fund_name" in holdings.columns
        assert "ticker" in holdings.columns
        assert "quarter" in holdings.columns


def test_seed_data_is_deterministic():
    """Loading seed data twice should produce identical results."""
    from app.services.seed_loader import load_prices, clear_cache

    clear_cache()
    df1 = load_prices()
    clear_cache()
    df2 = load_prices()

    if len(df1) > 0 and len(df2) > 0:
        import pandas as pd
        pd.testing.assert_frame_equal(df1.reset_index(drop=True), df2.reset_index(drop=True))
