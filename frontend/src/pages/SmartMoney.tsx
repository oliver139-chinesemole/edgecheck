import { useState, useEffect } from 'react'
import type { SmartMoneyResponse, ConsensusSignal, Holding } from '../types'
import { SampleDataBadge } from '../components/SampleDataBadge'

function QoQBadge({ change }: { change?: string }) {
  const map: Record<string, string> = {
    new_buy: 'badge-new-buy',
    add: 'badge-add',
    trim: 'badge-trim',
    exit: 'badge-exit',
    unchanged: 'badge-unchanged',
  }
  if (!change) return null
  return (
    <span className={`qoq-badge ${map[change] ?? ''}`}>
      {change.replace('_', ' ')}
    </span>
  )
}

function ConvictionBar({ score }: { score: number }) {
  return (
    <div className="conviction-bar-bg">
      <div
        className="conviction-bar-fill"
        style={{ width: `${Math.round(score * 100)}%` }}
        title={`Conviction: ${(score * 100).toFixed(0)}%`}
      />
    </div>
  )
}

function SignalCard({ s }: { s: ConsensusSignal }) {
  return (
    <div className={`signal-card ${s.signal_type === 'new_buy' ? 'signal-new-buy' : ''}`}>
      <div className="signal-header">
        <span className="signal-ticker">{s.ticker}</span>
        <span className={`signal-type-badge ${s.signal_type}`}>{s.signal_type.replace(/_/g, ' ')}</span>
      </div>
      <p className="signal-desc">{s.description}</p>
      <div className="signal-meta">
        <span>{s.fund_count} fund{s.fund_count !== 1 ? 's' : ''}</span>
        <span>{s.avg_weight_pct.toFixed(1)}% avg weight</span>
        <span>lag ≥{s.data_lag_days}d</span>
      </div>
      <ConvictionBar score={s.conviction_score} />
    </div>
  )
}

export default function SmartMoney() {
  const [data, setData] = useState<SmartMoneyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'signals' | 'holdings' | 'insider' | 'congress'>('signals')
  const [fundFilter, setFundFilter] = useState('')

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/smart-money/holdings')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: SmartMoneyResponse) => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div className="loading-state"><div className="spinner" />Loading smart money data…</div>
  if (error) return (
    <div className="error-state">
      <p>Failed to load data: {error}</p>
      <button onClick={() => window.location.reload()}>Retry</button>
    </div>
  )
  if (!data) return <div className="empty-state">No data available.</div>

  const filteredHoldings = data.holdings.filter(h =>
    !fundFilter || h.fund_name.toLowerCase().includes(fundFilter.toLowerCase())
  )

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Smart Money Dashboard</h1>
        <p className="page-subtitle">
          Institutional 13F holdings, insider trades, and congressional disclosures.
          Latest quarter: <strong>{data.latest_quarter}</strong>
        </p>
        <SampleDataBadge using={data.using_sample_data} />
      </div>

      <div className="data-lag-warning">
        ⚠ {data.data_lag_note}
      </div>

      <div className="sub-tabs">
        {(['signals', 'holdings', 'insider', 'congress'] as const).map(t => (
          <button
            key={t}
            className={`sub-tab ${activeTab === t ? 'active' : ''}`}
            onClick={() => setActiveTab(t)}
          >
            {t === 'signals' ? 'Consensus Signals' :
             t === 'holdings' ? `13F Holdings (${data.holdings.length})` :
             t === 'insider' ? `Insider Trades (${data.insider_trades.length})` :
             `Congressional (${data.congressional_trades.length})`}
          </button>
        ))}
      </div>

      {activeTab === 'signals' && (
        <div>
          {data.signals.length === 0 ? (
            <div className="empty-state">No high-conviction consensus signals found this quarter.</div>
          ) : (
            <div className="signal-grid">
              {data.signals.map((s, i) => <SignalCard key={i} s={s} />)}
            </div>
          )}
        </div>
      )}

      {activeTab === 'holdings' && (
        <div>
          <div className="filter-bar">
            <input
              type="text"
              placeholder="Filter by fund name…"
              value={fundFilter}
              onChange={e => setFundFilter(e.target.value)}
              className="filter-input"
            />
            <span className="filter-count">{filteredHoldings.length} rows</span>
          </div>
          {filteredHoldings.length === 0 ? (
            <div className="empty-state">No holdings match the filter.</div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Fund</th><th>Ticker</th><th>Shares</th>
                    <th>Value (USD)</th><th>Portfolio %</th><th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHoldings.map((h, i) => (
                    <tr key={i}>
                      <td>{h.fund_name}</td>
                      <td><strong>{h.ticker}</strong></td>
                      <td>{h.shares.toLocaleString()}</td>
                      <td>${(h.value_usd / 1e6).toFixed(1)}M</td>
                      <td>{h.portfolio_pct.toFixed(1)}%</td>
                      <td><QoQBadge change={h.qoq_change} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'insider' && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Insider</th><th>Title</th><th>Ticker</th>
                <th>Type</th><th>Shares</th><th>Price</th><th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.insider_trades.map((t, i) => (
                <tr key={i} className={t.transaction_type === 'Purchase' ? 'row-buy' : 'row-sell'}>
                  <td>{t.insider_name}</td>
                  <td>{t.title}</td>
                  <td><strong>{t.ticker}</strong></td>
                  <td><span className={`tx-badge ${t.transaction_type === 'Purchase' ? 'buy' : 'sell'}`}>{t.transaction_type}</span></td>
                  <td>{t.shares.toLocaleString()}</td>
                  <td>${t.price.toFixed(2)}</td>
                  <td>{t.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'congress' && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Politician</th><th>Chamber</th><th>Ticker</th>
                <th>Type</th><th>Amount</th><th>Trade Date</th><th>Disclosed</th>
              </tr>
            </thead>
            <tbody>
              {data.congressional_trades.map((t, i) => (
                <tr key={i} className={t.transaction_type === 'Purchase' ? 'row-buy' : 'row-sell'}>
                  <td>{t.politician}</td>
                  <td>{t.chamber}</td>
                  <td><strong>{t.ticker}</strong></td>
                  <td><span className={`tx-badge ${t.transaction_type === 'Purchase' ? 'buy' : 'sell'}`}>{t.transaction_type}</span></td>
                  <td>{t.amount_range}</td>
                  <td>{t.trade_date}</td>
                  <td>{t.disclosure_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
