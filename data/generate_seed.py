#!/usr/bin/env python3
"""
Generate deterministic seed data for EdgeCheck.
Run: python3 data/generate_seed.py
All data is synthetic and for research/testing purposes only.
"""
import numpy as np
import pandas as pd
from pathlib import Path

RNG = np.random.default_rng(42)

TICKERS = ["SPY", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "BRK-B", "JNJ", "JPM"]

START_PRICES = {
    "SPY": 478.0, "AAPL": 182.0, "MSFT": 335.0, "GOOGL": 144.0,
    "AMZN": 167.0, "META": 338.0, "NVDA": 297.0,
    "BRK-B": 293.0, "JNJ": 170.0, "JPM": 168.0,
}

VOLS = {
    "SPY": 0.008, "AAPL": 0.012, "MSFT": 0.011, "GOOGL": 0.013,
    "AMZN": 0.014, "META": 0.016, "NVDA": 0.018,
    "BRK-B": 0.009, "JNJ": 0.008, "JPM": 0.011,
}

DRIFTS = {
    "SPY": 0.0003, "AAPL": 0.0004, "MSFT": 0.0005, "GOOGL": 0.0003,
    "AMZN": 0.0004, "META": 0.0005, "NVDA": 0.0008,
    "BRK-B": 0.0002, "JNJ": 0.0001, "JPM": 0.0003,
}


def generate_prices() -> pd.DataFrame:
    dates = pd.bdate_range("2022-01-03", "2024-12-31")
    records = []
    for ticker in TICKERS:
        price = START_PRICES[ticker]
        vol = VOLS[ticker]
        drift = DRIFTS[ticker]
        for date in dates:
            r = RNG.normal(drift, vol)
            close = max(price * (1 + r), 1.0)
            high = close * (1 + abs(RNG.normal(0, vol * 0.4)))
            low = close * (1 - abs(RNG.normal(0, vol * 0.4)))
            open_p = price * (1 + RNG.normal(0, vol * 0.3))
            volume = int(RNG.integers(500_000, 15_000_000))
            records.append({
                "date": date.date().isoformat(),
                "ticker": ticker,
                "open": round(float(open_p), 2),
                "high": round(float(max(high, open_p, close)), 2),
                "low": round(float(min(low, open_p, close)), 2),
                "close": round(float(close), 2),
                "volume": volume,
            })
            price = close
    return pd.DataFrame(records)


def generate_holdings() -> pd.DataFrame:
    funds = [
        "Apex Capital Partners",
        "Summit Ridge Investments",
        "Harbor View Asset Management",
        "Meridian Growth Fund",
        "Keystone Value Partners",
    ]
    fund_tickers = {
        "Apex Capital Partners": ["AAPL", "MSFT", "GOOGL", "NVDA", "SPY"],
        "Summit Ridge Investments": ["MSFT", "AMZN", "META", "NVDA", "JPM"],
        "Harbor View Asset Management": ["AAPL", "GOOGL", "JNJ", "JPM", "BRK-B"],
        "Meridian Growth Fund": ["NVDA", "META", "AMZN", "AAPL", "SPY"],
        "Keystone Value Partners": ["BRK-B", "JNJ", "JPM", "MSFT", "SPY"],
    }
    quarters = [
        ("2022Q1", "2022-03-31"), ("2022Q2", "2022-06-30"),
        ("2022Q3", "2022-09-30"), ("2022Q4", "2022-12-31"),
        ("2023Q1", "2023-03-31"), ("2023Q2", "2023-06-30"),
        ("2023Q3", "2023-09-30"), ("2023Q4", "2023-12-31"),
    ]
    records = []
    for fund in funds:
        tickers = fund_tickers[fund]
        base_shares = {t: int(RNG.integers(50_000, 800_000)) for t in tickers}
        for quarter, period in quarters:
            for ticker in tickers:
                drift = float(RNG.normal(1.0, 0.08))
                shares = max(0, int(base_shares[ticker] * drift))
                base_shares[ticker] = shares
                # Value placeholder (will be joined with real prices in backend)
                value_usd = shares * START_PRICES.get(ticker, 100.0)
                records.append({
                    "fund_name": fund,
                    "ticker": ticker,
                    "shares": shares,
                    "value_usd": round(value_usd, 2),
                    "quarter": quarter,
                    "period_of_report": period,
                    "portfolio_pct": 0.0,  # computed in backend
                })
    df = pd.DataFrame(records)
    # Compute portfolio_pct per fund per quarter
    totals = df.groupby(["fund_name", "quarter"])["value_usd"].sum().reset_index()
    totals.columns = ["fund_name", "quarter", "total_value"]
    df = df.merge(totals, on=["fund_name", "quarter"])
    df["portfolio_pct"] = (df["value_usd"] / df["total_value"] * 100).round(2)
    df = df.drop(columns=["total_value"])
    return df


