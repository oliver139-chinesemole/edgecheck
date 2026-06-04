"""
Shared Pydantic data contracts for EdgeCheck.
These are the canonical shapes returned by the REST API.
"""
from __future__ import annotations
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Literal
from datetime import date


class _Base(BaseModel):
    model_config = ConfigDict(protected_namespaces=())


# ─── Smart Money (Tab A) ───────────────────────────────────────────────────

class Holding(_Base):
    fund_name: str
    ticker: str
    shares: int
    value_usd: float
    quarter: str
    period_of_report: str
    portfolio_pct: float = 0.0
    qoq_change: Optional[str] = None  # "new_buy" | "add" | "trim" | "exit" | "unchanged"
    shares_delta: int = 0


class InsiderTrade(_Base):
    insider_name: str
    title: str
    ticker: str
    transaction_type: str  # "Purchase" | "Sale"
    shares: int
    price: float
    date: str


class CongressionalTrade(_Base):
    politician: str
    chamber: str
    ticker: str
    transaction_type: str
    amount_range: str
    trade_date: str
    disclosure_date: str


class ConsensusSignal(_Base):
    ticker: str
    signal_type: Literal["new_buy", "add", "trim", "exit", "consensus_hold"]
    fund_count: int
    avg_weight_pct: float
    quarter: str
    conviction_score: float = Field(ge=0.0, le=1.0)
    description: str
    data_lag_days: int = 45


class SmartMoneyResponse(_Base):
    holdings: List[Holding]
    signals: List[ConsensusSignal]
    insider_trades: List[InsiderTrade]
    congressional_trades: List[CongressionalTrade]
    latest_quarter: str
    using_sample_data: bool
    data_lag_note: str


# ─── Backtest (Tab B) ──────────────────────────────────────────────────────

class BacktestConfig(_Base):
    strategy: Literal["selective_clone", "ml_classifier"] = "ml_classifier"
    start_date: str = "2022-01-03"
    end_date: str = "2024-06-30"
    initial_capital: float = 100_000.0
    pt_barrier: float = Field(0.03, ge=0.005, le=0.20, description="Profit take barrier")
    sl_barrier: float = Field(0.02, ge=0.005, le=0.10, description="Stop loss barrier")
    t1_bars: int = Field(20, ge=5, le=60, description="Time barrier in trading days")
    tickers: List[str] = ["AAPL", "MSFT", "NVDA", "META", "AMZN"]


class EquityPoint(_Base):
    date: str
    strategy_value: float
    benchmark_value: float


class ModelCard(_Base):
    model_type: str
    training_window_start: str
    training_window_end: str
    features: List[str]
    n_train_samples: int
    train_accuracy: float
    cv_accuracy: float
    frozen_at: str
    artifact_path: str
    config: BacktestConfig


class BacktestResult(_Base):
    equity_curve: List[EquityPoint]
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown: float
    win_rate: float
    cagr: float
    total_trades: int
    benchmark_sharpe: float
    benchmark_cagr: float
    model_card: Optional[ModelCard] = None
    strategy: str
    using_sample_data: bool
    no_edge_note: str = (
        "No edge found is a valid, expected outcome. "
        "Underperforming buy-and-hold SPY is the most likely result."
    )


# ─── Simulation (Tab C) ───────────────────────────────────────────────────

class Position(_Base):
    ticker: str
    shares: float
    entry_price: float
    current_price: float
    unrealized_pnl: float
    unrealized_pnl_pct: float
    is_short: bool = False


class SimState(_Base):
    status: Literal["running", "stopped", "error", "no_model"]
    equity_curve: List[EquityPoint]
    current_positions: List[Position]
    portfolio_value: float
    realized_return_pct: float
    benchmark_return_pct: float
    divergence_pct: float  # realized - backtest; large divergence = possible overfit
    sharpe_ratio: float
    max_drawdown: float
    trade_count: int
    data_source: Literal["alpaca", "seed"]
    model_frozen: bool
    model_card: Optional[ModelCard] = None
    using_sample_data: bool
    last_updated: str
    divergence_warning: bool = False
    message: str = ""


# ─── Improvement Log (Tab D) ──────────────────────────────────────────────

class ChallengerResult(_Base):
    model_id: str
    model_type: str
    trained_at: str
    oos_sharpe: float
    oos_cagr: float
    oos_max_drawdown: float
    champion_sharpe: float
    promoted: bool
    promotion_reason: Optional[str] = None
    notes: str = ""


class ImprovementLogResponse(_Base):
    champion: Optional[ModelCard]
    challengers: List[ChallengerResult]
    holdout_start: str
    holdout_end: str
    holdout_note: str
    multiple_testing_note: str
    retrain_log: List[dict]


# ─── Health ───────────────────────────────────────────────────────────────

class HealthResponse(_Base):
    status: str
    version: str
    has_alpaca: bool
    has_fmp: bool
    model_ready: bool
    seed_data_present: bool
    db_initialized: bool
