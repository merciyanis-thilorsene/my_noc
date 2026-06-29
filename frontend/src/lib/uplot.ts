import uPlot from 'uplot';
import { CSS } from './format';

/** Assembles aligned column arrays into uPlot's tuple-typed AlignedData. */
export function aligned(...columns: (number | null)[][]): uPlot.AlignedData {
  return columns as unknown as uPlot.AlignedData;
}

/** Convert an ISO-timestamped series to uPlot's [xs, ...ys] aligned-data form. */
export function toUplotData(series: { t: string }[], keys: string[]): uPlot.AlignedData {
  const xs = series.map((p) => Date.parse(p.t) / 1000);
  const ys = keys.map((k) => series.map((p) => {
    const v = (p as Record<string, unknown>)[k];
    return typeof v === 'number' ? v : null;
  }));
  return aligned(xs, ...ys);
}

/** Resolves a `var(--token)` color to its computed hex; passes other colors through.
 * Canvas fill/stroke cannot read CSS variables, so chart colors must be concrete. */
function resolveColor(c: string): string {
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(c);
  return m ? CSS(m[1]) : c;
}

const axisStroke = () => CSS('--text-2');
const grid = () => ({ stroke: CSS('--border'), width: 1 });

function axes(yLabel?: string): uPlot.Axis[] {
  return [
    { stroke: axisStroke, grid: grid(), ticks: { stroke: CSS('--border'), width: 1 } },
    {
      stroke: axisStroke, grid: grid(), ticks: { stroke: CSS('--border'), width: 1 }, size: 52, label: yLabel,
    },
  ];
}

const cursor: uPlot.Cursor = { y: false, points: { size: 6 } };

function fmtVal(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/**
 * A floating tooltip that shows the hovered bucket's time and each visible series' value —
 * replaces uPlot's built-in live legend (which renders distracting "—" when not hovering).
 */
export function tooltipPlugin(): uPlot.Plugin {
  let el: HTMLDivElement | null = null;
  return {
    hooks: {
      init: (u: uPlot) => {
        el = document.createElement('div');
        el.className = 'u-tip';
        el.style.display = 'none';
        u.over.appendChild(el);
        u.over.addEventListener('mouseleave', () => { if (el) el.style.display = 'none'; });
      },
      setCursor: (u: uPlot) => {
        if (!el) return;
        const { idx, left, top } = u.cursor;
        if (idx === null || idx === undefined) { el.style.display = 'none'; return; }
        const x = (u.data[0] as number[])[idx];
        const when = new Date(x * 1000).toLocaleString(undefined, {
          month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const rows = u.series.slice(1).map((s, i) => {
          if (s.show === false) return '';
          const stroke = typeof s.stroke === 'string' ? s.stroke : '#888';
          const v = (u.data[i + 1] as (number | null)[])[idx];
          return `<div class="r"><i style="background:${stroke}"></i>${s.label ?? ''} <b>${fmtVal(v)}</b></div>`;
        }).join('');
        el.innerHTML = `<div class="t">${when}</div>${rows}`;
        el.style.display = 'block';
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
      },
    },
  };
}

export interface LineDef {
  key: string;
  label: string;
  color: string;
  width?: number;
  dash?: number[];
  fill?: string;
}

/** A multi-series line chart. `keys` lists the data columns in series order. */
export function lineOptions(defs: LineDef[], yLabel?: string): Omit<uPlot.Options, 'width' | 'height'> {
  return {
    scales: { x: { time: true } },
    axes: axes(yLabel),
    cursor,
    legend: { show: false },
    plugins: [tooltipPlugin()],
    series: [
      {},
      ...defs.map((d) => ({
        label: d.label,
        stroke: d.color,
        width: d.width ?? 1.6,
        dash: d.dash,
        fill: d.fill,
        points: { show: false },
      })),
    ],
  };
}

/** Avg line with a shaded min/max band and an optional dashed p95 line. */
export function bandOptions(color: string, yLabel?: string): Omit<uPlot.Options, 'width' | 'height'> {
  // series order: avg, min, max, p95   (data columns must match)
  return {
    scales: { x: { time: true } },
    axes: axes(yLabel),
    cursor,
    legend: { show: false },
    plugins: [tooltipPlugin()],
    bands: [{ series: [3, 2], fill: `${color}22` }], // fill between max(3) and min(2)
    series: [
      {},
      { label: 'avg', stroke: color, width: 1.8, points: { show: false } },
      {
        label: 'min', stroke: `${color}55`, width: 1, points: { show: false },
      },
      {
        label: 'max', stroke: `${color}55`, width: 1, points: { show: false },
      },
      {
        label: 'p95', stroke: CSS('--warn'), width: 1, dash: [4, 4], points: { show: false },
      },
    ],
  };
}

/** A bar chart for a single value-per-bucket series. */
export function barOptions(label: string, color: string, yLabel?: string): Omit<uPlot.Options, 'width' | 'height'> {
  return {
    scales: { x: { time: true } },
    axes: axes(yLabel),
    cursor,
    legend: { show: false },
    plugins: [tooltipPlugin()],
    series: [
      {},
      {
        label,
        stroke: color,
        fill: `${color}cc`,
        paths: uPlot.paths.bars!({ size: [0.85, 40] }),
        points: { show: false },
      },
    ],
  };
}

/**
 * Stacked-area options. Series are drawn largest-cumulative first so each incremental
 * band stays visible. Pair with {@link stackData}.
 */
export function stackOptions(defs: LineDef[], yLabel?: string): Omit<uPlot.Options, 'width' | 'height'> {
  const reversed = [...defs].reverse();
  return {
    scales: { x: { time: true } },
    axes: axes(yLabel),
    cursor,
    legend: { show: false },
    plugins: [tooltipPlugin()],
    series: [
      {},
      ...reversed.map((d) => {
        const hex = resolveColor(d.color);
        return {
          label: d.label,
          stroke: hex,
          fill: `${hex}cc`,
          width: 1,
          points: { show: false },
        };
      }),
    ],
  };
}

/**
 * Builds cumulative aligned data for {@link stackOptions} from raw per-band values.
 * `keys` are bottom-to-top; output series order matches stackOptions (top-to-bottom).
 */
export function stackData(series: { t: string }[], keys: string[]): uPlot.AlignedData {
  const xs = series.map((p) => Date.parse(p.t) / 1000);
  const vals = keys.map((k) => series.map((p) => {
    const v = (p as Record<string, unknown>)[k];
    return typeof v === 'number' ? v : 0;
  }));
  // cumulative[i] = sum of vals[0..i]
  const cumulative = vals.map((_, i) => series.map((__, row) => {
    let sum = 0;
    for (let j = 0; j <= i; j += 1) sum += vals[j][row];
    return sum;
  }));
  return [xs, ...cumulative.reverse()] as uPlot.AlignedData;
}
