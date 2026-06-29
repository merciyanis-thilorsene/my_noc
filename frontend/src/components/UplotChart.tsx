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
  /** Pin the x-axis to [from, to] epoch seconds so the axis spans the selected time
   *  range regardless of how sparse the data is (and avoids uPlot's single-point sprawl). */
  xRange?: [number, number];
}

/**
 * Thin React wrapper around uPlot: creates the plot once, pushes new data on change,
 * and keeps width synced to its container via ResizeObserver.
 */
export default function UplotChart({
  options, data, height = 220, title, legend, xRange,
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
    const u = plotRef.current;
    if (!u) return;
    // setData resets scales to the data extents; re-pin x to the requested window after.
    u.setData(data);
    if (xRange) u.setScale('x', { min: xRange[0], max: xRange[1] });
  }, [data, xRange]);

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
