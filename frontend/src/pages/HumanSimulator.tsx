/**
 * Human Trading Simulator — runs entirely in the browser.
 * Uses SimCore (TypeScript) + seed price replay — no backend required.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { SimCore } from '../engine/sim_core'
import type { Portfolio, Order, OrderSide, OrderType, EquityPoint } from '../engine/sim_core'
import { loadPrices } from '../engine/loader'
import type { PriceBar } from '../engine/types'
import { Term } from '../components/Glossary'

const WATCHLIST = ['SPY', 'AAPL', 'MSFT', 'NVDA', 'META', 'AMZN', 'GOOGL', 'JPM', 'JNJ', 'BRK-B']
const TICK_MS = 700

function TickerTape({ prices, prevPrices }: { prices: Record<string, number>; prevPrices: Record<string, number> }) {
  const items = WATCHLIST
    .filter(t => prices[t] != null)
    .map(t => {
      const curr = prices[t]
      const prev = prevPrices[t]
      const diffPct = prev ? ((curr - prev) / prev) * 100 : 0
      const dir = diffPct > 0.001 ? 'up' : diffPct < -0.001 ? 'down' : 'flat'
      return { ticker: t, price: curr, diffPct, dir }
    })
  if (items.length === 0) return null
  const doubled = [...items, ...items]
  return (
    <div className="ticker-tape" role="marquee" aria-label="Live price ticker">
      <div className="ticker-tape-track">
        {doubled.map((item, i) => (
          <div key={`${item.ticker}-${i}`} className="ticker-item">
            <span className="ticker-symbol">{item.ticker}</span>
            <span className="ticker-price">${item.price.toFixed(2)}</span>
            <span className={`ticker-change ${item.dir}`}>
              {item.dir === 'up' ? '▲' : item.dir === 'down' ? '▼' : '▬'}{Math.abs(item.diffPct).toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function fmt$(v: number) {
  return `$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtK(v: number) { return `$${(v / 1000).toFixed(1)}k` }
function fmtPct(v: number) { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` }

function PnlCell({ v }: { v: number }) {
  return (
    <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-num)', fontWeight: 600 }}>
      {v >= 0 ? '+' : ''}{fmt$(v)}
    </span>
  )
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const strat = payload.find(p => p.name === 'Portfolio')?.value
  const bench = payload.find(p => p.name === 'SPY')?.value
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '0.6rem 0.85rem', fontSize: '0.74rem' }}>
      <div style={{ color: 'var(--text-lo)', marginBottom: '0.2rem', fontFamily: 'var(--font-num)' }}>{label}</div>
      {strat != null && <div style={{ color: 'var(--blue)', fontFamily: 'var(--font-num)' }}>Portfolio {fmtK(strat)}</div>}
      {bench != null && <div style={{ color: 'var(--amber)', fontFamily: 'var(--font-num)' }}>SPY {fmtK(bench)}</div>}
      {strat != null && bench != null && (
        <div style={{ color: strat >= bench ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-num)', borderTop: '1px solid var(--border-dim)', marginTop: '0.25rem', paddingTop: '0.25rem' }}>
          Δ {strat >= bench ? '+' : ''}{fmtK(strat - bench)}
        </div>
      )}
    </div>
  )
}

export default function HumanSimulator() {
  const simRef        = useRef(new SimCore(100_000, false))
  const barsRef       = useRef<Map<string, PriceBar[]>>(new Map())
  const idxRef        = useRef(252)
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevPricesRef = useRef<Record<string, number>>({})
  const curPricesRef  = useRef<Record<string, number>>({})
  const flashTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [portfolio, setPortfolio]     = useState<Portfolio>(simRef.current.getPortfolio())
  const [orders, setOrders]           = useState<Order[]>([])
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([])
  const [prices, setPrices]           = useState<Record<string, number>>({})
  const [running, setRunning]         = useState(false)
  const [loading, setLoading]         = useState(true)
  const [currentDate, setCurrentDate] = useState('')
  const [realismMode, setRealismMode] = useState(false)

  const [prevPrices, setPrevPrices] = useState<Record<string, number>>({})
  const [flashMap, setFlashMap]     = useState<Record<string, 'up' | 'down'>>({})

  const [ticker, setTicker]       = useState('AAPL')
  const [side, setSide]           = useState<OrderSide>('buy')
  const [orderType, setOrderType] = useState<OrderType>('market')
  const [qty, setQty]             = useState('10')
  const [limitPx, setLimitPx]     = useState('')
  const [stopPx, setStopPx]       = useState('')
  const [orderMsg, setOrderMsg]   = useState<{ text: string; ok: boolean } | null>(null)

  function getInitDate(grouped: Map<string, PriceBar[]>): string {
    return grouped.get('SPY')?.[252]?.date ?? ''
  }

  useEffect(() => {
    loadPrices().then(bars => {
      const grouped = new Map<string, PriceBar[]>()
      for (const b of bars) {
        const arr = grouped.get(b.ticker) ?? []
        arr.push(b)
        grouped.set(b.ticker, arr)
      }
      for (const [, arr] of grouped) arr.sort((a, b) => a.date.localeCompare(b.date))
      barsRef.current = grouped
      const initPrices: Record<string, number> = {}
      for (const [t, arr] of grouped) { if (arr[252]) initPrices[t] = arr[252].close }
      simRef.current.updatePrices(initPrices, getInitDate(grouped))
      curPricesRef.current = initPrices
      setPrices(initPrices)
      setPortfolio(simRef.current.getPortfolio())
      setCurrentDate(getInitDate(grouped))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const tick = useCallback(() => {
    const grouped = barsRef.current
    const spyBars = grouped.get('SPY') ?? []
    if (idxRef.current >= spyBars.length - 1) { setRunning(false); return }
    idxRef.current++
    const i = idxRef.current
    const newPrices: Record<string, number> = {}
    for (const [t, arr] of grouped) { if (arr[i]) newPrices[t] = arr[i].close }
    const sim = simRef.current
    sim.realismMode = realismMode
    const dateLabel = spyBars[i]?.date ?? ''
    sim.updatePrices(newPrices, dateLabel)

    // Track price changes for tape + flash
    const prev = curPricesRef.current
    const flashes: Record<string, 'up' | 'down'> = {}
    for (const t of WATCHLIST) {
      const p = prev[t], n = newPrices[t]
      if (p != null && n != null) {
        if (n > p) flashes[t] = 'up'
        else if (n < p) flashes[t] = 'down'
      }
    }
    setPrevPrices({ ...prev })
    curPricesRef.current = newPrices
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlashMap(flashes)
    flashTimer.current = setTimeout(() => setFlashMap({}), 750)

    setPrices({ ...newPrices })
    setPortfolio(sim.getPortfolio())
    setOrders([...sim.orders])
    setEquityCurve(sim.equityHistory.slice(-400))
    setCurrentDate(dateLabel)
  }, [realismMode])

  const startReplay = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(tick, TICK_MS)
    setRunning(true)
  }, [tick])

  const stopReplay = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setRunning(false)
  }, [])

  const handleReset = useCallback(() => {
    stopReplay()
    idxRef.current = 252
    simRef.current.reset()
    const grouped = barsRef.current
    const initPrices: Record<string, number> = {}
    for (const [t, arr] of grouped) { if (arr[252]) initPrices[t] = arr[252].close }
    simRef.current.updatePrices(initPrices, getInitDate(grouped))
    curPricesRef.current = initPrices
    prevPricesRef.current = {}
    setPrices(initPrices)
    setPrevPrices({})
    setFlashMap({})
    setPortfolio(simRef.current.getPortfolio())
    setOrders([])
    setEquityCurve([])
    setCurrentDate(getInitDate(grouped))
    setOrderMsg(null)
  }, [stopReplay])

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = parseFloat(qty)
    if (!ticker.trim() || isNaN(q) || q <= 0) { setOrderMsg({ text: 'Enter a valid ticker and quantity', ok: false }); return }
    const sim = simRef.current
    const o = sim.submitOrder(
      ticker.toUpperCase(), side, orderType, q,
      limitPx ? parseFloat(limitPx) : undefined,
      stopPx  ? parseFloat(stopPx)  : undefined,
    )
    if (o.status === 'rejected') {
      setOrderMsg({ text: o.rejectReason ?? 'Order rejected', ok: false })
    } else {
      setOrderMsg({ text: `${o.status === 'filled' ? '✓ Filled' : '⏳ Placed'}: ${side.replace('_', ' ')} ${q} ${ticker.toUpperCase()}`, ok: true })
    }
    setPortfolio(sim.getPortfolio())
    setOrders([...sim.orders])
    setEquityCurve(sim.equityHistory.slice(-400))
    setTimeout(() => setOrderMsg(null), 3500)
  }

  if (loading) return <div className="loading-state"><div className="spinner" />Loading price data…</div>

  const p = portfolio
  const ret = p.totalReturnPct
  const chartData = equityCurve.map(pt => ({
    date: typeof pt.date === 'string' ? pt.date.slice(2, 10) : pt.date,
    Portfolio: Math.round(pt.strategy),
    SPY: Math.round(pt.benchmark),
  }))
  const recentFills = [...simRef.current.fills].reverse().slice(0, 20)
  const openOrders  = orders.filter(o => o.status === 'pending')

  return (
    <div className="page sim-page">
      {/* Header */}
      <div className="sim-top-bar">
        <div>
          <h1 className="page-title" style={{ marginBottom: 0 }}>Paper Trading Simulator</h1>
          <p className="page-sub">
            $100,000 virtual account · Seed price replay ·{' '}
            <span style={{ color: 'var(--amber)' }}>Virtual money only — not financial advice</span>
          </p>
        </div>
        <div className="sim-controls-row">
          <span style={{ fontSize: '0.75rem', color: 'var(--text-lo)', fontFamily: 'var(--font-num)' }}>
            {currentDate || 'Jan 2022'} · 📼 Seed replay
          </span>
          <label className="realism-toggle" title="Add commissions and PDT rules">
            <input type="checkbox" checked={realismMode} onChange={e => setRealismMode(e.target.checked)} />
            <span>Realism mode</span>
          </label>
          {running
            ? <button className="btn btn-stop" onClick={stopReplay}>■ Pause</button>
            : <button className="btn btn-primary" onClick={startReplay}>▶ Play</button>
          }
          <button className="btn" style={{ border: '1px solid var(--border-dim)', color: 'var(--text-lo)' }} onClick={handleReset}>↺ Reset</button>
        </div>
      </div>

      {/* Ticker tape */}
      <TickerTape prices={prices} prevPrices={prevPrices} />

      {/* Summary bar */}
      <div className="portfolio-summary-bar">
        {[
          { label: 'Total Value',    val: fmt$(p.totalEquity),    color: 'var(--text-hi)', big: true },
          { label: 'Cash',           val: fmt$(p.cash),           color: undefined },
          { label: 'Total Return',   val: fmtPct(ret),            color: ret >= 0 ? 'var(--green)' : 'var(--red)', bold: true },
          { label: 'Unrealized P&L', val: (p.unrealizedPnl >= 0 ? '+' : '') + fmt$(p.unrealizedPnl), color: p.unrealizedPnl >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'Realized P&L',   val: (p.realizedPnl >= 0 ? '+' : '') + fmt$(p.realizedPnl), color: p.realizedPnl >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'Trades',         val: String(simRef.current.fills.length), color: undefined },
        ].map(item => (
          <div key={item.label} className="psb-item">
            <div className="psb-label">{item.label}</div>
            <div className="psb-val" style={{
              color: item.color,
              fontSize: item.big ? '1.35rem' : undefined,
              fontWeight: item.bold ? 700 : undefined,
            }}>{item.val}</div>
          </div>
        ))}
      </div>

      <div className="sim-body">
        {/* LEFT: order form + watchlist */}
        <div className="sim-left">
          <div className="sim-card">
            <div className="sim-card-title">Place Order</div>
            <form onSubmit={handleSubmit} className="order-form">
              <input className="order-input ticker-input" value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                placeholder="Ticker (e.g. AAPL)" maxLength={5} aria-label="Ticker" />

              <div className="order-side-row">
                {(['buy', 'sell', 'short_sell', 'buy_to_cover'] as OrderSide[]).map(s => (
                  <button key={s} type="button"
                    className={`side-btn ${s.includes('buy') ? 'side-buy' : 'side-sell'}${side === s ? ' active' : ''}`}
                    onClick={() => setSide(s)}>
                    {s === 'buy' ? 'Buy' : s === 'sell' ? 'Sell' : s === 'short_sell' ? 'Short' : 'Cover'}
                  </button>
                ))}
              </div>

              <div className="order-type-row">
                {(['market', 'limit', 'stop'] as OrderType[]).map(t => (
                  <button key={t} type="button"
                    className={`type-btn${orderType === t ? ' active' : ''}`}
                    onClick={() => setOrderType(t)}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              <div className="order-inputs-row">
                <div>
                  <div className="order-input-label">Shares</div>
                  <input className="order-input" type="number" min="0.01" step="1"
                    value={qty} onChange={e => setQty(e.target.value)} />
                </div>
                {orderType === 'limit' && (
                  <div>
                    <div className="order-input-label">Limit $</div>
                    <input className="order-input" type="number" min="0.01" step="0.01"
                      value={limitPx} onChange={e => setLimitPx(e.target.value)}
                      placeholder={prices[ticker]?.toFixed(2)} />
                  </div>
                )}
                {orderType === 'stop' && (
                  <div>
                    <div className="order-input-label">Stop $</div>
                    <input className="order-input" type="number" min="0.01" step="0.01"
                      value={stopPx} onChange={e => setStopPx(e.target.value)}
                      placeholder={prices[ticker]?.toFixed(2)} />
                  </div>
                )}
              </div>

              {prices[ticker] && (
                <div className="order-preview">
                  Last price: <strong style={{ fontFamily: 'var(--font-num)' }}>{fmt$(prices[ticker])}</strong>
                  {orderType === 'market' && qty && !isNaN(parseFloat(qty)) && prices[ticker] &&
                    <span style={{ color: 'var(--text-lo)' }}> · Est. {fmt$(prices[ticker] * parseFloat(qty))}</span>}
                </div>
              )}

              <button
                className={`order-submit-btn ${side.includes('buy') ? 'submit-buy' : 'submit-sell'}`}
                type="submit">
                {side === 'buy' ? 'Buy' : side === 'sell' ? 'Sell' : side === 'short_sell' ? 'Short Sell' : 'Buy to Cover'} {ticker}
              </button>

              {orderMsg && (
                <div className={`order-msg${orderMsg.ok ? ' ok' : ' err'}`} role="alert">{orderMsg.text}</div>
              )}
            </form>
          </div>

          <div className="sim-card">
            <div className="sim-card-title">Watchlist</div>
            <table className="watchlist-table">
              <thead><tr><th>Symbol</th><th>Price</th><th></th></tr></thead>
              <tbody>
                {WATCHLIST.map(t => (
                  <tr key={t} onClick={() => setTicker(t)} style={{ cursor: 'pointer' }}
                    className={[ticker === t ? 'wl-selected' : '', flashMap[t] ? `flash-${flashMap[t]}` : ''].filter(Boolean).join(' ')}>
                    <td style={{ fontFamily: 'var(--font-num)', fontWeight: 700, color: 'var(--text-hi)' }}>{t}</td>
                    <td style={{ fontFamily: 'var(--font-num)', fontSize: '0.82rem' }}>{prices[t] ? fmt$(prices[t]) : '—'}</td>
                    <td>
                      <button className="wl-trade-btn buy" onClick={e => { e.stopPropagation(); setTicker(t); setSide('buy') }}>B</button>
                      <button className="wl-trade-btn sell" onClick={e => { e.stopPropagation(); setTicker(t); setSide('sell') }}>S</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* CENTER: chart + tables */}
        <div className="sim-center">
          <div className="sim-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div className="sim-card-title" style={{ marginBottom: 0 }}>
                Portfolio vs <Term id="outOfSample">SPY</Term> Buy-and-Hold
              </div>
              <span style={{ fontFamily: 'var(--font-num)', fontSize: '0.82rem', fontWeight: 700, color: ret >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {ret >= 0 ? '▲' : '▼'} {fmtPct(ret)}
              </span>
            </div>
            {chartData.length < 2 ? (
              <div className="sim-chart-placeholder">
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📈</div>
                <p style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Click ▶ Play to start the price replay</p>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Place trades and watch your equity build against buy-and-hold SPY.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="gPort" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#4a9eff" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#4a9eff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(80,60,40,0.18)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickCount={5} stroke="none" />
                  <YAxis tickFormatter={fmtK} tick={{ fontSize: 10 }} stroke="none" width={46} />
                  <ReferenceLine y={100000} stroke="rgba(200,191,175,0.2)" strokeDasharray="4 2"
                    label={{ value: '$100k', fill: 'var(--text-dim)', fontSize: 9 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="Portfolio" stroke="#4a9eff" fill="url(#gPort)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Area type="monotone" dataKey="SPY" stroke="#f0b732" fill="none" strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Positions */}
          <div className="sim-card">
            <div className="sim-card-title">Open Positions ({p.positions.length})</div>
            {p.positions.length === 0 ? (
              <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-lo)', fontSize: '0.82rem' }}>
                No open positions — place a trade to get started.
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Ticker</th><th>Shares</th><th>Avg Cost</th><th>Current</th><th>Mkt Value</th><th>Unreal P&L</th><th>%</th><th></th></tr></thead>
                  <tbody>
                    {p.positions.map(pos => (
                      <tr key={pos.ticker}>
                        <td><strong style={{ color: pos.isShort ? 'var(--amber)' : 'var(--text-hi)' }}>{pos.ticker}{pos.isShort ? ' ↓' : ''}</strong></td>
                        <td className="num">{Math.abs(pos.qty).toFixed(2)}</td>
                        <td className="num">{fmt$(pos.avgCost)}</td>
                        <td className="num">{fmt$(pos.currentPrice)}</td>
                        <td className="num">{fmt$(Math.abs(pos.marketValue))}</td>
                        <td><PnlCell v={pos.unrealizedPnl} /></td>
                        <td style={{ color: pos.unrealizedPnlPct >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-num)', fontSize: '0.75rem' }}>
                          {fmtPct(pos.unrealizedPnlPct)}
                        </td>
                        <td>
                          <button className="close-pos-btn" title="Close position"
                            onClick={() => {
                              const sim = simRef.current
                              if (pos.isShort) sim.submitOrder(pos.ticker, 'buy_to_cover', 'market', Math.abs(pos.qty))
                              else sim.submitOrder(pos.ticker, 'sell', 'market', pos.qty)
                              setPortfolio(sim.getPortfolio()); setOrders([...sim.orders])
                              setEquityCurve(sim.equityHistory.slice(-400))
                            }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {openOrders.length > 0 && (
            <div className="sim-card">
              <div className="sim-card-title">Pending Orders ({openOrders.length})</div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Ticker</th><th>Side</th><th>Type</th><th>Qty</th><th>Price</th><th></th></tr></thead>
                  <tbody>
                    {openOrders.map(o => (
                      <tr key={o.id}>
                        <td><strong>{o.ticker}</strong></td>
                        <td><span className={`badge ${o.side.includes('buy') ? 'badge-new' : 'badge-exit'}`}>{o.side.replace('_', ' ')}</span></td>
                        <td>{o.orderType}</td>
                        <td className="num">{o.qty}</td>
                        <td className="num">{o.limitPrice ? fmt$(o.limitPrice) : o.stopPrice ? fmt$(o.stopPrice) : 'MKT'}</td>
                        <td><button className="close-pos-btn" onClick={() => { simRef.current.cancelOrder(o.id); setOrders([...simRef.current.orders]) }}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="sim-card">
            <div className="sim-card-title">Trade History</div>
            {recentFills.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-lo)', fontSize: '0.8rem' }}>No trades yet.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Ticker</th><th>Side</th><th>Shares</th><th>Fill Price</th><th>Value</th><th>Commission</th></tr></thead>
                  <tbody>
                    {recentFills.map((f, i) => (
                      <tr key={i}>
                        <td><strong>{f.ticker}</strong></td>
                        <td><span className={`badge ${f.side.includes('buy') ? 'badge-new' : 'badge-exit'}`}>{f.side.replace('_', ' ')}</span></td>
                        <td className="num">{f.qty.toFixed(2)}</td>
                        <td className="num">{fmt$(f.fillPrice)}</td>
                        <td className="num">{fmt$(f.qty * f.fillPrice)}</td>
                        <td className="num" style={{ color: 'var(--text-lo)' }}>{f.commission > 0 ? fmt$(f.commission) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
