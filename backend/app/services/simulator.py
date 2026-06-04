"""
Event-driven paper trading simulator.
Loads the frozen model read-only — never retrains it.
Uses seed price stream when Alpaca key is absent.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import List, Optional

import numpy as np
import pandas as pd

from app.config import get_settings
from app.models.schemas import EquityPoint, Position, SimState
from app.services import model_manager
from app.services.backtest_engine import (
    apply_costs, build_feature_matrix, FEATURES, compute_metrics
)
from app.services.seed_loader import load_prices

logger = logging.getLogger(__name__)

_sim_lock = threading.Lock()

class _SimState:
    def __init__(self):
        self.reset()

    def reset(self):
        self.running = False
        self.equity_curve: List[dict] = []
        self.positions: dict = {}
        self.cash: float = get_settings().initial_capital
        self.initial_capital: float = get_settings().initial_capital
        self.trade_count: int = 0
        self.data_source: str = "seed"
        self.error: Optional[str] = None
        self.current_idx: int = 0
        self.all_dates: List = []
        self.prices_df: Optional[pd.DataFrame] = None
        self.features_df: Optional[pd.DataFrame] = None
        self.backtest_cagr: float = 0.0

_state = _SimState()


def _try_alpaca_data() -> Optional[pd.DataFrame]:
    settings = get_settings()
    if not settings.has_alpaca:
        return None
    try:
        from alpaca.data.historical import StockHistoricalDataClient
        from alpaca.data.requests import StockBarsRequest
        from alpaca.data.timeframe import TimeFrame
        import datetime as dt

        client = StockHistoricalDataClient(settings.alpaca_api_key, settings.alpaca_secret_key)
        tickers = ["SPY", "AAPL", "MSFT", "NVDA", "META"]
        req = StockBarsRequest(
            symbol_or_symbols=tickers,
            timeframe=TimeFrame.Day,
            start=dt.datetime(2023, 1, 1),
        )
        bars = client.get_stock_bars(req).df
        bars = bars.reset_index()
        bars = bars.rename(columns={"symbol": "ticker", "timestamp": "date",
                                     "open": "open", "high": "high",
                                     "low": "low", "close": "close",
                                     "volume": "volume"})
        bars["date"] = pd.to_datetime(bars["date"]).dt.tz_localize(None)
        return bars[["date", "ticker", "open", "high", "low", "close", "volume"]]
    except Exception as exc:
        logger.warning("Alpaca data fetch failed, falling back to seed: %s", exc)
        return None


def start_simulation(tickers: Optional[List[str]] = None) -> None:
    global _state
    with _sim_lock:
        if _state.running:
            return
        _state.reset()

    bundle = model_manager.load_model()
    if bundle is None:
        with _sim_lock:
            _state.error = "no_model"
        return

    tickers = tickers or ["AAPL", "MSFT", "NVDA", "META", "AMZN"]

    # Try real data first, fall back to seed
    prices_df = _try_alpaca_data()
    data_source = "alpaca"
    if prices_df is None:
        prices_df = load_prices()
        data_source = "seed"

    if prices_df.empty:
        with _sim_lock:
            _state.error = "no_data"
        return

    features_df = build_feature_matrix(prices_df, tickers)

    with _sim_lock:
        _state.prices_df = prices_df
        _state.features_df = features_df
        _state.data_source = data_source
        _state.all_dates = sorted(prices_df["date"].unique())
        _state.running = True

    # Run in a background thread so API stays responsive
    t = threading.Thread(target=_run_loop, args=(tickers,), daemon=True)
    t.start()


def stop_simulation() -> None:
    with _sim_lock:
        _state.running = False


def _run_loop(tickers: List[str]) -> None:
    """
    Step through each trading day, run model inference, manage positions.
    Model is loaded read-only — predict() is the only call made.
    """
    settings = get_settings()
    initial_cap = settings.initial_capital
    capital_per = initial_cap / max(len(tickers), 1) * 0.9

    with _sim_lock:
        all_dates = list(_state.all_dates)
        prices_df = _state.prices_df.copy()
        features_df = _state.features_df.copy() if _state.features_df is not None else pd.DataFrame()

    # Skip first 252 bars (burn-in for features)
    start_idx = 252
    spy_start = None

    for i, date in enumerate(all_dates):
        with _sim_lock:
            if not _state.running:
                break

        px_today = prices_df[prices_df["date"] == date]
        spy_row = px_today[px_today["ticker"] == "SPY"]
        if len(spy_row) > 0:
            spy_now = float(spy_row.iloc[0]["close"])
            if spy_start is None:
                spy_start = spy_now

        if i < start_idx:
            continue

        # Mark-to-market
        with _sim_lock:
            port_value = _state.cash
            for ticker, pos in _state.positions.items():
                px = px_today[px_today["ticker"] == ticker]
                if len(px) > 0:
                    port_value += pos["shares"] * float(px.iloc[0]["close"])
                else:
                    port_value += pos["shares"] * pos["entry_price"]

        spy_value = (spy_now / spy_start * initial_cap) if spy_start else initial_cap

        with _sim_lock:
            _state.equity_curve.append({
                "date": str(date.date() if hasattr(date, "date") else date),
                "strategy_value": round(float(port_value), 2),
                "benchmark_value": round(float(spy_value), 2),
            })

        # Generate signals for each ticker
        if not features_df.empty:
            feat_today = features_df[features_df["date"] == date]
            for _, row in feat_today.iterrows():
                ticker = row["ticker"]
                if ticker not in tickers:
                    continue
                px = px_today[px_today["ticker"] == ticker]
                if len(px) == 0:
                    continue
                curr_price = float(px.iloc[0]["close"])

                signal = model_manager.predict(row[FEATURES].values)

                with _sim_lock:
                    # Exit if signal changed
                    if ticker in _state.positions and signal != 1:
                        pos = _state.positions[ticker]
                        gross = curr_price / pos["entry_price"] - 1
                        holding_days = max(1, (i - pos.get("entry_idx", i)))
                        net = apply_costs(gross, holding_days=holding_days)
                        _state.cash += pos["shares"] * curr_price
                        del _state.positions[ticker]
                        _state.trade_count += 1

                    # Enter new long
                    if signal == 1 and ticker not in _state.positions:
                        if _state.cash >= capital_per:
                            shares = capital_per / curr_price
                            _state.cash -= capital_per
                            _state.positions[ticker] = {
                                "shares": shares,
                                "entry_price": curr_price,
                                "entry_idx": i,
                            }

    with _sim_lock:
        _state.running = False
        logger.info("Simulation complete. Trades executed: %d", _state.trade_count)


def get_state() -> SimState:
    bundle = model_manager.load_model()

    with _sim_lock:
        if _state.error == "no_model":
            return SimState(
                status="no_model",
                equity_curve=[],
                current_positions=[],
                portfolio_value=0,
                realized_return_pct=0,
                benchmark_return_pct=0,
                divergence_pct=0,
                sharpe_ratio=0,
                max_drawdown=0,
                trade_count=0,
                data_source="seed",
                model_frozen=False,
                using_sample_data=True,
                last_updated=datetime.now(timezone.utc).isoformat(),
                message="No model trained yet. Run a backtest in Tab B to train and freeze the model.",
            )

        if _state.error == "no_data":
            return SimState(
                status="error",
                equity_curve=[],
                current_positions=[],
                portfolio_value=0,
                realized_return_pct=0,
                benchmark_return_pct=0,
                divergence_pct=0,
                sharpe_ratio=0,
                max_drawdown=0,
                trade_count=0,
                data_source="seed",
                model_frozen=bundle is not None,
                using_sample_data=True,
                last_updated=datetime.now(timezone.utc).isoformat(),
                message="No price data available. Run 'python3 data/generate_seed.py' to create seed data.",
            )

        equity_curve = list(_state.equity_curve[-500:])  # last 500 points
        positions = dict(_state.positions)
        cash = _state.cash
        trade_count = _state.trade_count
        running = _state.running
        data_source = _state.data_source
        prices_df = _state.prices_df

    # Build position list
    pos_list = []
    if prices_df is not None:
        last_prices = prices_df.sort_values("date").groupby("ticker").last()["close"].to_dict()
    else:
        last_prices = {}

    for ticker, pos in positions.items():
        curr = last_prices.get(ticker, pos["entry_price"])
        upnl = (curr / pos["entry_price"] - 1) * pos["shares"] * pos["entry_price"]
        upnl_pct = curr / pos["entry_price"] - 1
        pos_list.append(Position(
            ticker=ticker,
            shares=round(pos["shares"], 4),
            entry_price=round(pos["entry_price"], 2),
            current_price=round(float(curr), 2),
            unrealized_pnl=round(float(upnl), 2),
            unrealized_pnl_pct=round(float(upnl_pct), 4),
        ))

    port_value = cash + sum(
        p.shares * p.current_price for p in pos_list
    )
    initial_cap = get_settings().initial_capital

    # Metrics from equity curve
    if len(equity_curve) >= 5:
        strat_series = pd.Series([p["strategy_value"] for p in equity_curve])
        bench_series = pd.Series([p["benchmark_value"] for p in equity_curve])
        metrics = compute_metrics(strat_series)
        realized_ret = float(strat_series.iloc[-1] / initial_cap - 1) * 100
        bench_ret = float(bench_series.iloc[-1] / initial_cap - 1) * 100
    else:
        metrics = {"sharpe": 0.0, "sortino": 0.0, "max_drawdown": 0.0, "cagr": 0.0}
        realized_ret = 0.0
        bench_ret = 0.0

    divergence = realized_ret - bench_ret
    divergence_warning = abs(divergence) > 20.0

    card = model_manager.get_model_card()
    using_sample = data_source == "seed"

    status = "running" if running else "stopped"

    return SimState(
        status=status,
        equity_curve=[EquityPoint(**p) for p in equity_curve],
        current_positions=pos_list,
        portfolio_value=round(float(port_value), 2),
        realized_return_pct=round(realized_ret, 2),
        benchmark_return_pct=round(bench_ret, 2),
        divergence_pct=round(divergence, 2),
        sharpe_ratio=metrics["sharpe"],
        max_drawdown=metrics["max_drawdown"],
        trade_count=trade_count,
        data_source=data_source,
        model_frozen=True,
        model_card=card,
        using_sample_data=using_sample,
        last_updated=datetime.now(timezone.utc).isoformat(),
        divergence_warning=divergence_warning,
        message="" if not using_sample else "Using seed data — add ALPACA_API_KEY to .env to go live.",
    )
