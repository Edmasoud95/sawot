/** Promote headline links, while leaving citations and links within prose inline. */
export function rehypeArticleCards({ streaming = false, enabled = true } = {}) {
  return (tree: any, file: any) => {
    if (!enabled) return;
    const end = String(file.value).trimEnd().length;
    const text = (node: any): string => node.type === 'text' ? node.value : (node.children ?? []).map(text).join('');
    const visit = (node: any, excluded = false) => {
      excluded ||= ['table', 'pre', 'blockquote'].includes(node.tagName);
      if (!excluded && ['p', 'li', 'h2', 'h3', 'h4'].includes(node.tagName) &&
          !(streaming && node.position?.end?.offset >= end)) {
        const children = (node.children ?? []).filter((child: any) => child.type !== 'text' || child.value.trim());
        let first = children[0];
        while (['strong', 'em'].includes(first?.tagName) && first.children?.length === 1) first = first.children[0];
        const links: any[] = [];
        let hasImage = false;
        const scan = (child: any) => {
          if (child.tagName === 'a') links.push(child);
          if (child.tagName === 'img') hasImage = true;
          child.children?.forEach(scan);
        };
        scan(node);
        const trailing = first?.tagName === 'a' ? text(node).trim().slice(text(first).trim().length).trim() : '';
        if (first?.tagName === 'a' && links.length === 1 && !hasImage && (!trailing || /^[—–:\-]\s/.test(trailing)) && !/^\[?\d+\]?$/.test(text(first).trim())) {
          try {
            const url = new URL(first.properties.href);
            if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) first.properties.dataArticleCard = true;
          } catch { /* Relative and malformed links keep ordinary rendering. */ }
        }
      }
      node.children?.forEach((child: any) => visit(child, excluded));
      if (!excluded && ['ul', 'ol'].includes(node.tagName)) {
        const items = node.children.filter((child: any) => child.tagName === 'li');
        const hasCard = (child: any): boolean => child.properties?.dataArticleCard || child.children?.some(hasCard);
        if (items.length && items.every(hasCard)) node.properties.className = [...(node.properties.className ?? []), 'chat-article-list'];
      }
    };
    visit(tree);
  };
}
