/**
 * Browser-side trading simulator core.
 * Mirrors backend/app/services/sim_core.py — same cost model, same accounting.
 * Used by the Human Simulator tab so it works with zero backend.
 */

// ── Cost model (matches backend) ────────────────────────────────────────────
const HALF_SPREAD_BPS = 5
const SLIPPAGE_BPS = 3
const COMMISSION_PER_SHARE = 0.005

export type OrderSide = 'buy' | 'sell' | 'short_sell' | 'buy_to_cover'
export type OrderType = 'market' | 'limit' | 'stop'
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'rejected'

export interface Order {
  id: string
  ticker: string
  side: OrderSide
  orderType: OrderType
  qty: number
  limitPrice?: number
  stopPrice?: number
  status: OrderStatus
  createdAt: string
  filledAt?: string
  filledQty: number
  avgFillPrice?: number
  rejectReason?: string
}

export interface Position {
  ticker: string
  qty: number          // negative = short
  avgCost: number
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  isShort: boolean
}

export interface Portfolio {
  cash: number
  initialCapital: number
  totalEquity: number
  unrealizedPnl: number
  realizedPnl: number
  totalPnl: number
  totalReturnPct: number
  buyingPower: number
  positions: Position[]
}

export interface EquityPoint {
  date: string
  strategy: number
  benchmark: number
}

export interface Fill {
  orderId: string
  ticker: string
  side: OrderSide
  qty: number
  fillPrice: number
  timestamp: string
  commission: number
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

function now(): string {
  return new Date().toISOString()
}

function fillPrice(quotePrice: number, side: OrderSide, realismMode: boolean): number {
  const spread = quotePrice * HALF_SPREAD_BPS / 10000
  const slip   = quotePrice * SLIPPAGE_BPS  / 10000
  const adj    = realismMode ? spread + slip : 0
  return side === 'buy' || side === 'buy_to_cover'
    ? quotePrice + adj
    : quotePrice - adj
}

export class SimCore {
  initialCapital: number
  cash: number
  realismMode: boolean
  sessionId: string

  private positions = new Map<string, { qty: number; avgCost: number }>()
  orders: Order[] = []
  fills: Fill[] = []
  private realizedPnl = 0
  currentPrices: Record<string, number> = {}
  equityHistory: EquityPoint[] = []
  private spyStart: number | null = null

  constructor(initialCapital = 100_000, realismMode = false) {
    this.initialCapital = initialCapital
    this.cash = initialCapital
    this.realismMode = realismMode
    this.sessionId = uid()
  }

  updatePrices(prices: Record<string, number>, dateLabel?: string) {
    Object.assign(this.currentPrices, prices)
    if (prices.SPY && this.spyStart === null) this.spyStart = prices.SPY

    this.tryFillOrders()

    const eq = this.computeEquity()
    const benchmark = this.spyStart
      ? this.initialCapital * (prices.SPY ?? this.spyStart) / this.spyStart
      : this.initialCapital

    this.equityHistory.push({ date: dateLabel ?? now(), strategy: eq, benchmark })
    if (this.equityHistory.length > 5000) this.equityHistory.shift()
  }

  submitOrder(
    ticker: string,
    side: OrderSide,
    orderType: OrderType,
    qty: number,
    limitPrice?: number,
    stopPrice?: number,
  ): Order {
    ticker = ticker.toUpperCase()
    const order: Order = {
      id: uid(), ticker, side, orderType, qty,
      limitPrice, stopPrice,
      status: 'pending',
      createdAt: now(),
      filledQty: 0,
    }

    const err = this.validate(order)
    if (err) { order.status = 'rejected'; order.rejectReason = err; this.orders.push(order); return order }

    this.orders.push(order)
    if (orderType === 'market' && ticker in this.currentPrices) {
      this.executeOrder(order, this.currentPrices[ticker])
    }
    return order
  }

  cancelOrder(id: string): boolean {
    const o = this.orders.find(o => o.id === id && o.status === 'pending')
    if (!o) return false
    o.status = 'cancelled'
    return true
  }

  reset() {
    this.cash = this.initialCapital
    this.positions.clear()
    this.orders = []
    this.fills = []
    this.realizedPnl = 0
    this.currentPrices = {}
    this.equityHistory = []
    this.spyStart = null
    this.sessionId = uid()
  }

