import { useEffect, useRef } from 'react';
import uPlot from 'uplot';

export interface LegendItem { label: string; color: string; }

interface Props {
  /** uPlot options minus width/height (managed here). */
  options: Omit<uPlot.Options, 'width' | 'height'>;
  data: uPlot.AlignedData;
  height?: number;
  title?: string;
  legend?: LegendItem[];
}

/**
 * Thin React wrapper around uPlot: creates the plot once, pushes new data on change,
 * and keeps width synced to its container via ResizeObserver.
 */
export default function UplotChart({
  options, data, height = 220, title, legend,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef<uPlot.AlignedData>(data);
  dataRef.current = data;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const width = host.clientWidth || 600;
    const plot = new uPlot({ ...options, width, height } as uPlot.Options, dataRef.current, host);
    plotRef.current = plot;

    const ro = new ResizeObserver(() => {
      plot.setSize({ width: host.clientWidth || width, height });
    });
    ro.observe(host);

    return () => { ro.disconnect(); plot.destroy(); plotRef.current = null; };
    // Create the plot once on mount; options are stable per chart and data updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return (
    <div className="chart-box">
      <div className="chart-head">
        {title ? <div className="chart-title">{title}</div> : <span />}
        {legend && legend.length > 0 ? (
          <div className="legend">
            {legend.map((l) => (
              <span key={l.label} className="legend-item">
                <i style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div ref={hostRef} />
    </div>
  );
}
