import { useState, useEffect, useRef, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { loadPrices } from '../engine/loader'
import { computeSignals, netReturn, ROUND_TRIP_COST } from '../engine/indicators'
import { computeMetrics } from '../engine/metrics'
import type { PriceBar, EquityPoint } from '../engine/types'
import { Term } from '../components/Glossary'

const INITIAL = 100_000
const CAP_PER = INITIAL / 5 * 0.92
const TICKERS = ['AAPL', 'MSFT', 'NVDA', 'META', 'AMZN']

function pct(v: number) { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` }
function fmtUSD(v: number) { return `$${(v / 1000).toFixed(0)}k` }

interface Position { shares: number; entryPrice: number; entryIdx: number }

// Custom tooltip showing strategy, SPY, and delta
function SimTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const strategy = payload.find(p => p.name === 'strategy')
  const benchmark = payload.find(p => p.name === 'benchmark')
  const delta = strategy && benchmark ? strategy.value - benchmark.value : null
  return (
    <div style={{
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-sm)',
      padding: '0.6rem 0.8rem',
      fontSize: '0.76rem',
      lineHeight: 1.7,
    }}>
      <div style={{ color: 'var(--text-lo)', marginBottom: '0.25rem', fontFamily: 'var(--font-num)' }}>{label}</div>
      {strategy && (
        <div style={{ color: '#4a9eff', fontFamily: 'var(--font-num)' }}>
          Strategy: ${strategy.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
      )}
      {benchmark && (
        <div style={{ color: '#f0b732', fontFamily: 'var(--font-num)' }}>
          SPY: ${benchmark.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
      )}
      {delta !== null && (
        <div style={{
          color: delta >= 0 ? 'var(--green)' : 'var(--red)',
          fontFamily: 'var(--font-num)',
          borderTop: '1px solid var(--border-dim)',
          marginTop: '0.2rem',
          paddingTop: '0.2rem',
        }}>
          Δ {delta >= 0 ? '+' : ''}${delta.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
      )}
    </div>
  )
}

export default function Simulation() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'loading'>('idle')
  const [curve, setCurve] = useState<EquityPoint[]>([])
  const [tradeCount, setTradeCount] = useState(0)
  const [portfolioValue, setPortfolioValue] = useState(INITIAL)
  const [metrics, setMetrics] = useState({
    sharpe: 0, sortino: 0, maxDrawdown: 0, cagr: 0,
    benchmarkCagr: 0, benchmarkSharpe: 0, winRate: 0, totalTrades: 0,
  })
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

    for (let step = 0; step < 5 && s.dayIdx < s.allDates.length; step++) {
      const date = s.allDates[s.dayIdx]
      const dp = s.priceMap.get(date)
      const spyPx = s.spyByDate.get(date) ?? s.spyStart

      let portVal = s.cash
      for (const [ticker, pos] of s.positions) {
        portVal += pos.shares * (dp?.get(ticker) ?? pos.entryPrice)
      }

      const benchVal = INITIAL * (spyPx / s.spyStart)
      s.curve.push({ date, strategy: portVal, benchmark: benchVal })

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

      const sigMap = new Map<string, (1|0)[]>()
      for (const ticker of TICKERS) {
        const bars = prices.filter(p => p.ticker === ticker).sort((a, b) => a.date.localeCompare(b.date))
        const sigs = computeSignals(bars.map(b => b.close))
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
        <p className="page-sub">
          Runs the frozen momentum strategy forward on seed prices · Model never retrains ·
          Every bar is genuinely <Term id="outOfSample">out-of-sample</Term>
        </p>
      </div>

      <div className="alert alert-blue">
        <span className="alert-icon">🔒</span>
        <span>
          Strategy is frozen — the simulation uses the same signal logic as the backtest but applies it forward on data it has never seen.
        </span>
      </div>

      {divWarn && status === 'done' && (
        <div className="alert alert-red" role="alert">
          <span className="alert-icon">⚠</span>
          <span>
            <strong>Divergence {pct(divergence)} vs backtest.</strong>{' '}
            A large gap suggests the backtest overfit to seed data.
            This is an honest failure mode — not a bug. It means the pattern was not durable.
          </span>
        </div>
      )}

      <div className="sim-header">
        <div
          className={`sim-status-dot ${status === 'running' ? 'running' : 'stopped'}`}
          aria-hidden="true"
        />
        <span style={{ fontSize: '0.8rem', color: 'var(--text-lo)' }} aria-live="polite">
          {status === 'idle' && 'Ready'}
          {status === 'loading' && 'Loading data…'}
          {status === 'running' && `Simulating · ${tradeCount} trades · day ${stateRef.current.dayIdx} / ${stateRef.current.allDates.length}`}
          {status === 'done' && `Complete · ${tradeCount} trades executed`}
        </span>
        {(status === 'idle' || status === 'done') && (
          <button
            className="btn btn-primary"
            onClick={handleStart}
            aria-label={status === 'done' ? 'Restart simulation' : 'Start simulation'}
          >
            ▶ {status === 'done' ? 'Restart' : 'Start Simulation'}
          </button>
        )}
        {status === 'running' && (
          <button className="btn btn-stop" onClick={handleStop} aria-label="Stop simulation">
            ■ Stop
          </button>
        )}
      </div>

      {error && <div className="alert alert-red" role="alert">{error}</div>}

      <div className="metrics-row" role="region" aria-label="Portfolio metrics">
        <div className="metric-box">
          <div className="metric-label">Portfolio Value</div>
          <div className="metric-val" style={{ fontSize: '1.5rem' }}>
            ${portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
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
              <div className="metric-label"><Term id="sharpe">Live Sharpe</Term></div>
              <div className="metric-val">{metrics.sharpe.toFixed(2)}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label"><Term id="maxDrawdown">Max Drawdown</Term></div>
              <div className={`metric-val ${metrics.maxDrawdown < -0.15 ? 'neg' : ''}`}>
                {pct(metrics.maxDrawdown * 100)}
              </div>
            </div>
          </>
        )}
      </div>

      {curve.length > 1 && (
        <div className="chart-box" role="region" aria-label="Simulation equity curve">
          <div className="chart-title">
            {status === 'running' ? '● Live' : '✓ Completed'} — Strategy vs SPY (<Term id="outOfSample">out-of-sample</Term>)
          </div>
          <div className="chart-legend">
            <div className="legend-item">
              <div className="legend-swatch-solid" style={{ background: '#4a9eff' }} />
              Strategy
            </div>
            <div className="legend-item">
              <div className="legend-swatch-dashed" style={{ borderColor: '#f0b732' }} />
              SPY
            </div>
            <div className="legend-item" style={{ color: 'var(--text-dim)' }}>
              <div className="legend-swatch-solid" style={{ background: 'var(--border)' }} />
              $100k start
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={curve.filter((_, i) => i % 2 === 0)}
              margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(80,60,40,0.3)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
                tickCount={6}
                stroke="none"
              />
              <YAxis
                tickFormatter={fmtUSD}
                tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
                stroke="none"
                width={46}
              />
              <Tooltip content={<SimTooltip />} />
              <ReferenceLine
                y={INITIAL}
                stroke="rgba(120,100,75,0.55)"
                strokeDasharray="5 3"
                label={{ value: '$100k', position: 'insideTopRight', fontSize: 10, fill: 'var(--text-dim)' }}
              />
              <Line
                type="monotone"
                dataKey="strategy"
                stroke="#4a9eff"
                dot={false}
                strokeWidth={2}
                name="strategy"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="benchmark"
                stroke="#f0b732"
                dot={false}
                strokeWidth={1.5}
                strokeDasharray="4 2"
                name="benchmark"
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {status === 'idle' && (
        <div className="empty-state" role="status">
          <p className="empty-title">No simulation running</p>
          <p>Click <strong>Start Simulation</strong> to run the strategy on seed price data.</p>
        </div>
      )}
    </div>
  )
}
