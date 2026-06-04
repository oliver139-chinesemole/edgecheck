"""
SQLAlchemy setup and DB seed logic.
The DB is seeded from CSVs in /data on first run if empty.
"""
import logging
from pathlib import Path
from sqlalchemy import create_engine, Column, String, Float, Integer, DateTime, text
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
