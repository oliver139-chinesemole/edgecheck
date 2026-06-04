export interface PriceBar {
  date: string
  ticker: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Holding {
  fund_name: string
  ticker: string
  shares: number
  value_usd: number
  quarter: string
  period_of_report: string
  portfolio_pct: number
}

export interface InsiderTrade {
  insider_name: string
  title: string
  ticker: string
  transaction_type: string
  shares: number
  price: number
  date: string
}

export interface CongressionalTrade {
  politician: string
  chamber: string
  ticker: string
  transaction_type: string
  amount_range: string
  trade_date: string
  disclosure_date: string
}

export interface ConsensusSignal {
  ticker: string
  signal_type: 'new_buy' | 'add' | 'trim' | 'exit' | 'consensus_hold'
  fund_count: number
  avg_weight_pct: number
  quarter: string
  conviction_score: number
  description: string
}

export interface HoldingWithQoQ extends Holding {
  qoq_change: 'new_buy' | 'add' | 'trim' | 'exit' | 'unchanged'
  shares_delta: number
}

export interface EquityPoint {
  date: string
  strategy: number
  benchmark: number
}

export interface BacktestMetrics {
  sharpe: number
  sortino: number
  maxDrawdown: number
  cagr: number
  winRate: number
  totalTrades: number
  benchmarkSharpe: number
  benchmarkCagr: number
}

export interface BacktestResult {
  equityCurve: EquityPoint[]
  metrics: BacktestMetrics
  strategy: string
}

export interface TradeRecord {
  date: string
  ticker: string
  action: 'buy' | 'sell'
  price: number
  shares: number
  pnl?: number
}

export interface SimResult {
  equityCurve: EquityPoint[]
  trades: TradeRecord[]
  finalValue: number
  metrics: BacktestMetrics
  divergence: number
}

export interface FeatureRow {
  date: string
  ticker: string
  ret_1d: number
  ret_5d: number
  ret_20d: number
  close_to_ma20: number
  close_to_ma50: number
  rsi: number
  vol_20d: number
  pct_from_52w_high: number
  signal: 1 | 0 | -1
}
