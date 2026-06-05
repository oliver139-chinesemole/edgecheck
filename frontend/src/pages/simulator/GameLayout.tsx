/**
 * GameLayout — shared shell for all game tabs.
 * Provides the game header, tab bar, and game context.
 */
import { useEffect, useState, createContext, useContext } from 'react'
import { Outlet, NavLink, useParams, useNavigate, Link } from 'react-router-dom'
import { getGame, getPortfolio } from '../../lib/simApi'
import { useUsername } from '../../hooks/useUsername'
import type { Game, Portfolio } from '../../types/simulator'

// ── Game context shared with child pages ──────────────────────────────────

interface GameCtx {
  game: Game | null
  portfolio: Portfolio | null
  reloadPortfolio: () => void
}

const GameContext = createContext<GameCtx>({ game: null, portfolio: null, reloadPortfolio: () => {} })
export const useGameCtx = () => useContext(GameContext)

// ── Helpers ───────────────────────────────────────────────────────────────

function fmt$(v: number) {
  return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(v: number) {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

// ── Layout ─────────────────────────────────────────────────────────────────

export default function GameLayout() {
  const { gameId } = useParams<{ gameId: string }>()
  const { username } = useUsername()
  const navigate = useNavigate()

  const [game, setGame]           = useState<Game | null>(null)
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [loading, setLoading]     = useState(true)
  const [notFound, setNotFound]   = useState(false)

  async function loadGame() {
    if (!gameId) return
    try {
      const g = await getGame(gameId) as Game
      setGame(g)
      if (!g.is_participant) {
        navigate(`/market-sim`)
        return
      }
    } catch {
      setNotFound(true)
      return
    } finally {
      setLoading(false)
    }
  }

  async function loadPortfolio() {
    if (!gameId || !username) return
    try {
      const p = await getPortfolio(gameId) as Portfolio
      setPortfolio(p)
    } catch {
      // silent fail — portfolio shows zeros
    }
  }

  useEffect(() => { loadGame() }, [gameId])
  useEffect(() => { loadPortfolio() }, [gameId, username])

  if (loading) return <div className="loading-state"><div className="spinner" />Loading game…</div>
  if (notFound) return (
    <div className="ms-page">
      <div className="empty-state">
        <div className="empty-title">Game not found</div>
        <Link to="/market-sim" className="ms-btn ms-btn-primary" style={{ marginTop: '1rem' }}>
          Back to games
        </Link>
      </div>
    </div>
  )

  if (!game) return null
  const ret = portfolio?.total_return_pct ?? 0
  const base = `/market-sim/game/${gameId}`

  return (
    <GameContext.Provider value={{ game, portfolio, reloadPortfolio: loadPortfolio }}>
      <div className="ms-game-shell">
        {/* Game header */}
        <div className="ms-game-header">
          <div className="ms-game-header-left">
            <Link to="/market-sim" className="ms-back-link-sm">← Games</Link>
            <div>
              <div className="ms-game-title">{game.name}</div>
              <div className="ms-game-header-meta">
                <span className={`ms-badge ms-badge-${game.status}`}>
                  {game.status === 'active' ? '● Live' : game.status === 'pending' ? '○ Upcoming' : '✓ Ended'}
                </span>
                <span>{game.participant_count} players</span>
                <span>·</span>
                <span>Ends {game.end_date}</span>
                <span>·</span>
                <span>by {game.creator}</span>
              </div>
            </div>
          </div>
          {portfolio && (
            <div className="ms-game-header-right">
              <div className="ms-mini-portfolio">
                <div className="ms-mini-equity">{fmt$(portfolio.total_equity)}</div>
                <div className={`ms-mini-ret ${ret >= 0 ? 'pos' : 'neg'}`}>{fmtPct(ret)}</div>
              </div>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="ms-game-tabs">
          {[
            { to: base,                    label: 'Overview',    exact: true },
            { to: `${base}/trade`,         label: 'Trade' },
            { to: `${base}/portfolio`,     label: 'Portfolio' },
            { to: `${base}/leaderboard`,   label: 'Leaderboard' },
            { to: `${base}/rules`,         label: 'Rules' },
          ].map(tab => (
            <NavLink key={tab.to} to={tab.to}
              end={tab.exact}
              className={({ isActive }) => `ms-game-tab${isActive ? ' active' : ''}`}>
              {tab.label}
            </NavLink>
          ))}
        </div>

        {/* Tab content */}
        <div className="ms-game-content">
          <Outlet />
        </div>
      </div>
    </GameContext.Provider>
  )
}
