# EdgeCheck — Improvement Plan

Priority-ranked critique and improvement plan. Last updated: 2026-06-04.

---

## Current State Assessment

EdgeCheck is a well-conceived research SPA with honest, well-structured logic. The core engine is solid. The weak spots are entirely visual and UX — the app looks like a generic GitHub-dark SaaS dashboard, not a premium research terminal. The disclaimer content is present but visually thin. Jargon is unexplained. Charts are basic.

---

## Priority-Ranked Improvements

### P0 — Typography & Design Tokens (Improvement A) ★★★★★

**Problem:** The app uses `-apple-system` system fonts, the cold GitHub-blue palette (#0d1117), and modestly-sized metric values (1.35rem). This makes it visually indistinguishable from thousands of other dark dashboards.

**Fix:**
- Import Inter (400/500/600/700) and JetBrains Mono (400/500/600) from Google Fonts
- Shift base surfaces to warm near-black: #0c0a09, #131110, #1a1816 — the warm/cool contrast between the dark background and the blue/amber accents creates a distinctive premium-terminal feel
- Scale up metric values to 1.7rem+, using JetBrains Mono for all numbers
- Make the disclaimer bar visually prominent — currently it is 0.75rem text on a thin amber strip; should be larger and commanding
- Add a proper 4px spacing scale (`--space-1` through `--space-8`)
- Make the nav brand more distinctive (increase size, add monospace treatment to "Edge")

**Why this is P0:** Typography and color are the single highest-ROI change. Every other element looks better with a strong typographic foundation.

---

### P1 — Glossary Tooltip System (Improvement B) ★★★★☆

**Problem:** The app uses terms like Sharpe Ratio, Sortino, Max Drawdown, CAGR, Win Rate, Walk-forward validation, Out-of-sample, Triple-barrier labeling, Champion/Challenger, and 13F filing without explaining them. Users unfamiliar with quantitative finance — the vast majority — will not understand what they're looking at. This erodes trust.

**Fix:**
- Create `components/Glossary.tsx` with a `<Term>` component
- Inline `?` trigger button that opens a floating definition on hover/focus/click
- Keyboard accessible: Enter/Space to open, Escape to close
- Respects `prefers-reduced-motion`
- WCAG AA contrast on the popover
- Wire into Backtest.tsx metric labels and ImprovementLog.tsx

**Definitions to include:**
- **Sharpe Ratio** — Risk-adjusted return: excess return per unit of volatility. A Sharpe > 1 is considered good; < 0.5 is weak.
- **Sortino Ratio** — Like Sharpe but only penalizes downside volatility. Better measure for asymmetric return distributions.
- **Max Drawdown** — Largest peak-to-trough decline in portfolio value. Tells you the worst historical loss you would have endured.
- **CAGR** — Compound Annual Growth Rate. Annualizes total return accounting for compounding.
- **Win Rate** — Percentage of trades that closed at a profit. High win rate alone is meaningless without knowing the win/loss magnitude ratio.
- **Walk-forward validation** — A backtesting discipline where the model is trained on a rolling past window and tested on the next unseen window, repeatedly. Reduces look-ahead bias.
- **Out-of-sample** — Data the model has never trained on. The only honest performance estimate.
- **Triple-barrier labeling** — A method that labels each trade with one of three outcomes: profit-take, stop-loss, or time expiry. Reduces label bias.
- **Champion/Challenger** — A framework where the current best model (champion) can only be replaced if a new model (challenger) clears a defined improvement threshold on hold-out data.
- **13F filing** — Quarterly SEC filing required of institutional investment managers with ≥$100M AUM, disclosing long equity positions. Filed 45 days after quarter-end — data is always stale.

---

### P2 — Chart & Result Framing (Improvement C) ★★★★☆

**Problem:**
- When a strategy underperforms, the existing amber alert is a generic warning box — it doesn't communicate that underperformance is *expected* and *informative*
- Charts lack a reference line at initial capital ($100k) — users can't quickly see if the strategy is above or below water
- The Recharts tooltip shows only a single value and no benchmark comparison
- The strategy line has no fill, making gains/losses harder to read at a glance

**Fix:**
- "Honest Result" panel: a distinctively-styled panel (not a generic alert) that appears after results arrive, framing underperformance as expected information, not failure. Include the specific numbers.
- Add `ReferenceLine` at $100,000 on both Backtest and Simulation charts
- Custom tooltip component showing: date, strategy value, SPY value, and delta
- Add `Area` fill below strategy line (subtle, low opacity)

---

### P3 — Loading Skeletons & Empty States (Improvement D) ★★★☆☆

**Problem:**
- SmartMoney shows a spinner during data load — weak for a table of data
- Backtest empty state says "No results yet" with minimal guidance — new users don't understand the flow
- No aria-labels on key interactive elements

**Fix:**
- `SkeletonTable` component with animated shimmer rows
- Backtest empty state: numbered flow "1. Pick a strategy → 2. Select tickers → 3. Run Backtest"
- Add `aria-label` and `role` attributes to key interactive elements

---

## Non-Improvements (Things to Keep)

- The honesty messaging ("no edge found is valid") — keep and strengthen
- The walk-forward + embargo methodology notes — these are differentiators
- The frozen model messaging — this is rare and trustworthy; make it more visible
- All four tabs — must remain functional
- Zero-API-key operation — do not add any hard dependencies

---

## Implementation Order

1. **Improvement A** — Typography & design tokens (foundation for everything else)
2. **Improvement B** — Glossary tooltip system (trust + accessibility)
3. **Improvement C** — Chart & result framing (data communication)
4. **Improvement D** — Loading skeletons + empty states (polish)
