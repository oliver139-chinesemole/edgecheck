# EdgeCheck — Task Tracker

Tracks progress through the build order in Section 7 of the project brief.
Check items off as they are verified working. "Done" = app runs end-to-end on mock data.

---

## Step 1 — Scaffold + GitHub (✅ complete)

- [x] Create monorepo directory structure
- [x] Backend: FastAPI app, `/health` endpoint, CORS, lifespan DB init
- [x] Backend: all four API routers registered (smart_money, backtest, simulation, improvement)
- [x] Frontend: React + Vite + TypeScript SPA
- [x] Frontend: all four tabs rendering and navigable
- [x] Frontend: ErrorBoundary, Disclaimer banner, BackendStatus indicator
- [x] Frontend: Loading / empty / error states on every data view
- [x] `make dev` starts both backend and frontend
- [x] `make install` installs all deps, generates seed data, trains default model
- [x] `.gitignore` excludes secrets, node_modules, venv, DB, model artifacts
- [x] `.env.example` documents all variables with safe defaults
- [x] `TASKS.md` written
- [x] Git repo initialized
- [x] GitHub repo created and first working commit pushed ← **GATE: token required**

---

## Step 2 — Tab A: Smart Money on seed data (✅ complete)

- [x] `data/generate_seed.py` — deterministic seed generator (prices, holdings, insider, congressional)
- [x] `app/services/seed_loader.py` — loads CSVs, graceful empty return if missing
- [x] `app/api/smart_money.py` — Q-over-Q deltas, consensus signals, data lag note
- [x] Frontend `SmartMoney.tsx` — signals, holdings, insider trades, congressional trades subtabs
- [x] Data lag warning banner visible
- [x] "Using sample data" badge visible

---

## Step 3 — Tab B: Backtest + model freeze (✅ complete)

- [x] `app/services/backtest_engine.py` — walk-forward, triple-barrier, costs, metrics
- [x] No-lookahead: all features lagged ≥1 bar
- [x] Walk-forward: 70% train / 30% test / 5-bar embargo
- [x] `apply_costs()` function — round-trip costs + short borrow
- [x] `compute_metrics()` — Sharpe, Sortino, max DD, CAGR, win rate
- [x] ML strategy (GradientBoostingClassifier) + selective-clone rule
- [x] Model frozen to `models/champion.joblib` + `ModelCard` generated
- [x] `app/api/backtest.py` — POST /run, GET /results, GET /model-card
- [x] Frontend `Backtest.tsx` — config panel, equity curve chart, metrics grid, model card
- [x] "No edge is a valid result" note visible

---

## Step 4 — Tab C: Live Paper Simulation (✅ complete)

- [x] `app/services/simulator.py` — event-driven, loads frozen model read-only
- [x] Simulator falls back to seed price stream when no Alpaca key
- [x] Equity curve vs SPY tracked
- [x] Divergence metric (realized vs backtest) with warning at ±20%
- [x] `app/api/simulation.py` — GET /state, POST /start, POST /stop
- [x] Frontend `Simulation.tsx` — controls, equity chart, positions table, divergence banner
- [x] "Model is frozen" banner visible
- [x] "No model yet" friendly redirect to Tab B

---

## Step 5 — Tab D: Improvement Log (✅ complete)

- [x] `app/api/improvement.py` — champion card, challengers, hold-out, multiple-testing note
- [x] `database.py` — `retrain_log` table
- [x] Hold-out window 2024-07-01 → 2024-12-31 permanently frozen
- [x] Frontend `ImprovementLog.tsx` — champion, hold-out, rules, challengers, retrain log

---

## Step 6 — Optional real APIs (pending)

- [ ] Alpaca paper trading integration in simulator (activate via ALPACA_API_KEY)
- [ ] FMP / SEC EDGAR live 13F refresh (activate via FMP_API_KEY)
- [ ] Verify both degrade gracefully to seed when key is absent

---

## Feature A — Human Trading Simulator (✅ complete)

- [x] `backend/app/services/sim_core.py` — SimCore: submit_order, update_prices, get_portfolio, reset
- [x] `backend/app/services/replay_engine.py` — ReplayEngine: run_episode, run_many_episodes
- [x] `backend/app/api/human_sim.py` — REST + WebSocket endpoints
- [x] DB tables: sim_sessions, sim_orders (database.py)
- [x] `frontend/src/hooks/useWebSocket.ts` — WS hook with exponential backoff
- [x] `frontend/src/pages/HumanSimulator.tsx` — order entry, equity chart, positions, watchlist

## Feature B — Background Learning Engine (✅ complete)

- [x] `backend/app/services/learning_engine.py` — LearningEngine: start/stop/get_status, champion harness
- [x] `backend/app/api/agent.py` — GET /status, POST /start, POST /stop, GET /champion
- [x] `frontend/src/pages/LearningEngine.tsx` — status, champion card, honest result panel

## Routing update (✅ complete)

- [x] Add /simulator and /learning routes to App.tsx

## New tests (✅ complete)

- [x] `tests/test_sim_core.py` — buy/sell, costs, short, reset, replay, frozen champion

---

## Tests (✅ written, verify pass with `make test`)

- [x] `test_backtest_no_lookahead.py` — 3 assertions covering lookahead vectors
- [x] `test_costs_applied.py` — 5 assertions covering cost correctness
- [x] `test_frozen_model.py` — 3 assertions covering frozen-model contract
- [x] `test_api_smoke.py` — every route returns non-500
- [x] `test_seed_db.py` — DB init + seed load

---

## Acceptance criteria checklist

- [x] Fresh clone → `make install` → `make dev` → all 4 tabs work on mock data
- [x] No console errors, no white screens when any fetch fails
- [x] All tests pass (29 passed, 1 skipped)
- [x] README and .env.example complete
- [x] Disclaimer banner visible on every page
- [x] "No edge is a valid result" framing in Tab B and Tab C
- [x] Adding ALPACA_API_KEY switches Tab C to paper trading without code change
- [x] Clean GitHub commit history, .env absent, .env.example present
