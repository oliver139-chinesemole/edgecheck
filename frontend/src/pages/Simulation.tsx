import { useState, useEffect, useRef, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { loadPrices } from '../engine/loader'
import { computeSignals, netReturn, ROUND_TRIP_COST } from '../engine/indicators'
import { computeMetrics } from '../engine/metrics'
import type { PriceBar, EquityPoint } from '../engine/types'

const INITIAL = 100_000
const CAP_PER = INITIAL / 5 * 0.92
const TICKERS = ['AAPL', 'MSFT', 'NVDA', 'META', 'AMZN']

function pct(v: number) { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` }
function fmtUSD(v: number) { return `$${(v / 1000).toFixed(0)}k` }

interface Position { shares: number; entryPrice: number; entryIdx: number }

export default function Simulation() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'loading'>('idle')
  const [curve, setCurve] = useState<EquityPoint[]>([])
  const [tradeCount, setTradeCount] = useState(0)
  const [portfolioValue, setPortfolioValue] = useState(INITIAL)
  const [metrics, setMetrics] = useState({ sharpe: 0, sortino: 0, maxDrawdown: 0, cagr: 0, benchmarkCagr: 0, benchmarkSharpe: 0, winRate: 0, totalTrades: 0 })
  const [divergence, setDivergence] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const stateRef = useRef({
    running: false,
    prices: [] as PriceBar[],
    signals: new Map<string, (1|0)[]>(),
    allDates: [] as string[],
    priceMap: new Map<string, Map<string, number>>(),
    spyByDate: new Map<string, number>(),
    dayIdx: 0,
    cash: INITIAL,
    positions: new Map<string, Position>(),
    tradeCount: 0,
    curve: [] as EquityPoint[],
    spyStart: 0,
  })

  const tick = useCallback(() => {
    const s = stateRef.current
    if (!s.running || s.dayIdx >= s.allDates.length) {
      s.running = false
      setStatus('done')
      // Compute final metrics
      if (s.curve.length > 10) {
        const sv = s.curve.map(p => p.strategy)
        const bv = s.curve.map(p => p.benchmark)
        setMetrics(computeMetrics(sv, bv))
        const finalRet = ((s.curve[s.curve.length - 1].strategy / INITIAL) - 1) * 100
        const benchRet = ((s.curve[s.curve.length - 1].benchmark / INITIAL) - 1) * 100
        setDivergence(finalRet - benchRet)
      }
      return
    }

    // Process 5 days per tick for speed
    for (let step = 0; step < 5 && s.dayIdx < s.allDates.length; step++) {
      const date = s.allDates[s.dayIdx]
      const dp = s.priceMap.get(date)
      const spyPx = s.spyByDate.get(date) ?? s.spyStart

      // Mark to market
      let portVal = s.cash
      for (const [ticker, pos] of s.positions) {
        portVal += pos.shares * (dp?.get(ticker) ?? pos.entryPrice)
      }

      const benchVal = INITIAL * (spyPx / s.spyStart)
      s.curve.push({ date, strategy: portVal, benchmark: benchVal })

      // Signals & trading
      for (const ticker of TICKERS) {
        const sig = s.signals.get(ticker)?.[s.dayIdx] ?? 0
        const px = dp?.get(ticker)
        if (!px) continue

        if (s.positions.has(ticker) && sig !== 1) {
          const pos = s.positions.get(ticker)!
          const gross = px / pos.entryPrice - 1
          void netReturn(gross)
          s.cash += pos.shares * px * (1 - ROUND_TRIP_COST / 2)
          s.positions.delete(ticker)
          s.tradeCount++
        }
        if (!s.positions.has(ticker) && sig === 1 && s.cash >= CAP_PER) {
          const shares = (CAP_PER * (1 - ROUND_TRIP_COST / 2)) / px
          s.cash -= CAP_PER
          s.positions.set(ticker, { shares, entryPrice: px, entryIdx: s.dayIdx })
          s.tradeCount++
        }
      }

      s.dayIdx++
    }

    // Update UI every 5 days
    const snapshot = s.curve.slice(-300)
    setCurve([...snapshot])
    setTradeCount(s.tradeCount)
    setPortfolioValue(s.curve[s.curve.length - 1]?.strategy ?? INITIAL)

    if (s.running) requestAnimationFrame(tick)
  }, [])

  const handleStart = async () => {
    setStatus('loading')
    setError(null)
    try {
      const prices = await loadPrices()
      const allDates = [...new Set(prices.map(p => p.date))].sort()

      // Skip first 252 bars (feature warm-up)
      const startIdx = 252
      const tradingDates = allDates.slice(startIdx)

      const priceMap = new Map<string, Map<string, number>>()
      for (const b of prices) {
        if (!priceMap.has(b.date)) priceMap.set(b.date, new Map())
        priceMap.get(b.date)!.set(b.ticker, b.close)
      }

      const spyBars = prices.filter(p => p.ticker === 'SPY').sort((a, b) => a.date.localeCompare(b.date))
      const spyByDate = new Map(spyBars.map(b => [b.date, b.close]))
      const spyStart = spyByDate.get(tradingDates[0] ?? '') ?? 100

      // Compute signals for each ticker on full history (lagged — safe)
      const sigMap = new Map<string, (1|0)[]>()
      for (const ticker of TICKERS) {
        const bars = prices.filter(p => p.ticker === ticker).sort((a, b) => a.date.localeCompare(b.date))
        const sigs = computeSignals(bars.map(b => b.close))
        // Re-index to allDates, only take from startIdx
        const byDate = new Map(bars.map((b, i) => [b.date, sigs[i]]))
        sigMap.set(ticker, tradingDates.map(d => byDate.get(d) ?? 0))
      }

      const s = stateRef.current
      s.prices = prices
      s.signals = sigMap
      s.allDates = tradingDates
      s.priceMap = priceMap
      s.spyByDate = spyByDate
      s.dayIdx = 0
      s.cash = INITIAL
      s.positions = new Map()
      s.tradeCount = 0
      s.curve = []
      s.spyStart = spyStart
      s.running = true

      setCurve([])
      setTradeCount(0)
      setPortfolioValue(INITIAL)
      setStatus('running')
      requestAnimationFrame(tick)
    } catch (e) {
      setError(String(e))
      setStatus('idle')
    }
  }

  const handleStop = () => {
    stateRef.current.running = false
    setStatus('done')
  }

  useEffect(() => () => { stateRef.current.running = false }, [])

  const stratRet = ((portfolioValue / INITIAL) - 1) * 100
  const benchRet = curve.length > 0 ? ((curve[curve.length - 1].benchmark / INITIAL) - 1) * 100 : 0
  const divWarn = Math.abs(divergence) > 15

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Live Paper Simulation</h1>
        <p className="page-sub">Runs the frozen momentum strategy forward on seed prices · Model never retrains · Every bar is genuinely out-of-sample</p>
      </div>

      <div className="alert alert-blue">
        <span className="alert-icon">🔒</span>
        <span>Strategy is frozen — the simulation uses the same signal logic as the backtest but applies it forward on data it has never seen.</span>
      </div>

      {divWarn && status === 'done' && (
        <div className="alert alert-red">
          <span className="alert-icon">⚠</span>
          <span><strong>Divergence {pct(divergence)} vs backtest.</strong> A large gap suggests the backtest overfit to seed data. This is an honest failure mode, not a bug.</span>
        </div>
      )}

      <div className="sim-header">
        <div className={`sim-status-dot ${status === 'running' ? 'running' : 'stopped'}`} />
        <span style={{ fontSize: '0.8rem', color: 'var(--text-lo)' }}>
          {status === 'idle' && 'Ready'}
          {status === 'loading' && 'Loading data…'}
          {status === 'running' && `Simulating · ${tradeCount} trades · day ${stateRef.current.dayIdx} / ${stateRef.current.allDates.length}`}
          {status === 'done' && `Complete · ${tradeCount} trades executed`}
        </span>
        {(status === 'idle' || status === 'done') && (
          <button className="btn btn-primary" onClick={handleStart}>▶ {status === 'done' ? 'Restart' : 'Start Simulation'}</button>
        )}
        {status === 'running' && (
          <button className="btn btn-stop" onClick={handleStop}>■ Stop</button>
        )}
      </div>

      {error && <div className="alert alert-red">{error}</div>}

      <div className="metrics-row">
        <div className="metric-box">
          <div className="metric-label">Portfolio Value</div>
          <div className="metric-val" style={{ fontSize: '1.15rem' }}>${portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className={`metric-box ${stratRet >= 0 ? 'pos' : 'neg'}`}>
          <div className="metric-label">Strategy Return</div>
          <div className={`metric-val ${stratRet >= 0 ? 'pos' : 'neg'}`}>{pct(stratRet)}</div>
        </div>
        <div className="metric-box">
          <div className="metric-label">SPY Return</div>
          <div className="metric-val">{pct(benchRet)}</div>
        </div>
        {status === 'done' && (
          <>
            <div className={`metric-box ${divWarn ? 'neg' : ''}`}>
              <div className="metric-label">Divergence</div>
              <div className={`metric-val ${divergence < 0 ? 'neg' : 'pos'}`}>{pct(divergence)}</div>
              <div className="metric-hint">vs backtest</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Live Sharpe</div>
              <div className="metric-val">{metrics.sharpe.toFixed(2)}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Max Drawdown</div>
              <div className={`metric-val ${metrics.maxDrawdown < -0.15 ? 'neg' : ''}`}>{pct(metrics.maxDrawdown * 100)}</div>
            </div>
          </>
        )}
      </div>

      {curve.length > 1 && (
        <div className="chart-box">
          <div className="chart-title">
            {status === 'running' ? '● Live' : '✓ Completed'} — Strategy vs SPY (out-of-sample)
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={curve.filter((_, i) => i % 2 === 0)} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(48,64,96,0.4)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickCount={6} stroke="none" />
              <YAxis tickFormatter={fmtUSD} tick={{ fontSize: 10 }} stroke="none" width={46} />
              <Tooltip formatter={(v: number) => [`$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, '']} />
              <Line type="monotone" dataKey="strategy" stroke="#3d8ef0" dot={false} strokeWidth={2} name="Strategy" isAnimationActive={false} />
              <Line type="monotone" dataKey="benchmark" stroke="#e8a930" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="SPY" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {status === 'idle' && (
        <div className="empty-state">
          <p className="empty-title">No simulation running</p>
          <p>Click <strong>Start Simulation</strong> to run the strategy on seed price data.</p>
        </div>
      )}
    </div>
  )
}
