import assert from "node:assert/strict";
import test from "node:test";
import rehypeHighlight from "rehype-highlight";
import { rehypeChatCodeLanguages } from "../src/lib/chatCodeLanguages.ts";

function highlighted(language: string, text: string, fenced = true) {
  const code: any = { type: "element", tagName: "code", properties: { className: [`language-${language}`] }, children: [{ type: "text", value: text }] };
  const tree: any = { type: "root", children: [{ type: "element", tagName: fenced ? "pre" : "p", properties: {}, children: [code] }] };
  rehypeChatCodeLanguages()(tree);
  rehypeHighlight()(tree, { message() {} } as any);
  return code;
}

test("shell scripts use Bash tokenization for keywords, strings and variables", () => {
  const script = 'if [ -n "$name" ]; then\n  echo "Hello $name"\nfi\n';
  const bash = highlighted("bash", script);
  const shell = highlighted("shell", script);
  assert.deepEqual(shell, bash);
  const rendered = JSON.stringify(shell);
  for (const token of ["hljs-keyword", "hljs-string", "hljs-variable", "hljs-built_in"]) assert.ok(rendered.includes(token), token);
});

test("console transcripts, unknown languages and inline code retain their behavior", () => {
  const console = highlighted("console", '$ echo "hello"\nhello\n');
  assert.ok(console.properties.className.includes("language-console"));
  assert.ok(JSON.stringify(console).includes("hljs-meta"));
  const unknown = highlighted("unknown-language", "plain source");
  assert.deepEqual(unknown.children, [{ type: "text", value: "plain source" }]);
  const inline = highlighted("shell", "echo hello", false);
  assert.deepEqual(inline.properties.className, ["language-shell"]);
  assert.deepEqual(inline.children, [{ type: "text", value: "echo hello" }]);
});
