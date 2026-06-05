"""
Market data service — abstracts yfinance behind a clean interface.
Current implementation: yfinance (15-min delayed for US equities, free, no key).
Swap provider by replacing _provider in get_provider().

Data source label shown in all API responses so the UI can be honest.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── In-memory cache (avoids hammering yfinance) ───────────────────────────
_quote_cache: Dict[str, Tuple[float, "Quote"]] = {}
_info_cache:  Dict[str, Tuple[float, dict]]    = {}
_QUOTE_TTL  = 60    # seconds — quotes refresh every minute
_INFO_TTL   = 3600  # seconds — company info valid for 1 hour

# ── Data classes ─────────────────────────────────────────────────────────


@dataclass
class Quote:
    ticker:     str
    name:       str
    price:      float
    prev_close: float
    change:     float
    change_pct: float
    volume:     int
    market_cap: Optional[float]
    currency:   str
    data_source: str  # "delayed_15min" | "realtime" | "mock"
    as_of:      str   # ISO timestamp


@dataclass
class SearchResult:
    ticker:   str
    name:     str
    type:     str      # "stock" | "etf" | "crypto" | "other"
    exchange: str


@dataclass
class HistoricalBar:
    date:   str
    open:   float
    high:   float
    low:    float
    close:  float
    volume: int


# ── Common popular tickers for fallback search ────────────────────────────

_POPULAR: List[SearchResult] = [
    SearchResult("SPY",  "SPDR S&P 500 ETF",          "etf",   "NYSE Arca"),
    SearchResult("AAPL", "Apple Inc.",                 "stock", "NASDAQ"),
    SearchResult("MSFT", "Microsoft Corporation",      "stock", "NASDAQ"),
    SearchResult("NVDA", "NVIDIA Corporation",         "stock", "NASDAQ"),
    SearchResult("AMZN", "Amazon.com Inc.",            "stock", "NASDAQ"),
    SearchResult("GOOGL","Alphabet Inc.",              "stock", "NASDAQ"),
    SearchResult("META", "Meta Platforms Inc.",        "stock", "NASDAQ"),
    SearchResult("TSLA", "Tesla Inc.",                 "stock", "NASDAQ"),
    SearchResult("BRK-B","Berkshire Hathaway Inc.",    "stock", "NYSE"),
    SearchResult("JPM",  "JPMorgan Chase & Co.",       "stock", "NYSE"),
    SearchResult("JNJ",  "Johnson & Johnson",          "stock", "NYSE"),
    SearchResult("V",    "Visa Inc.",                  "stock", "NYSE"),
    SearchResult("UNH",  "UnitedHealth Group Inc.",    "stock", "NYSE"),
    SearchResult("XOM",  "Exxon Mobil Corporation",   "stock", "NYSE"),
    SearchResult("WMT",  "Walmart Inc.",               "stock", "NYSE"),
    SearchResult("DIS",  "The Walt Disney Company",   "stock", "NYSE"),
    SearchResult("NFLX", "Netflix Inc.",               "stock", "NASDAQ"),
    SearchResult("AMD",  "Advanced Micro Devices",    "stock", "NASDAQ"),
    SearchResult("INTC", "Intel Corporation",          "stock", "NASDAQ"),
    SearchResult("QQQ",  "Invesco QQQ Trust",          "etf",   "NASDAQ"),
    SearchResult("GLD",  "SPDR Gold Shares",           "etf",   "NYSE Arca"),
    SearchResult("VTI",  "Vanguard Total Stock Market ETF", "etf", "NYSE Arca"),
    SearchResult("BTC-USD", "Bitcoin USD",             "crypto","CCC"),
    SearchResult("ETH-USD", "Ethereum USD",            "crypto","CCC"),
]

_POPULAR_MAP = {r.ticker: r for r in _POPULAR}


# ── yfinance provider ─────────────────────────────────────────────────────

def _yf_get_quote(ticker: str) -> Optional[Quote]:
    """Fetch a single quote from yfinance with caching."""
    ticker = ticker.upper()
    now = time.time()

    if ticker in _quote_cache:
        cached_ts, cached_q = _quote_cache[ticker]
        if now - cached_ts < _QUOTE_TTL:
            return cached_q

    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        fi = t.fast_info          # fast, minimal API call

        price = getattr(fi, "last_price", None) or getattr(fi, "regular_market_price", None)
        if not price:
            return None

        prev = getattr(fi, "previous_close", None) or price
        change = round(price - prev, 4)
        change_pct = round((change / prev) * 100, 4) if prev else 0.0
        volume = int(getattr(fi, "three_month_average_volume", 0) or 0)

        # Company name: check popular map first, else slow .info call
        if ticker in _POPULAR_MAP:
            name = _POPULAR_MAP[ticker].name
        elif ticker in _info_cache and now - _info_cache[ticker][0] < _INFO_TTL:
            name = _info_cache[ticker][1].get("shortName", ticker)
        else:
            try:
                info = t.info
                name = info.get("shortName") or info.get("longName") or ticker
                _info_cache[ticker] = (now, info)
            except Exception:
                name = ticker

        market_cap = getattr(fi, "market_cap", None)
        currency   = getattr(fi, "currency", "USD") or "USD"

        q = Quote(
            ticker=ticker,
            name=name,
            price=round(float(price), 4),
            prev_close=round(float(prev), 4),
            change=change,
            change_pct=change_pct,
            volume=volume,
            market_cap=float(market_cap) if market_cap else None,
            currency=currency,
            data_source="delayed_15min",
            as_of=datetime.now(timezone.utc).isoformat(),
        )
        _quote_cache[ticker] = (now, q)
        return q

    except Exception as exc:
        logger.warning("yfinance quote failed for %s: %s", ticker, exc)
        return None


def _yf_get_history(ticker: str, period: str = "1mo") -> List[HistoricalBar]:
    """Fetch OHLCV history from yfinance."""
    try:
        import yfinance as yf
        df = yf.Ticker(ticker.upper()).history(period=period, interval="1d")
        if df.empty:
            return []
        bars = []
        for dt, row in df.iterrows():
            bars.append(HistoricalBar(
                date=str(dt.date()),
                open=round(float(row["Open"]), 4),
                high=round(float(row["High"]), 4),
                low=round(float(row["Low"]), 4),
                close=round(float(row["Close"]), 4),
                volume=int(row["Volume"]),
            ))
        return bars
    except Exception as exc:
        logger.warning("yfinance history failed for %s: %s", ticker, exc)
        return []


def _yf_search(query: str) -> List[SearchResult]:
    """Search for tickers. Falls back to filtering _POPULAR."""
    q = query.upper().strip()

    # First: filter popular list
    hits = [r for r in _POPULAR if q in r.ticker or q.lower() in r.name.lower()]

    # Second: try yfinance search for more results
    try:
        import yfinance as yf
        sr = yf.Search(query, max_results=8)
        for item in (sr.quotes or []):
            sym = (item.get("symbol") or "").upper()
            if not sym or sym in {h.ticker for h in hits}:
                continue
            qtype = item.get("quoteType", "").lower()
            hits.append(SearchResult(
                ticker=sym,
                name=item.get("shortname") or item.get("longname") or sym,
                type="etf" if qtype == "etf" else "crypto" if qtype in ("cryptocurrency", "crypto") else "stock",
                exchange=item.get("exchange") or "",
            ))
    except Exception:
        pass

    return hits[:12]


# ── Public API ────────────────────────────────────────────────────────────

def get_quote(ticker: str) -> Optional[Quote]:
    return _yf_get_quote(ticker)


def get_quotes(tickers: List[str]) -> Dict[str, Optional[Quote]]:
    return {t: _yf_get_quote(t) for t in tickers}


def search(query: str) -> List[SearchResult]:
    if not query or len(query) < 1:
        return _POPULAR[:10]
    return _yf_search(query)


def get_history(ticker: str, period: str = "1mo") -> List[HistoricalBar]:
    valid_periods = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"}
    if period not in valid_periods:
        period = "1mo"
    return _yf_get_history(ticker, period)


def invalidate(ticker: str) -> None:
    """Remove a ticker from the cache (call after trade for fresh price)."""
    _quote_cache.pop(ticker.upper(), None)
