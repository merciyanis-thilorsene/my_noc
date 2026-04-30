import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

export type SeriesDef = {
  key: string;
  color: string;
  label?: string;
  yAxisId?: 'left' | 'right';
};

type Point = Record<string, unknown>;

export function TimeSeries({
  data, xKey, series, height = 220, showLegend = true, formatX,
}: {
  data: Point[];
  xKey: string;
  series: SeriesDef[];
  height?: number;
  showLegend?: boolean;
  formatX?: (v: unknown) => string;
}) {
  const hasRight = series.some((s) => s.yAxisId === 'right');
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#15202e" strokeDasharray="2 4" />
        <XAxis
          dataKey={xKey}
          stroke="#5a6e80"
          fontSize={11}
          tickFormatter={formatX ?? ((v) => String(v))}
          minTickGap={30}
        />
        <YAxis yAxisId="left" stroke="#5a6e80" fontSize={11} width={40} />
        {hasRight && <YAxis yAxisId="right" orientation="right" stroke="#5a6e80" fontSize={11} width={40} />}
        <Tooltip
          contentStyle={{ background: '#0c1118', border: '1px solid #15202e', fontSize: 12 }}
          labelStyle={{ color: '#dce4ec' }}
          labelFormatter={(v) => (formatX ? formatX(v) : String(v))}
        />
        {showLegend && <Legend wrapperStyle={{ fontSize: 11, color: '#dce4ec' }} />}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label ?? s.key}
            stroke={s.color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            yAxisId={s.yAxisId ?? 'left'}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
