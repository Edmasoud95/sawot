import assert from "node:assert/strict";
import test from "node:test";
import { parseChartWidget, chartDomain } from "../src/lib/chartWidget.ts";

const example = {
  chartType: "pie", meta: { title: "Example time allocation", description: "Illustrative percentages, totaling 100%." },
  series: [{ dataKey: "percentage", label: "Share", valueSuffix: "%" }],
  nameKey: "activity", valueKey: "percentage",
  data: [{ activity: "Development", percentage: 50 }, { activity: "Testing", percentage: 25 },
    { activity: "Planning", percentage: 15 }, { activity: "Documentation", percentage: 10 }],
};
const encode = (content: any) => JSON.stringify({ charts_widget_v2: { content } });

test("accepts the supplied envelope and preserves labels and units", () => {
  assert.deepEqual(parseChartWidget(encode(example)), example);
});
test("ordinary JSON and malformed widgets fall back to source", () => {
  for (const text of ['{"hello":42}', '{"charts_widget_v2":', 'null', '[]', encode({ ...example, chartType: "unknown" })]) {
    assert.equal(parseChartWidget(text), null);
  }
});
test("rejects missing values, non-numbers, empty and oversized data", () => {
  for (const data of [[], [{activity:"A"}], [{activity:"A",percentage:"50"}], [{percentage:10}], Array(201).fill(example.data[0])]) {
    assert.equal(parseChartWidget(encode({...example,data})), null);
  }
  assert.equal(parseChartWidget(encode(example).replace('50', '1e999')), null);
});
test("pie needs nonnegative values and a finite positive total", () => {
  for (const values of [[-1,2],[0,0],[1e308,1e308]]) {
    assert.equal(parseChartWidget(encode({...example,data:values.map(percentage=>({activity:'A',percentage}))})), null);
  }
});
test("bar and line charts accept signed multiple series and a zero baseline", () => {
  for (const chartType of ['bar','line']) {
    const chart = parseChartWidget(encode({...example,chartType,series:[...example.series,{dataKey:'other',label:'Other'}],data:[{activity:'A',percentage:-10,other:20}]}));
    assert.ok(chart);
    assert.deepEqual(chartDomain(chart), [-10,20]);
  }
  const zero = parseChartWidget(encode({...example,chartType:'bar',data:[{activity:'A',percentage:0}]}))!;
  assert.deepEqual(chartDomain(zero), [0,1]);
});

test("horizontal stacked bars include positive and negative stack totals", () => {
  const chart = parseChartWidget(encode({...example,chartType:'bar',orientation:'horizontal',stacked:true,
    series:[{dataKey:'a',label:'A'},{dataKey:'b',label:'B'}],
    data:[{activity:'First',a:20,b:30},{activity:'Second',a:-10,b:-20}]}))!;
  assert.ok(chart);
  assert.deepEqual(chartDomain(chart), [-30,50]);
});

test("scatter requires numeric X values and accepts numeric Y series", () => {
  const scatter = {...example,chartType:'scatter',nameKey:'hours',series:[{dataKey:'score',label:'Score'}],data:[{hours:2,score:40},{hours:5,score:85}]};
  assert.ok(parseChartWidget(encode(scatter)));
  assert.equal(parseChartWidget(encode({...scatter,data:[{hours:'Monday',score:40}]})),null);
});
