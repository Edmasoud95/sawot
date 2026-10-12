import assert from 'node:assert/strict';
import test from 'node:test';
import { runChat, toOpenAiMessages } from '../src/chat.js';
import { buildSearchTools } from '../src/search.js';
import { executeTool } from '../src/tools.js';
import Fastify from 'fastify';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatStore } from '../src/chat.js';
import { registerChatRoutes } from '../src/chatRoutes.js';
const lookup = async () => ['93.184.216.34'];
test('403 blocks repeated reads and find requests, including redirect aliases', async () => {
  const requests: string[] = [];
  const tools = buildSearchTools({search: async () => []}, {lookup, fetchFn: async url => {
    requests.push(String(url));
    return String(url).endsWith('/redirect') ? new Response(null,{status:302,headers:{location:'/blocked'}}) : new Response('',{status:403});
  }});
  const first = await executeTool(tools,'fetch_page',{url:'https://blocked.example/redirect'});
  assert.equal(first.status,403);assert.equal(first.retryable,false);assert.equal(first.link_only,true);
  for(const url of ['https://blocked.example/redirect#again','https://blocked.example/blocked']){
    const result = await executeTool(tools,'find_in_page',{url,query:'price'});
    assert.equal(result.link_only,true);assert.equal(result.retryBlocked,true);
  }
  assert.deepEqual(requests,['https://blocked.example/redirect','https://blocked.example/blocked']);
});
function model(turns: any[], observed: any[] = []) {
  let round = 0;
  return { chat: { completions: { create: async request => {
    observed.push(structuredClone(request));
    return (async function* () { yield { choices: [{ delta: turns[round++] ?? { content: 'Final answer' } }] }; })();
  } } } };
}
let callId=0;
const call = (name:string,args:any) => ({tool_calls:[{index:0,id:String(++callId),function:{name,arguments:JSON.stringify(args)}}]});
const search = {name:'web_search',description:'Search',parameters:{},handler:async()=>({results:[{title:'First product',url:'https://shop.example/products/one'},{title:'Second product',url:'https://shop.example/products/two',thumbnail:'https://imgs.search.brave.com/two'}]})};
test('older saved direct-product selections are classified on reload without rewriting history', () => {
  const dir=mkdtempSync(join(tmpdir(),'sawot-old-products-'));
  try {
    const store=new ChatStore(dir);
    const conv=store.create('small');
    conv.messages=[{role:'assistant',content:'Saved answer',search:{presentationVersion:1,presentations:[{kind:'products',ids:['r1']}],sources:[{id:'r1',url:'https://allegro.pl/oferta/console-123',title:'Console',read:false}]}}];
    store.save(conv);
    const original=readFileSync(join(dir,conv.id+'.json'),'utf8');
    const source=new ChatStore(dir).get(conv.id).messages[0].search.sources[0];
    assert.equal(source.pageKind,'product');
    assert.equal(readFileSync(join(dir,conv.id+'.json'),'utf8'),original);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('unknown URLs cannot be selected as products', async () => {
  const observed:any[]=[];
  const events:any[]=[];
  for await(const event of runChat(model([call('web_search',{}),call('present_results',{kind:'products',ids:['r1']}),{content:'No direct offer found.'}],observed),'small',[{...search,handler:async()=>({results:[{title:'Unknown',url:'https://shop.example/unknown'}]})}],'',[]))events.push(event);
  assert.deepEqual(JSON.parse(observed[2].messages.at(-1).content).rejected_ids,['r1']);
  assert.ok(events.filter(e=>e[0]==='search').every(e=>!e[1].presentations.length));
});

test('product-search fallback excludes listings even without present_results', async () => {
  const catalog={...search,handler:async()=>({productSearch:true,results:[
    {title:'Search page',url:'https://allegro.pl/listing?string=console'},
    {title:'Console',url:'https://allegro.pl/oferta/console-123',thumbnail:'https://imgs.search.brave.com/console'},
  ]})};
  const invalid={content:'<tool_call><function=web_search>invalid</function></tool_call>'};
  const events:any[]=[];
  for await(const event of runChat(model([call('web_search',{kind:'products'}),invalid,invalid]),'small',[catalog],'',[]))events.push(event);
  assert.doesNotMatch(events.find(e=>e[0]==='final')[1].content,/listing\?/);
  const state=events.filter(e=>e[0]==='search').at(-1)[1];
  assert.equal(state.productSearch,true);
  assert.equal(state.sources[1].thumbnail,'https://imgs.search.brave.com/console');
});
test('only selected IDs become cards and IDs remain stable across searches',async()=>{
  const observed:any[]=[];
  const client=model([call('web_search',{query:'headphones'}),call('web_search',{query:'headphones reviews'}),call('present_results',{kind:'products',ids:['r2']}),{content:'The second option fits your needs.'}],observed);
  const events:any[]=[];for await(const event of runChat(client,'small',[search],'',[]))events.push(event);
  const returned = observed.flatMap(x=>x.messages.filter(m=>m.role==='tool'&&JSON.parse(m.content).results).map(m=>JSON.parse(m.content)));
  assert.deepEqual(returned[0].results.map(r=>r.id),['r1','r2']);
  assert.deepEqual(returned.at(-1).results.map(r=>r.id),['r1','r2']);
  const selected=events.filter(e=>e[0]==='search').at(-1)[1];
  assert.deepEqual(selected.presentations,[{kind:'products',ids:['r2']}]);
  assert.equal(selected.presentationVersion,1);
  assert.ok(observed[0].tools.some(t=>t.function.name==='present_results'));
});
test('unknown selections are rejected without showing all results',async()=>{
  const events:any[]=[];const observed:any[]=[];
  for await(const event of runChat(model([call('web_search',{query:'news'}),call('present_results',{kind:'news',ids:['r99']})],observed),'small',[search],'',[]))events.push(event);
  assert.ok(observed.at(-1).messages.some(m=>m.role==='tool'&&JSON.parse(m.content).error));
  assert.ok(events.filter(e=>e[0]==='search').every(e=>!e[1].presentations?.length));
});
test('repeating a blocked page forces a final answer without another HTTP attempt',async()=>{
  let downloads=0;const observed:any[]=[];
  const tools=buildSearchTools({search:async()=>[{title:'Relevant story',url:'https://news.example/blocked',description:''}]},{lookup,fetchFn:async()=>{downloads++;return new Response('',{status:403});}});
  const client=model([call('web_search',{query:'news'}),call('fetch_page',{url:'https://news.example/blocked'}),call('find_in_page',{url:'https://news.example/blocked#text',query:'story'}),{content:'You can open the relevant story directly.'}],observed);
  const events:any[]=[];for await(const event of runChat(client,'small',tools,'',[]))events.push(event);
  assert.equal(downloads,1);assert.equal(observed.at(-1).tools,undefined);
  const source=events.filter(e=>e[0]==='search').at(-1)[1].sources[0];
  assert.equal(source.title,'Relevant story');assert.equal(source.blocked,true);assert.equal(source.read,false);
});

test('a model that still asks for blocked reads receives a deterministic link-only finish',async()=>{
  let downloads=0;
  const tools=buildSearchTools({search:async()=>[]},{lookup,fetchFn:async()=>{downloads++;return new Response('',{status:403});}});
  const client=model(Array.from({length:5},()=>call('fetch_page',{url:'https://news.example/denied'})));
  const events:any[]=[];for await(const event of runChat(client,'small',tools,'',[]))events.push(event);
  assert.equal(downloads,1);
  const final=events.find(e=>e[0]==='final')[1];
  assert.match(final.content,/https:\/\/news.example\/denied/);
  assert.match(final.content,/could not read/i);
});

test('a blocked page cannot be retried through the file downloader', async () => {
  let bypass=0;
  const tools=buildSearchTools({search:async()=>[]},{lookup,fetchFn:async()=>new Response('',{status:403})});
  tools.push({name:'download_file',description:'',parameters:{},handler:async()=>{bypass++;return {file_id:'bad'};}});
  const observed:any[]=[];
  const client=model([call('fetch_page',{url:'https://news.example/no-reader'}),call('download_file',{url:'https://news.example/no-reader#text'}),{content:'Open the link directly.'}],observed);
  for await (const _ of runChat(client,'small',tools,'',[])) {}
  assert.equal(bypass,0);assert.equal(observed.at(-1).tools,undefined);
});

test('403 cooldown is page-specific, expires, and does not cache transient errors', async () => {
  let now=0;const seen:string[]=[];
  const tools=buildSearchTools({search:async()=>[]},{lookup,now:()=>now,fetchFn:async url=>{seen.push(String(url));return new Response('',{status:String(url).endsWith('/busy')?503:403});}});
  for(const url of ['https://site.example/a','https://site.example/a#fragment','https://site.example/b','https://site.example/busy','https://site.example/busy']) await executeTool(tools,'fetch_page',{url});
  assert.equal(seen.length,4);
  now=300001;await executeTool(tools,'fetch_page',{url:'https://site.example/a'});assert.equal(seen.length,5);
});

test('a cached 403 on the first read of a new turn still allows selecting relevant results', async () => {
  const tools=buildSearchTools({search:async()=>[{title:'Story',url:'https://news.example/cached',description:''}]},{lookup,fetchFn:async()=>new Response('',{status:403})});
  await executeTool(tools,'fetch_page',{url:'https://news.example/cached'});
  const observed:any[]=[];
  const client=model([call('web_search',{query:'news'}),call('fetch_page',{url:'https://news.example/cached'}),call('present_results',{kind:'news',ids:['r1']}),{content:'Here is the relevant link.'}],observed);
  const events:any[]=[];for await(const event of runChat(client,'small',tools,'',[]))events.push(event);
  assert.ok(observed[2].tools?.some(tool=>tool.function.name==='present_results'));
  assert.deepEqual(events.filter(e=>e[0]==='search').at(-1)[1].presentations,[{kind:'news',ids:['r1']}]);
});

test('selected cards and blocked links survive chat completion and disk reload', async () => {
  const dir=mkdtempSync(join(tmpdir(),'sawot-selected-'));const app=Fastify();
  const client=model([call('web_search',{query:'products'}),call('present_results',{kind:'products',ids:['r2']}),call('fetch_page',{url:'https://shop.example/products/two'}),{content:'This one fits, but the page could not be read.'}]);
  const store=new ChatStore(dir);
  registerChatRoutes(app,{store,resolve:()=>({client,model:'small'}),ha:null,haTools:[],uploadDir:dir,name:'Assistant',getEntitySummary:()=>'',getChatInstructions:()=>'',getDefaultModel:()=> 'small',searchTools:[search,{name:'fetch_page',description:'',parameters:{},handler:async()=>({error:'HTTP 403',url:'https://shop.example/products/two',link_only:true,status:403,retryable:false})}]});
  try {
    const id=(await app.inject({method:'POST',url:'/api/chat/conversations',payload:{}})).json().id;
    const response=await app.inject({method:'POST',url:`/api/chat/conversations/${id}/messages`,payload:{content:'Find products'}});
    const events=response.body.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
    const done=events.find(event=>event.type==='done').message;
    assert.deepEqual(done.search.presentations,[{kind:'products',ids:['r2']}]);
    assert.deepEqual(new ChatStore(dir).get(id).messages.at(-1).search,done.search);
    assert.equal(done.search.sources[1].blocked,true);
    assert.equal(done.search.sources[1].thumbnail,'https://imgs.search.brave.com/two');
    assert.equal(done.search.sources[1].pageKind,'product');
    assert.equal(done.presentationVersion,1);
    const history=toOpenAiMessages([done],dir)[0].content;
    assert.match(history,/Second product/);assert.match(history,/https:\/\/shop.example\/products\/two/);
    assert.doesNotMatch(history,/First product/);
    assert.doesNotMatch(history,/imgs\.search\.brave/);
  } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

for (const ending of ['markup', 'structured', 'empty'] as const) {
  test(`different blocked pages finish with retrieved links after ${ending} at the tool limit`, async () => {
    let downloads = 0;
    const observed: any[] = [];
    const tools = buildSearchTools({search: async () => [
      {title:'First product',url:'https://shop.example/products/one',description:''},
      {title:'Second product',url:'https://shop.example/products/two',description:''},
    ]}, {lookup, fetchFn: async () => { downloads++; return new Response('', {status:403}); }});
    const invalid = {content:'<tool_call><function=web_search>more products</function></tool_call>'};
    const client = model([
      call('web_search',{query:'adapter'}),
      call('fetch_page',{url:'https://shop.example/products/one'}),
      call('web_search',{query:'direct adapter links'}),
      call('fetch_page',{url:'https://shop.example/products/two'}),
      call('web_search',{query:'more adapters'}),
      ...(ending === 'markup' ? [invalid, invalid] : ending === 'structured' ? [call('web_search',{query:'must not execute'})] : [{content:''}]),
    ], observed);
    const events:any[]=[];
    for await (const event of runChat(client,'small',tools,'',[])) events.push(event);
    assert.equal(downloads,2);
    assert.equal(observed.length,ending === 'markup' ? 7 : 6);
    assert.equal(observed.at(-1).tools,undefined);
    const final=events.find(e=>e[0]==='final')[1].content;
    assert.match(final,/https:\/\/shop.example\/products\/one/);
    assert.match(final,/https:\/\/shop.example\/products\/two/);
    assert.match(final,/could not read/i);
    assert.doesNotMatch(final,/<tool_call>|<function=/);
    assert.equal(events.filter(e=>e[0]==='content').map(e=>e[1]).join('').trim(),final);
    assert.ok(events.filter(e=>e[0]==='search').every(e=>!e[1].presentations.length));
    assert.equal(events.filter(e=>e[0]==='debug'&&e[1].event==='tool_call').length,5);
  });
}

test('failed markup recovery before the limit preserves selected results and does not promote unselected sources', async () => {
  const invalid={content:'<tool_call><function=present_results>invalid</function></tool_call>'};
  const events:any[]=[];
  for await(const event of runChat(model([call('web_search',{}),call('present_results',{kind:'products',ids:['r2']}),invalid,invalid]),'small',[search],'',[]))events.push(event);
  const final=events.find(e=>e[0]==='final')[1].content;
  assert.match(final,/https:\/\/shop.example\/products\/two/);
  assert.doesNotMatch(final,/https:\/\/shop.example\/products\/one/);
  assert.deepEqual(events.filter(e=>e[0]==='search').at(-1)[1].presentations,[{kind:'products',ids:['r2']}]);
});

test('link fallback is streamed and saved as a completed reply without an error', async () => {
  const dir=mkdtempSync(join(tmpdir(),'sawot-fallback-'));
  const app=Fastify(), store=new ChatStore(dir);
  const invalid={content:'<tool_call><function=web_search>more</function></tool_call>'};
  const client=model([call('web_search',{}),invalid,invalid]);
  registerChatRoutes(app,{store,uploadDir:dir,resolve:()=>({client,model:'small'}),ha:null,haTools:[],searchTools:[search],name:'Assistant',getEntitySummary:()=>'',getChatInstructions:()=>'',getDefaultModel:()=> 'small'});
  try {
    const conversation=store.create('small');conversation.title='Existing search';store.save(conversation);
    const response=await app.inject({method:'POST',url:`/api/chat/conversations/${conversation.id}/messages`,payload:{content:'Find products'}});
    const events=response.body.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
    assert.equal(events.some(event=>event.type==='error'),false);
    const done=events.find(event=>event.type==='done').message;
    assert.match(done.content,/https:\/\/shop.example\/products\/one/);
    assert.doesNotMatch(done.content,/<tool_call>|<function=/);
    const saved=new ChatStore(dir).get(conversation.id);
    assert.equal(saved.messages.at(-1).content,done.content);
    assert.ok(!saved.responseError);
    assert.deepEqual(saved.messages.at(-1).search.presentations,[]);
  } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('product selection rejects search pages even when snippets name real products', async () => {
  const catalog={...search,handler:async()=>({results:[
    {title:'DisplayPort HDMI - Allegro',url:'https://allegro.pl/listing?string=displayport+hdmi',description:'Benfei adapter 4K, 8.99 zł'},
    {title:'Retoo DisplayPort to HDMI',url:'https://allegro.pl/produkt/retoo-adapter-123',description:'Individual product'},
  ]})};
  const observed:any[]=[],events:any[]=[];
  const client=model([call('web_search',{}),call('present_results',{kind:'products',ids:['r1']}),call('present_results',{kind:'products',ids:['r2']}),{content:'Here is the adapter.'}],observed);
  for await(const event of runChat(client,'small',[catalog],'',[]))events.push(event);
  const rejection=JSON.parse(observed[2].messages.at(-1).content);
  assert.match(rejection.error,/search|category/i);
  assert.deepEqual(rejection.rejected_ids,['r1']);
  assert.deepEqual(rejection.direct_product_ids,['r2']);
  const results=JSON.parse(observed[1].messages.at(-1).content).results;
  assert.equal(results[0].page_kind,'listing');assert.equal(results[1].page_kind,'product');
  const groups=events.filter(e=>e[0]==='search').flatMap(e=>e[1].presentations);
  assert.deepEqual(groups,[{kind:'products',ids:['r2']}]);
});

test('product fallback excludes listing pages after rejected selection', async () => {
  const catalog={...search,handler:async()=>({results:[
    {title:'Search page',url:'https://allegro.pl/listing?string=adapter'},
    {title:'Actual adapter',url:'https://allegro.pl/oferta/adapter-123'},
  ]})};
  const invalid={content:'<tool_call><function=present_results>r1</function></tool_call>'};
  const events:any[]=[];
  for await(const event of runChat(model([call('web_search',{}),call('present_results',{kind:'products',ids:['r1']}),invalid,invalid]),'small',[catalog],'',[]))events.push(event);
  const final=events.find(e=>e[0]==='final')[1].content;
  assert.doesNotMatch(final,/listing\?string/);assert.match(final,/oferta\/adapter-123/);
});

test('only listing pages produces an honest empty product result, not search-page recommendations', async () => {
  const catalog={...search,handler:async()=>({results:[{title:'Adapters',url:'https://allegro.pl/kategoria/adapters?string=hdmi'}]})};
  const invalid={content:'<tool_call><function=present_results>r1</function></tool_call>'};
  const events:any[]=[];
  for await(const event of runChat(model([call('web_search',{}),call('present_results',{kind:'products',ids:['r1']}),invalid,invalid]),'small',[catalog],'',[]))events.push(event);
  const final=events.find(e=>e[0]==='final')[1].content;
  assert.match(final,/couldn’t find an individual product link/);
  assert.doesNotMatch(final,/https:/);
  assert.ok(events.filter(e=>e[0]==='search').every(e=>!e[1].presentations.length));
});

test('a mixed invalid product selection does not overwrite a prior valid selection', async () => {
  const catalog={...search,handler:async()=>({results:[
    {title:'Search',url:'https://allegro.pl/listing?string=adapter'},
    {title:'Adapter',url:'https://allegro.pl/oferta/adapter-123'},
  ]})};
  const events:any[]=[];
  for await(const event of runChat(model([call('web_search',{}),call('present_results',{kind:'products',ids:['r2']}),call('present_results',{kind:'products',ids:['r1','r2']}),{content:'Here is the product.'}]),'small',[catalog],'',[]))events.push(event);
  assert.deepEqual(events.filter(e=>e[0]==='search').at(-1)[1].presentations,[{kind:'products',ids:['r2']}]);
});

test('final citations select only retrieved direct products when the model omits present_results', async () => {
  const catalog={...search,handler:async()=>({results:[
    {title:'Blocked product',url:'https://allegro.pl/produkt/blocked-123'},
    {title:'Recommended adapter',url:'https://allegro.pl/produkt/adapter-123'},
    {title:'Unselected adapter',url:'https://allegro.pl/produkt/other-123'},
    {title:'Search',url:'https://allegro.pl/listing?string=adapter'},
  ]})};
  const blocked={name:'fetch_page',description:'',parameters:{},handler:async()=>({url:'https://allegro.pl/produkt/blocked-123',link_only:true,status:403,error:'Forbidden'})};
  const answer='Consider [this](https://allegro.pl/produkt/blocked-123), or [this adapter](https://allegro.pl/produkt/adapter-123). [Search](https://allegro.pl/listing?string=adapter).';
  const events:any[]=[];
  for await(const event of runChat(model([call('web_search',{}),call('fetch_page',{}),{content:answer}]),'remote',[catalog,blocked],'',[]))events.push(event);
  assert.deepEqual(events.filter(e=>e[0]==='search').at(-1)[1].presentations,[{kind:'products',ids:['r2']}]);
  assert.equal(events.find(e=>e[0]==='final')[1].content,answer);
});
