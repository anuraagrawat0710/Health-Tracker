export default function ScoreRing({ value, max = 100, size = 96, label, color }) {
  const pct = Math.max(0, Math.min(1, (value ?? 0) / max))
  const stroke = size * 0.09
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = c * pct
  const ringColor = color || 'var(--accent)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="var(--line)" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={ringColor} strokeWidth={stroke}
          strokeDasharray={`${dash} ${c - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
        <text
          x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
          className="mono" fontSize={size * 0.24} fontWeight="700" fill="var(--ink)"
        >
          {value == null ? '—' : Math.round(value)}
        </text>
      </svg>
      {label && <span style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>{label}</span>}
    </div>
  )
}
