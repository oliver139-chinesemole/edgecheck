import type { Holding, HoldingWithQoQ, ConsensusSignal } from './types'

export function addQoQ(holdings: Holding[]): HoldingWithQoQ[] {
  const quarters = [...new Set(holdings.map(h => h.quarter))].sort()
  const result: HoldingWithQoQ[] = []

  for (let qi = 0; qi < quarters.length; qi++) {
    const q = quarters[qi]
    const curr = holdings.filter(h => h.quarter === q)
    const prev = qi > 0 ? holdings.filter(h => h.quarter === quarters[qi - 1]) : []

    for (const h of curr) {
      const prevRow = prev.find(p => p.fund_name === h.fund_name && p.ticker === h.ticker)
      let qoq: HoldingWithQoQ['qoq_change'] = 'unchanged'
      let delta = 0

      if (!prevRow) {
        qoq = 'new_buy'; delta = h.shares
      } else if (h.shares === 0) {
        qoq = 'exit'; delta = -prevRow.shares
      } else if (h.shares > prevRow.shares * 1.05) {
        qoq = 'add'; delta = h.shares - prevRow.shares
      } else if (h.shares < prevRow.shares * 0.95) {
        qoq = 'trim'; delta = h.shares - prevRow.shares
      }

      result.push({ ...h, qoq_change: qoq, shares_delta: delta })
    }
  }
  return result
}

export function computeSignals(holdings: Holding[]): ConsensusSignal[] {
  const quarters = [...new Set(holdings.map(h => h.quarter))].sort()
  if (quarters.length === 0) return []

  const latestQ = quarters[quarters.length - 1]
  const prevQ = quarters.length >= 2 ? quarters[quarters.length - 2] : null

  const latest = holdings.filter(h => h.quarter === latestQ)
  const prev = prevQ ? holdings.filter(h => h.quarter === prevQ) : []

  const signals: ConsensusSignal[] = []

  const byTicker = new Map<string, Holding[]>()
  for (const h of latest) {
    const arr = byTicker.get(h.ticker) ?? []
    arr.push(h)
    byTicker.set(h.ticker, arr)
  }

  for (const [ticker, rows] of byTicker) {
    const fundCount = new Set(rows.map(r => r.fund_name)).size
    const avgWeight = rows.reduce((s, r) => s + r.portfolio_pct, 0) / rows.length

    if (fundCount < 2 || avgWeight < 2) continue

    const prevCount = prev.filter(h => h.ticker === ticker).length
    let signalType: ConsensusSignal['signal_type'] = 'consensus_hold'
    let desc = `${fundCount} funds hold this position (avg ${avgWeight.toFixed(1)}% of portfolio)`

    if (prevCount === 0 && fundCount >= 2) {
      signalType = 'new_buy'
      desc = `${fundCount} funds opened new positions this quarter`
    } else if (fundCount > prevCount + 1) {
      signalType = 'add'
      desc = `${fundCount} funds hold — up from ${prevCount} last quarter`
    } else if (fundCount < prevCount - 1) {
      signalType = 'trim'
      desc = `Fund count dropped from ${prevCount} to ${fundCount} — managers trimming`
    }

    const conviction = Math.min(1, (fundCount / 5) * 0.6 + (avgWeight / 15) * 0.4)

    signals.push({
      ticker,
      signal_type: signalType,
      fund_count: fundCount,
      avg_weight_pct: +avgWeight.toFixed(2),
      quarter: latestQ,
      conviction_score: +conviction.toFixed(3),
      description: desc,
    })
  }

  return signals.sort((a, b) => b.conviction_score - a.conviction_score).slice(0, 10)
}
