import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from 'recharts'
import type { BacktestConfig, BacktestResult } from '../types'
import { SampleDataBadge } from '../components/SampleDataBadge'

const ALL_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'BRK-B', 'JNJ', 'JPM']

const DEFAULT_CONFIG: BacktestConfig = {
  strategy: 'ml_classifier',
  start_date: '2022-01-03',
  end_date: '2024-06-30',
  initial_capital: 100000,
  pt_barrier: 0.03,
  sl_barrier: 0.02,
  t1_bars: 20,
  tickers: ['AAPL', 'MSFT', 'NVDA', 'META', 'AMZN'],
}

function MetricCard({ label, value, sub, highlight }: {
  label: string; value: string; sub?: string; highlight?: 'good' | 'bad' | 'neutral'
}) {
  return (
    <div className={`metric-card metric-${highlight ?? 'neutral'}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  )
}

function pct(v: number) { return `${(v * 100).toFixed(1)}%` }
function fmt2(v: number) { return v.toFixed(2) }

function sampleEvery<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const step = Math.ceil(arr.length / n)
  return arr.filter((_, i) => i % step === 0)
}

export default function Backtest() {
  const [config, setConfig] = useState<BacktestConfig>(DEFAULT_CONFIG)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRun = async () => {
    setRunning(true)
    setError(null)
    try {
      const r = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: `HTTP ${r.status}` }))
        throw new Error(err.detail ?? `HTTP ${r.status}`)
      }
      setResult(await r.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const toggleTicker = (t: string) => {
    setConfig(c => ({
      ...c,
      tickers: c.tickers.includes(t)
        ? c.tickers.filter(x => x !== t)
        : [...c.tickers, t],
    }))
  }

  const chartData = result
    ? sampleEvery(result.equity_curve, 300).map(p => ({
        date: p.date.slice(0, 10),
        Strategy: Math.round(p.strategy_value),
        'SPY (B&H)': Math.round(p.benchmark_value),
      }))
    : []

  const strat_beats = result && result.cagr > result.benchmark_cagr

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Strategy &amp; Backtest</h1>
        <p className="page-subtitle">
          Leakage-free walk-forward backtest with realistic costs.
          Benchmarked against buy-and-hold SPY.
        </p>
      </div>

      <div className="no-edge-note">
        ℹ <strong>No edge found is a valid result.</strong> The most likely honest outcome is
        underperforming SPY on a risk-adjusted basis. That outcome is useful information.
      </div>

      <div className="backtest-layout">
        {/* Config panel */}
        <div className="config-panel">
          <h3>Configuration</h3>

          <label className="config-label">Strategy</label>
          <select
            className="config-select"
            value={config.strategy}
            onChange={e => setConfig(c => ({ ...c, strategy: e.target.value as BacktestConfig['strategy'] }))}
          >
            <option value="ml_classifier">ML Classifier (GBT)</option>
            <option value="selective_clone">Selective Clone (rule-based)</option>
          </select>

          <label className="config-label">Start Date</label>
          <input type="date" className="config-input" value={config.start_date}
            onChange={e => setConfig(c => ({ ...c, start_date: e.target.value }))} />

          <label className="config-label">End Date</label>
          <input type="date" className="config-input" value={config.end_date}
            onChange={e => setConfig(c => ({ ...c, end_date: e.target.value }))} />

          <label className="config-label">Initial Capital ($)</label>
          <input type="number" className="config-input" value={config.initial_capital}
            onChange={e => setConfig(c => ({ ...c, initial_capital: +e.target.value }))} />

          <label className="config-label">Profit Take {pct(config.pt_barrier)}</label>
          <input type="range" min="0.01" max="0.15" step="0.005" value={config.pt_barrier}
            onChange={e => setConfig(c => ({ ...c, pt_barrier: +e.target.value }))} />

          <label className="config-label">Stop Loss {pct(config.sl_barrier)}</label>
          <input type="range" min="0.005" max="0.08" step="0.005" value={config.sl_barrier}
            onChange={e => setConfig(c => ({ ...c, sl_barrier: +e.target.value }))} />

          <label className="config-label">Time Barrier (days) {config.t1_bars}</label>
          <input type="range" min="5" max="60" step="5" value={config.t1_bars}
            onChange={e => setConfig(c => ({ ...c, t1_bars: +e.target.value }))} />

          <label className="config-label">Tickers</label>
          <div className="ticker-grid">
            {ALL_TICKERS.map(t => (
              <button
                key={t}
                className={`ticker-btn ${config.tickers.includes(t) ? 'active' : ''}`}
                onClick={() => toggleTicker(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <button
            className="run-btn"
            onClick={handleRun}
            disabled={running || config.tickers.length === 0}
          >
            {running ? 'Running backtest…' : 'Run Backtest'}
          </button>

          {error && <div className="error-inline">Error: {error}</div>}
        </div>

        {/* Results panel */}
        <div className="results-panel">
          {!result && !running && (
            <div className="empty-state">
              Configure the backtest and click <strong>Run Backtest</strong> to see results.
            </div>
          )}
          {running && <div className="loading-state"><div className="spinner" />Running backtest…</div>}
          {result && (
            <>
              <SampleDataBadge using={result.using_sample_data} />
              <div className="no-edge-note subtle">{result.no_edge_note}</div>

              {/* Equity curve */}
              <div className="chart-container">
                <h3>Equity Curve vs Buy-and-Hold SPY</h3>
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

              {/* Metrics */}
              <div className="metrics-grid">
                <MetricCard label="Strategy CAGR" value={pct(result.cagr)}
                  sub={`SPY: ${pct(result.benchmark_cagr)}`}
                  highlight={strat_beats ? 'good' : 'bad'} />
                <MetricCard label="Sharpe Ratio" value={fmt2(result.sharpe_ratio)}
                  sub={`SPY: ${fmt2(result.benchmark_sharpe)}`}
                  highlight={result.sharpe_ratio > result.benchmark_sharpe ? 'good' : 'bad'} />
                <MetricCard label="Sortino Ratio" value={fmt2(result.sortino_ratio)} />
                <MetricCard label="Max Drawdown" value={pct(result.max_drawdown)}
                  highlight={result.max_drawdown > -0.2 ? 'good' : 'bad'} />
                <MetricCard label="Win Rate" value={pct(result.win_rate)} />
                <MetricCard label="Total Trades" value={String(result.total_trades)} />
              </div>

              {/* Model card */}
              {result.model_card && (
                <div className="model-card-box">
                  <h3>Model Card (Frozen)</h3>
                  <table className="model-card-table">
                    <tbody>
                      <tr><td>Type</td><td>{result.model_card.model_type}</td></tr>
                      <tr><td>Training window</td><td>{result.model_card.training_window_start} → {result.model_card.training_window_end}</td></tr>
                      <tr><td>CV accuracy</td><td>{pct(result.model_card.cv_accuracy)}</td></tr>
                      <tr><td>Training samples</td><td>{result.model_card.n_train_samples.toLocaleString()}</td></tr>
                      <tr><td>Frozen at</td><td>{new Date(result.model_card.frozen_at).toLocaleString()}</td></tr>
                    </tbody>
                  </table>
                  <p className="model-card-note">
                    This model is now frozen. The simulation in Tab C will load it read-only
                    and never retrain it. Every observation in Tab C is genuine out-of-sample.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
