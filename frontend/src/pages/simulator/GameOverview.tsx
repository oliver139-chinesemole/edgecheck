import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts'
import { getLeaderboard, getTransactions } from '../../lib/simApi'
import { useGameCtx } from './GameLayout'
import type { LeaderboardEntry, Transaction } from '../../types/simulator'

function fmt$(v: number) {
  return '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%' }

function QuickStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="ms-quick-stat">
      <div className="ms-qs-label">{label}</div>
      <div className="ms-qs-val" style={{ color }}>{value}</div>
    </div>
  )
}

export default function GameOverview() {
  const { gameId } = useParams<{ gameId: string }>()
  const { game, portfolio } = useGameCtx()

  const [leaderboard, setLeaderboard]   = useState<LeaderboardEntry[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])

  useEffect(() => {
    if (!gameId) return
    getLeaderboard(gameId)
      .then((r) => setLeaderboard((r as { entries: LeaderboardEntry[] }).entries || []))
      .catch(() => {})
    getTransactions(gameId, 5)
      .then((r) => setTransactions((r as { transactions: Transaction[] }).transactions || []))
      .catch(() => {})
  }, [gameId])

  if (!game || !portfolio) return <div className="loading-state"><div className="spinner" />Loading…</div>

  const ret = portfolio.total_return_pct
  const myRank = leaderboard.find(e => e.is_me)?.rank ?? '—'
  const base = `/market-sim/game/${gameId}`

  return (
    <div className="ms-overview">
      {/* Portfolio stats */}
      <div className="ms-stats-row">
        <QuickStat label="Portfolio Value"  value={fmt$(portfolio.total_equity)} />
        <QuickStat label="Total Return"     value={fmtPct(ret)} color={ret >= 0 ? 'var(--green)' : 'var(--red)'} />
        <QuickStat label="Cash Available"   value={fmt$(portfolio.cash)} />
        <QuickStat label="Rank"             value={`#${myRank} / ${leaderboard.length}`} />
        <QuickStat label="Positions"        value={String(portfolio.positions.length)} />
      </div>

      <div className="ms-overview-body">
        {/* Left: holdings + recent trades */}
        <div className="ms-overview-main">

          {/* Top positions */}
          <div className="ms-ov-card">
            <div className="ms-ov-card-header">
              <span className="ms-ov-card-title">Holdings</span>
              <Link to={`${base}/portfolio`} className="ms-see-all">View all →</Link>
            </div>
            {portfolio.positions.length === 0 ? (
              <div className="ms-ov-empty">
                No positions yet. <Link to={`${base}/trade`}>Place your first trade →</Link>
              </div>
            ) : (
              <table className="ms-table">
                <thead><tr><th>Ticker</th><th>Shares</th><th>Value</th><th>Return</th></tr></thead>
                <tbody>
                  {portfolio.positions.slice(0, 5).map(pos => (
                    <tr key={pos.ticker}>
                      <td><strong style={{ color: 'var(--blue)' }}>{pos.ticker}</strong></td>
                      <td className="num">{pos.shares.toFixed(2)}</td>
                      <td className="num">{fmt$(pos.market_value)}</td>
                      <td style={{ color: pos.gain_pct >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-num)', fontSize: '0.78rem' }}>
                        {fmtPct(pos.gain_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Recent trades */}
          <div className="ms-ov-card">
            <div className="ms-ov-card-header">
              <span className="ms-ov-card-title">Recent Trades</span>
              <Link to={`${base}/portfolio`} className="ms-see-all">All trades →</Link>
            </div>
            {transactions.length === 0 ? (
              <div className="ms-ov-empty">No trades yet.</div>
            ) : (
              <table className="ms-table">
                <thead><tr><th>Ticker</th><th>Side</th><th>Shares</th><th>Price</th></tr></thead>
                <tbody>
                  {transactions.map(t => (
                    <tr key={t.id}>
                      <td><strong>{t.ticker}</strong></td>
                      <td>
                        <span className={`badge ${t.side === 'buy' ? 'badge-new' : 'badge-exit'}`}>{t.side}</span>
                      </td>
                      <td className="num">{t.qty.toFixed(2)}</td>
                      <td className="num">${t.fill_price.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: leaderboard preview + quick trade link */}
        <div className="ms-overview-side">
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
                  <div key={entry.username} className={`ms-lb-preview-row ${entry.is_me ? 'ms-lb-me' : ''}`}>
                    <span className="ms-lb-rank">#{entry.rank}</span>
                    <span className="ms-lb-name">{entry.username}{entry.is_me ? ' (you)' : ''}</span>
                    <span className={`ms-lb-ret ${entry.return_pct >= 0 ? 'pos' : 'neg'}`}>
                      {fmtPct(entry.return_pct)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick trade CTA */}
          <Link to={`${base}/trade`} className="ms-trade-cta">
            <div className="ms-trade-cta-icon">📊</div>
            <div>
              <div className="ms-trade-cta-title">Place a Trade</div>
              <div className="ms-trade-cta-sub">Search stocks, buy, sell</div>
            </div>
            <span className="ms-trade-cta-arrow">→</span>
          </Link>

          {/* Game info */}
          <div className="ms-ov-card ms-game-info-card">
            <div className="ms-ov-card-title">Game Info</div>
            <div className="ms-game-info-rows">
              <div className="ms-gi-row"><span>Started</span><span>{game.start_date}</span></div>
              <div className="ms-gi-row"><span>Ends</span><span>{game.end_date}</span></div>
              <div className="ms-gi-row"><span>Starting cash</span><span>${game.starting_cash.toLocaleString()}</span></div>
              <div className="ms-gi-row"><span>Commission</span><span>${game.commission}/trade</span></div>
              <div className="ms-gi-row"><span>Rank by</span><span>{game.rank_by === 'return_pct' ? '% Return' : 'Total Value'}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
