// Numeric RF quality badge (0..100) with color bands:
//   ≥70 green, 40–70 amber, <40 red.
export function QualityBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-noc-text-mute mono">—</span>;
  const color = value >= 70 ? 'text-noc-accent'
              : value >= 40 ? 'text-noc-warning'
              :               'text-noc-critical';
  return <span className={`mono ${color}`}>{Math.round(value)}</span>;
}

export function LossBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-noc-text-mute mono">—</span>;
  const color = value < 5  ? 'text-noc-accent'
              : value < 20 ? 'text-noc-warning'
              :              'text-noc-critical';
  return <span className={`mono ${color}`}>{value.toFixed(1)}%</span>;
}
