#!/usr/bin/env python3
"""
Train a default champion model on seed data so Tab C works on fresh clone.
Invoked by 'make install'. Safe to re-run: skips if model already exists.
"""
import sys
import os
from pathlib import Path

# Allow importing from backend/
sys.path.insert(0, str(Path(__file__).parent.parent))

# Point to root .env if present
env_path = Path(__file__).parent.parent.parent / ".env"
if env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(env_path)

from app.config import get_settings
from app.services.seed_loader import load_prices, load_holdings, seed_data_present
from app.services.model_manager import model_ready
from app.models.schemas import BacktestConfig

settings = get_settings()


def main():
    models_dir = Path(settings.models_dir)
    models_dir.mkdir(parents=True, exist_ok=True)

    if model_ready():
        print("Default model already exists — skipping training.")
        return

    if not seed_data_present():
        print("Seed data not found. Run 'python3 data/generate_seed.py' first.")
        sys.exit(1)

    print("Training default champion model on seed data...")
    from app.services.backtest_engine import run_backtest

    config = BacktestConfig(
        strategy="ml_classifier",
        start_date="2022-01-03",
        end_date="2024-06-30",
        initial_capital=100_000.0,
        pt_barrier=0.03,
        sl_barrier=0.02,
        t1_bars=20,
        tickers=["AAPL", "MSFT", "NVDA", "META", "AMZN"],
    )

    prices = load_prices()
    holdings = load_holdings()
    result = run_backtest(config, prices, holdings)

    if result.model_card:
        print(f"  Model frozen at: {result.model_card.artifact_path}")
        print(f"  CV accuracy: {result.model_card.cv_accuracy:.3f}")
        print(f"  Backtest Sharpe: {result.sharpe_ratio:.3f} | SPY Sharpe: {result.benchmark_sharpe:.3f}")
        print("Done. Tab C is ready to use.")
    else:
        print("Warning: model card not generated. Tab C will prompt you to run a backtest.")


if __name__ == "__main__":
    main()
