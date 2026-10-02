/** Preserve fence completion before Markdown discards its delimiters. */
export function remarkChatMermaid({ streaming = false } = {}) {
  return (tree: any, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (node: any) => {
      const lang = node.lang?.toLowerCase();
      const chart = lang === "charts_widget_v2" || (lang === "json" && /^\s*\{\s*"charts_widget_v2"\s*:/.test(node.value));
      if (node.type === "code" && (lang === "mermaid" || chart)) {
        const fragment = source.slice(node.position.start.offset, node.position.end.offset);
        const lines = fragment.split(/\r?\n/);
        const opening = /^(`{3,}|~{3,})/.exec(lines[0]);
        const closing = /^[\s>]*(`{3,}|~{3,})\s*$/.exec(lines[lines.length - 1] ?? "");
        const closed = lines.length > 1 && opening && closing
          && opening[1][0] === closing[1][0] && closing[1].length >= opening[1].length;
        node.lang = chart ? "charts_widget_v2" : "mermaid";
        node.data = { ...node.data, hProperties: {
          ...node.data?.hProperties, dataMermaidPending: Boolean(streaming && !closed),
        } };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