def generate_insider_trades() -> pd.DataFrame:
    insiders = [
        ("John Smith", "AAPL", "CEO"),
        ("Jane Doe", "MSFT", "CFO"),
        ("Robert Johnson", "NVDA", "Director"),
        ("Mary Williams", "JPM", "EVP"),
        ("David Brown", "META", "COO"),
        ("Sarah Davis", "GOOGL", "CTO"),
        ("Michael Chen", "AMZN", "VP"),
    ]
    records = []
    dates = pd.bdate_range("2022-01-03", "2024-12-31")
    for insider_name, ticker, title in insiders:
        n_trades = int(RNG.integers(8, 30))
        idx = RNG.choice(len(dates), n_trades, replace=False)
        trade_dates = sorted(dates[idx])
        for date in trade_dates:
            tx_type = str(RNG.choice(["Purchase", "Sale"], p=[0.35, 0.65]))
            shares = int(RNG.integers(500, 50_000))
            price = round(float(RNG.uniform(50, 500)), 2)
            records.append({
                "insider_name": insider_name,
                "title": title,
                "company": ticker,
                "ticker": ticker,
                "transaction_type": tx_type,
                "shares": shares,
                "price": price,
                "date": date.date().isoformat(),
            })
    return pd.DataFrame(records)


def generate_congressional_trades() -> pd.DataFrame:
    politicians = [
        ("Rep. Alex Morgan", "House"),
        ("Sen. Casey Rivera", "Senate"),
        ("Rep. Jordan Lee", "House"),
        ("Sen. Taylor Kim", "Senate"),
        ("Rep. Sam Bradley", "House"),
    ]
    tickers_pool = ["AAPL", "MSFT", "NVDA", "AMZN", "SPY", "META", "GOOGL", "JPM"]
    amount_ranges = [
        "$1,001 - $15,000", "$15,001 - $50,000",
        "$50,001 - $100,000", "$100,001 - $250,000",
    ]
    records = []
    dates = pd.bdate_range("2022-01-03", "2024-12-31")
    for politician, chamber in politicians:
        n_trades = int(RNG.integers(10, 40))
        idx = RNG.choice(len(dates), n_trades, replace=False)
        trade_dates = sorted(dates[idx])
        for date in trade_dates:
            ticker = str(RNG.choice(tickers_pool))
            tx_type = str(RNG.choice(["Purchase", "Sale"]))
            amount_range = str(RNG.choice(amount_ranges))
            disclosure_days = int(RNG.integers(30, 65))
            disclosure_date = (pd.Timestamp(date) + pd.Timedelta(days=disclosure_days)).date()
            records.append({
                "politician": politician,
                "chamber": chamber,
                "ticker": ticker,
                "transaction_type": tx_type,
                "amount_range": amount_range,
                "trade_date": date.date().isoformat(),
                "disclosure_date": str(disclosure_date),
            })
    return pd.DataFrame(records)


if __name__ == "__main__":
    data_dir = Path(__file__).parent
    print("Generating EdgeCheck seed data (deterministic, synthetic)...")

    print("  prices.csv ...", end=" ", flush=True)
    prices_df = generate_prices()
    prices_df.to_csv(data_dir / "prices.csv", index=False)
    print(f"{len(prices_df)} rows")

    print("  holdings.csv ...", end=" ", flush=True)
    holdings_df = generate_holdings()
    holdings_df.to_csv(data_dir / "holdings.csv", index=False)
    print(f"{len(holdings_df)} rows")

    print("  insider_trades.csv ...", end=" ", flush=True)
    insider_df = generate_insider_trades()
    insider_df.to_csv(data_dir / "insider_trades.csv", index=False)
    print(f"{len(insider_df)} rows")

    print("  congressional_trades.csv ...", end=" ", flush=True)
    cong_df = generate_congressional_trades()
    cong_df.to_csv(data_dir / "congressional_trades.csv", index=False)
    print(f"{len(cong_df)} rows")

    print("Done. All data is synthetic — for research purposes only.")
