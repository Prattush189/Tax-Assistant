import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

const COLORS = ['#f97316', '#6366f1', '#10b981', '#f43f5e', '#8b5cf6', '#eab308'];

interface ChartRendererProps {
  jsonString: string;
}

export function ChartRenderer({ jsonString }: ChartRendererProps) {
  try {
    const chartData = JSON.parse(jsonString);
    const { type, data, title } = chartData;

    function renderChart() {
      switch (type) {
        case 'bar':
          return (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
              <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
              <YAxis fontSize={12} stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                itemStyle={{ color: '#fff' }}
              />
              <Bar dataKey="value" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          );
        case 'pie':
          return (
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
              >
                {data.map((_: unknown, index: number) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend />
            </PieChart>
          );
        case 'line':
          return (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
              <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
              <YAxis fontSize={12} stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend />
              {(chartData.lines ?? ['value']).map((key: string, i: number) => (
                <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          );
        case 'stacked-bar':
          return (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
              <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
              <YAxis fontSize={12} stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend />
              {(chartData.keys ?? ['value']).map((key: string, i: number) => (
                <Bar key={key} dataKey={key} stackId="a" fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          );
        case 'composed':
          return (
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
              <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
              <YAxis fontSize={12} stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend />
              {(chartData.bars ?? []).map((key: string, i: number) => (
                <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
              {(chartData.lines ?? []).map((key: string, i: number) => (
                <Line key={key} type="monotone" dataKey={key} stroke={COLORS[(i + 3) % COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </ComposedChart>
          );
        default:
          return null;
      }
    }

    const chart = renderChart();
    if (chart === null) return null;

    return (
      <div className="my-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
        {title && <h4 className="text-sm font-semibold mb-4 text-slate-700 dark:text-slate-300">{title}</h4>}
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {chart}
          </ResponsiveContainer>
        </div>
      </div>
    );
  } catch (e) {
    return null;
  }
}
