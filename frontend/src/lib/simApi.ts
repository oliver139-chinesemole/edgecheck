// API client for the Market Simulator backend

const BASE = '/api/ms'
const MARKET = '/api/market'

function getUsername(): string {
  return localStorage.getItem('ms_username') || ''
}

async function apiFetch(url: string, options?: RequestInit): Promise<unknown> {
  const username = getUsername()
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Username': username,
      ...(options?.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (data as { detail?: string }).detail || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}

// ── User ─────────────────────────────────────────────────────────────────

export const upsertMe = (displayName?: string) =>
  apiFetch(`${BASE}/users/me`, {
    method: 'POST',
    body: JSON.stringify({ display_name: displayName }),
  })

export const getMe = () => apiFetch(`${BASE}/users/me`)

// ── Games ─────────────────────────────────────────────────────────────────

export const listGames = (params?: { q?: string; mine?: boolean }) => {
  const qs = new URLSearchParams()
  if (params?.q)    qs.set('q', params.q)
  if (params?.mine) qs.set('mine', 'true')
  return apiFetch(`${BASE}/games?${qs}`)
}

export const getGame = (id: string) => apiFetch(`${BASE}/games/${id}`)

export const createGame = (body: Record<string, unknown>) =>
  apiFetch(`${BASE}/games`, { method: 'POST', body: JSON.stringify(body) })

export const joinGame = (id: string, joinCode?: string) =>
  apiFetch(`${BASE}/games/${id}/join`, {
    method: 'POST',
    body: JSON.stringify({ join_code: joinCode || null }),
  })

export const leaveGame = (id: string) =>
  apiFetch(`${BASE}/games/${id}/join`, { method: 'DELETE' })

// ── Trading ───────────────────────────────────────────────────────────────

export const placeTrade = (gameId: string, body: Record<string, unknown>) =>
  apiFetch(`${BASE}/games/${gameId}/trade`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

// ── Portfolio ─────────────────────────────────────────────────────────────

export const getPortfolio = (gameId: string) =>
  apiFetch(`${BASE}/games/${gameId}/portfolio`)

export const getTransactions = (gameId: string, limit = 50) =>
  apiFetch(`${BASE}/games/${gameId}/transactions?limit=${limit}`)

export const getPortfolioHistory = (gameId: string) =>
  apiFetch(`${BASE}/games/${gameId}/portfolio/history`)

export const getActivity = (gameId: string, limit = 20) =>
  apiFetch(`${BASE}/games/${gameId}/activity?limit=${limit}`)

// ── Leaderboard ───────────────────────────────────────────────────────────

export const getLeaderboard = (gameId: string) =>
  apiFetch(`${BASE}/games/${gameId}/leaderboard`)

// ── Watchlist ─────────────────────────────────────────────────────────────

export const getWatchlist = (gameId: string) =>
  apiFetch(`${BASE}/games/${gameId}/watchlist`)

export const addWatchlist = (gameId: string, ticker: string) =>
  apiFetch(`${BASE}/games/${gameId}/watchlist`, {
    method: 'POST',
    body: JSON.stringify({ ticker }),
  })

export const removeWatchlist = (gameId: string, ticker: string) =>
  apiFetch(`${BASE}/games/${gameId}/watchlist/${ticker}`, { method: 'DELETE' })

// ── Market data ───────────────────────────────────────────────────────────

export const getQuote = (ticker: string) =>
  apiFetch(`${MARKET}/quote/${ticker}`)

export const searchTickers = (q: string) =>
  apiFetch(`${MARKET}/search?q=${encodeURIComponent(q)}`)

export const getChart = (ticker: string, period = '1mo') =>
  apiFetch(`${MARKET}/chart/${ticker}?period=${period}`)

export const getQuotes = (tickers: string[]) =>
  apiFetch(`${MARKET}/quotes?tickers=${tickers.join(',')}`)
