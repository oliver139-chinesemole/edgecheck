/**
 * Learning Engine page (Feature B).
 *
 * Layout:
 *   - Status card: running/idle/training, progress bar
 *   - Champion model card: type, training episodes, CV accuracy, frozen timestamp
 *   - Honest result panel (always visible)
 *   - Live vs backtest metrics
 *   - Start / Stop buttons
 */
import { useState, useEffect, useRef } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────

interface ChampionCard {
  model_type: string
  features: string[]
  frozen_at: string
  artifact_path: string
  cv_accuracy: number
  train_accuracy: number
  n_train_samples: number
  training_episodes: number
  note: string
}

interface LiveStats {
  strategy_cagr: number
  spy_cagr: number
  divergence: number
  n_episodes: number
  honest_note: string
}

interface AgentStatus {
  phase: string
  episodes_completed: number
  target_episodes: number
  dataset_size: number
  champion: ChampionCard | null
  error: string | null
  live_episodes: number
  live_stats: LiveStats
  disclaimer?: string
}

// ─── Constants ───────────────────────────────────────────────────────────

import { BACKEND_URL } from '../lib/config'
const API_BASE = `${BACKEND_URL}/api/agent`

const DEFAULT_STATUS: AgentStatus = {
  phase: 'idle',
  episodes_completed: 0,
  target_episodes: 100,
  dataset_size: 0,
  champion: null,
  error: null,
  live_episodes: 0,
  live_stats: {
    strategy_cagr: 0,
    spy_cagr: 0,
    divergence: 0,
    n_episodes: 0,
    honest_note: 'Most likely result is underperformance vs SPY — that is a valid finding.',
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function fmtPct(v: number): string {
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%'
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    idle: 'Idle',
    seeding: 'Collecting episodes (heuristic)',
    training: 'Training model offline',
    evaluating: 'Evaluating trained model',
    champion_frozen: 'Champion frozen',
    stopping: 'Stopping…',
    error: 'Error',
  }
  return labels[phase] || phase
}

function phaseColor(phase: string): string {
  if (phase === 'idle' || phase === 'stopping') return 'var(--text-dim)'
  if (phase === 'error') return 'var(--red)'
  if (phase === 'champion_frozen') return 'var(--green)'
  return 'var(--amber)'
}

// ─── Offline banner ───────────────────────────────────────────────────────

function OfflineBanner() {
  return (
    <div className="alert alert-amber">
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

// ─── Progress bar ─────────────────────────────────────────────────────────

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{ background: 'var(--surface-3)', borderRadius: 99, height: 8, overflow: 'hidden', margin: '0.5rem 0' }}>
      <div style={{
        height: '100%', borderRadius: 99,
        background: 'linear-gradient(90deg, var(--blue), var(--indigo))',
        width: `${pct}%`,
        transition: 'width 0.4s ease',
      }} />
    </div>
  )
}

// ─── Champion card ────────────────────────────────────────────────────────

function ChampionModelCard({ champion }: { champion: ChampionCard }) {
  const frozenDate = new Date(champion.frozen_at).toLocaleString()
  return (
    <div className="model-card">
      <div className="model-card-title">Champion Model — FROZEN</div>
      <div className="model-kv">
        <span>Type</span><span>{champion.model_type}</span>
        <span>Training episodes</span><span>{champion.training_episodes}</span>
        <span>Training samples</span><span>{champion.n_train_samples.toLocaleString()}</span>
        <span>CV accuracy</span><span>{(champion.cv_accuracy * 100).toFixed(1)}%</span>
        <span>Train accuracy</span><span>{(champion.train_accuracy * 100).toFixed(1)}%</span>
        <span>Features</span><span>{champion.features.length} signals</span>
        <span>Frozen at</span><span>{frozenDate}</span>
      </div>
      <div className="model-frozen-note" style={{ fontSize: '0.72rem', marginTop: '0.65rem' }}>
        {champion.note}
      </div>
    </div>
  )
}

