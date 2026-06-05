import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useUsername } from '../../hooks/useUsername'
import { listGames, joinGame, getGame } from '../../lib/simApi'
import type { Game } from '../../types/simulator'

// ── Username setup modal ──────────────────────────────────────────────────

function UsernameModal({ onSet }: { onSet: (u: string) => void }) {
  const [val, setVal] = useState('')
  const [err, setErr] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = val.trim()
    if (!trimmed || trimmed.length < 2) { setErr('At least 2 characters'); return }
    if (trimmed.length > 20) { setErr('Max 20 characters'); return }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) { setErr('Letters, numbers, _ and - only'); return }
    onSet(trimmed)
  }

  return (
    <div className="ms-modal-overlay">
      <div className="ms-modal">
        <div className="ms-modal-icon">📈</div>
        <h2 className="ms-modal-title">Choose your player name</h2>
        <p className="ms-modal-sub">Pick a unique name that'll appear on the leaderboard.</p>
        <form onSubmit={submit} className="ms-modal-form">
          <input
            className="ms-input ms-input-lg"
            autoFocus
            maxLength={20}
            placeholder="e.g. TradingAce99"
            value={val}
            onChange={e => { setVal(e.target.value); setErr('') }}
          />
          {err && <div className="ms-field-error">{err}</div>}
          <button className="ms-btn ms-btn-primary ms-btn-full" type="submit">
            Let's go →
          </button>
        </form>
        <p className="ms-modal-disclaimer">
          Virtual money only · Not financial advice · Educational tool
        </p>
      </div>
    </div>
  )
}

// ── Game card ─────────────────────────────────────────────────────────────

function GameCard({ game, onJoin }: { game: Game; onJoin: (g: Game) => void }) {
  const navigate = useNavigate()
  const daysLeft = (() => {
    const end = new Date(game.end_date).getTime()
    const now  = Date.now()
    return Math.max(0, Math.ceil((end - now) / 86_400_000))
  })()

  function handleClick() {
    if (game.is_participant) {
      navigate(`/market-sim/game/${game.id}`)
    } else {
      onJoin(game)
    }
  }

  return (
    <div className="ms-game-card" onClick={handleClick} role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick()}>
      <div className="ms-game-card-header">
        <span className={`ms-badge ms-badge-${game.status}`}>
          {game.status === 'active' ? '● Live' : game.status === 'pending' ? '○ Upcoming' : '✓ Ended'}
        </span>
        {!game.is_public && <span className="ms-badge ms-badge-private">🔒 Private</span>}
        {game.is_participant && <span className="ms-badge ms-badge-joined">✓ Joined</span>}
      </div>
      <div className="ms-game-card-name">{game.name}</div>
      {game.description && (
        <div className="ms-game-card-desc">{game.description.slice(0, 80)}{game.description.length > 80 ? '…' : ''}</div>
      )}
      <div className="ms-game-card-meta">
        <span>${(game.starting_cash / 1000).toFixed(0)}k start</span>
        <span>·</span>
        <span>{game.participant_count} player{game.participant_count !== 1 ? 's' : ''}</span>
        <span>·</span>
        {game.status === 'active' && <span>{daysLeft}d left</span>}
        {game.status === 'pending' && <span>Starts {game.start_date}</span>}
        {game.status === 'ended'   && <span>Ended</span>}
      </div>
      <div className="ms-game-card-footer">
        <span className="ms-game-card-by">by {game.creator}</span>
        <button className="ms-btn ms-btn-sm ms-btn-outline" onClick={e => { e.stopPropagation(); handleClick() }}>
          {game.is_participant ? 'Open →' : 'Join →'}
        </button>
      </div>
    </div>
  )
}

// ── Join modal (for private games or code entry) ──────────────────────────

