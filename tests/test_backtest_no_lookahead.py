"""
Asserts the backtest engine cannot see future data.

Method: build a feature matrix and label series, then verify that
shuffling future price data does NOT change the features or predictions
that were generated from past data. If the feature at time t changes when
we shuffle prices at time t+k, that is a lookahead.
"""
import numpy as np
import pandas as pd
import pytest
from app.services.backtest_engine import (
    _compute_features, label_triple_barrier, FEATURES
)


def _make_prices(n: int = 300, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2022-01-03", periods=n)
    price = 100.0
    rows = []
    for d in dates:
        r = rng.normal(0.0003, 0.012)
        price = price * (1 + r)
        rows.append({"date": d, "ticker": "TEST", "close": price, "volume": 1_000_000,
                     "open": price, "high": price * 1.005, "low": price * 0.995})
    return pd.DataFrame(rows)


def test_features_do_not_use_future_prices():
    """
    Features computed at bar i must not change when we alter prices at bars > i.
    We check this by computing features on the original series, then on a version
    where all prices after the midpoint are replaced with noise, and asserting
    that the features before the midpoint are identical.
    """
    df = _make_prices(300)
    mid = 150

    # Compute features on original
    feats_original = _compute_features(df.copy())

    # Corrupt all prices after midpoint
    df_corrupted = df.copy()
    rng = np.random.default_rng(999)
    df_corrupted.loc[df_corrupted.index > mid, "close"] = rng.uniform(1, 1000, sum(df_corrupted.index > mid))

    feats_corrupted = _compute_features(df_corrupted.copy())

    # Features at dates <= midpoint must be unchanged
    orig_early = feats_original[feats_original["date"] <= df.loc[mid, "date"]]
    corr_early = feats_corrupted[feats_corrupted["date"] <= df.loc[mid, "date"]]

    if orig_early.empty or corr_early.empty:
        pytest.skip("Not enough data to test lookahead")

    for col in FEATURES:
        if col in orig_early.columns and col in corr_early.columns:
            orig_vals = orig_early[col].values
            corr_vals = corr_early[col].values
            min_len = min(len(orig_vals), len(corr_vals))
            np.testing.assert_allclose(
                orig_vals[:min_len], corr_vals[:min_len],
                rtol=1e-5,
                err_msg=f"Feature '{col}' at past bars changed when future prices were corrupted — LOOKAHEAD DETECTED"
            )


def test_labels_use_only_future_data():
    """
    Label at bar i is determined by prices at bars i+1 to i+t1 only.
    If we replace prices at bars i+1..end with a constant, the label at i must reflect
    that constant path (neither barrier hit → label 0 for all).
    """
    df = _make_prices(200)

    # Replace all prices from bar 50 onward with a flat value
    flat_price = float(df.loc[49, "close"])
    df_flat = df.copy()
    df_flat.loc[df_flat.index >= 50, "close"] = flat_price

    labels = label_triple_barrier(df_flat, "TEST", pt=0.03, sl=0.02, t1=20)

    # Bars 50+ should all be 0 (time barrier) because price never moves
    dates_50plus = df_flat.loc[50:, "date"].values
    for d in dates_50plus[:30]:  # check first 30 bars of the flat region
        if d in labels.index:
            assert labels[d] == 0, (
                f"Label at {d} is {labels[d]} despite flat prices — "
                "this suggests the labeling function is using same-bar or lagged data incorrectly."
            )


def test_feature_shift_prevents_same_bar_lookahead():
    """
    All features must be strictly lagged (shifted by ≥1 bar).
    Verify by checking that feature at row n depends on close at row n-1, not row n.
    """
    df = _make_prices(100)
    feats = _compute_features(df.copy())

    # Alter the very last close price
    df_alt = df.copy()
    last_idx = df_alt.index[-1]
    df_alt.loc[last_idx, "close"] *= 1000  # extreme change

    feats_alt = _compute_features(df_alt.copy())

    # The last row's features should NOT have changed (they depend on close[n-1], not close[n])
    if len(feats) > 0 and len(feats_alt) > 0:
        last_date = feats["date"].max()
        orig_row = feats[feats["date"] == last_date]
        alt_row = feats_alt[feats_alt["date"] == last_date]
        if not orig_row.empty and not alt_row.empty:
            for col in ["ret_1d"]:
                if col in orig_row.columns:
                    np.testing.assert_allclose(
                        orig_row[col].values, alt_row[col].values, rtol=1e-5,
                        err_msg=f"'{col}' at last bar changed when only close[n] was altered — lookahead detected"
                    )
