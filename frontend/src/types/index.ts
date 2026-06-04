// Canonical TypeScript types matching the Pydantic schemas in backend/app/models/schemas.py

export interface Holding {
  fund_name: string
  ticker: string
  shares: number
  value_usd: number
  quarter: string
  period_of_report: string
  portfolio_pct: number
  qoq_change?: string
  shares_delta: number
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
  data_lag_days: number
}

export interface SmartMoneyResponse {
  holdings: Holding[]
  signals: ConsensusSignal[]
  insider_trades: InsiderTrade[]
  congressional_trades: CongressionalTrade[]
  latest_quarter: string
  using_sample_data: boolean
  data_lag_note: string
}

export interface EquityPoint {
  date: string
  strategy_value: number
  benchmark_value: number
}

export interface BacktestConfig {
  strategy: 'selective_clone' | 'ml_classifier'
  start_date: string
  end_date: string
  initial_capital: number
  pt_barrier: number
  sl_barrier: number
  t1_bars: number
  tickers: string[]
}

export interface ModelCard {
  model_type: string
  training_window_start: string
  training_window_end: string
  features: string[]
  n_train_samples: number
  train_accuracy: number
  cv_accuracy: number
  frozen_at: string
  artifact_path: string
  config: BacktestConfig
}

export interface BacktestResult {
  equity_curve: EquityPoint[]
  sharpe_ratio: number
  sortino_ratio: number
  max_drawdown: number
  win_rate: number
  cagr: number
  total_trades: number
  benchmark_sharpe: number
  benchmark_cagr: number
  model_card?: ModelCard
  strategy: string
  using_sample_data: boolean
  no_edge_note: string
}

export interface Position {
  ticker: string
  shares: number
  entry_price: number
  current_price: number
  unrealized_pnl: number
  unrealized_pnl_pct: number
  is_short: boolean
}

export interface SimState {
  status: 'running' | 'stopped' | 'error' | 'no_model'
  equity_curve: EquityPoint[]
  current_positions: Position[]
  portfolio_value: number
  realized_return_pct: number
  benchmark_return_pct: number
  divergence_pct: number
  sharpe_ratio: number
  max_drawdown: number
  trade_count: number
  data_source: 'alpaca' | 'seed'
  model_frozen: boolean
  model_card?: ModelCard
  using_sample_data: boolean
  last_updated: string
  divergence_warning: boolean
  message: string
}

export interface ChallengerResult {
  model_id: string
  model_type: string
  trained_at: string
  oos_sharpe: number
  oos_cagr: number
  oos_max_drawdown: number
  champion_sharpe: number
  promoted: boolean
  promotion_reason?: string
  notes: string
}

export interface ImprovementLogResponse {
  champion?: ModelCard
  challengers: ChallengerResult[]
  holdout_start: string
  holdout_end: string
  holdout_note: string
  multiple_testing_note: string
  retrain_log: Record<string, unknown>[]
}

export interface HealthResponse {
  status: string
  version: string
  has_alpaca: boolean
  has_fmp: boolean
  model_ready: boolean
  seed_data_present: boolean
  db_initialized: boolean
}
