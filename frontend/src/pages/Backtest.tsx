import { useState } from 'react'
import {
  LineChart, Line, Area, AreaChart,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import { loadPrices, loadHoldings } from '../engine/loader'
import { runBacktest } from '../engine/backtest'
import type { BacktestResult } from '../engine/types'
import { Term } from '../components/Glossary'

const ALL_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'JNJ', 'JPM']
const DEFAULT_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'META', 'AMZN']
const INITIAL_CAPITAL = 100_000

function pct(v: number, decimals = 1) { return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(decimals)}%` }
function fmtUSD(v: number) { return `$${(v / 1000).toFixed(0)}k` }
function sampleN<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const step = Math.ceil(arr.length / n)
  return arr.filter((_, i) => i % step === 0)
}

// Custom tooltip for the equity chart
function EquityTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const strategy = payload.find(p => p.name === 'Strategy')
  const spy = payload.find(p => p.name === 'SPY')
  const delta = strategy && spy ? strategy.value - spy.value : null
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
          Strategy: ${strategy.value.toLocaleString()}
        </div>
      )}
      {spy && (
        <div style={{ color: '#f0b732', fontFamily: 'var(--font-num)' }}>
          SPY: ${spy.value.toLocaleString()}
        </div>
      )}
      {delta !== null && (
        <div style={{ color: delta >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-num)', borderTop: '1px solid var(--border-dim)', marginTop: '0.2rem', paddingTop: '0.2rem' }}>
          Δ {delta >= 0 ? '+' : ''}${delta.toLocaleString()}
        </div>
      )}
    </div>
  )
}

function MetricBox({ label, val, hint, tone }: { label: React.ReactNode; val: string; hint?: string; tone?: 'pos' | 'neg' | 'neutral' }) {
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

  // For the honest result panel
  const underperforms = m && (!strat_beats_sharpe || !strat_beats_cagr)

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Strategy &amp; Backtest</h1>
        <p className="page-sub">
          <Term id="walkForward">Walk-forward backtest</Term> ·{' '}
          <Term id="tripleBarrier">Triple-barrier labels</Term> · 8 bps round-trip costs · Benchmarked vs buy-and-hold SPY
        </p>
      </div>

      <div className="alert alert-green">
        <span className="alert-icon">◎</span>
        <span>
          <strong>No edge found is a valid, expected result.</strong>{' '}
          The most likely honest outcome is underperforming SPY on a risk-adjusted basis. That is still useful information.
        </span>
      </div>

      <div className="bt-layout">
        {/* Config */}
        <div className="config-panel" role="form" aria-label="Backtest configuration">
          <div className="config-section-title">Configuration</div>

          <div className="config-row">
            <div className="config-label">Strategy</div>
            <select
              className="config-select"
              value={strategy}
              onChange={e => setStrategy(e.target.value as 'momentum' | 'clone')}
              aria-label="Select strategy type"
            >
              <option value="momentum">Momentum (RSI + MA)</option>
              <option value="clone">Selective Clone (13F)</option>
            </select>
          </div>

          <div className="config-row">
            <div className="config-label">Profit take <span>{pct(ptBarrier)}</span></div>
            <input
              type="range" min={0.01} max={0.12} step={0.005}
              value={ptBarrier} onChange={e => setPt(+e.target.value)}
              aria-label={`Profit take barrier: ${pct(ptBarrier)}`}
            />
          </div>

          <div className="config-row">
            <div className="config-label">Stop loss <span>{pct(slBarrier)}</span></div>
            <input
              type="range" min={0.005} max={0.06} step={0.005}
              value={slBarrier} onChange={e => setSl(+e.target.value)}
              aria-label={`Stop loss barrier: ${pct(slBarrier)}`}
            />
          </div>

          <div className="config-row">
            <div className="config-label" style={{ marginBottom: '0.35rem' }}>Tickers</div>
            <div className="ticker-row" role="group" aria-label="Select tickers">
              {ALL_TICKERS.map(t => (
                <button
                  key={t}
                  className={`ticker-chip${tickers.has(t) ? ' on' : ''}`}
                  onClick={() => toggleTicker(t)}
                  aria-pressed={tickers.has(t)}
                  aria-label={`${t}: ${tickers.has(t) ? 'selected' : 'not selected'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <button
            className="run-btn"
            onClick={handleRun}
            disabled={running || tickers.size === 0}
            aria-label="Run backtest"
          >
            {running ? 'Computing…' : 'Run Backtest'}
          </button>
          {error && <p style={{ color: 'var(--red)', fontSize: '0.75rem', marginTop: '0.5rem' }} role="alert">{error}</p>}
        </div>

        {/* Results */}
        <div>
          {!result && !running && (
            <div className="bt-empty" role="status" aria-label="Backtest instructions">
              <div className="bt-empty-title">Ready to backtest</div>
              <div className="bt-empty-sub">Follow the steps below to run your first backtest.</div>
              <div className="bt-flow">
                <div className="bt-flow-step">
                  <div className="bt-flow-num">1</div>
                  <div className="bt-flow-label">Pick a strategy<br />(Momentum or Clone)</div>
                </div>
                <div className="bt-flow-arrow">→</div>
                <div className="bt-flow-step">
                  <div className="bt-flow-num">2</div>
                  <div className="bt-flow-label">Select tickers to trade</div>
                </div>
                <div className="bt-flow-arrow">→</div>
                <div className="bt-flow-step">
                  <div className="bt-flow-num">3</div>
                  <div className="bt-flow-label">Click<br /><strong style={{ color: 'var(--blue)' }}>Run Backtest</strong></div>
                </div>
              </div>
            </div>
          )}
          {running && (
            <div className="loading-state" role="status" aria-live="polite">
              <div className="spinner" aria-hidden="true" />
              Running backtest in browser…
            </div>
          )}

          {result && m && (
            <>
              <div className="metrics-row" role="region" aria-label="Backtest metrics">
                <MetricBox
                  label={<Term id="cagr">Strategy CAGR</Term>}
                  val={pct(m.cagr)}
                  hint={`SPY ${pct(m.benchmarkCagr)}`}
                  tone={strat_beats_cagr ? 'pos' : 'neg'}
                />
                <MetricBox
                  label={<Term id="sharpe">Sharpe Ratio</Term>}
                  val={m.sharpe.toFixed(2)}
                  hint={`SPY ${m.benchmarkSharpe.toFixed(2)}`}
                  tone={strat_beats_sharpe ? 'pos' : 'neg'}
                />
                <MetricBox
                  label={<Term id="sortino">Sortino</Term>}
                  val={m.sortino.toFixed(2)}
                />
                <MetricBox
                  label={<Term id="maxDrawdown">Max Drawdown</Term>}
                  val={pct(m.maxDrawdown)}
                  tone={m.maxDrawdown > -0.15 ? 'pos' : 'neg'}
                />
                <MetricBox
                  label={<Term id="winRate">Win Rate</Term>}
                  val={pct(m.winRate, 0)}
                />
                <MetricBox label="Total Trades" val={String(m.totalTrades)} />
              </div>

              {/* Honest Result panel — shown when strategy underperforms */}
              {underperforms ? (
                <div className="honest-result" role="region" aria-label="Honest result analysis">
                  <div className="honest-result-header">
                    <span className="honest-result-badge">Honest Result</span>
                    <span className="honest-result-title">Strategy underperforms SPY</span>
                  </div>
                  <div className="honest-result-numbers">
                    <div className="honest-result-stat">
                      <span className="honest-result-stat-label">Strategy CAGR</span>
                      <span className="honest-result-stat-val" style={{ color: m.cagr >= 0 ? 'var(--text-hi)' : 'var(--red)' }}>
                        {pct(m.cagr)}
                      </span>
                    </div>
                    <div className="honest-result-stat">
                      <span className="honest-result-stat-label">SPY CAGR</span>
                      <span className="honest-result-stat-val" style={{ color: 'var(--amber)' }}>
                        {pct(m.benchmarkCagr)}
                      </span>
                    </div>
                    <div className="honest-result-stat">
                      <span className="honest-result-stat-label">Strategy Sharpe</span>
                      <span className="honest-result-stat-val" style={{ color: 'var(--text-hi)' }}>
                        {m.sharpe.toFixed(2)}
                      </span>
                    </div>
                    <div className="honest-result-stat">
                      <span className="honest-result-stat-label">SPY Sharpe</span>
                      <span className="honest-result-stat-val" style={{ color: 'var(--amber)' }}>
                        {m.benchmarkSharpe.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="honest-result-explanation">
                    This is the expected result. Most strategies fail to beat a passive index after costs.
                    An underperforming strategy still contains information: it tells you that this signal, at these
                    parameters, on this universe, is not reliably priced in advance by this model.
                    That is a real finding — not a failure.
                  </div>
                </div>
              ) : (
                <div className="alert alert-green" style={{ marginBottom: '1rem' }}>
                  <span className="alert-icon">◎</span>
                  <span>
                    Strategy outperforms SPY (Sharpe {m.sharpe.toFixed(2)} vs {m.benchmarkSharpe.toFixed(2)}).
                    Interpret cautiously — examine if this holds on different parameter sets and tickers before drawing conclusions.
                  </span>
                </div>
              )}

              <div className="chart-box" role="region" aria-label="Equity curve chart">
                <div className="chart-title">
                  Equity Curve — Strategy vs Buy-and-Hold SPY (<Term id="outOfSample">out-of-sample</Term> test window)
                </div>
                <div className="chart-legend">
                  <div className="legend-item">
                    <div className="legend-swatch-solid" style={{ background: '#4a9eff' }} />
                    Strategy
                  </div>
                  <div className="legend-item">
                    <div className="legend-swatch-dashed" style={{ borderColor: '#f0b732' }} />
                    SPY (B&amp;H)
                  </div>
                  <div className="legend-item" style={{ color: 'var(--text-dim)' }}>
                    <div className="legend-swatch-solid" style={{ background: 'var(--border)' }} />
                    $100k start
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                    <defs>
                      <linearGradient id="strategyFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4a9eff" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#4a9eff" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(80,60,40,0.3)" />
                    <XAxis dataKey="d" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} tickCount={6} stroke="none" />
                    <YAxis tickFormatter={fmtUSD} tick={{ fontSize: 10, fill: 'var(--text-dim)' }} stroke="none" width={46} />
                    <Tooltip content={<EquityTooltip />} />
                    <ReferenceLine
                      y={INITIAL_CAPITAL}
                      stroke="rgba(120,100,75,0.55)"
                      strokeDasharray="5 3"
                      label={{ value: '$100k', position: 'insideTopRight', fontSize: 10, fill: 'var(--text-dim)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="Strategy"
                      stroke="#4a9eff"
                      strokeWidth={2}
                      fill="url(#strategyFill)"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="SPY"
                      stroke="#f0b732"
                      dot={false}
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="model-card" role="region" aria-label="Frozen strategy configuration">
                <div className="model-card-title">🔒 Strategy Config (Frozen)</div>
                <div className="model-kv">
                  <span>Strategy</span><span>{result.strategy}</span>
                  <span><Term id="walkForward">Walk-forward split</Term></span><span>70% train / 30% test</span>
                  <span>Embargo</span><span>5 bars</span>
                  <span>Cost per round-trip</span><span>8 bps</span>
                  <span>Tickers</span><span>{[...tickers].join(', ')}</span>
                </div>
                <p className="model-frozen-note">
                  ✓ All features lagged ≥1 bar · Labels use only future data · Test window is genuinely <Term id="outOfSample">out-of-sample</Term>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
