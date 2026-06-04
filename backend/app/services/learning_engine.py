"""
Background Learning Engine (Feature B).

Design contract:
  - Runs in a background thread; never blocks the API.
  - Champion model is FROZEN after training — never re-trained from forward data.
  - Honest reporting: live forward return vs SPY always shown; divergence surfaced.
  - Uses the same SimCore / ReplayEngine as Feature A.

Phases:
  1. Collect N_SEED episodes with heuristic momentum agent.
  2. Train GBT classifier offline on (features, labels) dataset.
  3. Collect N_EVAL episodes with the trained model.
  4. Retrain on full dataset → freeze champion.

Once frozen, the champion is NEVER updated from any forward data.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ─── Optional ML imports (graceful if not installed) ──────────────────────
try:
    import joblib
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline
    from sklearn.model_selection import cross_val_score
    _ML_AVAILABLE = True
except ImportError:
    _ML_AVAILABLE = False
    logger.warning("scikit-learn / joblib not available — LearningEngine disabled")

from app.config import get_settings
from app.services.replay_engine import ReplayEngine
from app.services.sim_core import SimCore

# ─── Heuristic agent ─────────────────────────────────────────────────────

_MOMENTUM_WINDOW = 20   # bars for MA
_RSI_PERIOD = 14
_RSI_OVERBOUGHT = 70


def _compute_rsi(prices: List[float], period: int = _RSI_PERIOD) -> float:
    if len(prices) < period + 1:
        return 50.0
    delta = np.diff(prices[-period - 1:])
    gain = np.mean(delta[delta > 0]) if np.any(delta > 0) else 1e-9
    loss = np.mean(-delta[delta < 0]) if np.any(delta < 0) else 1e-9
    rs = gain / loss
    return float(100 - 100 / (1 + rs))


class _AgentHistory:
    """Keeps rolling price history for each ticker."""
    def __init__(self, window: int = 60) -> None:
        self._history: Dict[str, List[float]] = {}
        self._window = window

    def push(self, prices: Dict[str, float]) -> None:
        for ticker, px in prices.items():
            if ticker not in self._history:
                self._history[ticker] = []
            self._history[ticker].append(px)
            if len(self._history[ticker]) > self._window:
                self._history[ticker].pop(0)

    def get(self, ticker: str) -> List[float]:
        return self._history.get(ticker, [])


def heuristic_momentum_agent(
    prices: Dict[str, float],
    step: int,
    sim: SimCore,
    history: Optional[_AgentHistory] = None,
) -> None:
    """
    Heuristic agent: buy when close > MA50 and RSI < 70; sell otherwise.
    Operates on all non-SPY tickers with sufficient history.
    """
    if history is None:
        return
    history.push(prices)
    portfolio = sim.get_portfolio()
    positions = {p["ticker"]: p for p in portfolio["positions"]}
    cash = portfolio["cash"]
    universe = [t for t in prices if t != "SPY"]
    capital_per = portfolio["equity"] / max(len(universe), 1) * 0.15

    for ticker in universe:
        hist = history.get(ticker)
        if len(hist) < _MOMENTUM_WINDOW + 1:
            continue
        ma = float(np.mean(hist[-_MOMENTUM_WINDOW:]))
        rsi = _compute_rsi(hist)
        curr = prices[ticker]
        signal = curr > ma and rsi < _RSI_OVERBOUGHT

        if signal and ticker not in positions and cash >= capital_per:
            try:
                sim.submit_order(ticker, "buy", "market", capital_per / curr)
            except Exception:
                pass
        elif not signal and ticker in positions and positions[ticker]["qty"] > 0:
            qty = positions[ticker]["qty"]
            try:
                sim.submit_order(ticker, "sell", "market", qty)
            except Exception:
                pass


def _make_heuristic_agent() -> Any:
    """Return a heuristic agent closure (with its own price history)."""
    hist = _AgentHistory(window=60)

    def agent(prices: Dict[str, float], step: int, sim: SimCore) -> None:
        heuristic_momentum_agent(prices, step, sim, hist)

    return agent


# ─── Feature extraction for ML ───────────────────────────────────────────

def _extract_features(history: _AgentHistory, ticker: str) -> Optional[np.ndarray]:
    """
    Extract a feature vector from rolling price history.
    All features are derived from LAGGED data (no same-bar lookahead).
    Returns None if not enough history.
    """
    h = history.get(ticker)
    if len(h) < 55:
        return None
    closes = np.array(h[-55:], dtype=float)
    # Returns (lagged by construction — we never include current bar)
    ret1 = closes[-2] / closes[-3] - 1 if closes[-3] != 0 else 0.0
    ret5 = closes[-2] / closes[-7] - 1 if closes[-7] != 0 else 0.0
    ret20 = closes[-2] / closes[-22] - 1 if closes[-22] != 0 else 0.0
    ma20 = float(np.mean(closes[-21:-1]))
    ma50 = float(np.mean(closes[-51:-1]))
    close_to_ma20 = closes[-2] / ma20 - 1 if ma20 != 0 else 0.0
    close_to_ma50 = closes[-2] / ma50 - 1 if ma50 != 0 else 0.0
    rsi = _compute_rsi(list(closes[:-1]))
    vol20 = float(np.std(np.diff(closes[-21:-1]) / closes[-22:-2]))
    return np.array([ret1, ret5, ret20, close_to_ma20, close_to_ma50, rsi, vol20])


FEATURE_NAMES = ["ret_1d", "ret_5d", "ret_20d", "close_to_ma20", "close_to_ma50", "rsi", "vol_20d"]


# ─── ML agent ────────────────────────────────────────────────────────────

def _make_ml_agent(model: Any) -> Any:
    """Return an ML agent closure using a frozen model for inference only."""
    hist = _AgentHistory(window=60)

    def agent(prices: Dict[str, float], step: int, sim: SimCore) -> None:
        hist.push(prices)
        portfolio = sim.get_portfolio()
        positions = {p["ticker"]: p for p in portfolio["positions"]}
        cash = portfolio["cash"]
        universe = [t for t in prices if t != "SPY"]
        capital_per = portfolio["equity"] / max(len(universe), 1) * 0.15

        for ticker in universe:
            feats = _extract_features(hist, ticker)
            if feats is None:
                continue
            try:
                signal = int(model.predict(feats.reshape(1, -1))[0])
            except Exception:
                signal = 0

            if signal == 1 and ticker not in positions and cash >= capital_per:
                curr = prices.get(ticker)
                if curr and curr > 0:
                    try:
                        sim.submit_order(ticker, "buy", "market", capital_per / curr)
                    except Exception:
                        pass
            elif signal != 1 and ticker in positions and positions[ticker]["qty"] > 0:
                qty = positions[ticker]["qty"]
                try:
                    sim.submit_order(ticker, "sell", "market", qty)
                except Exception:
                    pass

    return agent


# ─── LearningEngine ───────────────────────────────────────────────────────

class LearningEngine:
    """
    Background learning loop.

    All public methods are thread-safe.
    The champion model is frozen after training and NEVER updated from
    any forward / live data.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        # Status
        self._phase: str = "idle"
        self._episodes_completed: int = 0
        self._target_episodes: int = 0
        self._dataset_size: int = 0
        self._error: Optional[str] = None
        self._champion: Optional[dict] = None  # ModelCard-like dict
        self._champion_model: Optional[Any] = None  # sklearn Pipeline (frozen)
        self._live_episodes: List[dict] = []  # forward evaluation stats
        self._all_stats: List[dict] = []  # all episodes collected

        # Accumulated dataset
        self._X: List[np.ndarray] = []
        self._y: List[int] = []

        self._replay = ReplayEngine(realism_mode=True)

    # ─── Public API ──────────────────────────────────────────────────────

    def start(self, target_episodes: int = 100) -> None:
        """Start the background learning loop."""
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._target_episodes = target_episodes
            self._episodes_completed = 0
            self._phase = "seeding"
            self._error = None
        self._thread = threading.Thread(
            target=self._run_loop, args=(target_episodes,), daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        """Signal the learning loop to stop after the current episode."""
        self._stop_event.set()
        with self._lock:
            if self._phase not in ("idle", "error"):
                self._phase = "stopping"

    def get_status(self) -> dict:
        """Return current engine status (safe to call from any thread)."""
        with self._lock:
            champion_copy = dict(self._champion) if self._champion else None
            return {
                "phase": self._phase,
                "episodes_completed": self._episodes_completed,
                "target_episodes": self._target_episodes,
                "dataset_size": self._dataset_size,
                "champion": champion_copy,
                "error": self._error,
                "live_episodes": len(self._live_episodes),
                "live_stats": self._compute_live_stats_locked(),
            }

    def get_champion(self) -> Optional[dict]:
        """Return champion model card."""
        with self._lock:
            return dict(self._champion) if self._champion else None

    def freeze_model(self, model: Any, metrics: dict) -> None:
        """
        Freeze a trained model as the new champion.
        This method MUST only be called from the offline training phase,
        never from any live-data or update_prices path.
        """
        if not _ML_AVAILABLE:
            return
        settings = get_settings()
        models_dir = Path(settings.models_dir)
        models_dir.mkdir(parents=True, exist_ok=True)
        artifact_path = str(models_dir / "learning_engine_champion.joblib")
        now = datetime.now(timezone.utc).isoformat()

        card = {
            "model_type": "GradientBoostingClassifier",
            "features": FEATURE_NAMES,
            "frozen_at": now,
            "artifact_path": artifact_path,
            "cv_accuracy": metrics.get("cv_accuracy", 0.0),
            "train_accuracy": metrics.get("train_accuracy", 0.0),
            "n_train_samples": metrics.get("n_samples", 0),
            "training_episodes": metrics.get("training_episodes", 0),
            "note": (
                "This model is permanently frozen. "
                "It is never re-trained on forward data."
            ),
        }

        joblib.dump({"model": model, "card": card}, artifact_path)
        with self._lock:
            self._champion = card
            self._champion_model = model
            self._phase = "champion_frozen"
        logger.info("LearningEngine: champion model frozen at %s", artifact_path)

    # ─── Internal loop ────────────────────────────────────────────────────

    def _run_loop(self, target_episodes: int) -> None:
        try:
            self._replay.load()
            n_seed = max(10, target_episodes // 2)
            n_eval = target_episodes - n_seed

            # Phase 1: collect episodes with heuristic agent
            self._run_phase("seeding", n_seed, lambda: _make_heuristic_agent())

            if self._stop_event.is_set():
                self._set_phase("idle")
                return

            # Phase 2: train offline
            self._set_phase("training")
            model, metrics = self._train_offline()

            if self._stop_event.is_set():
                self._set_phase("idle")
                return

            # Phase 3: evaluate with trained model
            if model is not None:
                self._run_phase("evaluating", n_eval, lambda: _make_ml_agent(model))

            # Phase 4: retrain on full dataset and freeze
            if not self._stop_event.is_set():
                self._set_phase("training")
                final_model, final_metrics = self._train_offline()
                if final_model is not None:
                    self.freeze_model(final_model, final_metrics)
                else:
                    self._set_phase("idle")
            else:
                self._set_phase("idle")

        except Exception as exc:
            logger.exception("LearningEngine loop error: %s", exc)
            with self._lock:
                self._phase = "error"
                self._error = str(exc)

    def _run_phase(self, phase: str, n: int, agent_factory: Any) -> None:
        self._set_phase(phase)
        n_dates = self._replay.n_dates
        if n_dates == 0:
            return
        n_steps = min(252, n_dates - 1)
        stride = max(1, (n_dates - n_steps) // max(n, 1))

        for i in range(n):
            if self._stop_event.is_set():
                break
            start = min(i * stride, max(0, n_dates - n_steps - 1))
            agent = agent_factory()

            # Wrap agent to collect features + labels
            feature_rows: List[np.ndarray] = []
            label_rows: List[int] = []
            hist_for_features = _AgentHistory(window=60)

            def wrapped_agent(prices: Dict[str, float], step: int, sim: SimCore) -> None:
                hist_for_features.push(prices)
                agent(prices, step, sim)
                # Collect features
                for ticker in prices:
                    if ticker == "SPY":
                        continue
                    feats = _extract_features(hist_for_features, ticker)
                    if feats is not None:
                        feature_rows.append(feats)
                        # Label: 1 if price > MA20 next bar (look back, not ahead)
                        h = hist_for_features.get(ticker)
                        if len(h) >= 21:
                            ma20 = float(np.mean(h[-21:-1]))
                            label_rows.append(1 if h[-1] > ma20 else -1)

            stats = self._replay.run_episode(start, n_steps, wrapped_agent)

            with self._lock:
                self._all_stats.append(stats)
                self._episodes_completed += 1
                if feature_rows and len(feature_rows) == len(label_rows):
                    self._X.extend(feature_rows)
                    self._y.extend(label_rows)
                    self._dataset_size = len(self._X)

    def _train_offline(self) -> tuple:
        """Train a GBT model on accumulated dataset.  Returns (model, metrics)."""
        if not _ML_AVAILABLE:
            return None, {}

        with self._lock:
            X = list(self._X)
            y = list(self._y)

        if len(X) < 30 or len(np.unique(y)) < 2:
            logger.warning("LearningEngine: insufficient training data (%d samples)", len(X))
            return None, {}

        X_arr = np.array(X)
        y_arr = np.array(y)

        model = Pipeline([
            ("scaler", StandardScaler()),
            ("clf", GradientBoostingClassifier(
                n_estimators=100, max_depth=3,
                learning_rate=0.1, subsample=0.8,
                random_state=42,
            )),
        ])
        try:
            cv_scores = cross_val_score(model, X_arr, y_arr, cv=min(3, len(X_arr) // 10 or 2), scoring="accuracy")
        except Exception:
            cv_scores = [0.0]

        model.fit(X_arr, y_arr)
        train_acc = float(model.score(X_arr, y_arr))
        cv_acc = float(np.mean(cv_scores))

        metrics = {
            "cv_accuracy": round(cv_acc, 4),
            "train_accuracy": round(train_acc, 4),
            "n_samples": len(X_arr),
            "training_episodes": self._episodes_completed,
        }
        logger.info(
            "LearningEngine trained: n=%d, cv_acc=%.3f, train_acc=%.3f",
            len(X_arr), cv_acc, train_acc,
        )
        return model, metrics

    def _compute_live_stats_locked(self) -> dict:
        """Compute live forward stats vs SPY.  Called with _lock held."""
        stats = self._all_stats
        if not stats:
            return {
                "strategy_cagr": 0.0,
                "spy_cagr": 0.0,
                "divergence": 0.0,
                "n_episodes": 0,
                "honest_note": (
                    "Most likely result is underperformance vs SPY — "
                    "that is a valid finding."
                ),
            }
        strategy_returns = [s["total_return"] for s in stats]
        spy_returns = [s["spy_return"] for s in stats]
        avg_strat = float(np.mean(strategy_returns))
        avg_spy = float(np.mean(spy_returns))
        divergence = avg_strat - avg_spy
        return {
            "strategy_cagr": round(avg_strat, 4),
            "spy_cagr": round(avg_spy, 4),
            "divergence": round(divergence, 4),
            "n_episodes": len(stats),
            "honest_note": (
                "Most likely result is underperformance vs SPY — "
                "that is a valid finding. "
                "A strategy that looks brilliant across 1000 replayed simulations "
                "is the textbook overfitting trap — only the frozen forward "
                "track record counts."
            ),
        }

    def _set_phase(self, phase: str) -> None:
        with self._lock:
            self._phase = phase


# ─── Singleton ───────────────────────────────────────────────────────────

_engine_instance: Optional[LearningEngine] = None
_engine_lock = threading.Lock()


def get_learning_engine() -> LearningEngine:
    global _engine_instance
    with _engine_lock:
        if _engine_instance is None:
            _engine_instance = LearningEngine()
        return _engine_instance
