import { ReactNode, useMemo } from 'react';
import uPlot from 'uplot';
import UplotChart, { LegendItem } from './UplotChart';
import type { SeriesPoint, SeriesResult } from '../api';

interface Built {
  options: Omit<uPlot.Options, 'width' | 'height'>;
  data: uPlot.AlignedData;
}

interface QueryLike {
  isLoading: boolean;
  error: unknown;
  data?: SeriesResult;
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="chart-box">
      <div className="chart-title">{title}</div>
      {children}
    </div>
  );
}

/**
 * Renders a metric time-series, handling loading/empty/error states and memoizing the
 * uPlot options+data so the chart isn't rebuilt on every parent render.
 */
export default function SeriesChart({
  q, title, height, build, legend,
}: {
  q: QueryLike;
  title: string;
  height?: number;
  build: (series: SeriesPoint[]) => Built;
  legend?: LegendItem[];
}) {
  const series = q.data?.series ?? [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(() => build(series), [series]);
  // Pin the x-axis to the API's reported window so the selected range is always reflected.
  const xRange = useMemo<[number, number] | undefined>(() => (
    q.data ? [Date.parse(q.data.from) / 1000, Date.parse(q.data.to) / 1000] : undefined
  ), [q.data?.from, q.data?.to]);

  if (q.isLoading && !q.data) return <Box title={title}><div className="loading">Loading…</div></Box>;
  if (q.error) return <Box title={title}><div className="error">Failed to load</div></Box>;
  if (!series.length) return <Box title={title}><div className="empty">No data in range</div></Box>;
  return (
    <UplotChart
      options={built.options}
      data={built.data}
      title={title}
      height={height}
      legend={legend}
      xRange={xRange}
    />
  );
}
