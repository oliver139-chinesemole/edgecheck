interface Props {
  using?: boolean
  message?: string
}

export function SampleDataBadge({ using = true, message }: Props) {
  if (!using) return null
  return (
    <div className="sample-data-badge">
      Using sample data — add an API key to .env to go live
      {message && <span> · {message}</span>}
    </div>
  )
}
