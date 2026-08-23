// Compact pill for a tool invocation. Args render as a short inline summary;
// the full payload lives in the title attr. Error results tint ember-red.
const summarize = (args) => {
  if (!args || typeof args !== "object") return "";
  const parts = Object.entries(args).map(
    ([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`
  );
  const s = parts.join(" ");
  return s.length > 42 ? `${s.slice(0, 42)}…` : s;
};

export default function ToolChip({ tool }) {
  const isError = (tool.result || "").includes('"error"');
  const summary = summarize(tool.args);
  return (
    <span
      title={`${tool.name}(${JSON.stringify(tool.args ?? {})})${
        tool.result ? `\n→ ${tool.result}` : ""
      }`}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-3 font-mono text-[0.62rem] tracking-[0.04em] ${
        isError
          ? "border-aurora-ember/40 bg-aurora-ember/10 text-aurora-ember"
          : "border-white/10 bg-white/[0.04] text-zinc-400"
      }`}
    >
      <span aria-hidden="true" className={isError ? "" : "text-aurora-teal/70"}>
        ⚙
      </span>
      <span className="shrink-0">{tool.name}</span>
      {summary && (
        <span className={`truncate ${isError ? "text-aurora-ember/70" : "text-zinc-600"}`}>
          {summary}
        </span>
      )}
    </span>
  );
}
