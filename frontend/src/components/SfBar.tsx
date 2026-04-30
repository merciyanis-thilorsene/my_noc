type SfSlice = { sf: number; count: number; pct: number };

// SF7 (best) → SF12 (worst). Green → red gradient matches the palette in index.css.
const sfColor: Record<number, string> = {
  7:  '#00e699',
  8:  '#8bd34f',
  9:  '#d6c000',
  10: '#ffaa22',
  11: '#ff6633',
  12: '#ff3050',
};

export function SfBar({ slices, height = 12 }: { slices: SfSlice[]; height?: number }) {
  const total = slices.reduce((a, s) => a + s.count, 0);
  if (total === 0) {
    return <div className="text-noc-text-dim text-sm">No uplinks in the last hour.</div>;
  }
  return (
    <div>
      <div className="flex rounded overflow-hidden border border-noc-border" style={{ height }}>
        {slices.map((s) => (
          s.count > 0 && (
            <div
              key={s.sf}
              title={`SF${s.sf} · ${s.count} uplinks · ${s.pct}%`}
              style={{ width: `${s.pct}%`, background: sfColor[s.sf] ?? '#5a6e80' }}
            />
          )
        ))}
      </div>
      <div className="flex justify-between mt-2 text-[10px] mono text-noc-text-dim">
        {slices.map((s) => (
          <div key={s.sf} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: sfColor[s.sf] ?? '#5a6e80' }} />
            SF{s.sf} · {s.pct}%
          </div>
        ))}
      </div>
    </div>
  );
}
