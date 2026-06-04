"""
Verify that trading costs are actually deducted from gross returns.
"""
import pytest
from app.services.backtest_engine import apply_costs, ROUND_TRIP_COST, SHORT_BORROW_DAILY


def test_costs_reduce_return():
    gross = 0.05
    net = apply_costs(gross)
    assert net < gross, "Net return must be less than gross return after costs"
    assert net == pytest.approx(gross - ROUND_TRIP_COST, rel=1e-6)


def test_short_costs_include_borrow():
    gross = 0.05
    net_long = apply_costs(gross, is_short=False, holding_days=10)
    net_short = apply_costs(gross, is_short=True, holding_days=10)
    assert net_short < net_long, "Short trades must have higher cost than long trades (borrow fee)"
    expected_extra = SHORT_BORROW_DAILY * 10
    assert abs((net_long - net_short) - expected_extra) < 1e-10


def test_costs_are_positive():
    """Costs must be strictly positive (never free)."""
    net = apply_costs(0.0)
    assert net < 0.0, "A zero-return trade must result in a net loss after costs"


def test_longer_hold_increases_short_cost():
    short_1d = apply_costs(0.0, is_short=True, holding_days=1)
    short_30d = apply_costs(0.0, is_short=True, holding_days=30)
    assert short_30d < short_1d, "Longer short hold should cost more due to borrow fees"


def test_costs_applied_in_range():
    """Round-trip cost should be realistic: between 5 bps and 30 bps for a 1-day long trade."""
    net = apply_costs(0.0, is_short=False, holding_days=1)
    cost_bps = abs(net) * 10_000
    assert 5 <= cost_bps <= 30, f"Cost of {cost_bps:.1f} bps is outside the expected range 5–30 bps"
