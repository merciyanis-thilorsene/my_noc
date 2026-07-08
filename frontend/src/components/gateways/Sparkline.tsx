import { L } from '../../lib/i18n';

/** Minimal SVG sparkline (line + gradient area + last-point dot), per the NOC design. */
export default function Sparkline({ values, color, id }: {
  values: (number | null)[];
  color: string;
  id: string;
}) {
  const defined = values.filter((v): v is number => v !== null);
  if (defined.length < 2) {
    return <div className="empty" style={{ padding: 12 }}>{L.drawer.notEnoughData}</div>;
  }
  const w = 480;
  const h = 88;
  const pad = 4;
  const min = Math.min(...defined);
  const max = Math.max(...defined);
  const span = (max - min) || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => (v === null ? null : [
    pad + i * step,
    h - pad - ((v - min) / span) * (h - pad * 2 - 8) - 4,
  ] as [number, number]));
  const drawn = pts.filter((p): p is [number, number] => p !== null);
  const line = drawn.map((p) => p.join(',')).join(' ');
  const area = `M${drawn[0][0]},${h - pad} L${drawn.map((p) => p.join(',')).join(' L')} L${drawn[drawn.length - 1][0]},${h - pad} Z`;
  const last = drawn[drawn.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id}-g)`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
    </svg>
  );
}
