import { useState, useEffect } from 'react'
import type { HoldingWithQoQ, ConsensusSignal, InsiderTrade, CongressionalTrade } from '../engine/types'
import { loadHoldings, loadInsiderTrades, loadCongressionalTrades } from '../engine/loader'
import { addQoQ, computeSignals } from '../engine/smartmoney'
import { SkeletonTable } from '../components/SkeletonTable'
import { Term } from '../components/Glossary'

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
    <article
      className={`signal-card${isHot ? ' hot' : ''}`}
      aria-label={`${s.ticker} signal: ${typeLabel[s.signal_type] ?? s.signal_type}`}
    >
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
      <div
        className="conviction-track"
        role="meter"
        aria-valuenow={Math.round(s.conviction_score * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Conviction: ${Math.round(s.conviction_score * 100)}%`}
      >
        <div className="conviction-fill" style={{ width: `${(s.conviction_score * 100).toFixed(0)}%` }} />
      </div>
    </article>
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

  if (error) return (
    <div className="error-state" role="alert">
      <p>{error}</p>
      <button onClick={() => window.location.reload()}>Retry</button>
    </div>
  )

  const filtered = holdings.filter(h => !fundFilter || h.fund_name.toLowerCase().includes(fundFilter.toLowerCase()))

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Smart Money</h1>
        <p className="page-sub">
          Institutional <Term id="filing13f">13F holdings</Term> · Insider trades · Congressional disclosures
          {latestQ && !loading ? ` · Q ${latestQ}` : ''}
        </p>
      </div>

      <div className="alert alert-amber" role="note">
        <span className="alert-icon">⚠</span>
        <span>
          <Term id="filing13f">13F filings</Term> are due 45 days after quarter-end.
          This data is at minimum 45 days old — it is a trailing, not a leading, indicator.
        </span>
      </div>

      <div className="sample-badge" aria-label="Using sample data">
        ● Sample data — add FMP_API_KEY to go live
      </div>

      <div
        className="sub-tabs"
        role="tablist"
        aria-label="Smart money data views"
      >
        {(['signals','holdings','insider','congress'] as Tab[]).map(t => (
          <button
            key={t}
            role="tab"
            className={`sub-tab${tab === t ? ' active' : ''}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            id={`tab-${t}`}
            onClick={() => setTab(t)}
          >
            {loading ? t.charAt(0).toUpperCase() + t.slice(1) : (
              t === 'signals' ? `Signals (${signals.length})` :
              t === 'holdings' ? `13F Holdings (${holdings.length})` :
              t === 'insider' ? `Insider Trades (${insiders.length})` :
              `Congressional (${congress.length})`
            )}
          </button>
        ))}
      </div>

      {/* Signals tab */}
      <div
        role="tabpanel"
        id="panel-signals"
        aria-labelledby="tab-signals"
        hidden={tab !== 'signals'}
      >
        {loading ? (
          <div className="signal-grid" aria-busy="true" aria-label="Loading signals">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="signal-card" aria-hidden="true">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <div className="skeleton-cell" style={{ width: '60px', height: '20px', borderRadius: 4 }} />
                  <div className="skeleton-cell" style={{ width: '50px', height: '18px', borderRadius: 99 }} />
                </div>
                <div className="skeleton-cell" style={{ width: '90%', height: '12px', borderRadius: 4, marginBottom: '0.4rem' }} />
                <div className="skeleton-cell" style={{ width: '70%', height: '12px', borderRadius: 4, marginBottom: '0.65rem' }} />
                <div className="skeleton-cell" style={{ width: '100%', height: '3px', borderRadius: 99 }} />
              </div>
            ))}
          </div>
        ) : signals.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">No consensus signals found</p>
            <p>Not enough funds hold the same position to generate a signal this quarter.</p>
          </div>
        ) : (
          <div className="signal-grid">
            {signals.map((s, i) => <SignalCard key={i} s={s} />)}
          </div>
        )}
      </div>

      {/* Holdings tab */}
      <div
        role="tabpanel"
        id="panel-holdings"
        aria-labelledby="tab-holdings"
        hidden={tab !== 'holdings'}
      >
        {loading ? (
          <div className="table-scroll">
            <SkeletonTable columns={6} rows={10} widths={['30%','12%','15%','12%','12%','10%']} />
          </div>
        ) : (
          <>
            <div className="filter-row">
              <input
                className="filter-input"
                placeholder="Filter by fund…"
                value={fundFilter}
                onChange={e => setFundFilter(e.target.value)}
                aria-label="Filter holdings by fund name"
              />
              <span className="filter-count" aria-live="polite">{filtered.length} rows</span>
            </div>
            <div className="table-scroll">
              <table className="data-table" aria-label="13F holdings">
                <thead>
                  <tr>
                    <th scope="col">Fund</th>
                    <th scope="col">Ticker</th>
                    <th scope="col">Shares</th>
                    <th scope="col">Value</th>
                    <th scope="col">Portfolio %</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
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
      </div>

      {/* Insider trades tab */}
      <div
        role="tabpanel"
        id="panel-insider"
        aria-labelledby="tab-insider"
        hidden={tab !== 'insider'}
      >
        {loading ? (
          <div className="table-scroll">
            <SkeletonTable columns={7} rows={10} widths={['20%','15%','10%','10%','12%','10%','12%']} />
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table" aria-label="Insider trades">
              <thead>
                <tr>
                  <th scope="col">Insider</th>
                  <th scope="col">Title</th>
                  <th scope="col">Ticker</th>
                  <th scope="col">Type</th>
                  <th scope="col">Shares</th>
                  <th scope="col">Price</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
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
      </div>

      {/* Congressional tab */}
      <div
        role="tabpanel"
        id="panel-congress"
        aria-labelledby="tab-congress"
        hidden={tab !== 'congress'}
      >
        {loading ? (
          <div className="table-scroll">
            <SkeletonTable columns={7} rows={10} widths={['20%','12%','10%','10%','12%','12%','12%']} />
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table" aria-label="Congressional trades">
              <thead>
                <tr>
                  <th scope="col">Politician</th>
                  <th scope="col">Chamber</th>
                  <th scope="col">Ticker</th>
                  <th scope="col">Type</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Trade Date</th>
                  <th scope="col">Disclosed</th>
                </tr>
              </thead>
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
    </div>
  )
}
