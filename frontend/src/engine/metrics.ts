import { mean, std } from './indicators'
import type { EquityPoint, BacktestMetrics } from './types'

const ANN = 252
const RF = 0.04 / ANN

export function computeMetrics(equity: number[], benchmarkEquity: number[]): BacktestMetrics {
  const returns = equity.slice(1).map((v, i) => v / equity[i] - 1)
  const benchReturns = benchmarkEquity.slice(1).map((v, i) => v / benchmarkEquity[i] - 1)

  const calcMetrics = (rets: number[]) => {
    if (rets.length < 5) return { sharpe: 0, sortino: 0, maxDrawdown: 0, cagr: 0, winRate: 0 }
    const excess = rets.map(r => r - RF)
    const exStd = std(excess)
    const sharpe = exStd > 0 ? (mean(excess) / exStd) * Math.sqrt(ANN) : 0

    const down = rets.filter(r => r < 0)
    const dStd = down.length > 1 ? std(down) : 1e-8
    const sortino = ((mean(rets) - RF) / dStd) * Math.sqrt(ANN)

    let peak = 1, maxDD = 0, cum = 1
    for (const r of rets) {
      cum *= (1 + r)
      if (cum > peak) peak = cum
      const dd = cum / peak - 1
      if (dd < maxDD) maxDD = dd
    }

    const years = rets.length / ANN
    const totalRet = rets.reduce((acc, r) => acc * (1 + r), 1) - 1
    const cagr = years > 0 ? (1 + totalRet) ** (1 / years) - 1 : 0
    const winRate = rets.filter(r => r > 0).length / Math.max(rets.length, 1)

    return {
      sharpe: +sharpe.toFixed(3),
      sortino: +sortino.toFixed(3),
      maxDrawdown: +maxDD.toFixed(4),
      cagr: +cagr.toFixed(4),
      winRate: +winRate.toFixed(4),
    }
  }

  const sm = calcMetrics(returns)
  const bm = calcMetrics(benchReturns)

  return {
    ...sm,
    totalTrades: 0,
    benchmarkSharpe: bm.sharpe,
    benchmarkCagr: bm.cagr,
  }
}

export function buildEquityCurve(
  dates: string[],
  stratValues: number[],
  benchValues: number[],
): EquityPoint[] {
  return dates.map((date, i) => ({
    date,
    strategy: +stratValues[i].toFixed(2),
    benchmark: +benchValues[i].toFixed(2),
  }))
}