// ─── Live stats ───────────────────────────────────────────────────────────

function LiveVsBacktestPanel({ stats, hasChampion }: { stats: LiveStats; hasChampion: boolean }) {
  const divergenceColor = stats.divergence >= 0 ? 'var(--green)' : 'var(--red)'
  return (
    <div className="card bordered-blue" style={{ marginBottom: '1rem' }}>
      <div className="card-title">Live vs Backtest Metrics</div>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)' }}>Strategy Avg Return</div>
          <div style={{ fontFamily: 'var(--font-num)', fontSize: '1rem', fontWeight: 600, color: stats.strategy_cagr >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {fmtPct(stats.strategy_cagr)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)' }}>SPY Avg Return</div>
          <div style={{ fontFamily: 'var(--font-num)', fontSize: '1rem', fontWeight: 600, color: 'var(--amber)' }}>
            {fmtPct(stats.spy_cagr)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)' }}>Divergence (vs SPY)</div>
          <div style={{ fontFamily: 'var(--font-num)', fontSize: '1rem', fontWeight: 600, color: divergenceColor }}>
            {fmtPct(stats.divergence)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)' }}>Episodes Evaluated</div>
          <div style={{ fontFamily: 'var(--font-num)', fontSize: '1rem', fontWeight: 600 }}>{stats.n_episodes}</div>
        </div>
      </div>
      {!hasChampion && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-lo)' }}>
          Run the learning loop to train and freeze a champion model.
        </div>
      )}
      <div style={{ fontSize: '0.75rem', color: 'var(--indigo)', marginTop: '0.35rem', fontStyle: 'italic' }}>
        The model never trains on forward data. Every observation in the live track record is genuinely out-of-sample.
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────

export default function LearningEnginePage() {
  const [status, setStatus] = useState<AgentStatus>(DEFAULT_STATUS)
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null)
  const [targetEpisodes, setTargetEpisodes] = useState(100)
  const [actionFeedback, setActionFeedback] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function checkAndLoad() {
      try {
        const r = await fetch(`${API_BASE}/status`)
        if (!r.ok) throw new Error('Not ok')
        const data: AgentStatus = await r.json()
        setStatus(data)
        setBackendOnline(true)
      } catch {
        setBackendOnline(false)
      }
    }
    checkAndLoad()
    pollRef.current = setInterval(checkAndLoad, 2_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  async function handleStart() {
    try {
      const r = await fetch(`${API_BASE}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_episodes: targetEpisodes }),
      })
      const d = await r.json()
      setActionFeedback(d.message || 'Started.')
    } catch {
      setActionFeedback('Backend offline.')
    }
    setTimeout(() => setActionFeedback(''), 4_000)
  }

  async function handleStop() {
    try {
      const r = await fetch(`${API_BASE}/stop`, { method: 'POST' })
      const d = await r.json()
      setActionFeedback(d.message || 'Stop signal sent.')
    } catch {
      setActionFeedback('Backend offline.')
    }
    setTimeout(() => setActionFeedback(''), 4_000)
  }

  const isRunning = ['seeding', 'training', 'evaluating', 'stopping'].includes(status.phase)
  const progressPct = status.target_episodes > 0
    ? Math.round((status.episodes_completed / status.target_episodes) * 100)
    : 0

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Background Learning Engine</h1>
        <p className="page-sub">
          Runs hundreds of simulated episodes on seed data, trains an offline GBT model,
          and freezes a champion. The champion is <em>never</em> retrained on forward data.
        </p>
      </div>

      {backendOnline === false && <OfflineBanner />}

      {/* Honest result panel — ALWAYS VISIBLE */}
      <div className="honest-result" style={{ marginBottom: '1rem' }}>
        <div className="honest-result-header">
          <span className="honest-result-badge">Honest Result</span>
          <span className="honest-result-title">Most likely outcome: no durable edge vs SPY</span>
        </div>
        <div className="honest-result-explanation">
          A strategy that looks brilliant across 1,000 replayed simulations is the textbook overfitting
          trap. Only the frozen forward track record counts. Underperforming buy-and-hold SPY is the
          expected and honest finding — and that is scientifically valid. Do not trade real money based
          on anything shown here.
        </div>
      </div>

      {actionFeedback && (
        <div className="alert alert-blue" style={{ marginBottom: '1rem' }}>{actionFeedback}</div>
      )}

      {/* Status card */}
      <div className="card bordered-amber" style={{ marginBottom: '1rem' }}>
        <div className="card-title">Engine Status</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: phaseColor(status.phase), display: 'inline-block', flexShrink: 0,
            animation: isRunning ? 'pulse 1.4s ease infinite' : 'none',
          }} />
          <span style={{ fontFamily: 'var(--font-num)', fontWeight: 600, fontSize: '0.88rem', color: phaseColor(status.phase) }}>
            {phaseLabel(status.phase)}
          </span>
          {status.error && (
            <span style={{ color: 'var(--red)', fontSize: '0.75rem' }}> — {status.error}</span>
          )}
        </div>

        <ProgressBar value={status.episodes_completed} max={status.target_episodes} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-lo)' }}>
          <span>{status.episodes_completed} / {status.target_episodes} episodes</span>
          <span>{progressPct}%</span>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.72rem' }}>
            <span style={{ color: 'var(--text-lo)' }}>Dataset size: </span>
            <span style={{ fontFamily: 'var(--font-num)', color: 'var(--text-hi)' }}>{status.dataset_size.toLocaleString()} rows</span>
          </div>
          <div style={{ fontSize: '0.72rem' }}>
            <span style={{ color: 'var(--text-lo)' }}>Forward episodes: </span>
            <span style={{ fontFamily: 'var(--font-num)', color: 'var(--text-hi)' }}>{status.live_episodes}</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: 'var(--text-lo)' }}>
          Target episodes:
          <input
            type="number"
            min={10}
            max={1000}
            value={targetEpisodes}
            onChange={e => setTargetEpisodes(parseInt(e.target.value) || 100)}
            className="config-input"
            style={{ width: 80 }}
          />
        </label>
        <button
          className="btn btn-primary"
          onClick={handleStart}
          disabled={isRunning || !backendOnline}
        >
          Start
        </button>
        <button
          className="btn btn-stop"
          onClick={handleStop}
          disabled={!isRunning || !backendOnline}
        >
          Stop
        </button>
      </div>

      {/* Two-column: champion card + live stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' }}>
        {/* Champion model card */}
        <div className="card bordered-purple">
          <div className="card-title">Champion Model</div>
          {status.champion ? (
            <ChampionModelCard champion={status.champion} />
          ) : (
            <div className="empty-state" style={{ padding: '1.5rem 0.5rem', textAlign: 'center' }}>
              <div className="empty-title">No champion yet</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-lo)', marginTop: '0.25rem' }}>
                Start the learning loop to train and freeze a champion model.
              </div>
            </div>
          )}
        </div>

        {/* Live vs backtest stats */}
        <div>
          <LiveVsBacktestPanel stats={status.live_stats} hasChampion={status.champion !== null} />

          {/* Methodology note */}
          <div className="card" style={{ fontSize: '0.75rem' }}>
            <div className="card-title">Methodology</div>
            <ul style={{ paddingLeft: '1rem', lineHeight: 1.8, color: 'var(--text-lo)' }}>
              <li>All features lagged ≥1 bar (no lookahead bias)</li>
              <li>Triple-barrier labels (profit-take / stop-loss / time)</li>
              <li>8 bps round-trip cost minimum on all trades</li>
              <li>Benchmark vs buy-and-hold SPY always shown</li>
              <li>Champion model frozen — never updated from forward data</li>
              <li>"No edge found" is the displayed expected result</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
