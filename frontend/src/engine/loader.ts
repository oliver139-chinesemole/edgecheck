import type { PriceBar, Holding, InsiderTrade, CongressionalTrade } from './types'

const base = import.meta.env.BASE_URL

function parseCSV<T extends Record<string, string>>(text: string): T[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const vals = line.split(',')
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()])) as T
  })
}

async function fetchCSV(name: string): Promise<string> {
  const r = await fetch(`${base}data/${name}`)
  if (!r.ok) throw new Error(`Failed to load ${name}: ${r.status}`)
  return r.text()
}

export async function loadPrices(): Promise<PriceBar[]> {
  const text = await fetchCSV('prices.csv')
  return parseCSV<Record<string, string>>(text).map(r => ({
    date: r.date,
    ticker: r.ticker,
    open: parseFloat(r.open),
    high: parseFloat(r.high),
    low: parseFloat(r.low),
    close: parseFloat(r.close),
    volume: parseInt(r.volume),
  }))
}

export async function loadHoldings(): Promise<Holding[]> {
  const text = await fetchCSV('holdings.csv')
  return parseCSV<Record<string, string>>(text).map(r => ({
    fund_name: r.fund_name,
    ticker: r.ticker,
    shares: parseInt(r.shares),
    value_usd: parseFloat(r.value_usd),
    quarter: r.quarter,
    period_of_report: r.period_of_report,
    portfolio_pct: parseFloat(r.portfolio_pct),
  }))
}

export async function loadInsiderTrades(): Promise<InsiderTrade[]> {
  const text = await fetchCSV('insider_trades.csv')
  return parseCSV<Record<string, string>>(text).map(r => ({
    insider_name: r.insider_name,
    title: r.title,
    ticker: r.ticker,
    transaction_type: r.transaction_type,
    shares: parseInt(r.shares),
    price: parseFloat(r.price),
    date: r.date,
  }))
}

export async function loadCongressionalTrades(): Promise<CongressionalTrade[]> {
  const text = await fetchCSV('congressional_trades.csv')
  return parseCSV<Record<string, string>>(text).map(r => ({
    politician: r.politician,
    chamber: r.chamber,
    ticker: r.ticker,
    transaction_type: r.transaction_type,
    amount_range: r.amount_range,
    trade_date: r.trade_date,
    disclosure_date: r.disclosure_date,
  }))
}

/** Group price bars by ticker for fast lookup */
export function groupByTicker(bars: PriceBar[]): Map<string, PriceBar[]> {
  const map = new Map<string, PriceBar[]>()
  for (const bar of bars) {
    const arr = map.get(bar.ticker) ?? []
    arr.push(bar)
    map.set(bar.ticker, arr)
  }
  // Sort each ticker's bars by date
  for (const [, arr] of map) arr.sort((a, b) => a.date.localeCompare(b.date))
  return map
}
