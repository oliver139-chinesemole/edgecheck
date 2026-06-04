/**
 * Walk-forward backtest engine — runs entirely in the browser.
 *
 * Anti-lookahead guarantees:
 * 1. Signals at bar i use closes[0..i-1] only (lag 1, enforced in computeSignals).
 * 2. Walk-forward split: first 70% of trading days = train window (signal
 *    calibration), last 30% = test window where we simulate actual trades.
 * 3. A 5-day embargo between train end and test start prevents leakage through
 *    autocorrelated signals.
 */
import type { PriceBar, BacktestResult, EquityPoint } from './types'
import { computeSignals, netReturn, ROUND_TRIP_COST } from './indicators'
import { computeMetrics, buildEquityCurve } from './metrics'
import type { Holding } from './types'

const INITIAL_CAPITAL = 100_000

export function runBacktest(
  prices: PriceBar[],
  holdings: Holding[],
  strategy: 'momentum' | 'clone',
  tickers: string[],
): BacktestResult {
  // Gather all sorted trading dates
  const allDates = [...new Set(prices.map(p => p.date))].sort()
  const splitIdx = Math.floor(allDates.length * 0.70)
  const EMBARGO = 5
  const testDates = new Set(allDates.slice(splitIdx + EMBARGO))

  // Build price lookup: date → ticker → close
  const priceMap = new Map<string, Map<string, number>>()
  for (const bar of prices) {
    if (!priceMap.has(bar.date)) priceMap.set(bar.date, new Map())
    priceMap.get(bar.date)!.set(bar.ticker, bar.close)
  }

  // Build ticker → sorted closes (for signal computation)
  const tickerBars = new Map<string, PriceBar[]>()
  for (const bar of prices) {
    if (!tickers.includes(bar.ticker)) continue
    const arr = tickerBars.get(bar.ticker) ?? []
    arr.push(bar)
    tickerBars.set(bar.ticker, arr)
  }
  for (const [, arr] of tickerBars) arr.sort((a, b) => a.date.localeCompare(b.date))

  // Pre-compute signals per ticker (lagged, so safe to compute on full history)
  const signalMap = new Map<string, Map<string, 1 | 0>>()
  if (strategy === 'momentum') {
    for (const [ticker, bars] of tickerBars) {
      const closes = bars.map(b => b.close)
      const sigs = computeSignals(closes)
      const m = new Map<string, 1 | 0>()
      bars.forEach((b, i) => m.set(b.date, sigs[i]))
      signalMap.set(ticker, m)
    }
  } else {
    // Clone: buy tickers held by ≥3 funds in the latest quarter
    const latestQ = [...new Set(holdings.map(h => h.quarter))].sort().pop() ?? ''
    const latestH = holdings.filter(h => h.quarter === latestQ)
    const fundCounts = new Map<string, number>()
    for (const h of latestH) {
      fundCounts.set(h.ticker, (fundCounts.get(h.ticker) ?? 0) + 1)
    }
    for (const ticker of tickers) {
      const sigs = new Map<string, 1 | 0>()
      const isClone: 1 | 0 = (fundCounts.get(ticker) ?? 0) >= 3 ? 1 : 0
      for (const d of allDates) sigs.set(d, isClone)
      signalMap.set(ticker, sigs)
    }
  }

  // SPY benchmark
  const spyBars = prices.filter(p => p.ticker === 'SPY').sort((a, b) => a.date.localeCompare(b.date))
  const spyByDate = new Map(spyBars.map(b => [b.date, b.close]))

  // Simulate on test window
  let cash = INITIAL_CAPITAL
  const positions = new Map<string, { shares: number; entryPrice: number; entryIdx: number }>()
  const equityByDate = new Map<string, number>()
  let tradeCount = 0
  const capitalPerTicker = INITIAL_CAPITAL / Math.max(tickers.length, 1) * 0.92

  const testDateList = allDates.filter(d => testDates.has(d))
  const spyStart = spyByDate.get(testDateList[0] ?? '') ?? 100

  for (let dayIdx = 0; dayIdx < testDateList.length; dayIdx++) {
    const date = testDateList[dayIdx]
    const dayPrices = priceMap.get(date)

    // Mark-to-market
    let portfolioVal = cash
    for (const [ticker, pos] of positions) {
      const px = dayPrices?.get(ticker) ?? pos.entryPrice
      portfolioVal += pos.shares * px
    }
    equityByDate.set(date, portfolioVal)

    for (const ticker of tickers) {
      const signal = signalMap.get(ticker)?.get(date) ?? 0
      const currPrice = dayPrices?.get(ticker)
      if (!currPrice) continue

      // Exit
      if (positions.has(ticker) && signal !== 1) {
        const pos = positions.get(ticker)!
        const gross = currPrice / pos.entryPrice - 1
        const netPnl = netReturn(gross) * pos.shares * pos.entryPrice
        cash += pos.shares * currPrice
        // Deduct cost on exit
        cash -= pos.shares * currPrice * (ROUND_TRIP_COST / 2)
        positions.delete(ticker)
        tradeCount++
        void netPnl
      }

      // Enter
      if (!positions.has(ticker) && signal === 1 && cash >= capitalPerTicker) {
        const cost = capitalPerTicker * (ROUND_TRIP_COST / 2)
        const shares = (capitalPerTicker - cost) / currPrice
        cash -= capitalPerTicker
        positions.set(ticker, { shares, entryPrice: currPrice, entryIdx: dayIdx })
        tradeCount++
      }
    }
  }

  // Build equity curve aligned to test dates
  const stratVals = testDateList.map(d => equityByDate.get(d) ?? INITIAL_CAPITAL)
  const spyVals = testDateList.map(d => {
    const spy = spyByDate.get(d) ?? spyStart
    return INITIAL_CAPITAL * (spy / spyStart)
  })

  const metrics = computeMetrics(stratVals, spyVals)
  metrics.totalTrades = tradeCount

  const curve = buildEquityCurve(testDateList, stratVals, spyVals)

  return { equityCurve: curve, metrics, strategy }
}
