// Types for the Market Simulator feature

export interface Game {
  id: string
  name: string
  description: string
  creator: string
  is_public: boolean
  starting_cash: number
  start_date: string
  end_date: string
  status: 'pending' | 'active' | 'ended'
  allow_short: boolean
  allow_margin: boolean
  allow_day_trading: boolean
  commission: number
  max_position_pct: number
  rank_by: 'return_pct' | 'total_value'
  portfolio_public: boolean
  allowed_assets: string[]
  participant_count: number
  created_at: string
  is_participant?: boolean
  my_cash?: number
}

export interface Quote {
  ticker: string
  name: string
  price: number
  prev_close: number
  change: number
  change_pct: number
  volume: number
  market_cap: number | null
  currency: string
  data_source: string
  as_of: string
}

export interface SearchResult {
  ticker: string
  name: string
  type: 'stock' | 'etf' | 'crypto' | 'other'
  exchange: string
}

export interface HistoricalBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Position {
  ticker: string
  name: string
  shares: number
  avg_cost: number
  curr_price: number
  market_value: number
  gain: number
  gain_pct: number
  weight_pct: number
}

export interface Portfolio {
  game_id: string
  username: string
  cash: number
  market_value: number
  total_equity: number
  starting_cash: number
  total_return_pct: number
  positions: Position[]
  data_source: string
}

export interface Transaction {
  id: number
  ticker: string
  side: 'buy' | 'sell'
  order_type: 'market' | 'limit'
  qty: number
  fill_price: number
  commission: number
  total_cost: number
  executed_at: string
}

export interface LeaderboardEntry {
  rank: number
  username: string
  total_equity: number
  return_pct: number
  cash: number
  n_trades: number
  is_me: boolean
}

export interface WatchlistItem {
  ticker: string
  name: string
  price: number | null
  change_pct: number | null
  added_at: string
}
