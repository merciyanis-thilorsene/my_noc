type Status = 'operational' | 'degraded' | 'down' | 'unknown';

const colors: Record<Status, string> = {
  operational: 'bg-noc-accent',
  degraded:    'bg-noc-warning',
  down:        'bg-noc-critical',
  unknown:     'bg-noc-text-mute',
};

export function StatusDot({ status, label }: { status: Status; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={label ?? status}>
      <span className={`w-2 h-2 rounded-full ${colors[status]} ${status === 'operational' ? 'pulse-dot' : ''}`} />
      {label && <span className="text-xs text-noc-text-dim">{label}</span>}
    </span>
  );
}
