"""
Tests for SimCore (Feature A / Feature B shared engine).

Covers:
  - test_sim_core_buy_sell: buy 10 shares, sell them, verify cash reconciles
  - test_sim_core_costs_applied: fill price > quote for buy orders (costs > 0)
  - test_sim_core_short_sell: short 10 shares, verify position is negative qty
  - test_sim_core_same_engine: Feature A and B import the same SimCore class
  - test_sim_core_reset: after trades, reset returns to $100k
  - test_replay_engine: run 5 episodes, verify each returns valid stats
  - test_frozen_champion: freeze_model() is never called from update_prices() or any live path
"""
from __future__ import annotations

import inspect
import sys
from pathlib import Path

import pytest

# Ensure backend is importable
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))


# ─── SimCore tests ─────────────────────────────────────────────────────────

from app.services.sim_core import SimCore


def make_sim(realism_mode: bool = True) -> SimCore:
    return SimCore(initial_capital=100_000.0, realism_mode=realism_mode)


def test_sim_core_buy_sell():
    """Buy 10 shares at $100, sell them at $100; cash should be near starting value
    (minus round-trip costs in realism mode)."""
    sim = make_sim(realism_mode=False)
    sim.update_prices({"AAPL": 100.0})
    order_buy = sim.submit_order("AAPL", "buy", "market", 10)
    assert order_buy.status == "filled", f"Buy not filled: {order_buy.message}"
    assert order_buy.fill_qty == 10

    # Position should exist
    port = sim.get_portfolio()
    positions = {p["ticker"]: p for p in port["positions"]}
    assert "AAPL" in positions
    assert abs(positions["AAPL"]["qty"] - 10) < 1e-6

    # Sell
    order_sell = sim.submit_order("AAPL", "sell", "market", 10)
    assert order_sell.status == "filled", f"Sell not filled: {order_sell.message}"

    # After buy-sell at same price, cash should be very close to initial (no realism costs)
    port2 = sim.get_portfolio()
    assert len(port2["positions"]) == 0
    assert abs(port2["cash"] - 100_000.0) < 0.01


def test_sim_core_costs_applied():
    """Fill price for a buy order must be > quote price (cost model adds spread+slippage)."""
    sim = make_sim(realism_mode=True)
    sim.update_prices({"MSFT": 200.0})
    order = sim.submit_order("MSFT", "buy", "market", 5)
    assert order.status == "filled"
    # Cost model: 8 bps = 0.0008 → fill > 200
    assert order.fill_price > 200.0, (
        f"Expected fill_price > 200.0 (realism costs applied), got {order.fill_price}"
    )
    # Fill price should be close to quote + 8 bps
    expected_max = 200.0 * 1.002  # 20 bps is generous upper bound
    assert order.fill_price < expected_max, "Fill price too far from quote"


def test_sim_core_short_sell():
    """Short 10 shares → position qty should be -10."""
    sim = make_sim(realism_mode=False)
    sim.update_prices({"NVDA": 500.0})
    order = sim.submit_order("NVDA", "short", "market", 10)
    assert order.status == "filled", f"Short not filled: {order.message}"

    port = sim.get_portfolio()
    positions = {p["ticker"]: p for p in port["positions"]}
    assert "NVDA" in positions
    assert positions["NVDA"]["is_short"] is True
    assert positions["NVDA"]["qty"] < 0
    assert abs(positions["NVDA"]["qty"] + 10) < 1e-6  # qty == -10


def test_sim_core_same_engine():
    """Feature A (human_sim.py) and Feature B (replay_engine.py) must import SimCore
    from the same canonical module path."""
    from app.services.sim_core import SimCore as SimCoreA
    from app.services.replay_engine import ReplayEngine

    # ReplayEngine creates SimCore instances internally — verify it uses the same class
    engine = ReplayEngine()

    # Check the import path used in replay_engine module
    import app.services.replay_engine as re_mod
    re_source = inspect.getsource(re_mod)
    assert "from app.services.sim_core import SimCore" in re_source, (
        "ReplayEngine must import SimCore from app.services.sim_core"
    )

    # And human_sim uses the same module
    import app.api.human_sim as hs_mod
    # The human_sim module should not define its own SimCore
    assert "class SimCore" not in inspect.getsource(hs_mod), (
        "human_sim.py must not define its own SimCore — use app.services.sim_core"
    )


