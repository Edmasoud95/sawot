import assert from "node:assert/strict";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { remarkChatMermaid } from "../src/lib/chatMermaid.ts";

function blocks(source: string, streaming = true) {
  const processor = unified().use(remarkParse).use(remarkChatMermaid, { streaming }).use(remarkRehype);
  const tree = processor.runSync(processor.parse(source), { value: source });
  const codes: any[] = [];
  const visit = (node: any) => {
    if (node.tagName === "code") codes.push(node);
    node.children?.forEach(visit);
  };
  visit(tree);
  return codes;
}

test("streaming diagrams wait for a matching closing fence", () => {
  for (const source of ["```mermaid\nflowchart LR\nA-->B", "````mermaid\nA-->B\n```", "~~~mermaid\nA-->B\n```", "```mermaid\nA-->B\n```oops"]) {
    assert.equal(blocks(source)[0].properties.dataMermaidPending, true);
  }
});

test("closed diagrams render while later text is still streaming", () => {
  for (const source of ["```mermaid\nflowchart LR\nA-->B\n```\nMore text", "~~~mermaid\nA-->B\n~~~~", "> ```mermaid\n> A-->B\n> ```", "- ```mermaid\n  A-->B\n  ```"]) {
    assert.equal(blocks(source)[0].properties.dataMermaidPending, false);
  }
});

test("saved messages can render Markdown's EOF-terminated fences", () => {
  assert.equal(blocks("```mermaid\nflowchart LR\nA-->B", false)[0].properties.dataMermaidPending, false);
});

test("ordinary code and inline Mermaid mentions stay ordinary code", () => {
  for (const code of blocks("`mermaid`\n\n```js\nconst x = 1;\n```")) {
    assert.equal(code.properties.dataMermaidPending, undefined);
  }
});

test("structured chart fences wait until closed and retain raw JSON", () => {
  const json = '{"charts_widget_v2":{"content":{}}}';
  const pending = blocks('```json\n' + json)[0];
  assert.equal(pending.properties.dataMermaidPending, true);
  assert.deepEqual(pending.properties.className, ['language-charts_widget_v2']);
  const ready = blocks('```json\n' + json + '\n```')[0];
  assert.equal(ready.properties.dataMermaidPending, false);
  assert.equal(ready.children[0].value, json + '\n');
  assert.equal(blocks('```json\n{"other":1}\n```')[0].properties.dataMermaidPending, undefined);
});
