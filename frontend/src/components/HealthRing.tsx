export function HealthRing({
  value,
  label,
  size = 96,
}: {
  value: number; // 0..100
  label?: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = size / 2 - 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  let color = '#00e699';
  if (clamped < 70) color = '#ffaa22';
  if (clamped < 40) color = '#ff3050';

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#15202e" strokeWidth="6" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute text-center">
        <div className="mono text-xl font-semibold" style={{ color }}>
          {Math.round(clamped)}
        </div>
        {label && (
          <div className="text-[10px] uppercase tracking-wider text-noc-text-dim">{label}</div>
        )}
      </div>
    </div>
  );
}
