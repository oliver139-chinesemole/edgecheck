import { useState, useEffect } from 'react'
import type { HoldingWithQoQ, ConsensusSignal, InsiderTrade, CongressionalTrade } from '../engine/types'
import { loadHoldings, loadInsiderTrades, loadCongressionalTrades } from '../engine/loader'
import { addQoQ, computeSignals } from '../engine/smartmoney'

type Tab = 'signals' | 'holdings' | 'insider' | 'congress'

function QBadge({ change }: { change: HoldingWithQoQ['qoq_change'] }) {
  const map = { new_buy: 'badge-new', add: 'badge-add', trim: 'badge-trim', exit: 'badge-exit', unchanged: 'badge-hold' }
  const labels = { new_buy: 'New Buy', add: 'Add', trim: 'Trim', exit: 'Exit', unchanged: '—' }
  return <span className={`badge ${map[change]}`}>{labels[change]}</span>
}

function TxBadge({ type }: { type: string }) {
  return <span className={`badge ${type === 'Purchase' ? 'badge-buy' : 'badge-sell'}`}>{type}</span>
}

function SignalCard({ s }: { s: ConsensusSignal }) {
  const isHot = s.signal_type === 'new_buy' || s.signal_type === 'add'
  const typeLabel: Record<string, string> = {
    new_buy: 'New Buy', add: 'Adding', trim: 'Trimming', exit: 'Exit', consensus_hold: 'Consensus'
  }
  const typeBadge: Record<string, string> = {
    new_buy: 'badge-new', add: 'badge-add', trim: 'badge-trim', exit: 'badge-exit', consensus_hold: 'badge-hold'
  }
  return (
    <div className={`signal-card${isHot ? ' hot' : ''}`}>
      <div className="sc-top">
        <span className="sc-ticker">{s.ticker}</span>
        <span className={`badge ${typeBadge[s.signal_type] ?? 'badge-hold'}`}>{typeLabel[s.signal_type] ?? s.signal_type}</span>
      </div>
      <p className="sc-desc">{s.description}</p>
      <div className="sc-meta">
        <span>{s.fund_count} fund{s.fund_count !== 1 ? 's' : ''}</span>
        <span>{s.avg_weight_pct.toFixed(1)}% avg wt</span>
        <span>lag ≥45d</span>
      </div>
      <div className="conviction-track">
        <div className="conviction-fill" style={{ width: `${(s.conviction_score * 100).toFixed(0)}%` }} />
      </div>
    </div>
  )
}

export default function SmartMoney() {
  const [tab, setTab] = useState<Tab>('signals')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [holdings, setHoldings] = useState<HoldingWithQoQ[]>([])
  const [signals, setSignals] = useState<ConsensusSignal[]>([])
  const [insiders, setInsiders] = useState<InsiderTrade[]>([])
  const [congress, setCongress] = useState<CongressionalTrade[]>([])
  const [latestQ, setLatestQ] = useState('')
  const [fundFilter, setFundFilter] = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.all([loadHoldings(), loadInsiderTrades(), loadCongressionalTrades()])
      .then(([raw, ins, cong]) => {
        const withQoQ = addQoQ(raw)
        const sigs = computeSignals(raw)
        const allQ = [...new Set(raw.map(h => h.quarter))].sort()
        const latest = allQ[allQ.length - 1] ?? ''
        setHoldings(withQoQ.filter(h => h.quarter === latest))
        setSignals(sigs)
        setInsiders(ins.slice(0, 60))
        setCongress(cong.slice(0, 60))
        setLatestQ(latest)
        setLoading(false)
      })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return <div className="loading-state"><div className="spinner" />Loading smart money data…</div>
  if (error) return <div className="error-state"><p>{error}</p><button onClick={() => window.location.reload()}>Retry</button></div>

  const filtered = holdings.filter(h => !fundFilter || h.fund_name.toLowerCase().includes(fundFilter.toLowerCase()))

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Smart Money</h1>
        <p className="page-sub">Institutional 13F holdings · Insider trades · Congressional disclosures · Q {latestQ}</p>
      </div>

      <div className="alert alert-amber">
        <span className="alert-icon">⚠</span>
        <span>13F filings are due 45 days after quarter-end. This data is at minimum 45 days old — it is a trailing, not a leading, indicator.</span>
      </div>

      <div className="sample-badge">● Sample data — add FMP_API_KEY to go live</div>

      <div className="sub-tabs">
        {(['signals','holdings','insider','congress'] as Tab[]).map(t => (
          <button key={t} className={`sub-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'signals' ? `Signals (${signals.length})` :
             t === 'holdings' ? `13F Holdings (${holdings.length})` :
             t === 'insider' ? `Insider Trades (${insiders.length})` :
             `Congressional (${congress.length})`}
          </button>
        ))}
      </div>

      {tab === 'signals' && (
        signals.length === 0
          ? <div className="empty-state"><p className="empty-title">No consensus signals found</p><p>Not enough funds hold the same position to generate a signal this quarter.</p></div>
          : <div className="signal-grid">{signals.map((s, i) => <SignalCard key={i} s={s} />)}</div>
      )}

      {tab === 'holdings' && (
        <>
          <div className="filter-row">
            <input className="filter-input" placeholder="Filter by fund…" value={fundFilter} onChange={e => setFundFilter(e.target.value)} />
            <span className="filter-count">{filtered.length} rows</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Fund</th><th>Ticker</th><th>Shares</th><th>Value</th><th>Portfolio %</th><th>Change</th></tr></thead>
              <tbody>
                {filtered.map((h, i) => (
                  <tr key={i}>
                    <td>{h.fund_name}</td>
                    <td><strong>{h.ticker}</strong></td>
                    <td className="num">{h.shares.toLocaleString()}</td>
                    <td className="num">${(h.value_usd / 1e6).toFixed(1)}M</td>
                    <td className="num">{h.portfolio_pct.toFixed(1)}%</td>
                    <td><QBadge change={h.qoq_change} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'insider' && (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Insider</th><th>Title</th><th>Ticker</th><th>Type</th><th>Shares</th><th>Price</th><th>Date</th></tr></thead>
            <tbody>
              {insiders.map((t, i) => (
                <tr key={i}>
                  <td>{t.insider_name}</td><td>{t.title}</td>
                  <td><strong>{t.ticker}</strong></td>
                  <td><TxBadge type={t.transaction_type} /></td>
                  <td className="num">{t.shares.toLocaleString()}</td>
                  <td className="num">${t.price.toFixed(2)}</td>
                  <td>{t.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'congress' && (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Politician</th><th>Chamber</th><th>Ticker</th><th>Type</th><th>Amount</th><th>Trade Date</th><th>Disclosed</th></tr></thead>
            <tbody>
              {congress.map((t, i) => (
                <tr key={i}>
                  <td>{t.politician}</td><td>{t.chamber}</td>
                  <td><strong>{t.ticker}</strong></td>
                  <td><TxBadge type={t.transaction_type} /></td>
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