def test_sim_core_reset():
    """After trades, reset() must return cash to $100k and clear all positions."""
    sim = make_sim(realism_mode=False)
    sim.update_prices({"AAPL": 150.0, "MSFT": 300.0})
    sim.submit_order("AAPL", "buy", "market", 10)
    sim.submit_order("MSFT", "buy", "market", 5)

    pre = sim.get_portfolio()
    assert len(pre["positions"]) == 2
    assert pre["cash"] < 100_000.0  # cash was used

    sim.reset()
    post = sim.get_portfolio()
    assert abs(post["cash"] - 100_000.0) < 0.01, f"Cash after reset: {post['cash']}"
    assert len(post["positions"]) == 0
    assert post["trade_count"] == 0
    assert len(post["equity_history"]) == 0


# ─── ReplayEngine tests ────────────────────────────────────────────────────

def test_replay_engine():
    """Run 5 episodes with the heuristic agent; each must return valid stats."""
    from app.services.replay_engine import ReplayEngine
    from app.services.learning_engine import _make_heuristic_agent

    engine = ReplayEngine(realism_mode=False)
    engine.load()

    if engine.n_dates == 0:
        pytest.skip("No seed price data available — run data/generate_seed.py first")

    def agent(prices, step, sim):
        _make_heuristic_agent()(prices, step, sim)

    results = engine.run_many_episodes(n=5, n_steps=50, agent_fn=agent)

    assert len(results) == 5
    for i, r in enumerate(results):
        assert "final_equity" in r, f"Episode {i} missing final_equity"
        assert "n_trades" in r, f"Episode {i} missing n_trades"
        assert "spy_return" in r, f"Episode {i} missing spy_return"
        assert r["final_equity"] > 0, f"Episode {i} final_equity <= 0: {r['final_equity']}"
        assert r["n_steps"] > 0, f"Episode {i} n_steps == 0"


# ─── Frozen champion test ─────────────────────────────────────────────────

def test_frozen_champion():
    """
    LearningEngine.freeze_model() must NEVER be called from update_prices(),
    from any price-feed path, or from SimCore methods.

    This is verified by static source inspection:
      1. SimCore.update_prices does not call freeze_model
      2. ReplayEngine does not call freeze_model
      3. human_sim.py (live WebSocket path) does not call freeze_model
    """
    import app.services.sim_core as sc_mod
    import app.services.replay_engine as re_mod
    import app.api.human_sim as hs_mod

    for mod_name, mod in [("sim_core", sc_mod), ("replay_engine", re_mod), ("human_sim", hs_mod)]:
        src = inspect.getsource(mod)
        assert "freeze_model" not in src, (
            f"freeze_model() must NEVER appear in {mod_name}.py — "
            "the champion is only frozen from the offline training phase in LearningEngine."
        )

    # Verify freeze_model IS defined in learning_engine (and only there)
    from app.services.learning_engine import LearningEngine
    assert hasattr(LearningEngine, "freeze_model"), (
        "LearningEngine must have a freeze_model() method"
    )

    # Verify freeze_model is not called from update_prices or live-data paths
    le_src = inspect.getsource(LearningEngine)
    # The freeze_model method should only be called from _run_loop (offline training)
    # Count how many times it's referenced — must only be in _run_loop and the def itself
    call_sites = [line for line in le_src.splitlines() if "freeze_model" in line and "def freeze_model" not in line]
    for site in call_sites:
        # Should only appear inside _run_loop, not in any method that could be triggered
        # by live price data. We verify it's NOT in update_prices context.
        assert "update_prices" not in site, (
            f"freeze_model must not be called from update_prices: {site.strip()}"
        )
