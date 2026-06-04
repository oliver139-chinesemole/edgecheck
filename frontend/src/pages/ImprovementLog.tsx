import { Term } from '../components/Glossary'

export default function ImprovementLog() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Improvement Log</h1>
        <p className="page-sub">
          Disciplined, offline model improvement · No online learning ·{' '}
          <Term id="championChallenger">Champion/challenger framework</Term>
        </p>
      </div>

      <div className="alert alert-green">
        <span>◎</span>
        <span>
          <strong>Promotion is rare — and expected to be rare.</strong> A challenger must beat the champion on
          the permanently frozen hold-out set by Δ<Term id="sharpe">Sharpe</Term> &gt; 0.15 to be promoted.
          Most won't clear that bar.
        </span>
      </div>

      <div className="improve-grid">
        <div className="card bordered-blue">
          <div className="card-title">🏆 <Term id="championChallenger">Champion Model</Term></div>
          <div style={{ fontSize: '0.8rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.3rem 1rem' }}>
            <span className="text-muted">Type</span>
            <span className="text-hi text-num">Momentum (RSI + MA)</span>
            <span className="text-muted"><Term id="walkForward">Walk-forward split</Term></span>
            <span className="text-hi text-num">70 / 30 / 5-bar embargo</span>
            <span className="text-muted">Cost model</span>
            <span className="text-hi text-num">8 bps round-trip</span>
            <span className="text-muted">Features</span>
            <span className="text-hi text-num">RSI, MA20, MA50, ret20d, vol</span>
            <span className="text-muted">Status</span>
            <span style={{ color: 'var(--green)' }}>✓ Frozen</span>
          </div>
        </div>

        <div className="card bordered-purple">
          <div className="card-title">🔒 Frozen Hold-Out</div>
          <p style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--purple)', fontFamily: 'var(--font-num)', marginBottom: '0.4rem' }}>
            2024-07-01 → 2024-12-31
          </p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-lo)', lineHeight: 1.6 }}>
            Permanently reserved. No model — champion or challenger — may train on data from this window.
            Performance here is the only truly uncontaminated <Term id="outOfSample">out-of-sample</Term> estimate.
          </p>
        </div>

        <div className="card">
          <div className="card-title">Promotion Rules</div>
          <ul style={{ paddingLeft: '1rem', fontSize: '0.78rem', color: 'var(--text-lo)', lineHeight: 1.8 }}>
            <li>Must outperform champion on the frozen hold-out set</li>
            <li>Minimum margin: <strong style={{ color: 'var(--text-hi)' }}>Δ<Term id="sharpe">Sharpe</Term> &gt; 0.15</strong></li>
            <li>Training data must not include hold-out dates</li>
            <li>Every promotion is logged with timestamp and reason</li>
          </ul>
        </div>

        <div className="card bordered-amber">
          <div className="card-title">⚠ Multiple-Testing Note</div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-lo)', lineHeight: 1.6 }}>
            Every retrain attempt is a hypothesis test. Running many challengers inflates the false-positive
            rate by random chance — this is the multiple comparisons problem. The Δ<Term id="sharpe">Sharpe</Term> &gt; 0.15 threshold
            exists to counteract it. Treat promotion as extraordinary, requiring extraordinary evidence.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title">Challenger History</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-lo)', marginBottom: '1rem' }}>
          Run a backtest in the <strong style={{ color: 'var(--text)' }}>Strategy tab</strong> then experiment with different parameters to create challengers.
          Each run produces an offline result that can be compared to the champion on the hold-out window.
        </p>
        <div className="table-scroll">
          <table className="data-table" role="table" aria-label="Challenger history">
            <thead>
              <tr>
                <th>#</th>
                <th>Type</th>
                <th><Term id="outOfSample">OOS</Term> <Term id="sharpe">Sharpe</Term></th>
                <th>Champion <Term id="sharpe">Sharpe</Term></th>
                <th>Δ<Term id="sharpe">Sharpe</Term></th>
                <th>Promoted?</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-muted" colSpan={7} style={{ textAlign: 'center', padding: '1.5rem' }}>
                  No challengers yet. Retrain with different parameters to populate this log.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="alert alert-amber">
        <span>ℹ</span>
        <span>
          <strong>The one retail edge worth noting:</strong> a small account has no capacity constraint and can concentrate
          into top-conviction names. A large fund that holds 500 names for liquidity reasons is structurally
          different from a small follower who can own just 5. That is the only structural reason a cloner could outperform
          the fund they clone — and it only holds if the signals themselves are valid.
        </span>
      </div>

      <div className="alert alert-blue" style={{ marginTop: '0.75rem' }}>
        <span>📋</span>
        <span>
          <strong><Term id="filing13f">13F filings</Term></strong> used in the Selective Clone strategy are always at least 45 days stale by the time they appear.
          Any "edge" derived from them is operating on public, delayed information that the market has already partially priced in.
        </span>
      </div>
    </div>
  )
}
