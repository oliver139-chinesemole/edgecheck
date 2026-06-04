import { useState, useRef, useEffect, useCallback } from 'react'

interface TermDef {
  name: string
  definition: string
}

const GLOSSARY: Record<string, TermDef> = {
  sharpe: {
    name: 'Sharpe Ratio',
    definition:
      'Risk-adjusted return: excess return (above the risk-free rate) per unit of total volatility. A Sharpe above 1.0 is considered good; below 0.5 is weak. Higher is better.',
  },
  sortino: {
    name: 'Sortino Ratio',
    definition:
      'Like the Sharpe Ratio but only penalises downside volatility — price drops, not upswings. A better measure when return distributions are asymmetric.',
  },
  maxDrawdown: {
    name: 'Max Drawdown',
    definition:
      'The largest peak-to-trough decline in portfolio value over the full test window. Tells you the worst historical loss you would have endured if you bought at the top and sold at the bottom.',
  },
  cagr: {
    name: 'CAGR',
    definition:
      'Compound Annual Growth Rate — the annualised return that would produce the same total return via compounding. Strips out the effect of time so strategies over different periods are comparable.',
  },
  winRate: {
    name: 'Win Rate',
    definition:
      'The percentage of trades that closed at a profit. A high win rate is meaningless without knowing the magnitude ratio: winning 60% but losing 3× on each loss is still a losing strategy.',
  },
  walkForward: {
    name: 'Walk-forward validation',
    definition:
      'A backtesting discipline where the model trains on a rolling past window and is tested on the next unseen window, repeated across the full history. Reduces look-ahead bias versus a single train/test split.',
  },
  outOfSample: {
    name: 'Out-of-sample',
    definition:
      'Data the model has never trained on. Performance here is the only honest estimate — in-sample (training) performance is always optimistic because the model has seen the data.',
  },
  tripleBarrier: {
    name: 'Triple-barrier labeling',
    definition:
      'A trade labeling method from Marcos Lopez de Prado. Each bar is assigned a label based on which barrier is hit first: a profit target, a stop-loss, or a time expiry. Reduces common labeling biases in financial ML.',
  },
  championChallenger: {
    name: 'Champion / Challenger',
    definition:
      'A model governance framework: the current best model (champion) can only be replaced if a new candidate (challenger) clears a defined improvement threshold on hold-out data. Prevents random reversion being mistaken for progress.',
  },
  filing13f: {
    name: '13F Filing',
    definition:
      'Quarterly SEC disclosure required of institutional investment managers with ≥$100M in assets under management, reporting their long equity positions. Filed 45 days after quarter-end — this data is always at least 45 days stale when you see it.',
  },
}

interface TermProps {
  id: keyof typeof GLOSSARY
  children: React.ReactNode
}

export function Term({ id, children }: TermProps) {
  const def = GLOSSARY[id]
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setOpen(false), [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open, close])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close()
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  if (!def) return <>{children}</>

  return (
    <span className="term-wrapper" ref={wrapperRef}>
      {children}
      <button
        ref={triggerRef}
        className="term-trigger"
        aria-label={`Definition: ${def.name}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(v => !v)
          }
        }}
        tabIndex={0}
        type="button"
      >
        ?
      </button>
      {open && (
        <span
          className="term-popover"
          role="dialog"
          aria-label={def.name}
        >
          <div className="term-popover-name">{def.name}</div>
          <div className="term-popover-def">{def.definition}</div>
        </span>
      )}
    </span>
  )
}

export default Term
