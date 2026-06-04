import { useState, useEffect } from 'react'
import type { ImprovementLogResponse } from '../types'

export default function ImprovementLog() {
  const [data, setData] = useState<ImprovementLogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/improvement/log')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d: ImprovementLogResponse) => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div className="loading-state"><div className="spinner" />Loading improvement log…</div>
  if (error) return <div className="error-state"><p>{error}</p></div>
  if (!data) return <div className="empty-state">No data.</div>

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Improvement Log</h1>
        <p className="page-subtitle">
          Disciplined, offline model improvement. No continuous learning.
          A challenger is promoted <em>only</em> if it beats the champion out-of-sample.
        </p>
      </div>

      <div className="improvement-grid">
        {/* Champion */}
        <div className="card">
          <h3>🏆 Champion Model</h3>
          {data.champion ? (
            <table className="model-card-table">
              <tbody>
                <tr><td>Type</td><td>{data.champion.model_type}</td></tr>
                <tr><td>Training window</td><td>{data.champion.training_window_start} → {data.champion.training_window_end}</td></tr>
                <tr><td>CV accuracy</td><td>{(data.champion.cv_accuracy * 100).toFixed(1)}%</td></tr>
                <tr><td>Samples</td><td>{data.champion.n_train_samples.toLocaleString()}</td></tr>
                <tr><td>Frozen at</td><td>{new Date(data.champion.frozen_at).toLocaleString()}</td></tr>
                <tr><td>Strategy</td><td>{data.champion.config?.strategy ?? '—'}</td></tr>
              </tbody>
            </table>
          ) : (
            <p className="empty-state-inline">No model trained yet. Run a backtest in Tab B.</p>
          )}
        </div>

        {/* Hold-out */}
        <div className="card card-holdout">
          <h3>🔒 Permanently Frozen Hold-Out</h3>
          <p><strong>{data.holdout_start}</strong> → <strong>{data.holdout_end}</strong></p>
          <p className="note">{data.holdout_note}</p>
        </div>

        {/* Promotion rules */}
        <div className="card">
          <h3>Promotion Rules</h3>
          <ul className="rule-list">
            <li>A challenger must outperform the champion on the <strong>hold-out set</strong></li>
            <li>Minimum improvement: <strong>ΔSharpe &gt; 0.15</strong></li>
            <li>Training data must not include hold-out dates</li>
            <li>Promotion is logged with timestamp and reason</li>
          </ul>
        </div>

        {/* Multiple testing */}
        <div className="card card-warning">
          <h3>⚠ Multiple Testing Note</h3>
          <p>{data.multiple_testing_note}</p>
        </div>
      </div>

      {/* Challengers */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3>Challenger History</h3>
        {data.challengers.length === 0 ? (
          <p className="empty-state-inline">
            No challengers yet. After training your first model in Tab B, retrain with different
            parameters to create a challenger. It will only be promoted if it genuinely outperforms.
          </p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th><th>Type</th><th>Trained</th>
                  <th>OOS Sharpe</th><th>Champion Sharpe</th>
                  <th>ΔSharpe</th><th>Promoted</th><th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.challengers.map((c, i) => {
                  const delta = c.oos_sharpe - c.champion_sharpe
                  return (
                    <tr key={i} className={c.promoted ? 'row-buy' : ''}>
                      <td>#{c.model_id}</td>
                      <td>{c.model_type}</td>
                      <td>{new Date(c.trained_at).toLocaleDateString()}</td>
                      <td>{c.oos_sharpe.toFixed(3)}</td>
                      <td>{c.champion_sharpe.toFixed(3)}</td>
                      <td className={delta >= 0.15 ? 'text-green' : 'text-red'}>
                        {delta >= 0 ? '+' : ''}{delta.toFixed(3)}
                      </td>
                      <td>{c.promoted ? '✅ Yes' : '✗ No'}</td>
                      <td>{c.notes}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Retrain log */}
      {data.retrain_log.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3>Retrain Log</h3>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>Timestamp</th><th>Promoted</th><th>ΔSharpe</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {data.retrain_log.map((r, i) => (
                  <tr key={i}>
                    <td>{String(r.timestamp)}</td>
                    <td>{r.promoted ? '✅' : '✗'}</td>
                    <td>{String(r.delta_sharpe)}</td>
                    <td>{String(r.notes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
