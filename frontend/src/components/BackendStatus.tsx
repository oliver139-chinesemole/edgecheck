import { useState, useEffect } from 'react'
import type { HealthResponse } from '../types'
import { BACKEND_URL } from '../lib/config'

export function BackendStatus() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) })
        if (!r.ok) throw new Error('unhealthy')
        const data: HealthResponse = await r.json()
        if (!cancelled) { setHealth(data); setError(false) }
      } catch {
        if (!cancelled) setError(true)
      }
    }
    check()
    const id = setInterval(check, 15_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (error) {
    return (
      <span className="backend-status status-error" title="Backend unreachable — is it running?">
        ● Backend offline
      </span>
    )
  }
  if (!health) {
    return <span className="backend-status status-connecting">● Connecting…</span>
  }
  return (
    <span className="backend-status status-ok" title={`v${health.version}`}>
      ● Backend{' '}
      {health.has_alpaca ? '| Alpaca ✓' : '| Alpaca – (seed)'}
      {health.model_ready ? ' | Model ✓' : ' | Model – (run backtest)'}
    </span>
  )
}
