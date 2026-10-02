export interface ChartSeries { dataKey: string; label: string; valueSuffix?: string }
export interface ChartWidget {
  chartType: "bar" | "line" | "pie" | "scatter";
  meta: { title: string; description?: string };
  series: ChartSeries[];
  nameKey: string;
  valueKey?: string;
  orientation?: "horizontal" | "vertical";
  stacked?: boolean;
  data: Record<string, string | number>[];
}

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 500;
const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Only the named envelope opts JSON into a chart; invalid data remains source. */
export function parseChartWidget(source: string): ChartWidget | null {
  if (source.length > 150_000) return null;
  try {
    const c = JSON.parse(source)?.charts_widget_v2?.content;
    if (!c || !["bar", "line", "pie", "scatter"].includes(c.chartType)
      || !text(c.meta?.title) || (c.meta.description !== undefined && !text(c.meta.description))
      || !text(c.nameKey) || !Array.isArray(c.series) || !c.series.length || c.series.length > 8
      || !Array.isArray(c.data) || !c.data.length || c.data.length > 200
      || (c.orientation !== undefined && !["horizontal", "vertical"].includes(c.orientation))
      || (c.stacked !== undefined && typeof c.stacked !== "boolean")) return null;
    if (c.series.some((s: any) => !s || !text(s.dataKey) || !text(s.label)
      || (s.valueSuffix !== undefined && (typeof s.valueSuffix !== "string" || s.valueSuffix.length > 30)))) return null;
    if (new Set(c.series.map((s: ChartSeries) => s.dataKey)).size !== c.series.length) return null;
    if (c.chartType === "pie" && (!text(c.valueKey) || !c.series.some((s: ChartSeries) => s.dataKey === c.valueKey))) return null;
    if (c.data.some((row: any) => !row || typeof row !== "object" || Array.isArray(row)
      || !(c.chartType === "scatter" ? numeric(row[c.nameKey]) : text(row[c.nameKey]) || numeric(row[c.nameKey]))
      || c.series.some((s: ChartSeries) => !numeric(row[s.dataKey])))) return null;
    if (c.chartType === "pie") {
      const values = c.data.map((row: any) => row[c.valueKey]);
      const total = values.reduce((a: number, b: number) => a + b, 0);
      if (values.some((n: number) => n < 0) || !Number.isFinite(total) || total <= 0) return null;
    }
    const [min, max] = chartDomain(c);
    if (!Number.isFinite(max - min)) return null;
    if (c.chartType === "scatter") {
      const xs = c.data.map((r: any) => r[c.nameKey]);
      if (!Number.isFinite(Math.max(...xs) - Math.min(...xs))) return null;
    }
    return c;
  } catch { return null; }
}

export function chartDomain(chart: ChartWidget): [number, number] {
  let min = 0, max = 0;
  for (const row of chart.data) {
    let positive = 0, negative = 0;
    for (const s of chart.series) {
      const value = Number(row[s.dataKey]);
      if (chart.chartType === "bar" && chart.stacked) {
        positive += Math.max(0, value); negative += Math.min(0, value);
      } else { min = Math.min(min, value); max = Math.max(max, value); }
    }
    min = Math.min(min, negative); max = Math.max(max, positive);
  }
  return min === max ? [0, 1] : [min, max];
}
