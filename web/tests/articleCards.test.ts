import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../node_modules/esbuild/lib/main.js';
const { outputFiles } = await build({
  stdin: { contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { Markdown, MessageBody } from './components/chat/Message'; export const render = (text, streaming=false, search=null) => renderToStaticMarkup(React.createElement(Markdown, {streaming, search}, text)); export const renderBody = (text, search) => renderToStaticMarkup(React.createElement(MessageBody, {message: {content:text}, search}));`, resolveDir: new URL('../src', import.meta.url).pathname },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', define: {'import.meta.env': '{}'},
  banner: {js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(new URL('../package.json', import.meta.url).pathname)});`},
  plugins: [{name: 'unused-diagram', setup(b) { b.onResolve({filter: /^mermaid$/}, () => ({path:'mermaid', namespace:'stub'})); b.onLoad({filter: /.*/, namespace:'stub'}, () => ({contents:'export default {}'})); }}],
});
Object.assign(globalThis, { location: {protocol: 'http:', host: 'localhost'}, localStorage: {getItem: () => null}, window: {matchMedia: () => ({matches: false})} });
const directory = await mkdtemp(join(tmpdir(), 'sawot-card-test-'));
let render: (text: string, streaming?: boolean, search?: any) => string;
let renderBody: (text: string, search: any) => string;
try {
  const file = join(directory, 'cards.mjs');
  await writeFile(file, outputFiles![0].text);
  ({ render, renderBody } = await import(pathToFileURL(file).href));
} finally { await rm(directory, { recursive: true, force: true }); }
const article = 'https://example.org/news/2026/new-discovery';
const cards = (html: string) => (html.match(/class="chat-article-card"/g) ?? []).length;
test('standalone, bold list headlines, reference links and bare URLs render visible cards', () => {
  for (const text of [`[A new discovery](${article})`, `1. **[A new discovery](${article})** — A useful summary.`, `### [A new discovery](${article})`, `${article}`, `[A new discovery][story]\n\n[story]: ${article}`]) {
    const html = render(text);
    assert.equal(cards(html), 1, text);
    assert.match(html, /target="_blank"/); assert.match(html, /noopener noreferrer/);
    assert.match(html, /example.org/);
    if (text.includes('summary')) assert.match(html, /A useful summary/);
  }
});
test('prose citations, multiple inline links, code, images and unsafe links keep their layout', () => {
  for (const text of [`According to [the report](${article}), this is new.`, `[The report](${article}) describes the discovery.`, `[One](${article}) and [two](https://example.org/other)`, `[1](${article})`, '`'+article+'`', `[![photo](https://example.org/a.png)](${article})`, '[Bad](javascript:alert)', '[Local](/settings)', '| Source |\n| --- |\n| [News]('+article+') |']) assert.equal(cards(render(text)), 0, text);
});
test('an unfinished streaming block waits before fetching an article picture', () => {
  assert.equal(cards(render(`[A new discovery](${article})`, true)), 0);
  assert.equal(cards(render(`[A new discovery](${article})\n\nMore details`, true)), 1);
});
test('bare article URLs use matching saved source titles', () => {
  const html = render(article, false, {tool:'web_search', phase:'complete', sources:[{url:article, title:'Scientists announce a new discovery', read:false}]});
  assert.equal(cards(html), 1); assert.match(html, /Scientists announce a new discovery/);
});

const products = { product_cards_v1: { title: 'Headphones', items: [
  { title: 'Studio headphones', url: 'https://shop.example/headphones', price: '€129', description: 'Wired, closed back.' },
  { title: 'Travel headphones', url: 'https://store.example/travel' },
] } };
test('product recommendations render a dedicated carousel with product details', () => {
  const html = render('```json\n' + JSON.stringify(products) + '\n```');
  assert.match(html, /class="chat-products"/);
  assert.match(html, /class="chat-products-track"/);
  assert.match(html, /Studio headphones/); assert.match(html, /€129/);
  assert.match(html, /Wired, closed back/); assert.match(html, /shop.example/);
  assert.doesNotMatch(html, /product_cards_v1/);
});
test('streamed products wait for a closed fence instead of showing incomplete shopping cards', () => {
  const html = render('```json\n' + JSON.stringify(products), true);
  assert.doesNotMatch(html, /chat-products-track/);
  assert.doesNotMatch(html, /product_cards_v1/);
  assert.match(render('```json\n' + JSON.stringify(products) + '\n```', true), /chat-products-track/);
});
test('malformed or unsafe product data never becomes shopping links', () => {
  for (const items of [[], [{title:'Unsafe',url:'javascript:alert(1)'}], [{title:'Credential',url:'https://user:pass@example.org/p'}], [{title:'Missing URL'}], Array(13).fill(products.product_cards_v1.items[0])]) {
    assert.doesNotMatch(render('```json\n'+JSON.stringify({product_cards_v1:{title:'Products',items}})+'\n```'), /chat-products-track/);
  }
  assert.doesNotMatch(render('```json\n{"ordinary":true}\n```'), /chat-products-track/);
});

const selectedSearch = {tool:'web_search',phase:'complete',presentationVersion:1,sources:[
  {id:'r1',url:'https://shop.example/one',title:'Selected product',read:false},
  {id:'r2',url:'https://shop.example/two',title:'Unselected product',read:false},
]};
test('plain prose renders only selected server results, without model card markup', () => {
  const html=renderBody('This option fits your budget.', {...selectedSearch,presentations:[{kind:'products',ids:['r1']}]});
  assert.match(html,/chat-products-track/);assert.match(html,/Selected product/);assert.doesNotMatch(html,/Unselected product/);
  assert.doesNotMatch(renderBody('Normal answer', {...selectedSearch,presentations:[]}),/chat-article-card/);
  assert.doesNotMatch(renderBody('[Citation](https://shop.example/one)', {...selectedSearch,presentations:[]}),/chat-article-card/);
  assert.doesNotMatch(renderBody('```json\n'+JSON.stringify(products)+'\n```', {...selectedSearch,presentations:[]}),/chat-product-card|product_cards_v1/);
});
test('blocked selected pages remain plain links and invalid IDs do not promote other results', () => {
  const blocked={...selectedSearch,phase:'error',sources:selectedSearch.sources.map(s=>({...s,blocked:true})),presentations:[{kind:'news',ids:['r1']}]};
  const html=renderBody('The publisher blocks page access.',blocked);
  assert.match(html,/href="https:\/\/shop.example\/one"/);assert.doesNotMatch(html,/chat-article-card|chat-products-track|<img/);
  assert.doesNotMatch(renderBody('Answer',{...selectedSearch,presentations:[{kind:'products',ids:['r99']}]}),/chat-products-track/);
});

test('old card markup from a model falls back to known plain links in selection mode', () => {
  const old={product_cards_v1:{title:'Products',items:[{title:'Invented title',url:'https://shop.example/one'}]}};
  const html=renderBody('```json\n'+JSON.stringify(old)+'\n```',{...selectedSearch,presentations:[]});
  assert.match(html,/href="https:\/\/shop.example\/one"/);assert.match(html,/Selected product/);
  assert.doesNotMatch(html,/chat-product-card|Invented title|Unselected product/);
});