function JoinModal({ game, onClose, onJoined }: {
  game: Game | null
  onClose: () => void
  onJoined: (id: string) => void
}) {
  const [code, setCode]   = useState('')
  const [err, setErr]     = useState('')
  const [busy, setBusy]   = useState(false)
  const navigate = useNavigate()

  if (!game) return null

  async function handleJoin() {
    setBusy(true); setErr('')
    try {
      await joinGame(game!.id, game!.is_public ? undefined : code)
      onJoined(game!.id)
      navigate(`/market-sim/game/${game!.id}`)
    } catch (e: unknown) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ms-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ms-modal">
        <button className="ms-modal-close" onClick={onClose}>✕</button>
        <div className="ms-modal-icon">🎮</div>
        <h2 className="ms-modal-title">{game.name}</h2>
        <div className="ms-join-meta">
          <div className="ms-join-row"><span>Start cash</span><strong>${game.starting_cash.toLocaleString()}</strong></div>
          <div className="ms-join-row"><span>Players</span><strong>{game.participant_count}</strong></div>
          <div className="ms-join-row"><span>Ends</span><strong>{game.end_date}</strong></div>
          <div className="ms-join-row"><span>Short selling</span><strong>{game.allow_short ? 'Allowed' : 'Not allowed'}</strong></div>
        </div>
        {!game.is_public && (
          <div style={{ marginBottom: '1rem' }}>
            <div className="ms-field-label">Join code</div>
            <input className="ms-input" placeholder="Enter join code" value={code}
              onChange={e => setCode(e.target.value)} />
          </div>
        )}
        {err && <div className="ms-field-error" style={{ marginBottom: '0.75rem' }}>{err}</div>}
        <button className="ms-btn ms-btn-primary ms-btn-full" onClick={handleJoin} disabled={busy}>
          {busy ? 'Joining…' : 'Join Game →'}
        </button>
      </div>
    </div>
  )
}

// ── Main landing page ─────────────────────────────────────────────────────

