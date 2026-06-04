"""
Read-only model I/O.
The simulation loads this artifact and NEVER calls .fit() on it.
"""
import logging
from pathlib import Path
from typing import Optional

import joblib

from app.config import get_settings
from app.models.schemas import ModelCard, BacktestConfig

logger = logging.getLogger(__name__)

_cached_bundle: Optional[dict] = None


def _artifact_path() -> Path:
    return Path(get_settings().models_dir) / "champion.joblib"


def model_ready() -> bool:
    return _artifact_path().exists()


def load_model() -> Optional[dict]:
    """
    Load the frozen champion model bundle.
    Returns dict with keys: model, card, features.
    Returns None if no model has been trained yet.
    This function never trains or retrains the model.
    """
    global _cached_bundle
    if _cached_bundle is not None:
        return _cached_bundle
    p = _artifact_path()
    if not p.exists():
        logger.warning("No champion model found at %s — run a backtest in Tab B first.", p)
        return None
    try:
        bundle = joblib.load(p)
        _cached_bundle = bundle
        logger.info("Loaded frozen model from %s", p)
        return bundle
    except Exception as exc:
        logger.error("Failed to load model: %s", exc)
        return None


def get_model_card() -> Optional[ModelCard]:
    bundle = load_model()
    if bundle is None:
        return None
    try:
        card_data = bundle["card"]
        if isinstance(card_data, dict):
            return ModelCard(**card_data)
        return card_data
    except Exception as exc:
        logger.error("Failed to parse ModelCard: %s", exc)
        return None


def predict(features_row) -> int:
    """
    Run inference with the frozen model.
    Returns 1 (long), -1 (short/exit), or 0 (flat).
    NEVER retrains the model.
    """
    bundle = load_model()
    if bundle is None:
        return 0
    try:
        model = bundle["model"]
        import numpy as np
        x = np.array(features_row).reshape(1, -1)
        return int(model.predict(x)[0])
    except Exception as exc:
        logger.error("Prediction failed: %s", exc)
        return 0


def invalidate_cache():
    global _cached_bundle
    _cached_bundle = None
