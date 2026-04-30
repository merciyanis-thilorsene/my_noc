import type { ReactNode } from 'react';
import { SourceBadge } from './SourceBadge';

export function MetricBox({
  label,
  value,
  unit,
  source,
  children,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  source?: 'TTS' | 'WMC' | 'DERIVED' | 'ML';
  children?: ReactNode;
}) {
  return (
    <div className="panel-padded flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="label truncate m-0">{label}</div>
        {source && <SourceBadge source={source} />}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="mono text-2xl font-medium truncate">{value ?? '—'}</div>
        {unit && <div className="text-noc-text-dim text-xs">{unit}</div>}
      </div>
      {children}
    </div>
  );
}
