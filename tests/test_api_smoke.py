"""
Smoke tests: every API route must return a non-500 response.
"""
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "version" in data


def test_root():
    r = client.get("/")
    assert r.status_code == 200


def test_smart_money_holdings():
    r = client.get("/api/smart-money/holdings")
    assert r.status_code == 200
    data = r.json()
    assert "holdings" in data
    assert "signals" in data
    assert "using_sample_data" in data
    assert "data_lag_note" in data


def test_backtest_results_empty_on_fresh():
    r = client.get("/api/backtest/results")
    # Should return 200 with null or a result, never 500
    assert r.status_code == 200


def test_backtest_model_card():
    r = client.get("/api/backtest/model-card")
    assert r.status_code == 200


def test_simulation_state():
    r = client.get("/api/simulation/state")
    assert r.status_code == 200
    data = r.json()
    assert "status" in data
    assert "equity_curve" in data
    assert "model_frozen" in data


def test_improvement_log():
    r = client.get("/api/improvement/log")
    assert r.status_code == 200
    data = r.json()
    assert "holdout_start" in data
    assert "holdout_note" in data
    assert "multiple_testing_note" in data


def test_backtest_run_with_valid_config():
    config = {
        "strategy": "selective_clone",
        "start_date": "2022-01-03",
        "end_date": "2023-06-30",
        "initial_capital": 100000.0,
        "pt_barrier": 0.03,
        "sl_barrier": 0.02,
        "t1_bars": 20,
        "tickers": ["AAPL", "MSFT"],
    }
    r = client.post("/api/backtest/run", json=config)
    assert r.status_code == 200
    data = r.json()
    assert "equity_curve" in data
    assert "sharpe_ratio" in data
    assert "benchmark_cagr" in data
    assert "no_edge_note" in data


def test_backtest_run_invalid_config():
    """Invalid config must return a 422, not a 500 crash."""
    r = client.post("/api/backtest/run", json={"strategy": "nonexistent"})
    assert r.status_code == 422
