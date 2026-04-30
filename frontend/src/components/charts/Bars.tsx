import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

type Point = Record<string, unknown>;

export function Bars({
  data, xKey, yKey, color, height = 220, formatX,
}: {
  data: Point[];
  xKey: string;
  yKey: string;
  color: string;
  height?: number;
  formatX?: (v: unknown) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#15202e" strokeDasharray="2 4" />
        <XAxis
          dataKey={xKey}
          stroke="#5a6e80"
          fontSize={11}
          tickFormatter={formatX ?? ((v) => String(v))}
          minTickGap={30}
        />
        <YAxis stroke="#5a6e80" fontSize={11} width={40} />
        <Tooltip
          contentStyle={{ background: '#0c1118', border: '1px solid #15202e', fontSize: 12 }}
          labelStyle={{ color: '#dce4ec' }}
          labelFormatter={(v) => (formatX ? formatX(v) : String(v))}
        />
        <Bar dataKey={yKey} fill={color} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
