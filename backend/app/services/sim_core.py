"""
SimCore — shared order-matching and portfolio-accounting engine.

Used by BOTH Feature A (Human Trading Simulator) and Feature B (Background
Learning Engine).  One engine, proven correct once.

Cost model (realism_mode=True):
  - 5 bps half-spread  (applied at fill)
  - 3 bps slippage     (applied at fill)
  - $0.005/share commission

Thread-safe: all mutations hold _lock.
Equity history capped at 10 000 points (oldest dropped).
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional

INITIAL_CAPITAL = 100_000.0
HALF_SPREAD_BPS = 5       # basis points
SLIPPAGE_BPS = 3          # basis points
COMMISSION_PER_SHARE = 0.005  # USD
MAX_EQUITY_HISTORY = 10_000

OrderSide = Literal["buy", "sell", "short", "cover"]
OrderType = Literal["market", "limit", "stop"]
OrderStatus = Literal["pending", "filled", "cancelled", "rejected"]


@dataclass
class Order:
    order_id: str
    ticker: str
    side: OrderSide
    order_type: OrderType
    qty: float
    limit_price: Optional[float]
    stop_price: Optional[float]
    status: OrderStatus
    submitted_at: str
    filled_at: Optional[str] = None
    fill_price: Optional[float] = None
    fill_qty: Optional[float] = None
    message: str = ""

    def to_dict(self) -> dict:
        return {
            "order_id": self.order_id,
            "ticker": self.ticker,
            "side": self.side,
            "order_type": self.order_type,
            "qty": self.qty,
            "limit_price": self.limit_price,
            "stop_price": self.stop_price,
            "status": self.status,
            "submitted_at": self.submitted_at,
            "filled_at": self.filled_at,
            "fill_price": self.fill_price,
            "fill_qty": self.fill_qty,
            "message": self.message,
        }


@dataclass
class _Position:
    ticker: str
    qty: float          # positive = long, negative = short
    avg_entry: float    # average entry price (absolute)
    cost_basis: float   # total cash cost of position (incl. commissions)


class SimCore:
    """
    Order-matching, portfolio-accounting, mark-to-market engine.

    Parameters
    ----------
    initial_capital : float
        Starting cash balance (default $100,000).
    realism_mode : bool
        When True, applies cost model to fills (spread + slippage + commission).
        Disable only for unit tests that explicitly check gross P&L.
    """

    def __init__(
        self,
        initial_capital: float = INITIAL_CAPITAL,
        realism_mode: bool = True,
    ) -> None:
        self._initial_capital = initial_capital
        self._realism_mode = realism_mode
        self._lock = threading.Lock()
        self._reset_state()

    # ─── Public API ─────────────────────────────────────────────────────────

    def submit_order(
        self,
        ticker: str,
        side: OrderSide,
        order_type: OrderType,
        qty: float,
        limit_price: Optional[float] = None,
        stop_price: Optional[float] = None,
    ) -> Order:
        """
        Submit a new order.  Returns the Order object.
        Market orders are attempted for immediate fill against the last
        known price.  Limit/stop orders sit in pending queue until
        update_prices() processes them.
        """
        now = datetime.now(timezone.utc).isoformat()
        order = Order(
            order_id=str(uuid.uuid4()),
            ticker=ticker,
            side=side,
            order_type=order_type,
            qty=qty,
            limit_price=limit_price,
            stop_price=stop_price,
            status="pending",
            submitted_at=now,
        )

        with self._lock:
            # Basic validation
            if qty <= 0:
                order.status = "rejected"
                order.message = "qty must be > 0"
                self._orders.append(order)
                return order

            last = self._last_prices.get(ticker)

            if order_type == "market":
                if last is None:
                    # No price yet — queue it; will fill on next tick
                    self._pending_orders.append(order)
                else:
                    self._fill_order(order, last)
            else:
                # Limit / stop — queue for later
                self._pending_orders.append(order)

            self._orders.append(order)

        return order

    def cancel_order(self, order_id: str) -> bool:
        """Cancel a pending order.  Returns True if found and cancelled."""
        with self._lock:
            for o in self._pending_orders:
                if o.order_id == order_id and o.status == "pending":
                    o.status = "cancelled"
                    self._pending_orders.remove(o)
                    return True
        return False

    def update_prices(self, prices: Dict[str, float]) -> None:
        """
        Feed new prices (ticker → price).
        1. Updates last-known prices.
        2. Marks existing positions to market.
        3. Tries to fill pending orders.
        4. Appends an equity snapshot to history.
        """
        with self._lock:
            self._last_prices.update(prices)

            # Attempt fills on pending orders
            still_pending: List[Order] = []
            for order in self._pending_orders:
                filled = self._try_fill_pending(order)
                if not filled:
                    still_pending.append(order)
            self._pending_orders = still_pending

            # Equity snapshot
            equity = self._compute_equity_locked()
            ts = datetime.now(timezone.utc).isoformat()
            self._equity_history.append({"ts": ts, "equity": equity})
            if len(self._equity_history) > MAX_EQUITY_HISTORY:
                self._equity_history = self._equity_history[-MAX_EQUITY_HISTORY:]

    def get_portfolio(self) -> dict:
        """Return a snapshot of the current portfolio state."""
        with self._lock:
            equity = self._compute_equity_locked()
            positions = []
            for ticker, pos in self._positions.items():
                last = self._last_prices.get(ticker, pos.avg_entry)
                if pos.qty > 0:
                    upnl = (last - pos.avg_entry) * pos.qty
                else:
                    # Short: profit when price falls
                    upnl = (pos.avg_entry - last) * abs(pos.qty)
                upnl_pct = upnl / (pos.avg_entry * abs(pos.qty)) if pos.avg_entry != 0 else 0.0
                positions.append({
                    "ticker": ticker,
                    "qty": pos.qty,
                    "avg_entry": round(pos.avg_entry, 4),
                    "current_price": round(last, 4),
                    "unrealized_pnl": round(upnl, 2),
                    "unrealized_pnl_pct": round(upnl_pct, 4),
                    "is_short": pos.qty < 0,
                    "market_value": round(last * abs(pos.qty), 2),
                })
            return {
                "cash": round(self._cash, 2),
                "equity": round(equity, 2),
                "initial_capital": self._initial_capital,
                "unrealized_pnl": round(equity - self._cash - self._realized_pnl, 2),
                "realized_pnl": round(self._realized_pnl, 2),
                "positions": positions,
                "pending_orders": [o.to_dict() for o in self._pending_orders],
                "equity_history": list(self._equity_history),
                "trade_count": self._trade_count,
            }

    def get_orders(self, limit: int = 50) -> List[dict]:
        """Return recent order history (newest first)."""
        with self._lock:
            return [o.to_dict() for o in reversed(self._orders[-limit:])]

    def reset(self) -> None:
        """Reset to $100k cash.  Clears all positions, orders, history."""
        with self._lock:
            self._reset_state()

    # ─── Internal helpers ────────────────────────────────────────────────────

    def _reset_state(self) -> None:
        """Must be called with _lock held (or from __init__)."""
        self._cash: float = self._initial_capital
        self._positions: Dict[str, _Position] = {}
        self._orders: List[Order] = []
        self._pending_orders: List[Order] = []
        self._last_prices: Dict[str, float] = {}
        self._equity_history: List[dict] = []
        self._realized_pnl: float = 0.0
        self._trade_count: int = 0

    def _compute_equity_locked(self) -> float:
        """Compute total equity (cash + market value of all positions).
        Caller must hold _lock."""
        equity = self._cash
        for ticker, pos in self._positions.items():
            last = self._last_prices.get(ticker, pos.avg_entry)
            equity += last * abs(pos.qty) if pos.qty > 0 else 0.0
            if pos.qty < 0:
                # Short: we received proceeds when we shorted; equity impact is
                # the mark-to-market loss/gain on the short exposure.
                # Simplified: equity = cash + sum(mark for longs) - short_exposure_change
                # For UI purposes: short MtM value = avg_entry * |qty| (initial proceeds)
                # minus current mark loss
                short_gain = (pos.avg_entry - last) * abs(pos.qty)
                equity += pos.avg_entry * abs(pos.qty) + short_gain
        return equity

    def _cost_adjusted_price(self, quote: float, side: OrderSide) -> float:
        """Return fill price after applying cost model."""
        if not self._realism_mode:
            return quote
        cost_bps = HALF_SPREAD_BPS + SLIPPAGE_BPS  # 8 bps total
        if side in ("buy", "cover"):
            return quote * (1 + cost_bps / 10_000)
        else:  # sell, short
            return quote * (1 - cost_bps / 10_000)

    def _commission(self, qty: float) -> float:
        if not self._realism_mode:
            return 0.0
        return COMMISSION_PER_SHARE * abs(qty)

    def _fill_order(self, order: Order, quote_price: float) -> None:
        """Execute an order at quote_price.  Mutates order in place.
        Caller must hold _lock."""
        fill_px = self._cost_adjusted_price(quote_price, order.side)
        commission = self._commission(order.qty)
        now = datetime.now(timezone.utc).isoformat()

        ticker = order.ticker
        qty = order.qty
        side = order.side

        if side == "buy":
            total_cost = fill_px * qty + commission
            if self._cash < total_cost:
                order.status = "rejected"
                order.message = f"Insufficient cash (need {total_cost:.2f}, have {self._cash:.2f})"
                return
            self._cash -= total_cost
            if ticker in self._positions and self._positions[ticker].qty > 0:
                pos = self._positions[ticker]
                total_qty = pos.qty + qty
                pos.avg_entry = (pos.avg_entry * pos.qty + fill_px * qty) / total_qty
                pos.qty = total_qty
                pos.cost_basis += total_cost
            else:
                self._positions[ticker] = _Position(
                    ticker=ticker,
                    qty=qty,
                    avg_entry=fill_px,
                    cost_basis=total_cost,
                )

        elif side == "sell":
            if ticker not in self._positions or self._positions[ticker].qty <= 0:
                order.status = "rejected"
                order.message = "No long position to sell"
                return
            pos = self._positions[ticker]
            sell_qty = min(qty, pos.qty)
            proceeds = fill_px * sell_qty - commission
            realized = (fill_px - pos.avg_entry) * sell_qty - commission
            self._cash += proceeds
            self._realized_pnl += realized
            pos.qty -= sell_qty
            if pos.qty <= 1e-9:
                del self._positions[ticker]

        elif side == "short":
            proceeds = fill_px * qty - commission
            self._cash += proceeds
            if ticker in self._positions and self._positions[ticker].qty < 0:
                pos = self._positions[ticker]
                total_qty = abs(pos.qty) + qty
                pos.avg_entry = (pos.avg_entry * abs(pos.qty) + fill_px * qty) / total_qty
                pos.qty = -total_qty
            else:
                self._positions[ticker] = _Position(
                    ticker=ticker,
                    qty=-qty,
                    avg_entry=fill_px,
                    cost_basis=proceeds,
                )

        elif side == "cover":
            if ticker not in self._positions or self._positions[ticker].qty >= 0:
                order.status = "rejected"
                order.message = "No short position to cover"
                return
            pos = self._positions[ticker]
            cover_qty = min(qty, abs(pos.qty))
            cost = fill_px * cover_qty + commission
            realized = (pos.avg_entry - fill_px) * cover_qty - commission
            self._cash -= cost
            self._realized_pnl += realized
            pos.qty += cover_qty  # less negative
            if abs(pos.qty) <= 1e-9:
                del self._positions[ticker]

        order.status = "filled"
        order.filled_at = now
        order.fill_price = round(fill_px, 4)
        order.fill_qty = qty
        self._trade_count += 1

    def _try_fill_pending(self, order: Order) -> bool:
        """
        Attempt to fill a pending limit/stop/market order against the current
        last price.  Returns True if filled (or rejected).
        Caller must hold _lock.
        """
        quote = self._last_prices.get(order.ticker)
        if quote is None:
            return False  # no price yet, stay pending

        side = order.side
        otype = order.order_type

        if otype == "market":
            self._fill_order(order, quote)
            return True

        elif otype == "limit":
            if side in ("buy", "cover") and quote <= order.limit_price:
                self._fill_order(order, min(quote, order.limit_price))
                return True
            elif side in ("sell", "short") and quote >= order.limit_price:
                self._fill_order(order, max(quote, order.limit_price))
                return True

        elif otype == "stop":
            if side in ("sell", "short") and quote <= order.stop_price:
                self._fill_order(order, quote)
                return True
            elif side in ("buy", "cover") and quote >= order.stop_price:
                self._fill_order(order, quote)
                return True

        return False
