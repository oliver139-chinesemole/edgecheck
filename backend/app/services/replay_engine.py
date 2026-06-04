"""
ReplayEngine — fast in-memory historical replay over seed price data.

Loads prices.csv once, then replays episodes in-memory with zero I/O per step.
Used by the Background Learning Engine (Feature B) and can be used for
debugging in Feature A.

Usage
-----
    engine = ReplayEngine()
    stats = engine.run_episode(start_idx=0, n_steps=252, agent_fn=my_agent)
    all_stats = engine.run_many_episodes(n=100, n_steps=252, agent_fn=my_agent)
"""
from __future__ import annotations

import logging
from typing import Callable, Dict, List, Optional

import numpy as np
import pandas as pd

from app.services.seed_loader import load_prices
from app.services.sim_core import SimCore

logger = logging.getLogger(__name__)

TICKERS = ["AAPL", "MSFT", "NVDA", "META", "AMZN", "SPY"]


class ReplayEngine:
    """
    Replays historical daily bars through a SimCore instance.

    Parameters
    ----------
    tickers : list of str, optional
        Tickers to include in the replay universe.
    initial_capital : float
        Starting capital per episode (default $100,000).
    realism_mode : bool
        Passed through to SimCore cost model.
    """

    def __init__(
        self,
        tickers: Optional[List[str]] = None,
        initial_capital: float = 100_000.0,
        realism_mode: bool = True,
    ) -> None:
        self._tickers = tickers or TICKERS
        self._initial_capital = initial_capital
        self._realism_mode = realism_mode
        self._prices: Optional[pd.DataFrame] = None
        self._dates: Optional[np.ndarray] = None
        self._price_matrix: Optional[Dict[str, np.ndarray]] = None  # ticker → price array

    # ─── Public API ─────────────────────────────────────────────────────────

    def load(self) -> None:
        """
        Load prices from seed CSV into memory.  Call once before run_episode.
        Safe to call multiple times; only loads once.
        """
        if self._prices is not None:
            return
        df = load_prices()
        if df.empty:
            logger.warning("ReplayEngine: price data empty — replay will produce trivial stats")
            self._prices = df
            self._dates = np.array([], dtype=object)
            self._price_matrix = {}
            return

        # Only keep tickers that exist in the data
        available = set(df["ticker"].unique())
        self._tickers = [t for t in self._tickers if t in available]

        # Build dense date index and price matrix for fast indexing
        all_dates = sorted(df["date"].unique())
        self._dates = np.array(all_dates)

        self._price_matrix = {}
        for ticker in self._tickers:
            sub = df[df["ticker"] == ticker].set_index("date")["close"]
            sub = sub.reindex(all_dates)
            sub = sub.ffill().bfill()
            self._price_matrix[ticker] = sub.values.astype(float)

        self._prices = df
        logger.info(
            "ReplayEngine loaded %d tickers × %d dates",
            len(self._tickers), len(self._dates),
        )

    def run_episode(
        self,
        start_idx: int,
        n_steps: int,
        agent_fn: Callable[[dict, int], None],
    ) -> dict:
        """
        Run a single episode.

        Parameters
        ----------
        start_idx : int
            Index into the date array to start from.
        n_steps : int
            Number of bars to advance.
        agent_fn : callable(prices_snapshot: dict, step: int) -> None
            Called at each bar with the current prices dict.
            The agent should call sim.submit_order() directly on the SimCore
            instance returned by this episode.  Signature:
                agent_fn(prices_snapshot, step, sim_core)
            where sim_core is passed as the third argument.

        Returns
        -------
        dict with keys: final_equity, cagr, n_trades, spy_return, start_idx, n_steps
        """
        self.load()

        if len(self._dates) == 0:
            return self._empty_stats(start_idx, n_steps)

        end_idx = min(start_idx + n_steps, len(self._dates))
        actual_steps = end_idx - start_idx

        sim = SimCore(
            initial_capital=self._initial_capital,
            realism_mode=self._realism_mode,
        )

        spy_start = None

        for step, i in enumerate(range(start_idx, end_idx)):
            # Build price snapshot for this bar
            snapshot: Dict[str, float] = {}
            for ticker in self._tickers:
                px = self._price_matrix[ticker][i]
                if np.isfinite(px):
                    snapshot[ticker] = float(px)

            # Track SPY for benchmark
            if "SPY" in snapshot:
                if spy_start is None:
                    spy_start = snapshot["SPY"]

            # Let agent act (may submit orders)
            try:
                agent_fn(snapshot, step, sim)
            except Exception as exc:
                logger.debug("agent_fn error at step %d: %s", step, exc)

            # Advance the sim clock
            sim.update_prices(snapshot)

        portfolio = sim.get_portfolio()
        final_equity = portfolio["equity"]
        n_trades = portfolio["trade_count"]

        # SPY benchmark return
        spy_end = None
        if "SPY" in self._price_matrix and spy_start and start_idx < len(self._dates):
            last_i = end_idx - 1
            spy_end = float(self._price_matrix["SPY"][last_i])
        spy_return = (spy_end / spy_start - 1) if (spy_start and spy_end) else 0.0

        # CAGR (annualised from actual steps)
        total_return = final_equity / self._initial_capital - 1
        n_years = actual_steps / 252
        cagr = float((1 + total_return) ** (1 / n_years) - 1) if n_years > 0 else 0.0

        return {
            "final_equity": round(final_equity, 2),
            "total_return": round(total_return, 4),
            "cagr": round(cagr, 4),
            "n_trades": n_trades,
            "spy_return": round(spy_return, 4),
            "start_idx": start_idx,
            "n_steps": actual_steps,
        }

    def run_many_episodes(
        self,
        n: int,
        n_steps: int,
        agent_fn: Callable[[dict, int, SimCore], None],
        stride: Optional[int] = None,
    ) -> List[dict]:
        """
        Run n episodes sequentially.

        Parameters
        ----------
        stride : int, optional
            How many bars to advance start_idx between episodes.
            Defaults to n_steps // max(n, 1).

        Returns
        -------
        List of episode stat dicts.
        """
        self.load()

        if len(self._dates) == 0:
            return [self._empty_stats(0, n_steps)] * n

        max_start = max(0, len(self._dates) - n_steps)
        if stride is None:
            stride = max(1, max_start // max(n, 1))

        results = []
        for i in range(n):
            start = min(i * stride, max_start)
            stats = self.run_episode(start, n_steps, agent_fn)
            results.append(stats)

        return results

    @property
    def tickers(self) -> List[str]:
        return list(self._tickers)

    @property
    def n_dates(self) -> int:
        return len(self._dates) if self._dates is not None else 0

    # ─── Helpers ─────────────────────────────────────────────────────────────

    def _empty_stats(self, start_idx: int, n_steps: int) -> dict:
        return {
            "final_equity": self._initial_capital,
            "total_return": 0.0,
            "cagr": 0.0,
            "n_trades": 0,
            "spy_return": 0.0,
            "start_idx": start_idx,
            "n_steps": n_steps,
        }