export default function SimulatorLanding() {
  const { username, setUsername, isReady } = useUsername()
  const navigate = useNavigate()

  const [publicGames, setPublicGames]  = useState<Game[]>([])
  const [myGames, setMyGames]          = useState<Game[]>([])
  const [loading, setLoading]          = useState(true)
  const [searchQ, setSearchQ]          = useState('')
  const [joinTarget, setJoinTarget]    = useState<Game | null>(null)
  const [joinCode, setJoinCode]        = useState('')
  const [joinErr, setJoinErr]          = useState('')
  const [joinBusy, setJoinBusy]        = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pubRes, mineRes] = await Promise.all([
        listGames({ q: searchQ }) as Promise<{ games: Game[] }>,
        username ? listGames({ mine: true }) as Promise<{ games: Game[] }> : Promise.resolve({ games: [] }),
      ])
      setPublicGames(pubRes.games || [])
      setMyGames(mineRes.games || [])
    } catch {
      // If backend is down, show empty state — not an error screen
    } finally {
      setLoading(false)
    }
  }, [searchQ, username])

  useEffect(() => { if (isReady) load() }, [isReady, load])

  async function handleJoinByCode() {
    const code = joinCode.trim().toUpperCase()
    if (!code) return
    setJoinBusy(true); setJoinErr('')
    try {
      // Try fetching the game directly by ID first
      const game = await getGame(code) as Game
      if (game.is_participant) {
        navigate(`/market-sim/game/${game.id}`)
        return
      }
      if (!game.is_public) {
        // Private game — show the join modal with code pre-filled
        setJoinTarget(game)
        setJoinBusy(false)
        return
      }
      await joinGame(game.id, undefined)
      navigate(`/market-sim/game/${game.id}`)
    } catch {
      setJoinErr('Game not found. Check the ID or code and try again.')
    } finally {
      setJoinBusy(false)
    }
  }

  if (!isReady) return null
  if (!username) return <UsernameModal onSet={setUsername} />

  const filtered = publicGames.filter(g =>
    !searchQ || g.name.toLowerCase().includes(searchQ.toLowerCase())
  )

  return (
    <div className="ms-page">
      {/* Hero */}
      <div className="ms-hero">
        <div className="ms-hero-inner">
          <div className="ms-hero-text">
            <div className="ms-hero-eyebrow">Virtual · Educational · Free</div>
            <h1 className="ms-hero-title">Market Simulator</h1>
            <p className="ms-hero-sub">
              Trade with $100k of virtual money, compete with friends,
              and learn investing risk-free.
            </p>
            <div className="ms-hero-actions">
              <Link to="/market-sim/create" className="ms-btn ms-btn-primary ms-btn-lg">
                + Create Game
              </Link>
              <button className="ms-btn ms-btn-outline ms-btn-lg"
                onClick={() => document.getElementById('public-games')?.scrollIntoView({ behavior: 'smooth' })}>
                Browse Games
              </button>
            </div>
          </div>
          <div className="ms-hero-stats">
            <div className="ms-hero-stat"><div className="ms-hero-stat-val">{publicGames.length}</div><div className="ms-hero-stat-label">Active Games</div></div>
            <div className="ms-hero-stat"><div className="ms-hero-stat-val">$100k</div><div className="ms-hero-stat-label">Starting Cash</div></div>
            <div className="ms-hero-stat"><div className="ms-hero-stat-val">Free</div><div className="ms-hero-stat-label">No Cost</div></div>
          </div>
        </div>
      </div>

      {/* My Games */}
      {myGames.length > 0 && (
        <section className="ms-section">
          <div className="ms-section-header">
            <h2 className="ms-section-title">My Games</h2>
          </div>
          <div className="ms-game-grid">
            {myGames.slice(0, 6).map(g => (
              <GameCard key={g.id} game={g} onJoin={setJoinTarget} />
            ))}
          </div>
        </section>
      )}

      {/* Public Games */}
      <section className="ms-section" id="public-games">
        <div className="ms-section-header">
          <h2 className="ms-section-title">Public Games</h2>
          <input
            className="ms-input ms-search-input"
            placeholder="Search games…"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="loading-state"><div className="spinner" />Loading games…</div>
        ) : filtered.length === 0 ? (
          <div className="ms-empty-state">
            <div className="ms-empty-icon">🎮</div>
            <div className="ms-empty-title">No public games yet</div>
            <div className="ms-empty-sub">Be the first to create one!</div>
            <Link to="/market-sim/create" className="ms-btn ms-btn-primary" style={{ marginTop: '1rem' }}>
              Create a Game
            </Link>
          </div>
        ) : (
          <div className="ms-game-grid">
            {filtered.map(g => (
              <GameCard key={g.id} game={g} onJoin={setJoinTarget} />
            ))}
          </div>
        )}
      </section>

      {/* Join by code */}
      <section className="ms-section ms-join-code-section">
        <h2 className="ms-section-title">Have a join code?</h2>
        <div className="ms-join-code-row">
          <input
            className="ms-input"
            placeholder="Enter game ID or join code"
            value={joinCode}
            onChange={e => { setJoinCode(e.target.value); setJoinErr('') }}
            onKeyDown={e => e.key === 'Enter' && handleJoinByCode()}
          />
          <button className="ms-btn ms-btn-primary" onClick={handleJoinByCode} disabled={joinBusy || !joinCode.trim()}>
            {joinBusy ? '…' : 'Join →'}
          </button>
        </div>
        {joinErr && <div className="ms-field-error">{joinErr}</div>}
      </section>

      {/* Disclaimer */}
      <div className="ms-disclaimer-footer">
        ⚠ Market Simulator uses virtual money only. Not financial advice.
        Market data is ~15 minutes delayed (Yahoo Finance free tier).
        Past simulation results do not guarantee future returns.
      </div>

      {joinTarget && (
        <JoinModal
          game={joinTarget}
          onClose={() => setJoinTarget(null)}
          onJoined={() => { setJoinTarget(null); load() }}
        />
      )}
    </div>
  )
}
