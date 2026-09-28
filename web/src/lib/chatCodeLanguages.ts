/** Models commonly label shell scripts `shell`; `console` remains a transcript. */
export function rehypeChatCodeLanguages() {
  return (tree: any) => {
    const visit = (node: any, parent?: any) => {
      if (parent?.tagName === "pre" && node.tagName === "code" && Array.isArray(node.properties?.className)) {
        node.properties.className = node.properties.className.map((name: string) =>
          /^language-shell$/i.test(name) ? "language-bash" : name,
        );
      }
      node.children?.forEach((child: any) => visit(child, node));
    };
    visit(tree);
  };
}
