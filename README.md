# EdgeCheck — Smart Money Signal & Paper-Trading Research Platform

**🌐 Website:** https://oliver139-chinesemole.github.io/edgecheck/

> **NOT financial advice.** EdgeCheck is a research and validation tool.
> The most likely honest result is no durable edge. That is a valid, expected, and respectable outcome.

## Quick start

**Requirements:** Python 3.11+, Node 18+, pip, npm

```bash
git clone https://github.com/<you>/edgecheck
cd edgecheck
make install   # installs deps, generates seed data, trains default model
make dev       # starts backend on :8000 and frontend on :5173
```

Open http://localhost:5173 in your browser. **All four tabs work with zero API keys.**

## Tabs

| Tab | Description |
|-----|-------------|
| **Smart Money** | 13F institutional holdings, insider trades, congressional disclosures with Q-over-Q deltas and consensus signals |
| **Strategy & Backtest** | Leakage-free walk-forward backtest (ML classifier or selective-clone rule), equity curve vs buy-and-hold SPY, full performance metrics, model freezing |
| **Live Paper Sim** | Frozen model running forward on real or seed price data, live equity curve, realized-vs-backtest divergence (overfit detector) |
| **Improvement Log** | Champion/challenger framework, permanently frozen hold-out set, promotion rules, multiple-testing note |

## Key design principles

- **No lookahead:** all features are lagged ≥1 bar; labels use only future data. Unit-tested.
- **Frozen model:** after Tab B trains the model it is serialized to `models/champion.joblib` and never retrained. The simulator only calls `predict()`.
- **Realistic costs:** 8 bps round-trip (spread + slippage + commission); 3% annual borrow for shorts.
- **Benchmark:** every strategy is compared to buy-and-hold SPY over the identical window on a risk-adjusted basis.
- **Graceful degradation:** every external call has a seed-data fallback. Missing keys are a UI state, never a crash.

## API keys (optional)

Copy `.env.example` to `.env` and fill in the keys you have:

- **`ALPACA_API_KEY` + `ALPACA_SECRET_KEY`** — enables live paper trading in Tab C (free paper account at alpaca.markets)
- **`FMP_API_KEY`** — enables live 13F / insider data refresh in Tab A (free tier at financialmodelingprep.com)

No keys = seed data with a visible "using sample data" badge. No code changes required to activate a key.

## Two-terminal fallback

```bash
# Terminal 1
cd backend && uvicorn main:app --reload --port 8000

# Terminal 2
cd frontend && npm run dev
```

## Running tests

```bash
make test
```

Tests cover:
- `test_backtest_no_lookahead.py` — proves the backtest cannot see future data
- `test_costs_applied.py` — proves costs are deducted from every trade
- `test_frozen_model.py` — proves the simulator loads the model read-only
- `test_api_smoke.py` — every API route returns non-500 on seed data
- `test_seed_db.py` — database initializes correctly from seed data

## Methodology notes

- **Triple-barrier labeling:** profit-take / stop-loss / time barrier (no fixed-horizon returns)
- **Walk-forward validation:** 70% train / 30% test with a 5-bar embargo gap between windows
- **Hold-out set:** 2024-07-01 → 2024-12-31, permanently frozen, never used for training or model selection
- **Multiple testing:** promotion requires ΔSharpe > 0.15 on the hold-out set to reduce false positives
- **Retail constraints noted:** Pattern Day Trader rule, short-borrow frictions, partial IEX data

## Project structure

```
edgecheck/
├── backend/          FastAPI backend, owns all secrets and external calls
│   ├── main.py
│   ├── requirements.txt
│   ├── app/
│   │   ├── api/      Route handlers (health, smart_money, backtest, simulation, improvement)
│   │   ├── models/   Pydantic schemas (the REST API contract)
│   │   └── services/ Business logic (backtest engine, simulator, model manager, seed loader)
│   └── scripts/      One-off scripts (train_default_model.py)
├── frontend/         React + Vite + TypeScript SPA
│   └── src/
│       ├── pages/    One file per tab
│       ├── components/
│       └── types/    TypeScript types matching backend Pydantic models
├── data/             Committed seed CSVs (synthetic, deterministic)
│   └── generate_seed.py
├── models/           Frozen model artifacts (generated, not committed)
├── tests/            Backend + methodology unit tests
├── Makefile
├── .env.example
└── README.md
```

## Limitations

- Seed prices are synthetic (random walk). Backtests on them are illustrative only.
- 13F data has a ≥45-day lag; it is a trailing, not leading, indicator.
- The retail PDT rule (≤3 day trades/5 business days for accounts < $25k) is noted but not enforced in the simulator.
- Borrow availability for shorts is modeled at a flat 3% annual cost; real availability is position-specific and can be much worse.
- This is a single-user local tool. There is no authentication or multi-user support.
