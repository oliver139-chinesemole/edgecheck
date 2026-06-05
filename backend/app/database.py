"""
SQLAlchemy setup and DB seed logic.
The DB is seeded from CSVs in /data on first run if empty.
"""
from __future__ import annotations

import logging
from pathlib import Path
from sqlalchemy import create_engine, Column, String, Float, Integer, Text, text
from sqlalchemy.orm import DeclarativeBase, Session
from sqlalchemy.pool import StaticPool

from app.config import get_settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


class SimTradeRecord(Base):
    __tablename__ = "sim_trades"
    id = Column(Integer, primary_key=True, autoincrement=True)
    ticker = Column(String, nullable=False)
    action = Column(String, nullable=False)  # buy / sell / short / cover
    shares = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    timestamp = Column(String, nullable=False)
    portfolio_value = Column(Float, nullable=False)
    is_short = Column(Integer, default=0)


class RetrainLogRecord(Base):
    __tablename__ = "retrain_log"
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(String, nullable=False)
    model_type = Column(String, nullable=False)
    train_start = Column(String, nullable=False)
    train_end = Column(String, nullable=False)
    cv_accuracy = Column(Float, nullable=False)
    oos_sharpe = Column(Float, nullable=False)
    champion_sharpe = Column(Float, nullable=False)
    promoted = Column(Integer, default=0)
    notes = Column(String, default="")


class SimSessionRecord(Base):
    __tablename__ = "sim_sessions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, nullable=False, unique=True)
    created_at = Column(String, nullable=False)
    final_equity = Column(Float, nullable=False)
    n_trades = Column(Integer, nullable=False, default=0)
    notes = Column(String, default="")


class SimOrderRecord(Base):
    __tablename__ = "sim_orders"
    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(String, nullable=False, unique=True)
    session_id = Column(String, nullable=False)
    ticker = Column(String, nullable=False)
    side = Column(String, nullable=False)     # buy/sell/short/cover
    order_type = Column(String, nullable=False)  # market/limit/stop
    qty = Column(Float, nullable=False)
    limit_price = Column(Float, nullable=True)
    stop_price = Column(Float, nullable=True)
    status = Column(String, nullable=False)   # pending/filled/cancelled/rejected
    submitted_at = Column(String, nullable=False)
    filled_at = Column(String, nullable=True)
    fill_price = Column(Float, nullable=True)
    fill_qty = Column(Float, nullable=True)
    message = Column(String, default="")


# ── Market Simulator tables ──────────────────────────────────────────────


class SimUserRecord(Base):
    __tablename__ = "ms_users"
    username  = Column(String, primary_key=True)
    display_name = Column(String, nullable=False)
    created_at   = Column(String, nullable=False)


class MsGameRecord(Base):
    __tablename__ = "ms_games"
    id               = Column(String, primary_key=True)        # uuid
    name             = Column(String, nullable=False)
    description      = Column(Text, default="")
    creator          = Column(String, nullable=False)
    is_public        = Column(Integer, default=1)              # 1=public 0=private
    join_code        = Column(String, nullable=True)           # private game code
    starting_cash    = Column(Float, default=100_000.0)
    start_date       = Column(String, nullable=False)          # ISO date
    end_date         = Column(String, nullable=False)
    allow_short      = Column(Integer, default=0)
    allow_margin     = Column(Integer, default=0)
    allow_day_trading= Column(Integer, default=1)
    commission       = Column(Float, default=0.0)
    max_position_pct = Column(Float, default=1.0)              # 1.0 = no limit
    rank_by          = Column(String, default="return_pct")   # "return_pct"|"total_value"
    portfolio_public = Column(Integer, default=1)
    allowed_assets   = Column(Text, default='["stocks","etfs"]')  # json
    created_at       = Column(String, nullable=False)


class MsParticipantRecord(Base):
    __tablename__ = "ms_participants"
    id        = Column(Integer, primary_key=True, autoincrement=True)
    game_id   = Column(String, nullable=False)
    username  = Column(String, nullable=False)
    cash      = Column(Float, nullable=False)
    joined_at = Column(String, nullable=False)


class MsHoldingRecord(Base):
    __tablename__ = "ms_holdings"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    game_id    = Column(String, nullable=False)
    username   = Column(String, nullable=False)
    ticker     = Column(String, nullable=False)
    shares     = Column(Float, nullable=False)
    avg_cost   = Column(Float, nullable=False)
    updated_at = Column(String, nullable=False)


class MsTransactionRecord(Base):
    __tablename__ = "ms_transactions"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    game_id     = Column(String, nullable=False)
    username    = Column(String, nullable=False)
    ticker      = Column(String, nullable=False)
    side        = Column(String, nullable=False)    # buy/sell
    order_type  = Column(String, nullable=False)    # market/limit
    qty         = Column(Float, nullable=False)
    fill_price  = Column(Float, nullable=False)
    commission  = Column(Float, default=0.0)
    total_cost  = Column(Float, nullable=False)     # positive=cash out, negative=cash in
    executed_at = Column(String, nullable=False)


class MsWatchlistRecord(Base):
    __tablename__ = "ms_watchlist"
    id       = Column(Integer, primary_key=True, autoincrement=True)
    game_id  = Column(String, nullable=False)
    username = Column(String, nullable=False)
    ticker   = Column(String, nullable=False)
    added_at = Column(String, nullable=False)


class MsEquitySnapshotRecord(Base):
    """Portfolio value snapshot recorded after every trade."""
    __tablename__ = "ms_equity_snapshots"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    game_id     = Column(String, nullable=False)
    username    = Column(String, nullable=False)
    equity      = Column(Float, nullable=False)
    cash        = Column(Float, nullable=False)
    recorded_at = Column(String, nullable=False)


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        settings = get_settings()
        db_url = f"sqlite:///{settings.db_path}"
        _engine = create_engine(
            db_url,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    return _engine


def init_db():
    engine = get_engine()
    Base.metadata.create_all(engine)
    logger.info("Database initialized at %s", get_settings().db_path)


def get_session() -> Session:
    return Session(get_engine())
