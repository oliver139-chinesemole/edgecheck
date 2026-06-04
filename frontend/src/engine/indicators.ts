/**
 * Technical indicator computations.
 * All signals are built from lagged data — the feature at index i
 * uses prices from indices [0, i-1] only, never index i itself.
 */

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

export function std(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length)
}

export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  const changes = closes.slice(1).map((c, i) => c - closes[i])
  const gains = changes.map(c => Math.max(c, 0))
  const losses = changes.map(c => Math.max(-c, 0))
  const avgGain = mean(gains.slice(-period))
  const avgLoss = mean(losses.slice(-period))
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/**
 * Generate trading signals for an array of close prices (already sorted oldest→newest).
 * Returns an array of signals {1=long, 0=flat} aligned to the input array.
 *
 * Strategy: momentum + mean-reversion blend
 *   - Long when: close > MA50 AND RSI(14) between 40–70 AND 20d return > 0
 *   - Flat otherwise
 * All inputs are lagged by 1 bar so signal[i] depends only on closes[0..i-1].
 */
export function computeSignals(closes: number[]): (1 | 0)[] {
  const n = closes.length
  const signals: (1 | 0)[] = new Array(n).fill(0)

  for (let i = 51; i < n; i++) {
    // Use data up to i-1 (lag 1)
    const hist = closes.slice(0, i)
    const prev = hist[hist.length - 1]      // close[i-1]
    const ma20 = mean(hist.slice(-20))
    const ma50 = mean(hist.slice(-50))
    const r = rsi(hist.slice(-16))          // RSI on last 16 bars ending at i-1
    const ret20 = prev / hist[hist.length - 21] - 1

    const long = prev > ma50 && prev > ma20 && r >= 38 && r <= 72 && ret20 > -0.02
    signals[i] = long ? 1 : 0
  }
  return signals
}

/** Apply round-trip trading cost (8 bps) to a gross return. */
export const ROUND_TRIP_COST = 0.0008  // 8 bps

export function netReturn(gross: number): number {
  return gross - ROUND_TRIP_COST
}
