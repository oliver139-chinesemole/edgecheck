/**
 * Human Trading Simulator — MarketWatch-style layout.
 * $100k virtual account, seed price replay, zero API keys required.
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
const MARKET_INDICES = ['SPY', 'AAPL', 'NVDA', 'META', 'MSFT', 'AMZN']
const TICK_MS = 700

// ── Formatters ────────────────────────────────────────────────────────────

function fmt$(v: number) {
  return '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtK(v: number) { return '$' + (v / 1000).toFixed(1) + 'k' }
function fmtPct(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%' }
function fmtPnl(v: number) { return (v >= 0 ? '+' : '−') + fmt$(Math.abs(v)) }

// ── Market overview bar ───────────────────────────────────────────────────

function MarketBar({
  prices, prevPrices,
}: {
  prices: Record<string, number>
  prevPrices: Record<string, number>
}) {
  const items = MARKET_INDICES
    .filter(t => prices[t] != null)
    .map(t => {
      const curr = prices[t]
      const prev = prevPrices[t] ?? curr
      const chgPct = prev ? ((curr - prev) / prev) * 100 : 0
      return { ticker: t, price: curr, chgPct }
    })
  if (items.length === 0) return null
  return (
    <div className="hms-market-bar">
      {items.map(item => (
        <div key={item.ticker} className="hms-market-item">
          <span className="hms-mi-ticker">{item.ticker}</span>
          <span className="hms-mi-price">{fmt$(item.price)}</span>
          <span className={`hms-mi-change ${item.chgPct >= 0 ? 'up' : 'down'}`}>
            {item.chgPct >= 0 ? '▲' : '▼'} {Math.abs(item.chgPct).toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Chart tooltip ─────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { name: string; value: number }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const strat = payload.find(p => p.name === 'Portfolio')?.value
  const bench = payload.find(p => p.name === 'SPY')?.value
  return (
    <div className="hms-chart-tooltip">
      <div className="hms-ct-date">{label}</div>
      {strat != null && <div style={{ color: 'var(--blue)' }}>Portfolio  {fmtK(strat)}</div>}
      {bench != null && <div style={{ color: 'var(--amber)' }}>SPY B&H  {fmtK(bench)}</div>}
      {strat != null && bench != null && (
        <div style={{ color: strat >= bench ? 'var(--green)' : 'var(--red)', borderTop: '1px solid var(--border-dim)', marginTop: 4, paddingTop: 4 }}>
          Δ {fmtK(strat - bench)}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function HumanSimulator() {
  const simRef       = useRef(new SimCore(100_000, false))
  const barsRef      = useRef<Map<string, PriceBar[]>>(new Map())
  const idxRef       = useRef(252)
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const curPricesRef = useRef<Record<string, number>>({})
  const flashTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [portfolio, setPortfolio]     = useState<Portfolio>(simRef.current.getPortfolio())
  const [orders, setOrders]           = useState<Order[]>([])
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([])
  const [prices, setPrices]           = useState<Record<string, number>>({})
  const [prevPrices, setPrevPrices]   = useState<Record<string, number>>({})
  const [flashMap, setFlashMap]       = useState<Record<string, 'up' | 'down'>>({})
  const [running, setRunning]         = useState(false)
  const [loading, setLoading]         = useState(true)
  const [currentDate, setCurrentDate] = useState('')
  const [realismMode, setRealismMode] = useState(false)

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
    if (!ticker.trim() || isNaN(q) || q <= 0) {
      setOrderMsg({ text: 'Enter a valid ticker and quantity', ok: false }); return
    }
    const sim = simRef.current
    const o = sim.submitOrder(
      ticker.toUpperCase(), side, orderType, q,
      limitPx ? parseFloat(limitPx) : undefined,
      stopPx  ? parseFloat(stopPx)  : undefined,
    )
    setOrderMsg(
      o.status === 'rejected'
        ? { text: o.rejectReason ?? 'Order rejected', ok: false }
        : { text: `${o.status === 'filled' ? '✓ Filled' : '⏳ Placed'}: ${side.replace('_', ' ')} ${q} ${ticker.toUpperCase()}`, ok: true }
    )
    setPortfolio(sim.getPortfolio())
    setOrders([...sim.orders])
    setEquityCurve(sim.equityHistory.slice(-400))
    setTimeout(() => setOrderMsg(null), 3500)
  }

  if (loading) return <div className="loading-state"><div className="spinner" />Loading price data…</div>

  const p = portfolio
  const ret = p.totalReturnPct
  const totalPnl = p.unrealizedPnl + p.realizedPnl
  const chartData = equityCurve.map(pt => ({
    date: typeof pt.date === 'string' ? pt.date.slice(2, 10) : pt.date,
    Portfolio: Math.round(pt.strategy),
    SPY: Math.round(pt.benchmark),
  }))
  const recentFills = [...simRef.current.fills].reverse().slice(0, 25)
  const openOrders  = orders.filter(o => o.status === 'pending')
  const currentPrice = prices[ticker]
  const prevPrice    = prevPrices[ticker] ?? currentPrice
  const quoteChgPct  = currentPrice && prevPrice ? ((currentPrice - prevPrice) / prevPrice) * 100 : 0
  const estimatedCost = currentPrice && !isNaN(parseFloat(qty))
    ? currentPrice * parseFloat(qty)
    : null

  return (
    <div className="hms-page">

      {/* ── Market overview ── */}
      <MarketBar prices={prices} prevPrices={prevPrices} />

      {/* ── Portfolio header ── */}
      <div className="hms-header">
        <div className="hms-header-left">
          <div className="hms-portfolio-value">{fmt$(p.totalEquity)}</div>
          <div className="hms-portfolio-meta">
            <span className={`hms-return ${ret >= 0 ? 'pos' : 'neg'}`}>
              {ret >= 0 ? '▲' : '▼'} {Math.abs(ret).toFixed(2)}%
            </span>
            <span className={`hms-pnl ${totalPnl >= 0 ? 'pos' : 'neg'}`}>
              {fmtPnl(totalPnl)} total P&L
            </span>
            <span className="hms-cash">{fmt$(p.cash)} cash</span>
            <span className="hms-date-tag">📼 {currentDate || 'seed replay'}</span>
          </div>
        </div>
        <div className="hms-header-right">
          <label className="realism-toggle" title="Adds commissions and PDT rules">
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

      {/* ── Body: main (chart + tables) + right sidebar ── */}
      <div className="hms-body">

        {/* LEFT: equity chart → positions → trade history */}
        <div className="hms-main">

          {/* Equity chart */}
          <div className="hms-card">
            <div className="hms-chart-header">
              <span className="hms-card-title" style={{ marginBottom: 0 }}>
                Portfolio vs <Term id="outOfSample">SPY</Term> Buy-and-Hold
              </span>
              <div className="hms-legend">
                <span className="hms-legend-item">
                  <span className="hms-legend-line" style={{ background: 'var(--blue)' }} />
                  Portfolio
                </span>
                <span className="hms-legend-item">
                  <span className="hms-legend-dashed" style={{ borderColor: 'var(--amber)' }} />
                  SPY B&H
                </span>
              </div>
            </div>
            {chartData.length < 2 ? (
              <div className="hms-chart-empty">
                <div style={{ fontSize: '2rem' }}>📈</div>
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>Press ▶ Play to start the replay</div>
                <div style={{ fontSize: '0.78rem' }}>Place trades and watch your equity build against buy-and-hold SPY.</div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={270}>
                <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="gPort" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#4a9eff" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#4a9eff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(80,60,40,0.14)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickCount={6} stroke="none" />
                  <YAxis tickFormatter={fmtK} tick={{ fontSize: 10 }} stroke="none" width={52} />
                  <ReferenceLine y={100000} stroke="rgba(200,191,175,0.18)" strokeDasharray="4 2" />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="Portfolio" stroke="#4a9eff" fill="url(#gPort)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Area type="monotone" dataKey="SPY" stroke="#f0b732" fill="none" strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Open positions */}
          <div className="hms-card">
            <div className="hms-card-title">Open Positions ({p.positions.length})</div>
            {p.positions.length === 0 ? (
              <div className="hms-empty-row">No open positions — place a trade to get started.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr>
                    <th>Symbol</th><th>Shares</th><th>Avg Cost</th>
                    <th>Last Price</th><th>Mkt Value</th>
                    <th>Unreal. P&L</th><th>Return</th><th></th>
                  </tr></thead>
                  <tbody>
                    {p.positions.map(pos => (
                      <tr key={pos.ticker}>
                        <td>
                          <strong style={{ color: pos.isShort ? 'var(--amber)' : 'var(--blue)', letterSpacing: '0.02em' }}>
                            {pos.ticker}
                          </strong>
                          {pos.isShort && (
                            <span style={{ fontSize: '0.62rem', color: 'var(--amber)', marginLeft: 5, fontFamily: 'var(--font-num)', background: 'rgba(240,183,50,0.12)', padding: '0.05em 0.35em', borderRadius: 3 }}>
                              SHORT
                            </span>
                          )}
                        </td>
                        <td className="num">{Math.abs(pos.qty).toFixed(2)}</td>
                        <td className="num">{fmt$(pos.avgCost)}</td>
                        <td className="num">{fmt$(pos.currentPrice)}</td>
                        <td className="num">{fmt$(Math.abs(pos.marketValue))}</td>
                        <td>
                          <span style={{ color: pos.unrealizedPnl >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-num)', fontWeight: 600 }}>
                            {fmtPnl(pos.unrealizedPnl)}
                          </span>
                        </td>
                        <td style={{ color: pos.unrealizedPnlPct >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-num)', fontSize: '0.75rem' }}>
                          {fmtPct(pos.unrealizedPnlPct)}
                        </td>
                        <td>
                          <button className="close-pos-btn" title="Close position"
                            onClick={() => {
                              const sim = simRef.current
                              if (pos.isShort) sim.submitOrder(pos.ticker, 'buy_to_cover', 'market', Math.abs(pos.qty))
                              else sim.submitOrder(pos.ticker, 'sell', 'market', pos.qty)
                              setPortfolio(sim.getPortfolio())
                              setOrders([...sim.orders])
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

          {/* Pending orders */}
          {openOrders.length > 0 && (
            <div className="hms-card">
              <div className="hms-card-title">Pending Orders ({openOrders.length})</div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Symbol</th><th>Side</th><th>Type</th><th>Qty</th><th>Limit / Stop</th><th></th></tr></thead>
                  <tbody>
                    {openOrders.map(o => (
                      <tr key={o.id}>
                        <td><strong>{o.ticker}</strong></td>
                        <td><span className={`badge ${o.side.includes('buy') ? 'badge-new' : 'badge-exit'}`}>{o.side.replace('_', ' ')}</span></td>
                        <td>{o.orderType}</td>
                        <td className="num">{o.qty}</td>
                        <td className="num">{o.limitPrice ? fmt$(o.limitPrice) : o.stopPrice ? fmt$(o.stopPrice) : 'MKT'}</td>
                        <td>
                          <button className="close-pos-btn" onClick={() => {
                            simRef.current.cancelOrder(o.id)
                            setOrders([...simRef.current.orders])
                          }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Trade history */}
          <div className="hms-card">
            <div className="hms-card-title">Trade History ({recentFills.length})</div>
            {recentFills.length === 0 ? (
              <div className="hms-empty-row">No trades yet.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Symbol</th><th>Side</th><th>Shares</th><th>Fill Price</th><th>Value</th><th>Commission</th></tr></thead>
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

        {/* RIGHT: quote → order form → watchlist → account summary */}
        <div className="hms-right">

          {/* Quote strip for selected ticker */}
          {currentPrice != null && (
            <div className="hms-quote-strip">
              <span className="hms-qs-ticker">{ticker}</span>
              <span className="hms-qs-price">{fmt$(currentPrice)}</span>
              {prevPrices[ticker] != null && (
                <span className={`hms-qs-change ${quoteChgPct >= 0 ? 'up' : 'down'}`}>
                  {quoteChgPct >= 0 ? '▲' : '▼'} {Math.abs(quoteChgPct).toFixed(2)}%
                </span>
              )}
            </div>
          )}

          {/* Order entry */}
          <div className="hms-card">
            <div className="hms-card-title">Place Order</div>
            <form onSubmit={handleSubmit} className="hms-order-form">

              <input
                className="order-input ticker-input"
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                placeholder="Ticker (e.g. AAPL)"
                maxLength={5}
                aria-label="Ticker symbol"
              />

              <div className="hms-side-tabs">
                {(['buy', 'sell', 'short_sell', 'buy_to_cover'] as OrderSide[]).map(s => (
                  <button key={s} type="button"
                    className={`hms-side-btn ${s.includes('buy') ? 'hms-buy' : 'hms-sell'}${side === s ? ' active' : ''}`}
                    onClick={() => setSide(s)}>
                    {s === 'buy' ? 'Buy' : s === 'sell' ? 'Sell' : s === 'short_sell' ? 'Short' : 'Cover'}
                  </button>
                ))}
              </div>

              <div className="hms-type-row">
                {(['market', 'limit', 'stop'] as OrderType[]).map(t => (
                  <button key={t} type="button"
                    className={`hms-type-btn${orderType === t ? ' active' : ''}`}
                    onClick={() => setOrderType(t)}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              <div>
                <div className="hms-field-label">Shares</div>
                <input className="order-input" type="number" min="0.01" step="1"
                  value={qty} onChange={e => setQty(e.target.value)} />
              </div>

              {orderType === 'limit' && (
                <div>
                  <div className="hms-field-label">Limit Price</div>
                  <input className="order-input" type="number" min="0.01" step="0.01"
                    value={limitPx} onChange={e => setLimitPx(e.target.value)}
                    placeholder={currentPrice?.toFixed(2)} />
                </div>
              )}

              {orderType === 'stop' && (
                <div>
                  <div className="hms-field-label">Stop Price</div>
                  <input className="order-input" type="number" min="0.01" step="0.01"
                    value={stopPx} onChange={e => setStopPx(e.target.value)}
                    placeholder={currentPrice?.toFixed(2)} />
                </div>
              )}

              {estimatedCost != null && (
                <div className="hms-est-cost">
                  Est. value: <strong>{fmt$(estimatedCost)}</strong>
                  {side === 'buy' && p.cash < estimatedCost && (
                    <span style={{ display: 'block', color: 'var(--red)', fontSize: '0.71rem', marginTop: 2 }}>
                      ⚠ Insufficient cash ({fmt$(p.cash)} available)
                    </span>
                  )}
                </div>
              )}

              <button
                className={`hms-submit-btn ${side.includes('buy') ? 'hms-submit-buy' : 'hms-submit-sell'}`}
                type="submit">
                {side === 'buy' ? '↑ Buy' : side === 'sell' ? '↓ Sell' : side === 'short_sell' ? '↓ Short Sell' : '↑ Buy to Cover'}{' '}{ticker}
              </button>

              {orderMsg && (
                <div className={`order-msg${orderMsg.ok ? ' ok' : ' err'}`} role="alert">{orderMsg.text}</div>
              )}
            </form>
          </div>

          {/* Watchlist */}
          <div className="hms-card">
            <div className="hms-card-title">Watchlist</div>
            <table className="hms-watchlist">
              <thead>
                <tr><th>Symbol</th><th>Last</th><th>Chg %</th><th></th></tr>
              </thead>
              <tbody>
                {WATCHLIST.map(t => {
                  const curr = prices[t]
                  const prev = prevPrices[t] ?? curr
                  const chgPct = curr && prev ? ((curr - prev) / prev) * 100 : 0
                  return (
                    <tr key={t}
                      onClick={() => setTicker(t)}
                      className={[
                        ticker === t ? 'wl-selected' : '',
                        flashMap[t] ? `flash-${flashMap[t]}` : '',
                      ].filter(Boolean).join(' ')}>
                      <td style={{ fontFamily: 'var(--font-num)', fontWeight: 700, color: 'var(--text-hi)' }}>{t}</td>
                      <td style={{ fontFamily: 'var(--font-num)', fontSize: '0.81rem' }}>{curr ? fmt$(curr) : '—'}</td>
                      <td style={{ fontFamily: 'var(--font-num)', fontSize: '0.72rem', color: chgPct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                        {curr && prev ? fmtPct(chgPct) : '—'}
                      </td>
                      <td>
                        <button className="wl-trade-btn buy" onClick={e => { e.stopPropagation(); setTicker(t); setSide('buy') }}>B</button>
                        <button className="wl-trade-btn sell" onClick={e => { e.stopPropagation(); setTicker(t); setSide('sell') }}>S</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Account summary */}
          <div className="hms-card">
            <div className="hms-card-title">Account Summary</div>
            <div className="hms-acct-rows">
              {[
                { label: 'Total Equity',   val: fmt$(p.totalEquity),     color: 'var(--text-hi)' },
                { label: 'Cash',           val: fmt$(p.cash),            color: undefined },
                { label: 'Positions',      val: String(p.positions.length), color: undefined },
                { label: 'Unrealized P&L', val: fmtPnl(p.unrealizedPnl), color: p.unrealizedPnl >= 0 ? 'var(--green)' : 'var(--red)' },
                { label: 'Realized P&L',   val: fmtPnl(p.realizedPnl),   color: p.realizedPnl >= 0 ? 'var(--green)' : 'var(--red)' },
                { label: 'Total Return',   val: fmtPct(ret),             color: ret >= 0 ? 'var(--green)' : 'var(--red)' },
                { label: 'Total Trades',   val: String(simRef.current.fills.length), color: undefined },
              ].map(row => (
                <div key={row.label} className="hms-acct-row">
                  <span className="hms-acct-label">{row.label}</span>
                  <span style={{ fontFamily: 'var(--font-num)', fontSize: '0.82rem', fontWeight: 500, color: row.color ?? 'var(--text)' }}>
                    {row.val}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
