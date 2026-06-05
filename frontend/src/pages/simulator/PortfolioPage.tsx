import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { getTransactions } from '../../lib/simApi'
import { useGameCtx } from './GameLayout'
import type { Transaction } from '../../types/simulator'

function fmt$(v: number) {
  return '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%' }

const COLORS = ['#4a9eff','#2dd68a','#f0b732','#ff5c4a','#b09fff','#6dd5fa','#f093fb','#43e97b']

export default function PortfolioPage() {
  const { gameId } = useParams<{ gameId: string }>()
  const { portfolio, game } = useGameCtx()
  const [txns, setTxns] = useState<Transaction[]>([])
  const [tab, setTab]   = useState<'holdings' | 'history'>('holdings')

  useEffect(() => {
    if (gameId) {
      getTransactions(gameId, 100)
        .then(r => setTxns((r as { transactions: Transaction[] }).transactions || []))
        .catch(() => {})
    }
  }, [gameId])

  if (!portfolio) return <div className="loading-state"><div className="spinner" />Loading portfolio…</div>

  const ret = portfolio.total_return_pct
  const alloc = [
    { name: 'Cash', value: portfolio.cash, pct: portfolio.cash / portfolio.total_equity * 100 },
    ...portfolio.positions.map(p => ({
      name: p.ticker,
      value: p.market_value,
      pct: p.weight_pct,
    })),
  ].filter(x => x.value > 0)

  return (
    <div className="ms-portfolio-page">
      {/* Summary header */}
      <div className="ms-portfolio-header">
        <div className="ms-ph-main">
          <div className="ms-ph-label">Portfolio Value</div>
          <div className="ms-ph-equity">{fmt$(portfolio.total_equity)}</div>
          <div className={`ms-ph-ret ${ret >= 0 ? 'pos' : 'neg'}`}>
            {fmtPct(ret)} since start
          </div>
        </div>
        <div className="ms-ph-stats">
          <div className="ms-ph-stat"><div className="ms-ph-sl">{fmt$(portfolio.cash)}</div><div className="ms-ph-slabel">Cash</div></div>
          <div className="ms-ph-stat"><div className="ms-ph-sl">{fmt$(portfolio.market_value)}</div><div className="ms-ph-slabel">Invested</div></div>
          <div className="ms-ph-stat"><div className="ms-ph-sl">{portfolio.positions.length}</div><div className="ms-ph-slabel">Positions</div></div>
          <div className="ms-ph-stat"><div className="ms-ph-sl">{txns.length}</div><div className="ms-ph-slabel">Trades</div></div>
        </div>
      </div>

      <div className="ms-portfolio-body">
        {/* Left: holdings + history */}
        <div className="ms-portfolio-main">
          <div className="ms-tab-bar">
            <button className={`ms-tab-btn${tab === 'holdings' ? ' active' : ''}`} onClick={() => setTab('holdings')}>Holdings</button>
            <button className={`ms-tab-btn${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>Trade History</button>
          </div>

          {tab === 'holdings' && (
            portfolio.positions.length === 0 ? (
              <div className="ms-ov-empty">No positions. Go to the Trade tab to place your first order.</div>
            ) : (
              <div className="table-scroll">
                <table className="ms-table ms-table-full">
                  <thead>
                    <tr>
                      <th>Ticker</th><th>Shares</th><th>Avg Cost</th>
                      <th>Current</th><th>Mkt Value</th>
                      <th>Gain / Loss</th><th>Return</th><th>Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.positions.map(pos => (
                      <tr key={pos.ticker}>
                        <td>
                          <strong style={{ color: 'var(--blue)', letterSpacing: '0.02em' }}>{pos.ticker}</strong>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-lo)' }}>{pos.name}</div>
                        </td>
                        <td className="num">{pos.shares.toFixed(2)}</td>
                        <td className="num">${pos.avg_cost.toFixed(2)}</td>
                        <td className="num">${pos.curr_price.toFixed(2)}</td>
                        <td className="num">{fmt$(pos.market_value)}</td>
                        <td>
                          <span style={{ color: pos.gain >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-num)', fontWeight: 600 }}>
                            {pos.gain >= 0 ? '+' : '−'}{fmt$(Math.abs(pos.gain))}
                          </span>
                        </td>
                        <td style={{ color: pos.gain_pct >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-num)', fontSize: '0.78rem', fontWeight: 600 }}>
                          {fmtPct(pos.gain_pct)}
                        </td>
                        <td className="num">{pos.weight_pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === 'history' && (
            txns.length === 0 ? (
              <div className="ms-ov-empty">No transactions yet.</div>
            ) : (
              <div className="table-scroll">
                <table className="ms-table ms-table-full">
                  <thead><tr><th>Date</th><th>Ticker</th><th>Side</th><th>Qty</th><th>Fill Price</th><th>Value</th></tr></thead>
                  <tbody>
                    {txns.map(t => (
                      <tr key={t.id}>
                        <td style={{ color: 'var(--text-lo)', fontSize: '0.75rem', fontFamily: 'var(--font-num)' }}>
                          {new Date(t.executed_at).toLocaleDateString()}
                        </td>
                        <td><strong>{t.ticker}</strong></td>
                        <td><span className={`badge ${t.side === 'buy' ? 'badge-new' : 'badge-exit'}`}>{t.side}</span></td>
                        <td className="num">{t.qty.toFixed(2)}</td>
                        <td className="num">${t.fill_price.toFixed(2)}</td>
                        <td className="num">{fmt$(Math.abs(t.total_cost))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>

        {/* Right: allocation chart */}
        {alloc.length > 0 && (
          <div className="ms-portfolio-side">
            <div className="ms-ov-card">
              <div className="ms-ov-card-title">Allocation</div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={alloc}
                    cx="50%" cy="50%"
                    innerRadius={55} outerRadius={85}
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {alloc.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12, borderRadius: 8 }}
                    formatter={(v: number) => [`$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, '']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="ms-alloc-legend">
                {alloc.map((item, i) => (
                  <div key={item.name} className="ms-alloc-row">
                    <span className="ms-alloc-dot" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="ms-alloc-name">{item.name}</span>
                    <span className="ms-alloc-pct">{item.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
