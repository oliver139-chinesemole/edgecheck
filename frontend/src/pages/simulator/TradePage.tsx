import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { searchTickers, getQuote, getChart, placeTrade } from '../../lib/simApi'
import { useGameCtx } from './GameLayout'
import type { Quote, SearchResult, HistoricalBar } from '../../types/simulator'

// ── Formatters ────────────────────────────────────────────────────────────
function fmt$(v: number) {
  return '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Ticker search input ───────────────────────────────────────────────────
function TickerSearch({ onSelect }: { onSelect: (r: SearchResult) => void }) {
  const [q, setQ]               = useState('')
  const [results, setResults]   = useState<SearchResult[]>([])
  const [open, setOpen]         = useState(false)
  const [loading, setLoading]   = useState(false)

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setResults([]); return }
    setLoading(true)
    try {
      const res = await searchTickers(query) as { results: SearchResult[] }
      setResults(res.results || [])
      setOpen(true)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => doSearch(q), 280)
    return () => clearTimeout(t)
  }, [q, doSearch])

  return (
    <div className="ms-ticker-search" style={{ position: 'relative' }}>
      <div className="ms-search-wrap">
        <span className="ms-search-icon">🔍</span>
        <input
          className="ms-input ms-search-lg"
          placeholder="Search ticker or company name…"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => q && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          autoComplete="off"
        />
        {loading && <span className="ms-search-spinner" />}
      </div>
      {open && results.length > 0 && (
        <div className="ms-search-dropdown">
          {results.map(r => (
            <div key={r.ticker} className="ms-search-item"
              onMouseDown={e => { e.preventDefault(); onSelect(r); setQ(''); setOpen(false) }}>
              <span className="ms-si-ticker">{r.ticker}</span>
              <span className="ms-si-name">{r.name}</span>
              <span className="ms-si-type">{r.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Quote card + mini chart ───────────────────────────────────────────────
function QuoteCard({ ticker, quote, chart }: {
  ticker: string
  quote: Quote | null
  chart: HistoricalBar[]
}) {
  if (!quote) return (
    <div className="ms-quote-card ms-quote-loading">
      <div className="spinner" style={{ margin: '2rem auto' }} />
    </div>
  )

  const isUp = quote.change_pct >= 0
  const chartData = chart.map(b => ({ date: b.date.slice(5), price: b.close }))

  return (
    <div className={`ms-quote-card ${isUp ? 'ms-quote-up' : 'ms-quote-down'}`}>
      <div className="ms-qc-header">
        <div>
          <div className="ms-qc-ticker">{quote.ticker}</div>
          <div className="ms-qc-name">{quote.name}</div>
        </div>
        <div className="ms-qc-right">
          <div className="ms-qc-price">${quote.price.toFixed(2)}</div>
          <div className={`ms-qc-change ${isUp ? 'up' : 'down'}`}>
            {isUp ? '▲' : '▼'} {Math.abs(quote.change).toFixed(2)} ({Math.abs(quote.change_pct).toFixed(2)}%)
          </div>
        </div>
      </div>
      <div className="ms-qc-delay-note">~15 min delayed · {quote.data_source}</div>
      {chartData.length > 1 && (
        <div className="ms-qc-chart">
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="gchart" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={isUp ? '#2dd68a' : '#ff5c4a'} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={isUp ? '#2dd68a' : '#ff5c4a'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 11, borderRadius: 6 }}
                formatter={(v: number) => [`$${v.toFixed(2)}`, '']}
              />
              <XAxis dataKey="date" hide />
              <YAxis domain={['auto', 'auto']} hide />
              <Area type="monotone" dataKey="price"
                stroke={isUp ? '#2dd68a' : '#ff5c4a'} fill="url(#gchart)"
                strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Confirm modal ─────────────────────────────────────────────────────────
function ConfirmModal({ side, qty, ticker, price, cash, onConfirm, onCancel, busy }: {
  side: 'buy' | 'sell', qty: number, ticker: string, price: number
  cash: number, onConfirm: () => void, onCancel: () => void, busy: boolean
}) {
  const total = qty * price
  const isAffordable = side === 'buy' ? cash >= total : true
  return (
    <div className="ms-modal-overlay">
      <div className="ms-modal">
        <div className="ms-modal-icon">{side === 'buy' ? '📈' : '📉'}</div>
        <h2 className="ms-modal-title">Confirm {side === 'buy' ? 'Purchase' : 'Sale'}</h2>
        <div className="ms-join-meta">
          <div className="ms-join-row"><span>Ticker</span><strong>{ticker}</strong></div>
          <div className="ms-join-row"><span>Side</span><strong style={{ color: side === 'buy' ? 'var(--green)' : 'var(--red)', textTransform: 'capitalize' }}>{side}</strong></div>
          <div className="ms-join-row"><span>Shares</span><strong>{qty}</strong></div>
          <div className="ms-join-row"><span>Est. Price</span><strong>${price.toFixed(2)}</strong></div>
          <div className="ms-join-row"><span>Est. {side === 'buy' ? 'Cost' : 'Proceeds'}</span><strong>${total.toFixed(2)}</strong></div>
          {side === 'buy' && <div className="ms-join-row"><span>Cash after</span><strong style={{ color: isAffordable ? undefined : 'var(--red)' }}>${(cash - total).toFixed(2)}</strong></div>}
        </div>
        {!isAffordable && <div className="ms-field-error">Insufficient cash for this trade.</div>}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <button className="ms-btn ms-btn-ghost" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
          <button
            className={`ms-btn ${side === 'buy' ? 'ms-btn-buy' : 'ms-btn-sell'}`}
            style={{ flex: 1 }}
            onClick={onConfirm}
            disabled={busy || !isAffordable}>
            {busy ? 'Placing…' : `Confirm ${side === 'buy' ? 'Buy' : 'Sell'}`}
          </button>
        </div>
        <div className="ms-modal-disclaimer">Virtual money only · Not financial advice</div>
      </div>
    </div>
  )
}

// ── Main trade page ───────────────────────────────────────────────────────

export default function TradePage() {
  const { gameId } = useParams<{ gameId: string }>()
  const { game, portfolio, reloadPortfolio } = useGameCtx()

  const [selectedTicker, setSelectedTicker] = useState('')
  const [quote, setQuote]       = useState<Quote | null>(null)
  const [chart, setChart]       = useState<HistoricalBar[]>([])
  const [quoteLoading, setQL]   = useState(false)
  const [side, setSide]         = useState<'buy' | 'sell'>('buy')
  const [qty, setQty]           = useState('10')
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [limitPrice, setLimitPrice] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy]         = useState(false)
  const [msg, setMsg]           = useState<{ text: string; ok: boolean } | null>(null)

  async function loadQuote(ticker: string) {
    setQL(true); setQuote(null); setChart([])
    try {
      const [q, c] = await Promise.all([
        getQuote(ticker) as Promise<Quote>,
        getChart(ticker, '1mo') as Promise<{ bars: HistoricalBar[] }>,
      ])
      setQuote(q)
      setChart(c.bars || [])
    } catch {
      setQuote(null)
    } finally {
      setQL(false)
    }
  }

  function handleSelect(r: SearchResult) {
    setSelectedTicker(r.ticker)
    loadQuote(r.ticker)
    setMsg(null)
  }

  async function executeTrade() {
    if (!gameId || !quote) return
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        ticker:     quote.ticker,
        side,
        order_type: orderType,
        qty:        parseFloat(qty),
      }
      if (orderType === 'limit' && limitPrice) {
        body.limit_price = parseFloat(limitPrice)
      }
      await placeTrade(gameId, body)
      setMsg({ text: `✓ ${side === 'buy' ? 'Bought' : 'Sold'} ${qty} shares of ${quote.ticker}`, ok: true })
      setShowConfirm(false)
      reloadPortfolio()
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, ok: false })
      setShowConfirm(false)
    } finally {
      setBusy(false)
      setTimeout(() => setMsg(null), 5000)
    }
  }

  const qtyNum    = parseFloat(qty) || 0
  const estValue  = quote ? qtyNum * (orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : quote.price) : 0
  const cash      = portfolio?.cash ?? 0
  const canAfford = side === 'sell' || cash >= estValue

  return (
    <div className="ms-trade-page">
      <div className="ms-trade-left">
        <div className="ms-trade-search-wrap">
          <TickerSearch onSelect={handleSelect} />
        </div>

        {selectedTicker && (
          <>
            <QuoteCard ticker={selectedTicker} quote={quote} chart={chart} />

            <div className="ms-trade-form-card">
              <div className="ms-trade-side-tabs">
                <button className={`ms-trade-side-btn buy${side === 'buy' ? ' active' : ''}`}
                  onClick={() => setSide('buy')}>Buy</button>
                <button className={`ms-trade-side-btn sell${side === 'sell' ? ' active' : ''}`}
                  onClick={() => setSide('sell')}>Sell</button>
              </div>

              <div className="ms-field-row" style={{ marginTop: '0.85rem' }}>
                <div className="ms-field">
                  <label className="ms-field-label">Shares</label>
                  <input className="ms-input" type="number" min="0.001" step="1"
                    value={qty} onChange={e => setQty(e.target.value)} />
                </div>
                <div className="ms-field">
                  <label className="ms-field-label">Order type</label>
                  <select className="ms-input" value={orderType}
                    onChange={e => setOrderType(e.target.value as 'market' | 'limit')}>
                    <option value="market">Market</option>
                    <option value="limit">Limit</option>
                  </select>
                </div>
              </div>

              {orderType === 'limit' && (
                <div className="ms-field">
                  <label className="ms-field-label">Limit Price</label>
                  <div className="ms-input-prefix-wrap">
                    <span className="ms-input-prefix">$</span>
                    <input className="ms-input ms-input-prefix" type="number" min="0.01" step="0.01"
                      placeholder={quote?.price.toFixed(2)}
                      value={limitPrice} onChange={e => setLimitPrice(e.target.value)} />
                  </div>
                </div>
              )}

              {quote && qtyNum > 0 && (
                <div className="ms-trade-summary">
                  <div className="ms-ts-row">
                    <span>Est. value</span>
                    <strong>${estValue.toFixed(2)}</strong>
                  </div>
                  <div className="ms-ts-row">
                    <span>Cash available</span>
                    <span style={{ color: canAfford ? undefined : 'var(--red)' }}>
                      ${cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  {game?.commission !== 0 && (
                    <div className="ms-ts-row"><span>Commission</span><span>${game?.commission?.toFixed(2)}</span></div>
                  )}
                </div>
              )}

              {msg && (
                <div className={`order-msg${msg.ok ? ' ok' : ' err'}`} role="alert">{msg.text}</div>
              )}

              <button
                className={`ms-trade-submit-btn ${side === 'buy' ? 'ms-btn-buy' : 'ms-btn-sell'}`}
                disabled={!quote || qtyNum <= 0 || (!canAfford && side === 'buy')}
                onClick={() => setShowConfirm(true)}>
                {side === 'buy' ? `Buy ${selectedTicker}` : `Sell ${selectedTicker}`}
              </button>

              <div className="ms-trade-disclaimer">Virtual money only · Not financial advice</div>
            </div>
          </>
        )}

        {!selectedTicker && (
          <div className="ms-trade-empty">
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔍</div>
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '0.35rem' }}>Search for a stock</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-lo)' }}>
              Enter a ticker symbol or company name above to start trading.
            </div>
          </div>
        )}
      </div>

      {/* Right: portfolio snapshot */}
      <div className="ms-trade-right">
        {portfolio && (
          <div className="ms-ov-card">
            <div className="ms-ov-card-title">Your Account</div>
            <div className="ms-game-info-rows">
              <div className="ms-gi-row"><span>Cash</span><strong>${portfolio.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
              <div className="ms-gi-row"><span>Positions</span><strong>{portfolio.positions.length}</strong></div>
              <div className="ms-gi-row">
                <span>Total Return</span>
                <strong style={{ color: portfolio.total_return_pct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {portfolio.total_return_pct >= 0 ? '+' : ''}{portfolio.total_return_pct.toFixed(2)}%
                </strong>
              </div>
            </div>
            {portfolio.positions.slice(0, 4).map(pos => (
              <div key={pos.ticker} className="ms-gi-row" style={{ marginTop: '0.35rem' }}>
                <span style={{ color: 'var(--blue)', fontFamily: 'var(--font-num)', fontWeight: 700, fontSize: '0.8rem' }}>
                  {pos.ticker}
                </span>
                <span style={{ fontFamily: 'var(--font-num)', fontSize: '0.78rem' }}>{pos.shares.toFixed(2)}sh</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showConfirm && quote && (
        <ConfirmModal
          side={side} qty={qtyNum} ticker={quote.ticker} price={quote.price}
          cash={cash} onConfirm={executeTrade} onCancel={() => setShowConfirm(false)}
          busy={busy}
        />
      )}
    </div>
  )
}
