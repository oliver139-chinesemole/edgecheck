from fastapi import APIRouter, Query
from typing import List, Optional
import pandas as pd

from app.models.schemas import (
    Holding, ConsensusSignal, InsiderTrade, CongressionalTrade, SmartMoneyResponse
)
from app.services.seed_loader import (
    load_holdings, load_insider_trades, load_congressional_trades, seed_data_present
)

router = APIRouter()

DATA_LAG_NOTE = (
    "13F filings are due 45 days after quarter-end and reflect positions held at quarter close. "
    "The data you see is at minimum 45 days old. Do not treat it as a current position indicator."
)


def _compute_qoq(holdings: pd.DataFrame) -> pd.DataFrame:
    """Add quarter-over-quarter change labels to holdings."""
    quarters = sorted(holdings["quarter"].unique())
    result_rows = []

    for i, quarter in enumerate(quarters):
        curr = holdings[holdings["quarter"] == quarter].copy()
        if i == 0:
            curr["qoq_change"] = "new_buy"
            curr["shares_delta"] = curr["shares"]
            result_rows.append(curr)
            continue

        prev_quarter = quarters[i - 1]
        prev = holdings[holdings["quarter"] == prev_quarter]

        for _, row in curr.iterrows():
            key = (row["fund_name"], row["ticker"])
            prev_row = prev[(prev["fund_name"] == row["fund_name"]) & (prev["ticker"] == row["ticker"])]

            if len(prev_row) == 0:
                change = "new_buy"
                delta = int(row["shares"])
            elif row["shares"] == 0:
                change = "exit"
                delta = -int(prev_row.iloc[0]["shares"])
            elif row["shares"] > prev_row.iloc[0]["shares"] * 1.05:
                change = "add"
                delta = int(row["shares"] - prev_row.iloc[0]["shares"])
            elif row["shares"] < prev_row.iloc[0]["shares"] * 0.95:
                change = "trim"
                delta = int(row["shares"] - prev_row.iloc[0]["shares"])
            else:
                change = "unchanged"
                delta = 0

            row = row.copy()
            row["qoq_change"] = change
            row["shares_delta"] = delta
            result_rows.append(pd.DataFrame([row]))

    if not result_rows:
        return holdings.copy()
    return pd.concat(result_rows, ignore_index=True)


def _compute_consensus_signals(holdings: pd.DataFrame) -> List[ConsensusSignal]:
    """
    Identify high-conviction signals: tickers newly added by multiple funds,
    or tickers with high aggregate weight across funds.
    """
    signals = []
    quarters = sorted(holdings["quarter"].unique())
    if not quarters:
        return signals

    latest_q = quarters[-1]
    prev_q = quarters[-2] if len(quarters) >= 2 else None

    latest = holdings[holdings["quarter"] == latest_q]
    prev = holdings[holdings["quarter"] == prev_q] if prev_q else pd.DataFrame()

    for ticker, group in latest.groupby("ticker"):
        fund_count = int(group["fund_name"].nunique())
        avg_weight = float(group["portfolio_pct"].mean())

        # Consensus hold (high conviction: 3+ funds, >4% avg weight)
        if fund_count >= 3 and avg_weight > 4.0:
            # Check if it's a new consensus this quarter
            if not prev.empty:
                prev_count = int(prev[prev["ticker"] == ticker]["fund_name"].nunique())
                if prev_count < 3 and fund_count >= 3:
                    signal_type = "new_buy"
                    desc = f"{fund_count} funds initiated or added positions this quarter (new consensus)"
                else:
                    signal_type = "consensus_hold"
                    desc = f"{fund_count} funds hold this position (avg {avg_weight:.1f}% of portfolio)"
            else:
                signal_type = "new_buy"
                desc = f"{fund_count} funds hold this position"

            conviction = min(1.0, (fund_count / 5) * (avg_weight / 10))
            signals.append(ConsensusSignal(
                ticker=str(ticker),
                signal_type=signal_type,
                fund_count=fund_count,
                avg_weight_pct=round(avg_weight, 2),
                quarter=latest_q,
                conviction_score=round(conviction, 3),
                description=desc,
            ))

    # Sort by conviction descending
    signals.sort(key=lambda s: s.conviction_score, reverse=True)
    return signals[:10]  # top 10 signals


@router.get("/holdings", response_model=SmartMoneyResponse)
def get_smart_money(
    quarter: Optional[str] = Query(None, description="Filter to specific quarter e.g. 2023Q4"),
    fund: Optional[str] = Query(None, description="Filter by fund name"),
    limit: int = Query(200, ge=1, le=1000),
) -> SmartMoneyResponse:
    holdings_df = load_holdings()
    insider_df = load_insider_trades()
    cong_df = load_congressional_trades()
    using_sample = not seed_data_present()

    # Add QoQ changes
    holdings_with_qoq = _compute_qoq(holdings_df)
    signals = _compute_consensus_signals(holdings_df)

    # Apply filters
    display = holdings_with_qoq.copy()
    if quarter:
        display = display[display["quarter"] == quarter]
    if fund:
        display = display[display["fund_name"].str.contains(fund, case=False, na=False)]

    # Most recent quarter by default
    if not quarter and not display.empty:
        latest = sorted(display["quarter"].unique())[-1]
        display = display[display["quarter"] == latest]

    display = display.head(limit)

    holdings_out = [
        Holding(
            fund_name=str(r.fund_name),
            ticker=str(r.ticker),
            shares=int(r.shares),
            value_usd=round(float(r.value_usd), 2),
            quarter=str(r.quarter),
            period_of_report=str(r.period_of_report),
            portfolio_pct=round(float(r.portfolio_pct), 2),
            qoq_change=str(r.qoq_change) if hasattr(r, "qoq_change") else None,
            shares_delta=int(r.shares_delta) if hasattr(r, "shares_delta") else 0,
        )
        for r in display.itertuples()
    ]

    # Insider trades (latest 50)
    insider_out = []
    if not insider_df.empty:
        for r in insider_df.head(50).itertuples():
            insider_out.append(InsiderTrade(
                insider_name=str(r.insider_name),
                title=str(r.title),
                ticker=str(r.ticker),
                transaction_type=str(r.transaction_type),
                shares=int(r.shares),
                price=float(r.price),
                date=str(r.date.date() if hasattr(r.date, "date") else r.date),
            ))

    # Congressional trades (latest 50)
    cong_out = []
    if not cong_df.empty:
        for r in cong_df.head(50).itertuples():
            cong_out.append(CongressionalTrade(
                politician=str(r.politician),
                chamber=str(r.chamber),
                ticker=str(r.ticker),
                transaction_type=str(r.transaction_type),
                amount_range=str(r.amount_range),
                trade_date=str(r.trade_date.date() if hasattr(r.trade_date, "date") else r.trade_date),
                disclosure_date=str(r.disclosure_date.date() if hasattr(r.disclosure_date, "date") else r.disclosure_date),
            ))

    latest_q = sorted(holdings_df["quarter"].unique())[-1] if not holdings_df.empty else "N/A"

    return SmartMoneyResponse(
        holdings=holdings_out,
        signals=signals,
        insider_trades=insider_out,
        congressional_trades=cong_out,
        latest_quarter=latest_q,
        using_sample_data=using_sample,
        data_lag_note=DATA_LAG_NOTE,
    )
