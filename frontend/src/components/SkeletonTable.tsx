interface SkeletonTableProps {
  columns: number
  rows?: number
  widths?: string[]
}

/** Animated shimmer table used while data is loading */
export function SkeletonTable({ columns, rows = 8, widths }: SkeletonTableProps) {
  const defaultWidths = Array.from({ length: columns }, (_, i) => {
    // Vary widths to look natural
    const bases = ['60%', '80%', '50%', '70%', '55%', '65%', '45%', '75%']
    return bases[i % bases.length]
  })
  const colWidths = widths ?? defaultWidths

  return (
    <table
      className="data-table"
      aria-label="Loading data"
      aria-busy="true"
    >
      <thead>
        <tr>
          {Array.from({ length: columns }).map((_, i) => (
            <th key={i} scope="col">
              <div
                className="skeleton-cell"
                style={{ width: colWidths[i], maxWidth: '120px' }}
                aria-hidden="true"
              />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <tr key={rowIdx} className="skeleton-row">
            {Array.from({ length: columns }).map((_, colIdx) => (
              <td key={colIdx}>
                <div
                  className="skeleton-cell"
                  style={{
                    width: colWidths[colIdx],
                    maxWidth: '160px',
                    // Stagger animation delay for a wave effect
                    animationDelay: `${(rowIdx * columns + colIdx) * 0.04}s`,
                  }}
                  aria-hidden="true"
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default SkeletonTable