  getPortfolio(): Portfolio {
    const positions: Position[] = []
    for (const [ticker, pos] of this.positions) {
      const px = this.currentPrices[ticker] ?? pos.avgCost
      const isShort = pos.qty < 0
      const mv = pos.qty * px
      const upnl = isShort
        ? (pos.avgCost - px) * Math.abs(pos.qty)
        : (px - pos.avgCost) * pos.qty
      const pct = pos.avgCost > 0 ? upnl / (Math.abs(pos.qty) * pos.avgCost) : 0
      positions.push({ ticker, qty: pos.qty, avgCost: pos.avgCost, currentPrice: px, marketValue: mv, unrealizedPnl: upnl, unrealizedPnlPct: pct * 100, isShort })
    }

    const unrealized = positions.reduce((s, p) => s + p.unrealizedPnl, 0)
    const equity = this.computeEquity()

    return {
      cash: this.cash,
      initialCapital: this.initialCapital,
      totalEquity: equity,
      unrealizedPnl: unrealized,
      realizedPnl: this.realizedPnl,
      totalPnl: unrealized + this.realizedPnl,
      totalReturnPct: (equity / this.initialCapital - 1) * 100,
      buyingPower: this.cash,
      positions,
    }
  }

  // ── private ────────────────────────────────────────────────────────────────

  private computeEquity(): number {
    let total = this.cash
    for (const [ticker, pos] of this.positions) {
      const px = this.currentPrices[ticker] ?? pos.avgCost
      total += pos.qty * px
      if (pos.qty < 0) {
        // Short: cash includes proceeds; add back cost basis adjustment
        total -= pos.qty * pos.avgCost  // subtracting a negative = adding
      }
    }
    return total
  }

  private validate(o: Order): string | null {
    if (o.qty <= 0) return 'Quantity must be positive'
    const px = this.currentPrices[o.ticker] ?? 0
    if (o.side === 'buy' || o.side === 'buy_to_cover') {
      const est = o.qty * (o.limitPrice ?? px) * 1.02
      if (est > this.cash) return `Insufficient cash (need ~$${est.toFixed(0)}, have $${this.cash.toFixed(0)})`
    }
    if (o.side === 'sell') {
      const owned = this.positions.get(o.ticker)?.qty ?? 0
      if (owned < o.qty) return `Insufficient shares (own ${owned.toFixed(2)}, selling ${o.qty})`
    }
    return null
  }

  private tryFillOrders() {
    for (const o of this.orders) {
      if (o.status !== 'pending') continue
      const px = this.currentPrices[o.ticker]
      if (px === undefined) continue

      let fill = false
      if (o.orderType === 'market') {
        fill = true
      } else if (o.orderType === 'limit') {
        fill = (o.side === 'buy' || o.side === 'buy_to_cover')
          ? px <= (o.limitPrice ?? Infinity)
          : px >= (o.limitPrice ?? 0)
      } else if (o.orderType === 'stop') {
        fill = (o.side === 'sell' || o.side === 'short_sell')
          ? px <= (o.stopPrice ?? 0)
          : px >= (o.stopPrice ?? Infinity)
      }

      if (fill) this.executeOrder(o, fillPrice(px, o.side, this.realismMode))
    }
  }

  private executeOrder(o: Order, fp: number) {
    const qty = o.qty - o.filledQty
    if (qty <= 0) return
    const commission = this.realismMode ? qty * COMMISSION_PER_SHARE : 0

    if (o.side === 'buy') {
      this.cash -= qty * fp + commission
      const prev = this.positions.get(o.ticker) ?? { qty: 0, avgCost: 0 }
      const newQty = prev.qty + qty
      const newAvg = newQty > 0 ? (prev.qty * prev.avgCost + qty * fp) / newQty : fp
      this.positions.set(o.ticker, { qty: newQty, avgCost: newAvg })

    } else if (o.side === 'sell') {
      const prev = this.positions.get(o.ticker)!
      this.cash += qty * fp - commission
      this.realizedPnl += (fp - prev.avgCost) * qty
      const newQty = prev.qty - qty
      newQty < 0.001 ? this.positions.delete(o.ticker) : this.positions.set(o.ticker, { qty: newQty, avgCost: prev.avgCost })

    } else if (o.side === 'short_sell') {
      this.cash += qty * fp - commission
      const prev = this.positions.get(o.ticker) ?? { qty: 0, avgCost: fp }
      this.positions.set(o.ticker, { qty: prev.qty - qty, avgCost: fp })

    } else if (o.side === 'buy_to_cover') {
      const prev = this.positions.get(o.ticker)!
      this.cash -= qty * fp + commission
      this.realizedPnl += (prev.avgCost - fp) * qty
      const newQty = prev.qty + qty
      newQty >= -0.001 ? this.positions.delete(o.ticker) : this.positions.set(o.ticker, { qty: newQty, avgCost: prev.avgCost })
    }

    this.fills.push({ orderId: o.id, ticker: o.ticker, side: o.side, qty, fillPrice: fp, timestamp: now(), commission })
    o.filledQty += qty
    o.status = 'filled'
    o.avgFillPrice = fp
    o.filledAt = now()
  }
}
