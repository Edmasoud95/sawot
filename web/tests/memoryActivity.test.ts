import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../node_modules/esbuild/lib/main.js';

const {outputFiles} = await build({
  stdin: {contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import MemoryActivity from './components/chat/MemoryActivity'; export const render = events => renderToStaticMarkup(React.createElement(MemoryActivity,{events}));`,resolveDir:new URL('../src',import.meta.url).pathname},
  bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',define:{'import.meta.env':'{}'},
  banner:{js:`import {createRequire} from 'node:module'; const require=createRequire(${JSON.stringify(new URL('../package.json',import.meta.url).pathname)});`},
});
Object.assign(globalThis,{location:{protocol:'http:',host:'localhost'},localStorage:{getItem:()=>null},window:{matchMedia:()=>({matches:false})}});
const directory=await mkdtemp(join(tmpdir(),'sawot-memory-activity-'));
let render:(events:any[])=>string;
try {
  const file=join(directory,'memory.mjs');
  await writeFile(file,outputFiles[0].text);
  ({render}=await import(pathToFileURL(file).href));
} finally {await rm(directory,{recursive:true,force:true});}
const event=(id:string,kind='recalled',memories=[{id:'fact-'+id,revision:1}])=>({id,kind,memories,created:'2026-10-12T12:00:00Z'});

test('adjacent recalls display one count without duplicating repeated memories',()=>{
  const events=[event('a','recalled',[{id:'one',revision:1},{id:'two',revision:1}]),event('b','recalled',[{id:'two',revision:1},{id:'three',revision:1}])];
  const original=JSON.stringify(events);
  const html=render(events);
  assert.equal((html.match(/Memories recalled/g)??[]).length,1);
  assert.match(html,/tool-activity-detail">3</);
  assert.equal(JSON.stringify(events),original);
});

test('writes separate recall groups and keep chronological order',()=>{
  const html=render([event('a'),event('b'),event('c','saved'),event('d'),event('e'),event('f','updated'),event('g','deleted')]);
  assert.equal((html.match(/Memories recalled/g)??[]).length,2);
  assert.match(html,/Memories recalled[\s\S]*Memory saved[\s\S]*Memories recalled[\s\S]*Memory updated[\s\S]*Memory deleted/);
});
