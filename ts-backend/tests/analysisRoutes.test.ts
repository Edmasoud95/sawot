import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import Fastify from 'fastify';
import {ChatStore} from '../src/chat.js';import {registerChatRoutes} from '../src/chatRoutes.js';import {AnalysisFileStore} from '../src/analysis/fileStore.js';
async function harness(available=true){
 const root=mkdtempSync(join(tmpdir(),'analysis-route-'));const store=new ChatStore(join(root,'chats'));const files=new AnalysisFileStore(join(root,'analysis'),s=>!!store.get(s.conversationId));
 let round=0; const requests:any[]=[];
 const client={chat:{completions:{create:async(req:any)=>{requests.push(req);if(!req.stream)return {choices:[{message:{content:'CSV analysis'}}]};return (async function*(){if(round++===0)yield {choices:[{delta:{tool_calls:[{index:0,id:'call-1',function:{name:'run_python',arguments:JSON.stringify({code:'print(2+3)',file_ids:[]})}}]}}]};else yield {choices:[{delta:{content:'The total is 5.'}}]};})();}}}};
 const runner={ready:async()=>({ready:available,runtime:'runsc',imageDigest:'sha256:'+'a'.repeat(64)}),run:async()=>({status:'success',stdout:'5',stderr:'',exitCode:0,durationMs:1,truncated:false,outputs:[]})};
 const app=Fastify();registerChatRoutes(app,{store,uploadDir:join(root,'uploads'),resolve:()=>({client,model:'m'}),haTools:[],searchTools:[],ha:null,name:'Test',getEntitySummary:()=>'',getChatInstructions:()=>'',getDefaultModel:()=> 'm',analysis:{files,runner}} as any);
 return {app,store,files,requests,root,close:async()=>{await app.close();files.close();rmSync(root,{recursive:true,force:true});}};
}
test('chat executes Python through injected runner and persists analysis events',async()=>{
 const h=await harness();try{
 const c=h.store.create('m');const res=await h.app.inject({method:'POST',url:`/api/chat/conversations/${c.id}/messages`,payload:{content:'Calculate 2+3'}});
 assert.match(res.body,/"type":"analysis"/);
 const saved=h.store.get(c.id);assert.equal(saved.messages.at(-1).analysis[0].result.stdout,'5');
 assert.ok(h.requests[0].tools.some((t:any)=>t.function.name==='run_python'));
 }finally{await h.close();}
});
test('file route refuses other conversations and always serves attachment',async()=>{
 const h=await harness();try{
 const a=h.store.create('m'),b=h.store.create('m');const turn='a'.repeat(12);a.messages=[{id:turn,role:'user',content:'file'}];h.store.save(a);
 const r=h.files.reserve({conversationId:a.id,turnId:turn,visibleTurnIds:[turn]},1,100);
 const f=await h.files.add(r,{name:'evil.html',mediaType:'text/html',inputIds:[]},[Buffer.from('<script>alert(1)</script>')]);
 const good=await h.app.inject(`/api/chat/conversations/${a.id}/analysis-files/${f.id}`);
 assert.equal(good.statusCode,200);assert.match(good.headers['content-disposition']!,/^attachment/);assert.equal(good.headers['x-content-type-options'],'nosniff');
 assert.equal((await h.app.inject(`/api/chat/conversations/${b.id}/analysis-files/${f.id}`)).statusCode,404);
 }finally{await h.close();}
});

test('ready sandbox preserves vision attachments in model history',async()=>{
 const h=await harness();try{
  const c=h.store.create('m');const uid='e'.repeat(12);c.uploadIds=[uid];h.store.save(c);
  mkdirSync(join(h.root,'uploads'));writeFileSync(join(h.root,'uploads',uid+'.png'),Buffer.from('synthetic-image'));
  await h.app.inject({method:'POST',url:`/api/chat/conversations/${c.id}/messages`,payload:{content:'View image',attachments:[{id:uid,name:'photo.png',kind:'image'}]}});
  assert.ok(h.requests[0].messages.some((m:any)=>Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='image_url')));
 }finally{await h.close();}
});
