import { useEffect, useId, useState, type ReactNode } from "react";

let engine: Promise<typeof import("mermaid")["default"]> | undefined;
function loadMermaid() {
  return engine ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      fontFamily: "Instrument Sans, sans-serif",
      flowchart: { diagramPadding: 8, nodeSpacing: 24, rankSpacing: 32 },
      xyChart: {
        width: 360, height: 240, titleFontSize: 15, titlePadding: 8,
        xAxis: { labelFontSize: 13, titleFontSize: 13, showTick: false },
        yAxis: { labelFontSize: 12, titleFontSize: 13, titlePadding: 10, showTick: false },
      },
      themeVariables: {
        darkMode: true, fontSize: "14px", background: "#11141c", primaryColor: "#1b202c",
        primaryTextColor: "#dce1ed", primaryBorderColor: "#59677e",
        lineColor: "#8390a6", secondaryColor: "#30384b", tertiaryColor: "#222734",
        xyChart: {
          backgroundColor: "#11141c", titleColor: "#dce1ed",
          xAxisLabelColor: "#a3aec3", xAxisTitleColor: "#a3aec3",
          yAxisLabelColor: "#a3aec3", yAxisTitleColor: "#a3aec3",
          xAxisLineColor: "#394354", yAxisLineColor: "#394354",
          plotColorPalette: "#8fa9d2,#c7bfe4,#b0cddd,#e6b58a,#788ba8,#a49aba",
        },
        pie1: "#8fa9d2", pie2: "#c7bfe4", pie3: "#b0cddd", pie4: "#e6b58a",
        pie5: "#788ba8", pie6: "#a49aba", pie7: "#6e929d", pie8: "#b29886",
        pie9: "#647899", pie10: "#8f87a5", pie11: "#8ab0bb", pie12: "#cfb09a",
        pieStrokeColor: "#11141c", pieStrokeWidth: "2px", pieOuterStrokeWidth: "0px",
        pieTitleTextColor: "#dce1ed", pieTitleTextSize: "24px",
        pieSectionTextColor: "#11141c", pieSectionTextSize: "22px",
        pieLegendTextColor: "#a3aec3", pieLegendTextSize: "22px",
      },
    });
    return mermaid;
  }).catch(error => { engine = undefined; throw error; });
}

export default function MermaidBlock({ source, pending, children }: {
  source: string; pending: boolean; children: ReactNode;
}) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [result, setResult] = useState<{ source: string; svg?: string; failed?: boolean }>();

  useEffect(() => {
    if (pending) return;
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        await document.fonts.ready;
        if (cancelled) return;
        const { svg } = await mermaid.render(id, source);
        const diagram = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
        const width = Number(diagram.getAttribute("viewBox")?.split(/\s+/)[2]);
        if (Number.isFinite(width) && width > 0) diagram.setAttribute("width", String(width));
        if (!cancelled) setResult({ source, svg: diagram.outerHTML });
      } catch {
        if (!cancelled) setResult({ source, failed: true });
      }
    })();
    return () => { cancelled = true; };
  }, [id, source, pending]);

  const current = !pending && result?.source === source ? result : undefined;
  if (!current?.svg) return <>
    {current?.failed && <p className="text-sm text-zinc-400">Could not render diagram. Source shown below.</p>}
    {children}
  </>;

  return <div className="chat-mermaid" role="region" aria-label="Mermaid diagram" tabIndex={0}
    dangerouslySetInnerHTML={{ __html: current.svg }} />;
}
