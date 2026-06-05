import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getLeaderboard } from '../../lib/simApi'
import { useGameCtx } from './GameLayout'
import type { LeaderboardEntry } from '../../types/simulator'

function fmt$(v: number) {
  return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%' }

const MEDALS = ['🥇', '🥈', '🥉']

export default function LeaderboardPage() {
  const { gameId } = useParams<{ gameId: string }>()
  const { game }   = useGameCtx()
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [myRank, setMyRank]   = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!gameId) return
    setLoading(true)
    getLeaderboard(gameId)
      .then(r => {
        const data = r as { entries: LeaderboardEntry[]; my_rank: number | null }
        setEntries(data.entries || [])
        setMyRank(data.my_rank ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [gameId])

  if (loading) return <div className="loading-state"><div className="spinner" />Loading leaderboard…</div>

  const myEntry = entries.find(e => e.is_me)

  return (
    <div className="ms-leaderboard-page">
      {/* My standing banner */}
      {myEntry && (
        <div className="ms-my-standing">
          <div className="ms-ms-rank">#{myEntry.rank}</div>
          <div className="ms-ms-info">
            <div className="ms-ms-label">Your Rank</div>
            <div className="ms-ms-equity">{fmt$(myEntry.total_equity)}</div>
          </div>
          <div className={`ms-ms-ret ${myEntry.return_pct >= 0 ? 'pos' : 'neg'}`}>
            {fmtPct(myEntry.return_pct)}
          </div>
        </div>
      )}

      {/* Ranked table */}
      <div className="ms-lb-table-wrap">
        {entries.length === 0 ? (
          <div className="ms-ov-empty">No players yet.</div>
        ) : (
          <table className="ms-table ms-table-full ms-lb-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Portfolio Value</th>
                <th>Return</th>
                <th>Cash</th>
                <th>Trades</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.username} className={entry.is_me ? 'ms-lb-me-row' : ''}>
                  <td>
                    <span className="ms-lb-rank-cell">
                      {entry.rank <= 3 ? MEDALS[entry.rank - 1] : `#${entry.rank}`}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: entry.is_me ? 700 : 500, color: entry.is_me ? 'var(--blue)' : undefined }}>
                      {entry.username}
                    </span>
                    {entry.is_me && <span style={{ fontSize: '0.65rem', color: 'var(--text-lo)', marginLeft: 6 }}>(you)</span>}
                  </td>
                  <td className="num">{fmt$(entry.total_equity)}</td>
                  <td>
                    <span style={{ color: entry.return_pct >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-num)', fontWeight: 600, fontSize: '0.82rem' }}>
                      {fmtPct(entry.return_pct)}
                    </span>
                  </td>
                  <td className="num">{fmt$(entry.cash)}</td>
                  <td className="num">{entry.n_trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="ms-lb-footer">
        <p>Ranked by <strong>{game?.rank_by === 'return_pct' ? '% Return' : 'Total Portfolio Value'}</strong> · Portfolio values use ~15 min delayed prices</p>
      </div>
    </div>
  )
}
