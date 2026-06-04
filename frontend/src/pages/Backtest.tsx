import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { loadPrices, loadHoldings } from '../engine/loader'
import { runBacktest } from '../engine/backtest'
import type { BacktestResult } from '../engine/types'

const ALL_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'JNJ', 'JPM']
const DEFAULT_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'META', 'AMZN']

function pct(v: number, decimals = 1) { return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(decimals)}%` }
function fmtUSD(v: number) { return `$${(v / 1000).toFixed(0)}k` }
function sampleN<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const step = Math.ceil(arr.length / n)
  return arr.filter((_, i) => i % step === 0)
}

function MetricBox({ label, val, hint, tone }: { label: string; val: string; hint?: string; tone?: 'pos' | 'neg' | 'neutral' }) {
  return (
    <div className={`metric-box${tone ? ` ${tone}` : ''}`}>
      <div className="metric-label">{label}</div>
      <div className={`metric-val${tone ? ` ${tone}` : ''}`}>{val}</div>
      {hint && <div className="metric-hint">{hint}</div>}
    </div>
  )
}

export default function Backtest() {
  const [strategy, setStrategy] = useState<'momentum' | 'clone'>('momentum')
  const [tickers, setTickers] = useState(new Set(DEFAULT_TICKERS))
  const [ptBarrier, setPt] = useState(0.03)
  const [slBarrier, setSl] = useState(0.02)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggleTicker = (t: string) => {
    setTickers(prev => {
      const n = new Set(prev)
      n.has(t) ? n.delete(t) : n.add(t)
      return n
    })
  }

  const handleRun = async () => {
    if (tickers.size === 0) return
    setRunning(true); setError(null); setResult(null)
    try {
      const [prices, holdings] = await Promise.all([loadPrices(), loadHoldings()])
      const res = runBacktest(prices, holdings, strategy, [...tickers])
      setResult(res)
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  const chartData = result
    ? sampleN(result.equityCurve, 280).map(p => ({
        d: p.date.slice(2, 10),
        Strategy: Math.round(p.strategy),
        SPY: Math.round(p.benchmark),
      }))
    : []

  const m = result?.metrics
  const strat_beats_sharpe = m && m.sharpe > m.benchmarkSharpe
  const strat_beats_cagr = m && m.cagr > m.benchmarkCagr

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Strategy &amp; Backtest</h1>
        <p className="page-sub">Walk-forward backtest · Triple-barrier labels · 8 bps round-trip costs · Benchmarked vs buy-and-hold SPY</p>
      </div>

      <div className="alert alert-green">
        <span className="alert-icon">◎</span>
        <span><strong>No edge found is a valid, expected result.</strong> The most likely honest outcome is underperforming SPY on a risk-adjusted basis. That is still useful information.</span>
      </div>

      <div className="bt-layout">
        {/* Config */}
        <div className="config-panel">
          <div className="config-section-title">Configuration</div>

          <div className="config-row">
            <div className="config-label">Strategy</div>
            <select className="config-select" value={strategy} onChange={e => setStrategy(e.target.value as 'momentum' | 'clone')}>
              <option value="momentum">Momentum (RSI + MA)</option>
              <option value="clone">Selective Clone (13F)</option>
            </select>
          </div>

          <div className="config-row">
            <div className="config-label">Profit take <span>{pct(ptBarrier)}</span></div>
            <input type="range" min={0.01} max={0.12} step={0.005} value={ptBarrier} onChange={e => setPt(+e.target.value)} />
          </div>

          <div className="config-row">
            <div className="config-label">Stop loss <span>{pct(slBarrier)}</span></div>
            <input type="range" min={0.005} max={0.06} step={0.005} value={slBarrier} onChange={e => setSl(+e.target.value)} />
          </div>

          <div className="config-row">
            <div className="config-label" style={{ marginBottom: '0.35rem' }}>Tickers</div>
            <div className="ticker-row">
              {ALL_TICKERS.map(t => (
                <button key={t} className={`ticker-chip${tickers.has(t) ? ' on' : ''}`} onClick={() => toggleTicker(t)}>{t}</button>
              ))}
            </div>
          </div>

          <button className="run-btn" onClick={handleRun} disabled={running || tickers.size === 0}>
            {running ? 'Computing…' : 'Run Backtest'}
          </button>
          {error && <p style={{ color: 'var(--red)', fontSize: '0.75rem', marginTop: '0.5rem' }}>{error}</p>}
        </div>

        {/* Results */}
        <div>
          {!result && !running && (
            <div className="empty-state">
              <p className="empty-title">No results yet</p>
              <p>Select a strategy and click <strong>Run Backtest</strong> to see results.</p>
            </div>
          )}
          {running && <div className="loading-state"><div className="spinner" />Running backtest in browser…</div>}

          {result && m && (
            <>
              <div className="metrics-row">
                <MetricBox label="Strategy CAGR" val={pct(m.cagr)} hint={`SPY ${pct(m.benchmarkCagr)}`} tone={strat_beats_cagr ? 'pos' : 'neg'} />
                <MetricBox label="Sharpe Ratio" val={m.sharpe.toFixed(2)} hint={`SPY ${m.benchmarkSharpe.toFixed(2)}`} tone={strat_beats_sharpe ? 'pos' : 'neg'} />
                <MetricBox label="Sortino" val={m.sortino.toFixed(2)} />
                <MetricBox label="Max Drawdown" val={pct(m.maxDrawdown)} tone={m.maxDrawdown > -0.15 ? 'pos' : 'neg'} />
                <MetricBox label="Win Rate" val={pct(m.winRate, 0)} />
                <MetricBox label="Total Trades" val={String(m.totalTrades)} />
              </div>

              {!strat_beats_sharpe && (
                <div className="alert alert-amber" style={{ marginBottom: '1rem' }}>
                  <span>Strategy underperforms SPY (Sharpe {m.sharpe.toFixed(2)} vs {m.benchmarkSharpe.toFixed(2)}). This is the honest, expected result for most strategies.</span>
                </div>
              )}

              <div className="chart-box">
                <div className="chart-title">Equity Curve — Strategy vs Buy-and-Hold SPY (out-of-sample test window)</div>
                <div className="chart-legend">
                  <div className="legend-item"><div className="legend-dot" style={{ background: '#3d8ef0' }} />Strategy</div>
                  <div className="legend-item"><div className="legend-dot" style={{ background: '#e8a930' }} />SPY (B&amp;H)</div>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(48,64,96,0.4)" />
                    <XAxis dataKey="d" tick={{ fontSize: 10 }} tickCount={6} stroke="none" />
                    <YAxis tickFormatter={fmtUSD} tick={{ fontSize: 10 }} stroke="none" width={46} />
                    <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} labelStyle={{ color: 'var(--text-lo)' }} />
                    <Line type="monotone" dataKey="Strategy" stroke="#3d8ef0" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="SPY" stroke="#e8a930" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="model-card">
                <div className="model-card-title">🔒 Strategy Config (Frozen)</div>
                <div className="model-kv">
                  <span>Strategy</span><span>{result.strategy}</span>
                  <span>Walk-forward split</span><span>70% train / 30% test</span>
                  <span>Embargo</span><span>5 bars</span>
                  <span>Cost per round-trip</span><span>8 bps</span>
                  <span>Tickers</span><span>{[...tickers].join(', ')}</span>
                </div>
                <p className="model-frozen-note">
                  ✓ All features lagged ≥1 bar · Labels use only future data · Test window is genuinely out-of-sample
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
