/**
 * useWebSocket — connects to ws://localhost:8000/ws/sim (or /api/sim/ws)
 * with exponential backoff reconnect.
 *
 * Returns: { connected, lastMessage, send }
 *
 * Gracefully handles backend being offline:
 *   - connected = false
 *   - no crash, no unhandled error
 *   - retries forever with capped backoff (max 30 s)
 */
import { useEffect, useRef, useState, useCallback } from 'react'

export interface WsMessage {
  type: string
  prices?: Record<string, number>
  portfolio?: Record<string, unknown>
  timestamp?: string
  data_source?: string
  [key: string]: unknown
}

export interface UseWebSocketResult {
  connected: boolean
  lastMessage: WsMessage | null
  send: (data: string | object) => void
}

const INITIAL_DELAY_MS = 1_000
const MAX_DELAY_MS = 30_000
const BACKOFF_FACTOR = 1.5

// The backend WebSocket is at /api/sim/ws (router mounted at /api/sim, handler at /ws)
function resolveWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // In dev with Vite proxy the backend is at localhost:8000
  // In production (GitHub Pages) the backend won't be available
  const host = import.meta.env.DEV
    ? 'localhost:8000'
    : window.location.host
  return `${proto}//${host}/api/sim/ws`
}

export function useWebSocket(): UseWebSocketResult {
  const [connected, setConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const delayRef = useRef<number>(INITIAL_DELAY_MS)
  const mountedRef = useRef(true)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    const url = resolveWsUrl()
    let ws: WebSocket

    try {
      ws = new WebSocket(url)
    } catch {
      // URL construction failed (e.g. GitHub Pages without backend)
      scheduleReconnect()
      return
    }

    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return }
      setConnected(true)
      delayRef.current = INITIAL_DELAY_MS  // reset backoff
    }

    ws.onmessage = (evt) => {
      if (!mountedRef.current) return
      try {
        const msg = JSON.parse(evt.data) as WsMessage
        setLastMessage(msg)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onerror = () => {
      // onerror is always followed by onclose; don't schedule retry here
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setConnected(false)
      scheduleReconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function scheduleReconnect() {
    if (!mountedRef.current) return
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
    retryTimeoutRef.current = setTimeout(() => {
      delayRef.current = Math.min(delayRef.current * BACKOFF_FACTOR, MAX_DELAY_MS)
      connect()
    }, delayRef.current)
  }

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((data: string | object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === 'string' ? data : JSON.stringify(data))
    }
  }, [])

  return { connected, lastMessage, send }
}
