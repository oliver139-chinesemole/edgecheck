import { useGameCtx } from './GameLayout'

function RuleRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="ms-rule-row">
      <div>
        <div className="ms-rule-label">{label}</div>
        {note && <div className="ms-rule-note">{note}</div>}
      </div>
      <div className="ms-rule-value">{value}</div>
    </div>
  )
}

export default function RulesPage() {
  const { game } = useGameCtx()
  if (!game) return null

  return (
    <div className="ms-rules-page">
      <div className="ms-ov-card" style={{ maxWidth: 560 }}>
        <div className="ms-ov-card-title">Game Rules — {game.name}</div>
        <div className="ms-rule-section">
          <div className="ms-rule-section-label">Cash &amp; Duration</div>
          <RuleRow label="Starting Cash"    value={`$${game.starting_cash.toLocaleString()}`} />
          <RuleRow label="Start Date"       value={game.start_date} />
          <RuleRow label="End Date"         value={game.end_date} />
          <RuleRow label="Commission"       value={`$${game.commission} per trade`}
            note="Deducted from each buy or sell order" />
        </div>
        <div className="ms-rule-section">
          <div className="ms-rule-section-label">Trading Permissions</div>
          <RuleRow label="Short Selling"    value={game.allow_short   ? '✓ Allowed' : '✗ Not allowed'}
            note={game.allow_short ? 'Selling shares you do not own is permitted.' : 'You can only sell shares you hold.'} />
          <RuleRow label="Margin Trading"   value={game.allow_margin  ? '✓ Allowed' : '✗ Not allowed'}
            note={game.allow_margin ? 'Buying power can exceed cash balance.' : 'Trades are limited to available cash.'} />
          <RuleRow label="Day Trading"      value={game.allow_day_trading ? '✓ Allowed' : '✗ Not allowed'}
            note={game.allow_day_trading ? 'No restrictions on same-day round-trips.' : 'PDT-style limit applies.'} />
        </div>
        <div className="ms-rule-section">
          <div className="ms-rule-section-label">Leaderboard</div>
          <RuleRow label="Ranked by"        value={game.rank_by === 'return_pct' ? 'Percent Return (%)' : 'Total Portfolio Value ($)'} />
          <RuleRow label="Portfolio Privacy" value={game.portfolio_public ? 'Public — everyone can see holdings' : 'Private until game ends'} />
        </div>
        <div className="ms-rule-section">
          <div className="ms-rule-section-label">Assets</div>
          <RuleRow label="Allowed"          value={game.allowed_assets.join(', ')} />
        </div>
        <div className="ms-rules-disclaimer">
          ⚠ This is a virtual simulator using fake money. No real investments are made.
          Market data is approximately 15 minutes delayed. Not financial advice.
        </div>
      </div>
    </div>
  )
}
