import { useId, useState } from "react";
import { chartDomain, type ChartWidget as ChartData } from "../../lib/chartWidget";

const COLORS = ["#9aafd4", "#c7bfe4", "#8eb7bd", "#dbb18f", "#8796b3", "#b49bae", "#abc2a5", "#bcb6a5"];
const number = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
const tick = (value: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
const short = (value: string | number) => String(value).length > 12 ? `${String(value).slice(0, 11)}…` : String(value);

export default function ChartWidget({ chart }: { chart: ChartData }) {
  const titleId = useId();
  const [detail, setDetail] = useState("");
  const series = chart.chartType === "pie" ? chart.series.filter(s => s.dataKey === chart.valueKey) : chart.series;
  const describe = (i: number, j: number) => `${chart.chartType === "scatter" ? `${chart.nameKey}: ` : ""}${chart.data[i][chart.nameKey]} · ${series[j].label}: ${number(Number(chart.data[i][series[j].dataKey]))}${series[j].valueSuffix ?? ""}`;
  const interaction = (label: string) => ({
    tabIndex: 0, role: "button", "aria-label": label, "aria-pressed": detail === label,
    onFocus: () => setDetail(label), onMouseEnter: () => setDetail(label), onClick: () => setDetail(label),
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setDetail(label); } },
  });
  const [min, max] = chartDomain(chart);
  const horizontal = chart.chartType === "bar" && chart.orientation === "horizontal";
  const left = horizontal ? 90 : 42, right = 348, top = 12, bottom = 166;
  const span = max - min;
  const y = (value: number) => bottom - ((value - min) / span) * (bottom - top);
  const xValue = (value: number) => left + ((value - min) / span) * (right - left);
  const categorySize = (horizontal ? bottom - top : right - left) / chart.data.length;
  const xs = chart.data.map(row => Number(row[chart.nameKey]));
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const x = (i: number) => chart.chartType === "scatter"
    ? (xMin === xMax ? (left + right) / 2 : left + ((xs[i] - xMin) / (xMax - xMin)) * (right - left))
    : left + categorySize * (i + 0.5);
  const labelsEvery = Math.max(1, Math.ceil(chart.data.length / (horizontal ? 6 : 4)));

  let angle = -Math.PI / 2;
  const total = chart.chartType === "pie" ? chart.data.reduce((sum, row) => sum + Number(row[chart.valueKey!]), 0) : 1;

  return <figure className="chat-chart" aria-labelledby={titleId}>
    <figcaption>
      <div id={titleId} className="chat-chart-title">{chart.meta.title}</div>
      {chart.meta.description && <p className="chat-chart-description">{chart.meta.description}</p>}
    </figcaption>
    {chart.chartType === "pie" ? <div className="chat-chart-pie-layout">
      <svg className="chat-chart-pie" viewBox="0 0 160 160" aria-label={chart.meta.title} role="group">
        {chart.data.map((row, i) => {
          const fraction = Number(row[chart.valueKey!]) / total;
          const start = angle; angle += fraction * Math.PI * 2;
          const label = describe(i, 0);
          if (!fraction) return null;
          const props = { fill: COLORS[i % COLORS.length], ...interaction(label) };
          return fraction >= 1 ? <circle key={i} cx="80" cy="80" r="72" {...props}><title>{label}</title></circle>
            : <path key={i} d={`M80,80 L${80 + 72 * Math.cos(start)},${80 + 72 * Math.sin(start)} A72,72 0 ${fraction > .5 ? 1 : 0},1 ${80 + 72 * Math.cos(angle)},${80 + 72 * Math.sin(angle)} Z`}
              stroke="var(--color-ink-900)" strokeWidth="1.5" {...props}><title>{label}</title></path>;
        })}
      </svg>
      <div className="chat-chart-pie-legend">{chart.data.map((row, i) => <button type="button" key={i}
        onFocus={() => setDetail(describe(i, 0))} onMouseEnter={() => setDetail(describe(i, 0))} onClick={() => setDetail(describe(i, 0))}>
        <span className="chat-chart-swatch" style={{ background: COLORS[i % COLORS.length] }} />
        <span className="chat-chart-name">{row[chart.nameKey]}</span>
        <span className="chat-chart-value">{number(Number(row[chart.valueKey!]))}{series[0].valueSuffix}</span>
      </button>)}</div>
    </div> : <>
      <svg className="chat-chart-plot" viewBox="0 0 360 194" role="group" aria-label={chart.meta.title}>
        {[0, .5, 1].map(f => {
          const value = min + f * span;
          return <g key={f} className="chat-chart-axis">
            {horizontal ? <><line x1={xValue(value)} x2={xValue(value)} y1={top} y2={bottom} /><text x={xValue(value)} y={bottom + 19} textAnchor="middle">{tick(value)}</text></>
              : <><line x1={left} x2={right} y1={y(value)} y2={y(value)} /><text x={left - 7} y={y(value) + 4} textAnchor="end">{tick(value)}</text></>}
          </g>;
        })}
        {chart.chartType === "scatter" ? [0, .5, 1].map(f => <text className="chat-chart-label" key={f} x={left + f * (right - left)} y={bottom + 19} textAnchor="middle">{tick(xMin + f * (xMax - xMin))}</text>)
          : chart.data.map((row, i) => i % labelsEvery === 0 && <text key={i} className="chat-chart-label"
            x={horizontal ? left - 8 : x(i)} y={horizontal ? top + categorySize * (i + .5) + 4 : bottom + 19} textAnchor={horizontal ? "end" : "middle"}>
            {short(row[chart.nameKey])}<title>{String(row[chart.nameKey])}</title>
          </text>)}
        {chart.chartType === "bar" ? chart.data.flatMap((row, i) => {
          let positive = 0, negative = 0;
          return series.map((s, j) => {
            const value = Number(row[s.dataKey]);
            const start = chart.stacked ? (value >= 0 ? positive : negative) : 0;
            if (value >= 0) positive += value; else negative += value;
            const end = start + value;
            const thickness = categorySize * .65 / (chart.stacked ? 1 : series.length);
            const offset = categorySize * (i + .175) + (chart.stacked ? 0 : j * thickness);
            const label = describe(i, j);
            return <rect key={`${i}-${j}`} fill={COLORS[j]} rx={chart.stacked ? 0 : 2}
              x={horizontal ? Math.min(xValue(start), xValue(end)) : left + offset}
              y={horizontal ? top + offset : Math.min(y(start), y(end))}
              width={horizontal ? Math.abs(xValue(end) - xValue(start)) : thickness}
              height={horizontal ? thickness : Math.abs(y(end) - y(start))}
              {...interaction(label)}><title>{label}</title></rect>;
          });
        }) : series.map((s, j) => <g key={s.dataKey}>
          {chart.chartType === "line" && <polyline fill="none" stroke={COLORS[j]} strokeWidth="2" strokeLinejoin="round"
            points={chart.data.map((row, i) => `${x(i)},${y(Number(row[s.dataKey]))}`).join(" ")} />}
          {chart.data.map((row, i) => <g key={i}>
            <circle cx={x(i)} cy={y(Number(row[s.dataKey]))} r={chart.chartType === "scatter" ? 4 : 3}
              fill={COLORS[j]} stroke={detail === describe(i, j) ? "#edf0f6" : "none"} strokeWidth="2" />
            <circle className="chat-chart-hit" cx={x(i)} cy={y(Number(row[s.dataKey]))} r="12"
              fill="transparent" {...interaction(describe(i, j))}><title>{describe(i, j)}</title></circle>
          </g>)}
        </g>)}
      </svg>
      <div className="chat-chart-series">{series.map((s, j) => <span key={s.dataKey}><i className="chat-chart-swatch" style={{ background: COLORS[j] }} />{s.label}{s.valueSuffix ? ` (${s.valueSuffix})` : ""}</span>)}</div>
    </>}
    <div className="chat-chart-detail" aria-live="polite">{detail || "Focus or tap a value for details"}</div>
    <details className="chat-chart-data"><summary>View data</summary>
      <div className="chat-table-scroll" tabIndex={0} role="region" aria-label="Chart data">
        <table><thead><tr><th>{chart.nameKey}</th>{series.map(s => <th key={s.dataKey}>{s.label}</th>)}</tr></thead>
          <tbody>{chart.data.map((row, i) => <tr key={i}><td>{row[chart.nameKey]}</td>{series.map(s => <td key={s.dataKey}>{number(Number(row[s.dataKey]))}{s.valueSuffix}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  </figure>;
}
