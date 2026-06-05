import { useState, useEffect, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer,
  Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts'
import {
  getLeaderboard, getActivity, getPortfolioHistory,
  getWatchlist, addWatchlist, removeWatchlist,
} from '../../lib/simApi'
import { useGameCtx } from './GameLayout'
import type { LeaderboardEntry, WatchlistItem } from '../../types/simulator'

// ── Types ─────────────────────────────────────────────────────────────────

interface ActivityItem {
  username: string; ticker: string; side: 'buy' | 'sell'
  qty: number; fill_price: number; executed_at: string; is_me: boolean
}
interface EquityPoint { date: string; equity: number; return_pct: number }

// ── Helpers ───────────────────────────────────────────────────────────────

function fmt$(v: number) {
  return '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtK(v: number) { return '$' + (v / 1000).toFixed(1) + 'k' }
function fmtPct(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%' }
function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)   return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ── Equity chart tooltip ──────────────────────────────────────────────────

function EqTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number }[]; label?: string
}) {
  if (!active || !payload?.length) return null
  const eq = payload.find(p => p.name === 'equity')?.value
  const ret = payload.find(p => p.name === 'return_pct')?.value
  return (
    <div className="hms-chart-tooltip">
      <div className="hms-ct-date">{label}</div>
      {eq  != null && <div style={{ color: 'var(--blue)' }}>{fmtK(eq)}</div>}
      {ret != null && <div style={{ color: ret >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '0.7rem' }}>{fmtPct(ret)}</div>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function GameOverview() {
  const { gameId }  = useParams<{ gameId: string }>()
  const { game, portfolio } = useGameCtx()

  const [leaderboard, setLeaderboard]   = useState<LeaderboardEntry[]>([])
  const [activity, setActivity]         = useState<ActivityItem[]>([])
  const [equityHistory, setEqHistory]   = useState<EquityPoint[]>([])
  const [watchlist, setWatchlist]       = useState<WatchlistItem[]>([])
  const [watchInput, setWatchInput]     = useState('')
  const [watchBusy, setWatchBusy]       = useState(false)

  const load = useCallback(() => {
    if (!gameId) return
    getLeaderboard(gameId).then(r => setLeaderboard((r as { entries: LeaderboardEntry[] }).entries || [])).catch(() => {})
    getActivity(gameId, 15).then(r => setActivity((r as { activity: ActivityItem[] }).activity || [])).catch(() => {})
    getPortfolioHistory(gameId).then(r => setEqHistory((r as { history: EquityPoint[] }).history || [])).catch(() => {})
    getWatchlist(gameId).then(r => setWatchlist((r as { watchlist: WatchlistItem[] }).watchlist || [])).catch(() => {})
  }, [gameId])

  useEffect(() => { load() }, [load])

  async function handleAddWatch(e: React.FormEvent) {
    e.preventDefault()
    if (!gameId || !watchInput.trim()) return
    setWatchBusy(true)
    try {
      await addWatchlist(gameId, watchInput.trim().toUpperCase())
      setWatchInput('')
      load()
    } catch { /* ignore */ } finally { setWatchBusy(false) }
  }

  async function handleRemoveWatch(ticker: string) {
    if (!gameId) return
    await removeWatchlist(gameId, ticker).catch(() => {})
    setWatchlist(prev => prev.filter(w => w.ticker !== ticker))
  }

  if (!game || !portfolio) return <div className="loading-state"><div className="spinner" />Loading…</div>

  const ret = portfolio.total_return_pct
  const myRank = leaderboard.find(e => e.is_me)?.rank ?? '—'
  const base = `/market-sim/game/${gameId}`

  const chartData = equityHistory.map(pt => ({
    date:       pt.date,
    equity:     pt.equity,
    return_pct: pt.return_pct,
  }))
  const retIsPos = chartData.length > 0
    ? (chartData[chartData.length - 1]?.equity ?? portfolio.total_equity) >= game.starting_cash
    : true

  return (
    <div className="ms-overview">

      {/* ── Quick stats row ── */}
      <div className="ms-stats-row">
        {[
          { label: 'Portfolio Value',  val: fmt$(portfolio.total_equity) },
          { label: 'Total Return',     val: fmtPct(ret), color: ret >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'Cash Available',   val: fmt$(portfolio.cash) },
          { label: 'Rank',             val: `#${myRank} / ${leaderboard.length}` },
          { label: 'Positions',        val: String(portfolio.positions.length) },
        ].map(s => (
          <div key={s.label} className="ms-quick-stat">
            <div className="ms-qs-label">{s.label}</div>
            <div className="ms-qs-val" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="ms-overview-body">

        {/* ── LEFT column ── */}
        <div className="ms-overview-main">

          {/* Equity curve */}
          <div className="ms-ov-card">
            <div className="ms-ov-card-header">
              <span className="ms-ov-card-title">Your Equity Curve</span>
              <span style={{ fontFamily: 'var(--font-num)', fontSize: '0.78rem', fontWeight: 700, color: ret >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtPct(ret)}
              </span>
            </div>
            {chartData.length < 2 ? (
              <div className="ms-ov-empty" style={{ padding: '2rem' }}>
                Place trades to start tracking your equity curve.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={retIsPos ? '#2dd68a' : '#ff5c4a'} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={retIsPos ? '#2dd68a' : '#ff5c4a'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(80,60,40,0.12)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} tickCount={5} stroke="none" />
                  <YAxis tickFormatter={fmtK} tick={{ fontSize: 9 }} stroke="none" width={48} />
                  <ReferenceLine y={game.starting_cash} stroke="rgba(200,191,175,0.2)" strokeDasharray="4 2"
                    label={{ value: 'Start', fill: 'var(--text-dim)', fontSize: 9 }} />
                  <Tooltip content={<EqTooltip />} />
                  <Area type="monotone" dataKey="equity" name="equity"
                    stroke={retIsPos ? 'var(--green)' : 'var(--red)'} fill="url(#eqGrad)"
                    strokeWidth={2} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top positions */}
          <div className="ms-ov-card">
            <div className="ms-ov-card-header">
              <span className="ms-ov-card-title">Holdings ({portfolio.positions.length})</span>
              <Link to={`${base}/portfolio`} className="ms-see-all">Full portfolio →</Link>
            </div>
            {portfolio.positions.length === 0 ? (
              <div className="ms-ov-empty">
                No positions yet.{' '}
                <Link to={`${base}/trade`}>Place your first trade →</Link>
              </div>
            ) : (
              <table className="ms-table">
                <thead>
                  <tr><th>Ticker</th><th>Shares</th><th>Value</th><th>Return</th></tr>
                </thead>
                <tbody>
                  {portfolio.positions.slice(0, 6).map(pos => (
                    <tr key={pos.ticker}>
                      <td>
                        <strong style={{ color: 'var(--blue)', letterSpacing: '0.02em' }}>{pos.ticker}</strong>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-lo)', marginLeft: 5 }}>{pos.weight_pct.toFixed(0)}%</span>
                      </td>
                      <td className="num">{pos.shares.toFixed(2)}</td>
                      <td className="num">{fmt$(pos.market_value)}</td>
                      <td style={{ fontFamily: 'var(--font-num)', fontSize: '0.78rem', fontWeight: 600, color: pos.gain_pct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {fmtPct(pos.gain_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Activity feed */}
          <div className="ms-ov-card">
            <div className="ms-ov-card-header">
              <span className="ms-ov-card-title">
                {game.portfolio_public ? 'Game Activity' : 'My Trades'}
              </span>
            </div>
            {activity.length === 0 ? (
              <div className="ms-ov-empty">No activity yet.</div>
            ) : (
              <div className="ms-activity-feed">
                {activity.map((a, i) => (
                  <div key={i} className={`ms-activity-item${a.is_me ? ' ms-activity-me' : ''}`}>
                    <span className={`ms-activity-side ${a.side === 'buy' ? 'buy' : 'sell'}`}>
                      {a.side === 'buy' ? '↑' : '↓'}
                    </span>
                    <div className="ms-activity-body">
                      <span className="ms-activity-user">{a.is_me ? 'You' : a.username}</span>
                      {' '}{a.side} <strong>{a.qty.toFixed(2)}</strong> {a.ticker} @ ${a.fill_price.toFixed(2)}
                    </div>
                    <span className="ms-activity-time">{timeAgo(a.executed_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* ── RIGHT sidebar ── */}
        <div className="ms-overview-side">

          {/* Trade CTA */}
          <Link to={`${base}/trade`} className="ms-trade-cta">
            <div className="ms-trade-cta-icon">📊</div>
            <div>
              <div className="ms-trade-cta-title">Place a Trade</div>
              <div className="ms-trade-cta-sub">Search stocks, buy, sell</div>
            </div>
            <span className="ms-trade-cta-arrow">→</span>
          </Link>

          {/* Leaderboard preview */}
          <div className="ms-ov-card">
            <div className="ms-ov-card-header">
              <span className="ms-ov-card-title">Leaderboard</span>
              <Link to={`${base}/leaderboard`} className="ms-see-all">Full →</Link>
            </div>
            {leaderboard.length === 0 ? (
              <div className="ms-ov-empty">No standings yet.</div>
            ) : (
              <div className="ms-lb-preview">
                {leaderboard.slice(0, 5).map(entry => (
                  <div key={entry.username} className={`ms-lb-preview-row${entry.is_me ? ' ms-lb-me' : ''}`}>
                    <span className="ms-lb-rank">
                      {entry.rank <= 3 ? ['🥇','🥈','🥉'][entry.rank-1] : `#${entry.rank}`}
                    </span>
                    <span className="ms-lb-name">{entry.is_me ? 'You' : entry.username}</span>
                    <span className={`ms-lb-ret ${entry.return_pct >= 0 ? 'pos' : 'neg'}`}>
                      {fmtPct(entry.return_pct)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Watchlist */}
          <div className="ms-ov-card">
            <div className="ms-ov-card-header">
              <span className="ms-ov-card-title">Watchlist</span>
            </div>
            <form onSubmit={handleAddWatch} className="ms-watch-form">
              <input
                className="ms-input" placeholder="Add ticker…" value={watchInput}
                onChange={e => setWatchInput(e.target.value.toUpperCase())}
                maxLength={6}
              />
              <button className="ms-btn ms-btn-sm ms-btn-primary" type="submit" disabled={watchBusy || !watchInput.trim()}>
                +
              </button>
            </form>
            {watchlist.length === 0 ? (
              <div className="ms-ov-empty" style={{ paddingTop: '0.5rem' }}>No tickers — add one above.</div>
            ) : (
              <div className="ms-watchlist-mini">
                {watchlist.map(w => (
                  <div key={w.ticker} className="ms-wl-row">
                    <span className="ms-wl-ticker">{w.ticker}</span>
                    <span className="ms-wl-price">{w.price ? `$${w.price.toFixed(2)}` : '—'}</span>
                    <span className={`ms-wl-chg ${(w.change_pct ?? 0) >= 0 ? 'up' : 'down'}`}>
                      {w.change_pct != null ? `${w.change_pct >= 0 ? '+' : ''}${w.change_pct.toFixed(2)}%` : '—'}
                    </span>
                    <button className="ms-wl-remove" onClick={() => handleRemoveWatch(w.ticker)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Invite link */}
          <div className="ms-ov-card ms-invite-card">
            <div className="ms-ov-card-title">Invite Players</div>
            <div className="ms-invite-id">Game ID: <strong>{gameId}</strong></div>
            <button className="ms-btn ms-btn-outline ms-btn-full" style={{ marginTop: '0.6rem', fontSize: '0.78rem' }}
              onClick={() => {
                const url = `${window.location.origin}${window.location.pathname.split('/market-sim')[0]}/edgecheck/market-sim`
                navigator.clipboard.writeText(`Join my game on Market Sim! ID: ${gameId}\n${url}`)
                  .catch(() => {})
              }}>
              📋 Copy Invite Link
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
