import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { createGame } from '../../lib/simApi'
import { useUsername } from '../../hooks/useUsername'

export default function CreateGame() {
  const navigate = useNavigate()
  const { username } = useUsername()

  const [name, setName]             = useState('')
  const [description, setDesc]      = useState('')
  const [isPublic, setIsPublic]     = useState(true)
  const [joinCode, setJoinCode]     = useState('')
  const [startingCash, setCash]     = useState('100000')
  const [startDate, setStartDate]   = useState('')
  const [endDate, setEndDate]       = useState('')
  const [allowShort, setShort]      = useState(false)
  const [allowMargin, setMargin]    = useState(false)
  const [dayTrading, setDayTrading] = useState(true)
  const [commission, setCommission] = useState('0')
  const [rankBy, setRankBy]         = useState<'return_pct' | 'total_value'>('return_pct')
  const [portfolioPublic, setPortPublic] = useState(true)
  const [err, setErr]               = useState('')
  const [busy, setBusy]             = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!username) { setErr('Set your username first.'); return }
    if (!name.trim()) { setErr('Game name is required.'); return }
    if (!isPublic && !joinCode.trim()) { setErr('Private games need a join code.'); return }
    const cash = parseFloat(startingCash)
    if (isNaN(cash) || cash < 1000) { setErr('Starting cash must be at least $1,000.'); return }

    setBusy(true); setErr('')
    try {
      const res = await createGame({
        name: name.trim(),
        description: description.trim(),
        is_public: isPublic,
        join_code: isPublic ? null : joinCode.trim(),
        starting_cash: cash,
        start_date: startDate || undefined,
        end_date:   endDate   || undefined,
        allow_short:       allowShort,
        allow_margin:      allowMargin,
        allow_day_trading: dayTrading,
        commission:        parseFloat(commission) || 0,
        rank_by:           rankBy,
        portfolio_public:  portfolioPublic,
        allowed_assets:    ['stocks', 'etfs'],
      }) as { game_id: string }
      navigate(`/market-sim/game/${res.game_id}`)
    } catch (e: unknown) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ms-page ms-create-page">
      <div className="ms-create-header">
        <Link to="/market-sim" className="ms-back-link">← Back</Link>
        <h1 className="ms-create-title">Create a Game</h1>
        <p className="ms-create-sub">Set up your own virtual stock trading competition.</p>
      </div>

      <form onSubmit={handleSubmit} className="ms-create-form">

        {/* ── Basics ── */}
        <div className="ms-form-section">
          <div className="ms-form-section-title">Game Basics</div>

          <div className="ms-field">
            <label className="ms-field-label">Game Name *</label>
            <input className="ms-input" placeholder="e.g. Tech Stocks Showdown"
              value={name} onChange={e => setName(e.target.value)} maxLength={60} />
          </div>

          <div className="ms-field">
            <label className="ms-field-label">Description <span className="ms-optional">(optional)</span></label>
            <textarea className="ms-input ms-textarea" rows={2}
              placeholder="What's this game about?"
              value={description} onChange={e => setDesc(e.target.value)} maxLength={300} />
          </div>

          <div className="ms-field">
            <label className="ms-field-label">Visibility</label>
            <div className="ms-radio-group">
              <label className={`ms-radio-card ${isPublic ? 'selected' : ''}`} onClick={() => setIsPublic(true)}>
                <span className="ms-radio-icon">🌐</span>
                <span className="ms-radio-title">Public</span>
                <span className="ms-radio-desc">Anyone can find and join</span>
              </label>
              <label className={`ms-radio-card ${!isPublic ? 'selected' : ''}`} onClick={() => setIsPublic(false)}>
                <span className="ms-radio-icon">🔒</span>
                <span className="ms-radio-title">Private</span>
                <span className="ms-radio-desc">Join by code only</span>
              </label>
            </div>
          </div>

          {!isPublic && (
            <div className="ms-field">
              <label className="ms-field-label">Join Code *</label>
              <input className="ms-input" placeholder="e.g. SECRET123"
                value={joinCode} onChange={e => setJoinCode(e.target.value)} maxLength={20} />
              <div className="ms-field-hint">Share this with people you want to invite.</div>
            </div>
          )}
        </div>

        {/* ── Cash & Dates ── */}
        <div className="ms-form-section">
          <div className="ms-form-section-title">Cash & Duration</div>

          <div className="ms-field-row">
            <div className="ms-field">
              <label className="ms-field-label">Starting Cash</label>
              <div className="ms-input-prefix-wrap">
                <span className="ms-input-prefix">$</span>
                <input className="ms-input ms-input-prefix" type="number" min="1000" step="1000"
                  value={startingCash} onChange={e => setCash(e.target.value)} />
              </div>
            </div>
            <div className="ms-field">
              <label className="ms-field-label">Commission per trade</label>
              <div className="ms-input-prefix-wrap">
                <span className="ms-input-prefix">$</span>
                <input className="ms-input ms-input-prefix" type="number" min="0" step="0.01"
                  value={commission} onChange={e => setCommission(e.target.value)} />
              </div>
              <div className="ms-field-hint">Default $0 — set to simulate realistic costs</div>
            </div>
          </div>

          <div className="ms-field-row">
            <div className="ms-field">
              <label className="ms-field-label">Start Date <span className="ms-optional">(defaults to today)</span></label>
              <input className="ms-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="ms-field">
              <label className="ms-field-label">End Date <span className="ms-optional">(defaults to +30 days)</span></label>
              <input className="ms-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── Trading Rules ── */}
        <div className="ms-form-section">
          <div className="ms-form-section-title">Trading Rules</div>
          <div className="ms-toggle-group">
            <label className="ms-toggle-row">
              <div>
                <div className="ms-toggle-title">Allow Short Selling</div>
                <div className="ms-toggle-desc">Players can sell shares they don't own</div>
              </div>
              <input type="checkbox" className="ms-toggle-check" checked={allowShort} onChange={e => setShort(e.target.checked)} />
            </label>
            <label className="ms-toggle-row">
              <div>
                <div className="ms-toggle-title">Allow Margin Trading</div>
                <div className="ms-toggle-desc">Players can trade more than their cash balance</div>
              </div>
              <input type="checkbox" className="ms-toggle-check" checked={allowMargin} onChange={e => setMargin(e.target.checked)} />
            </label>
            <label className="ms-toggle-row">
              <div>
                <div className="ms-toggle-title">Allow Day Trading</div>
                <div className="ms-toggle-desc">No restriction on number of daily round-trips</div>
              </div>
              <input type="checkbox" className="ms-toggle-check" checked={dayTrading} onChange={e => setDayTrading(e.target.checked)} />
            </label>
          </div>
        </div>

        {/* ── Leaderboard ── */}
        <div className="ms-form-section">
          <div className="ms-form-section-title">Leaderboard &amp; Privacy</div>

          <div className="ms-field">
            <label className="ms-field-label">Rank players by</label>
            <div className="ms-radio-group">
              <label className={`ms-radio-card ${rankBy === 'return_pct' ? 'selected' : ''}`} onClick={() => setRankBy('return_pct')}>
                <span className="ms-radio-icon">%</span>
                <span className="ms-radio-title">Percent Return</span>
                <span className="ms-radio-desc">Fairest comparison</span>
              </label>
              <label className={`ms-radio-card ${rankBy === 'total_value' ? 'selected' : ''}`} onClick={() => setRankBy('total_value')}>
                <span className="ms-radio-icon">$</span>
                <span className="ms-radio-title">Total Value</span>
                <span className="ms-radio-desc">Highest portfolio wins</span>
              </label>
            </div>
          </div>

          <label className="ms-toggle-row">
            <div>
              <div className="ms-toggle-title">Public Portfolios</div>
              <div className="ms-toggle-desc">Players can see each other's holdings</div>
            </div>
            <input type="checkbox" className="ms-toggle-check" checked={portfolioPublic} onChange={e => setPortPublic(e.target.checked)} />
          </label>
        </div>

        {err && <div className="ms-field-error ms-form-error">{err}</div>}

        <div className="ms-form-actions">
          <Link to="/market-sim" className="ms-btn ms-btn-ghost">Cancel</Link>
          <button type="submit" className="ms-btn ms-btn-primary ms-btn-lg" disabled={busy}>
            {busy ? 'Creating…' : 'Create Game →'}
          </button>
        </div>

        <p className="ms-form-disclaimer">
          ⚠ Virtual money only. Not financial advice. Educational simulator.
        </p>
      </form>
    </div>
  )
}
