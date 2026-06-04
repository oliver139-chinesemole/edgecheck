import { useState, useEffect, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from 'recharts'
import type { SimState } from '../types'
import { SampleDataBadge } from '../components/SampleDataBadge'
import { useNavigate } from 'react-router-dom'

function sampleEvery<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const step = Math.ceil(arr.length / n)
  return arr.filter((_, i) => i % step === 0)
}

function pct(v: number) { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` }
function fmt2(v: number) { return v.toFixed(2) }

export default function Simulation() {
  const [state, setState] = useState<SimState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const navigate = useNavigate()

  const fetchState = async () => {
    try {
      const r = await fetch('/api/simulation/state')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setState(await r.json())
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchState()
    pollRef.current = setInterval(fetchState, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const handleStart = async () => {
    await fetch('/api/simulation/start', { method: 'POST' })
    fetchState()
  }

  const handleStop = async () => {
    await fetch('/api/simulation/stop', { method: 'POST' })
    fetchState()
  }

  if (loading) return <div className="loading-state"><div className="spinner" />Loading simulation state…</div>
  if (error) return (
    <div className="error-state">
      <p>Failed to connect: {error}</p>
      <button onClick={fetchState}>Retry</button>
    </div>
  )
  if (!state) return <div className="empty-state">No data.</div>

  if (state.status === 'no_model') {
    return (
      <div className="page-content">
        <div className="page-header">
          <h1>Live Paper Simulation</h1>
        </div>
        <div className="no-model-notice">
          <h3>No model trained yet</h3>
          <p>{state.message}</p>
          <button className="run-btn" onClick={() => navigate('/backtest')}>
            Go to Strategy &amp; Backtest →
          </button>
        </div>
      </div>
    )
  }

  const chartData = sampleEvery(state.equity_curve, 300).map(p => ({
    date: p.date.slice(0, 10),
    Strategy: Math.round(p.strategy_value),
    'SPY (B&H)': Math.round(p.benchmark_value),
  }))

  const divWarn = state.divergence_warning

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Live Paper Simulation</h1>
        <p className="page-subtitle">
          Using the <strong>frozen</strong> model from Tab B. Every bar shown here is
          genuine out-of-sample — the model has never been retrained on this data.
        </p>
        <SampleDataBadge using={state.using_sample_data} message={state.message} />
      </div>

      <div className="frozen-model-banner">
        🔒 Model is frozen · Data source: <strong>{state.data_source}</strong> ·
        Trades: <strong>{state.trade_count}</strong> ·
        Last updated: {new Date(state.last_updated).toLocaleTimeString()}
      </div>

      {divWarn && (
        <div className="divergence-warning">
          ⚠ <strong>Large divergence detected ({pct(state.divergence_pct)}).</strong>{' '}
          This suggests the backtest may have been overfit or data-leaked.
          A large gap between backtest returns and live sim returns is an honest failure mode.
        </div>
      )}

      <div className="sim-controls">
        {state.status === 'running' ? (
          <button className="stop-btn" onClick={handleStop}>■ Stop Simulation</button>
        ) : (
          <button className="run-btn" onClick={handleStart}>▶ Start Simulation</button>
        )}
        <span className={`status-pill ${state.status}`}>{state.status}</span>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Portfolio Value</div>
          <div className="metric-value">${state.portfolio_value.toLocaleString()}</div>
        </div>
        <div className={`metric-card ${state.realized_return_pct >= 0 ? 'metric-good' : 'metric-bad'}`}>
          <div className="metric-label">Strategy Return</div>
          <div className="metric-value">{pct(state.realized_return_pct)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">SPY Return</div>
          <div className="metric-value">{pct(state.benchmark_return_pct)}</div>
        </div>
        <div className={`metric-card ${divWarn ? 'metric-bad' : 'metric-neutral'}`}>
          <div className="metric-label">Divergence (vs SPY)</div>
          <div className="metric-value">{pct(state.divergence_pct)}</div>
          <div className="metric-sub">positive = outperforming</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Sharpe Ratio</div>
          <div className="metric-value">{fmt2(state.sharpe_ratio)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Max Drawdown</div>
          <div className="metric-value">{pct(state.max_drawdown * 100)}</div>
        </div>
      </div>

      {chartData.length > 1 && (
        <div className="chart-container">
          <h3>Live Equity Curve vs Buy-and-Hold SPY</h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickCount={6} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} />
              <Legend />
              <Line type="monotone" dataKey="Strategy" stroke="#3b82f6" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="SPY (B&H)" stroke="#f59e0b" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {state.current_positions.length > 0 && (
        <div className="table-wrapper">
          <h3>Current Positions</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Ticker</th><th>Shares</th><th>Entry</th>
                <th>Current</th><th>Unrealized P&L</th><th>P&L %</th>
              </tr>
            </thead>
            <tbody>
              {state.current_positions.map((p, i) => (
                <tr key={i} className={p.unrealized_pnl >= 0 ? 'row-buy' : 'row-sell'}>
                  <td><strong>{p.ticker}</strong></td>
                  <td>{p.shares.toFixed(2)}</td>
                  <td>${p.entry_price.toFixed(2)}</td>
                  <td>${p.current_price.toFixed(2)}</td>
                  <td>${p.unrealized_pnl.toFixed(2)}</td>
                  <td>{pct(p.unrealized_pnl_pct * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
