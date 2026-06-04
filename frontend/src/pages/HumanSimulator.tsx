/**
 * Human Trading Simulator page.
 *
 * Layout:
 *   Left:   Order Entry form
 *   Center: Equity chart + positions table
 *   Right:  Watchlist + cash summary
 *   Bottom: Order history table (last 20 fills)
 *
 * Connects to /api/sim/ws for real-time price ticks.
 * Falls back gracefully when backend is offline.
 */
import { useState, useEffect, useRef } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { useWebSocket } from '../hooks/useWebSocket'

// ─── Types ───────────────────────────────────────────────────────────────

interface Position {
  ticker: string
  qty: number
  avg_entry: number
  current_price: number
  unrealized_pnl: number
  unrealized_pnl_pct: number
  is_short: boolean
  market_value: number
}

interface OrderRecord {
  order_id: string
  ticker: string
  side: string
  order_type: string
  qty: number
  status: string
  submitted_at: string
  filled_at?: string
  fill_price?: number
  fill_qty?: number
  message?: string
}

interface EquityPoint {
  ts: string
  equity: number
}

interface Portfolio {
  cash: number
  equity: number
  initial_capital: number
  unrealized_pnl: number
  realized_pnl: number
  positions: Position[]
  equity_history: EquityPoint[]
  trade_count: number
  pending_orders: OrderRecord[]
}

// ─── Constants ───────────────────────────────────────────────────────────

const WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'META', 'AMZN', 'SPY', 'TSLA', 'GOOGL', 'AMD', 'QQQ']
const API_BASE = '/api/sim'
const INITIAL_PORTFOLIO: Portfolio = {
  cash: 100_000,
  equity: 100_000,
  initial_capital: 100_000,
  unrealized_pnl: 0,
  realized_pnl: 0,
  positions: [],
  equity_history: [],
  trade_count: 0,
  pending_orders: [],
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function fmtUsd(v: number): string {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function fmtPct(v: number): string {
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%'
}

function pnlClass(v: number): string {
  return v > 0 ? 'text-green' : v < 0 ? 'text-red' : 'text-muted'
}

// ─── Offline banner ───────────────────────────────────────────────────────

function OfflineBanner() {
  return (
    <div className="alert alert-amber" style={{ marginBottom: '1.5rem' }}>
      <span className="alert-icon">⚠</span>
      <div>
        <strong>Backend offline — showing placeholder UI.</strong>
        <br />
        This feature requires the local backend.
        Run: <code>cd /Users/oliverguo/edgecheck &amp;&amp; make dev</code>
      </div>
    </div>
  )
}

// ─── Order Entry panel ────────────────────────────────────────────────────

interface OrderEntryProps {
  onSubmit: (order: {
    ticker: string; side: string; order_type: string;
    qty: number; limit_price?: number; stop_price?: number
  }) => void
  disabled: boolean
}

function OrderEntry({ onSubmit, disabled }: OrderEntryProps) {
  const [ticker, setTicker] = useState('AAPL')
  const [side, setSide] = useState<'buy' | 'sell' | 'short' | 'cover'>('buy')
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop'>('market')
  const [qty, setQty] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [stopPrice, setStopPrice] = useState('')
  const [error, setError] = useState('')

  const sideColors: Record<string, string> = {
    buy: '#2dd68a', sell: '#ff5c4a', short: '#f0b732', cover: '#4a9eff',
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const qtyNum = parseFloat(qty)
    if (!ticker || isNaN(qtyNum) || qtyNum <= 0) {
      setError('Enter a valid ticker and quantity.')
      return
    }
    setError('')
    onSubmit({
      ticker: ticker.toUpperCase(),
      side,
      order_type: orderType,
      qty: qtyNum,
      limit_price: limitPrice ? parseFloat(limitPrice) : undefined,
      stop_price: stopPrice ? parseFloat(stopPrice) : undefined,
    })
    setQty('')
    setLimitPrice('')
    setStopPrice('')
  }

  return (
    <div className="config-panel" style={{ position: 'sticky', top: 76, minWidth: 210 }}>
      <div className="config-section-title">Order Entry</div>
      <form onSubmit={handleSubmit}>
        <div className="config-row">
          <div className="config-label">Ticker</div>
          <input
            className="config-input"
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL"
            maxLength={8}
          />
        </div>

        <div className="config-row">
          <div className="config-label">Side</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(['buy', 'sell', 'short', 'cover'] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                style={{
                  flex: '1 0 40%',
                  padding: '0.3rem 0.4rem',
                  border: `1px solid ${side === s ? sideColors[s] : 'var(--border-dim)'}`,
                  borderRadius: 'var(--r-sm)',
                  background: side === s ? `${sideColors[s]}22` : 'var(--surface-2)',
                  color: side === s ? sideColors[s] : 'var(--text-lo)',
                  fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  transition: 'all var(--t)',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="config-row">
          <div className="config-label">Order Type</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['market', 'limit', 'stop'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setOrderType(t)}
                style={{
                  flex: 1,
                  padding: '0.3rem 0.2rem',
                  border: `1px solid ${orderType === t ? 'var(--blue)' : 'var(--border-dim)'}`,
                  borderRadius: 'var(--r-sm)',
                  background: orderType === t ? 'var(--blue-dim)' : 'var(--surface-2)',
                  color: orderType === t ? 'var(--blue)' : 'var(--text-lo)',
                  fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                  transition: 'all var(--t)',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="config-row">
          <div className="config-label">Quantity (shares)</div>
          <input
            className="config-input"
            type="number"
            min="0.0001"
            step="any"
            value={qty}
            onChange={e => setQty(e.target.value)}
            placeholder="e.g. 10"
          />
        </div>

        {orderType === 'limit' && (
          <div className="config-row">
            <div className="config-label">Limit Price</div>
            <input
              className="config-input"
              type="number"
              step="any"
              value={limitPrice}
              onChange={e => setLimitPrice(e.target.value)}
              placeholder="USD"
            />
          </div>
        )}

        {orderType === 'stop' && (
          <div className="config-row">
            <div className="config-label">Stop Price</div>
            <input
              className="config-input"
              type="number"
              step="any"
              value={stopPrice}
              onChange={e => setStopPrice(e.target.value)}
              placeholder="USD"
            />
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--red)', fontSize: '0.72rem', marginBottom: '0.5rem' }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={disabled}
          className="run-btn"
          style={{
            background: sideColors[side],
            opacity: disabled ? 0.5 : 1,
          }}
        >
          Submit {side.toUpperCase()} Order
        </button>
      </form>

      <div
        className="alert alert-amber"
        style={{ marginTop: '1rem', fontSize: '0.7rem', padding: '0.5rem 0.75rem' }}
      >
        Virtual account — not real money — not financial advice.
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────

export default function HumanSimulator() {
  const { connected, lastMessage } = useWebSocket()
  const [portfolio, setPortfolio] = useState<Portfolio>(INITIAL_PORTFOLIO)
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [dataSource, setDataSource] = useState<string>('seed')
  const [realismMode, setRealismMode] = useState(true)
  const [submitFeedback, setSubmitFeedback] = useState('')
  const equityChartData = useRef<{ ts: string; equity: number; spy?: number }[]>([])
  const spyStartRef = useRef<number | null>(null)

  // Load initial state from REST API
  useEffect(() => {
    fetch(`${API_BASE}/state`)
      .then(r => r.json())
      .then(data => {
        if (data.portfolio) setPortfolio(data.portfolio)
        if (data.data_source) setDataSource(data.data_source)
      })
      .catch(() => {/* backend offline */})
  }, [])

  // Consume WebSocket ticks
  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.type === 'tick') {
      if (lastMessage.prices) setPrices(lastMessage.prices as Record<string, number>)
      if (lastMessage.portfolio) {
        const p = lastMessage.portfolio as unknown as Portfolio
        setPortfolio(p)
        // Build equity chart data
        const spy = (lastMessage.prices as Record<string, number> | undefined)?.['SPY']
        if (spy !== undefined) {
          if (!spyStartRef.current) spyStartRef.current = spy
          const spyVal = (spy / spyStartRef.current) * (p.initial_capital || 100_000)
          equityChartData.current.push({
            ts: lastMessage.timestamp as string || '',
            equity: p.equity,
            spy: spyVal,
          })
          if (equityChartData.current.length > 300) {
            equityChartData.current = equityChartData.current.slice(-300)
          }
        }
      }
      if (lastMessage.data_source) setDataSource(lastMessage.data_source as string)
    }
  }, [lastMessage])

  // Fetch order history periodically
  useEffect(() => {
    function loadOrders() {
      fetch(`${API_BASE}/state`)
        .then(r => r.json())
        .then(d => { if (d.orders) setOrders(d.orders) })
        .catch(() => {})
    }
    loadOrders()
    const id = setInterval(loadOrders, 5_000)
    return () => clearInterval(id)
  }, [])

  async function handleSubmitOrder(orderReq: {
    ticker: string; side: string; order_type: string;
    qty: number; limit_price?: number; stop_price?: number
  }) {
    if (!connected) {
      setSubmitFeedback('Backend offline — cannot submit orders.')
      return
    }
    try {
      const res = await fetch(`${API_BASE}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...orderReq, prices }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitFeedback(`Error: ${data.detail || 'Unknown error'}`)
      } else {
        const o = data.order
        setSubmitFeedback(
          `${o.status === 'filled' ? '✓ Filled' : '⏳ Queued'}: ${o.side.toUpperCase()} ${o.qty} ${o.ticker}${o.fill_price ? ` @ $${o.fill_price.toFixed(2)}` : ''}`
        )
        if (data.portfolio) setPortfolio(data.portfolio)
        // Refresh orders
        fetch(`${API_BASE}/state`).then(r => r.json()).then(d => { if (d.orders) setOrders(d.orders) }).catch(() => {})
      }
    } catch {
      setSubmitFeedback('Backend offline — cannot submit orders.')
    }
    setTimeout(() => setSubmitFeedback(''), 5_000)
  }

  async function handleReset() {
    if (!connected) return
    if (!confirm('Reset simulator to $100,000 cash? All positions will be closed.')) return
    try {
      const res = await fetch(`${API_BASE}/reset`, { method: 'POST' })
      const data = await res.json()
      if (data.portfolio) setPortfolio(data.portfolio)
      equityChartData.current = []
      spyStartRef.current = null
      setOrders([])
      setSubmitFeedback('Simulator reset to $100,000.')
      setTimeout(() => setSubmitFeedback(''), 3_000)
    } catch {
      setSubmitFeedback('Reset failed — backend offline.')
    }
  }

  const returnPct = ((portfolio.equity - portfolio.initial_capital) / portfolio.initial_capital) * 100
  const chartData = equityChartData.current.slice(-120).map((p, i) => ({
    ...p,
    label: `T-${equityChartData.current.length - (equityChartData.current.length - 120 + i)}`,
  }))

  // Connection status label
  const connStatus =
    !connected ? { label: 'Offline', color: 'var(--red)' } :
    dataSource === 'alpaca' ? { label: 'Live', color: 'var(--green)' } :
    { label: 'Replaying seed', color: 'var(--amber)' }

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Human Trading Simulator</h1>
          <p className="page-sub">$100,000 virtual account. Not real money. Not financial advice.</p>
        </div>
        <div style={{ flex: 1 }} />
        {/* Connection status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem' }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: connStatus.color,
            display: 'inline-block', flexShrink: 0,
            boxShadow: connected ? `0 0 0 3px ${connStatus.color}33` : 'none',
            animation: connected ? 'pulse 1.4s ease infinite' : 'none',
          }} />
          <span style={{ color: connStatus.color, fontFamily: 'var(--font-num)', fontWeight: 600 }}>
            {connStatus.label}
          </span>
        </div>
        {/* Realism toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-lo)' }}>
          <input type="checkbox" checked={realismMode} onChange={e => setRealismMode(e.target.checked)} />
          Realism mode (8 bps costs)
        </label>
        {/* Reset */}
        <button
          className="btn btn-stop"
          onClick={handleReset}
          disabled={!connected}
          style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem' }}
        >
          Reset
        </button>
      </div>

      {!connected && <OfflineBanner />}

      {submitFeedback && (
        <div className="alert alert-blue" style={{ marginBottom: '1rem' }}>
          {submitFeedback}
        </div>
      )}

      {/* Main layout: left (order entry) + center (chart+positions) + right (watchlist) */}
      <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr 200px', gap: '1rem', alignItems: 'start' }}>

        {/* LEFT: Order Entry */}
        <OrderEntry onSubmit={handleSubmitOrder} disabled={!connected} />

        {/* CENTER: Equity chart + positions */}
        <div>
          {/* Metrics row */}
          <div className="metrics-row" style={{ marginBottom: '0.75rem' }}>
            <div className={`metric-box ${returnPct >= 0 ? 'pos' : 'neg'}`}>
              <div className="metric-label">Portfolio Value</div>
              <div className={`metric-val ${returnPct >= 0 ? 'pos' : 'neg'}`}>{fmtUsd(portfolio.equity)}</div>
              <div className="metric-hint">{fmtPct(returnPct / 100)}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Cash</div>
              <div className="metric-val">{fmtUsd(portfolio.cash)}</div>
              <div className="metric-hint">Available</div>
            </div>
            <div className={`metric-box ${portfolio.unrealized_pnl >= 0 ? 'pos' : 'neg'}`}>
              <div className="metric-label">Unrealized P&L</div>
              <div className={`metric-val ${portfolio.unrealized_pnl >= 0 ? 'pos' : 'neg'}`}>
                {fmtUsd(portfolio.unrealized_pnl)}
              </div>
              <div className="metric-hint">Open positions</div>
            </div>
            <div className={`metric-box ${portfolio.realized_pnl >= 0 ? 'pos' : 'neg'}`}>
              <div className="metric-label">Realized P&L</div>
              <div className={`metric-val ${portfolio.realized_pnl >= 0 ? 'pos' : 'neg'}`}>
                {fmtUsd(portfolio.realized_pnl)}
              </div>
              <div className="metric-hint">{portfolio.trade_count} trades</div>
            </div>
          </div>

          {/* Equity chart */}
          <div className="chart-box" style={{ marginBottom: '1rem' }}>
            <div className="chart-title">Equity vs SPY</div>
            {chartData.length < 2 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <div className="empty-title">Waiting for price ticks...</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-lo)', marginTop: '0.35rem' }}>
                  {connected ? 'Receiving live ticks — equity curve will appear shortly.' : 'Connect to backend to see equity curve.'}
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--blue)" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="var(--blue)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="spyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--amber)" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="var(--amber)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-dim)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-dim)' }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: number, name: string) => [fmtUsd(v), name === 'equity' ? 'Portfolio' : 'SPY']}
                    contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                  />
                  <Legend formatter={v => v === 'equity' ? 'Portfolio' : 'SPY Benchmark'} wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="equity" stroke="var(--blue)" fill="url(#eqGrad)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="spy" stroke="var(--amber)" fill="url(#spyGrad)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Positions table */}
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-title">Open Positions</div>
            {portfolio.positions.length === 0 ? (
              <div className="empty-state" style={{ padding: '1.5rem 1rem', textAlign: 'center' }}>
                <div className="empty-title">No open positions.</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-lo)', marginTop: '0.25rem' }}>
                  Use the order panel to place your first trade.
                </div>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table positions-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Qty</th>
                      <th>Avg Entry</th>
                      <th>Price</th>
                      <th>Mkt Value</th>
                      <th>Unrealized P&L</th>
                      <th>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.positions.map(pos => (
                      <tr key={pos.ticker}>
                        <td><strong>{pos.ticker}</strong> {pos.is_short && <span className="badge badge-trim">SHORT</span>}</td>
                        <td className="num">{pos.qty.toFixed(4)}</td>
                        <td className="num">{fmtUsd(pos.avg_entry)}</td>
                        <td className="num">{fmtUsd(pos.current_price)}</td>
                        <td className="num">{fmtUsd(pos.market_value)}</td>
                        <td className={`num pos-pnl ${pos.unrealized_pnl >= 0 ? 'pos' : 'neg'}`}>
                          {fmtUsd(pos.unrealized_pnl)}
                        </td>
                        <td className={`num ${pnlClass(pos.unrealized_pnl_pct)}`}>
                          {fmtPct(pos.unrealized_pnl_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Watchlist + cash summary */}
        <div>
          <div className="card" style={{ marginBottom: '0.75rem' }}>
            <div className="card-title">Cash & Buying Power</div>
            <div style={{ fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-lo)' }}>Cash</span>
                <span style={{ fontFamily: 'var(--font-num)', color: 'var(--text-hi)' }}>{fmtUsd(portfolio.cash)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-lo)' }}>Total Equity</span>
                <span style={{ fontFamily: 'var(--font-num)', color: 'var(--text-hi)' }}>{fmtUsd(portfolio.equity)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-lo)' }}>Return</span>
                <span className={`text-num ${pnlClass(returnPct)}`}>{fmtPct(returnPct / 100)}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Watchlist</div>
            {WATCHLIST.map(t => {
              const px = prices[t]
              return (
                <div key={t} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                  <span style={{ fontFamily: 'var(--font-num)', fontWeight: 600, color: 'var(--text-hi)' }}>{t}</span>
                  <span style={{ fontFamily: 'var(--font-num)', color: px ? 'var(--text)' : 'var(--text-dim)' }}>
                    {px ? fmtUsd(px) : '—'}
                  </span>
                </div>
              )
            })}
            {!connected && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                Connect to backend for live prices.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM: Order history */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card-title">Order History (last 20)</div>
        {orders.length === 0 ? (
          <div style={{ color: 'var(--text-lo)', fontSize: '0.78rem', padding: '0.75rem 0' }}>No orders yet.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Ticker</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>Fill Price</th>
                  <th>Status</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 20).map(o => (
                  <tr key={o.order_id}>
                    <td style={{ color: 'var(--text-lo)', fontSize: '0.7rem' }}>
                      {o.filled_at ? new Date(o.filled_at).toLocaleTimeString() : new Date(o.submitted_at).toLocaleTimeString()}
                    </td>
                    <td><strong>{o.ticker}</strong></td>
                    <td>
                      <span className={`badge ${o.side === 'buy' || o.side === 'cover' ? 'badge-new' : o.side === 'sell' ? 'badge-exit' : 'badge-trim'}`}>
                        {o.side}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-lo)' }}>{o.order_type}</td>
                    <td className="num">{o.fill_qty ?? o.qty}</td>
                    <td className="num">{o.fill_price ? fmtUsd(o.fill_price) : '—'}</td>
                    <td>
                      <span className={`badge ${o.status === 'filled' ? 'badge-new' : o.status === 'pending' ? 'badge-add' : 'badge-exit'}`}>
                        {o.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-lo)', fontSize: '0.7rem' }}>{o.message || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
