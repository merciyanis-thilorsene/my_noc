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
          // uPlot wraps string strokes into functions internally; call to recover the color.
          const raw = typeof s.stroke === 'function' ? s.stroke(u, i + 1) : s.stroke;
          const color = typeof raw === 'string' ? raw : '#888';
          const v = (u.data[i + 1] as (number | null)[])[idx];
          return `<div class="r"><i style="background:${color}"></i>${s.label ?? ''} <b>${fmtVal(v)}</b></div>`;
        }).join('');
        el.innerHTML = `<div class="t">${when}</div>${rows}`;
        el.style.display = 'block';
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        // Flip to the left of the cursor near the right edge so it doesn't clip.
        const flip = (left ?? 0) > u.over.clientWidth * 0.6;
        el.style.transform = flip ? 'translate(calc(-100% - 12px), -50%)' : 'translate(12px, -50%)';
      },
    },
  };
}

/**
 * Tooltip for the packet-loss chart: shows the bucket's expected/received/lost counts and
 * the loss %. Reads aligned-data columns [t, lossPct, received, lost, expected].
 */
function lossTooltip(): uPlot.Plugin {
  let el: HTMLDivElement | null = null;
  const row = (color: string, label: string, val: string) => `<div class="r"><i style="background:${color}"></i>${label} <b>${val}</b></div>`;
  const n = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : String(v));
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
        const at = (col: number) => (u.data[col] as (number | null)[])[idx];
        const when = new Date((u.data[0] as number[])[idx] * 1000).toLocaleString(undefined, {
          month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const pct = at(1);
        el.innerHTML = `<div class="t">${when}</div>`
          + row(CSS('--text-2'), 'expected', n(at(4)))
          + row(CSS('--ok'), 'received', n(at(2)))
          + row(CSS('--crit'), 'lost', n(at(3)))
          + row(CSS('--warn'), 'loss', pct === null || pct === undefined ? '—' : `${pct.toFixed(1)}%`);
        el.style.display = 'block';
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        const flip = (left ?? 0) > u.over.clientWidth * 0.6;
        el.style.transform = flip ? 'translate(calc(-100% - 12px), -50%)' : 'translate(12px, -50%)';
      },
    },
  };
}

/**
 * Packet-loss chart: a loss-% line (left axis) whose tooltip also surfaces the raw
 * expected/received/lost counts. Pair with {@link lossData}.
 */
export function lossOptions(): Omit<uPlot.Options, 'width' | 'height'> {
  const crit = CSS('--crit');
  return {
    scales: { x: { time: true } },
    axes: axes('%'),
    cursor,
    legend: { show: false },
    plugins: [lossTooltip()],
    series: [
      {},
      {
        label: 'loss %', stroke: crit, fill: `${crit}22`, width: 1.6, points: { show: false },
      },
      // Carried for the tooltip only (separate scale, not drawn).
      { label: 'received', scale: 'cnt', show: false },
      { label: 'lost', scale: 'cnt', show: false },
      { label: 'expected', scale: 'cnt', show: false },
    ],
  };
}

/** Aligned data for {@link lossOptions}: [t, lossPct, received, lost, expected]. */
export function lossData(series: { t: string }[]): uPlot.AlignedData {
  const get = (p: { t: string }, k: string) => {
    const v = (p as Record<string, unknown>)[k];
    return typeof v === 'number' ? v : null;
  };
  return aligned(
    series.map((p) => Date.parse(p.t) / 1000),
    series.map((p) => { const r = get(p, 'loss_rate'); return r === null ? null : r * 100; }),
    series.map((p) => get(p, 'received')),
    series.map((p) => get(p, 'missing')),
    series.map((p) => { const r = get(p, 'received'); const m = get(p, 'missing'); return r === null || m === null ? null : r + m; }),
  );
}

/** Tooltip for the event timeline: shows the exact arrival time and f_cnt of an uplink. */
function eventTooltip(): uPlot.Plugin {
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
        const when = new Date((u.data[0] as number[])[idx] * 1000).toLocaleString(undefined, {
          month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        });
        const fcnt = (u.data[2] as (number | null)[])[idx];
        el.innerHTML = `<div class="t">${when}</div><div class="r"><i style="background:${CSS('--accent')}"></i>f_cnt <b>${fcnt ?? '—'}</b></div>`;
        el.style.display = 'block';
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        const flip = (left ?? 0) > u.over.clientWidth * 0.6;
        el.style.transform = flip ? 'translate(calc(-100% - 12px), -50%)' : 'translate(12px, -50%)';
      },
    },
  };
}

/**
 * Event-timeline options: one point per uplink at its real timestamp, all on a single row
 * (y is meaningless and hidden). Density shows the arrival pattern. Pair with {@link eventData}.
 */
export function eventTimelineOptions(): Omit<uPlot.Options, 'width' | 'height'> {
  const c = CSS('--accent');
  return {
    scales: { x: { time: true }, y: { range: () => [0, 2] } },
    axes: [
      { stroke: axisStroke, grid: grid(), ticks: { stroke: CSS('--border'), width: 1 } },
      { show: false },
    ],
    cursor,
    legend: { show: false },
    plugins: [eventTooltip()],
    series: [
      {},
      {
        label: 'uplink', stroke: c, width: 0, points: { show: true, size: 5, fill: c },
      },
      { label: 'f_cnt', scale: 'cnt', show: false },
    ],
  };
}

/** Aligned data for {@link eventTimelineOptions}: [t, constant-1, f_cnt]. */
export function eventData(series: { t: string }[]): uPlot.AlignedData {
  return aligned(
    series.map((p) => Date.parse(p.t) / 1000),
    series.map(() => 1),
    series.map((p) => {
      const v = (p as Record<string, unknown>).f_cnt;
      return typeof v === 'number' ? v : null;
    }),
  );
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
        label: 'min', stroke: `${color}aa`, width: 1, points: { show: false },
      },
      {
        label: 'max', stroke: `${color}aa`, width: 1, points: { show: false },
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
