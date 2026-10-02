# Charts in chat

Chat renders `charts_widget_v2` JSON envelopes as interactive charts. Put the
envelope in a fenced `json` (or `charts_widget_v2`) block. Completed blocks render
during streaming; invalid charts remain readable as source. Saved messages also
support a standalone JSON envelope. Mermaid remains available for diagrams.

```json
{
  "charts_widget_v2": {
    "content": {
      "chartType": "pie",
      "meta": { "title": "Example allocation", "description": "Illustrative percentages." },
      "series": [{ "dataKey": "percentage", "label": "Share", "valueSuffix": "%" }],
      "nameKey": "activity",
      "valueKey": "percentage",
      "data": [
        { "activity": "Development", "percentage": 60 },
        { "activity": "Testing", "percentage": 40 }
      ]
    }
  }
}
```

Supported `content.chartType` values:

| Type | Data and options |
| --- | --- |
| `bar` | Compare categories. Add `orientation: "horizontal"` and/or `stacked: true`. Positive and negative stacks are separate. |
| `line` | Trends in the supplied row order. `nameKey` provides axis labels. |
| `pie` | Nonnegative parts of a positive total. `valueKey` selects a field also listed in `series`. |
| `scatter` | `nameKey` selects a numeric X field; each series' `dataKey` selects numeric Y values. |

Every series needs a `dataKey` and `label`; `valueSuffix` is optional. Every row
must include the selected fields. Values must be finite numbers. Up to 200 rows
and 8 series are accepted. Pie charts display the supplied values and units;
percentages are not invented or automatically substituted for raw values.

Tap, click, hover, or focus a mark to reveal its category/X value, series, and
exact value below the chart. Scatter and line points have enlarged hit targets.
Keyboard users can tab to marks and use Enter or Space. **View data** exposes all
values in a table, including labels shortened on the plotted axes.

For example, a scatter chart can use `nameKey: "hours"`, a series with
`dataKey: "score"`, and rows such as `{ "hours": 2, "score": 40 }`.
