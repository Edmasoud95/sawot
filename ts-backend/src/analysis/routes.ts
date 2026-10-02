import type {FastifyInstance} from 'fastify';
import type {ChatStore} from '../chat.js';
import type {AnalysisFileStore} from './fileStore.js';
import {CHAT_ID,FILE_ID} from './types.js';
export function visibleTurns(conv:any):string[]{return (conv?.messages??[]).map((m:any)=>m.id).filter((id:unknown)=>typeof id==='string'&&CHAT_ID.test(id));}
export function registerAnalysisRoutes(app:FastifyInstance,files:AnalysisFileStore,chats:ChatStore){
 app.get('/api/chat/conversations/:cid/analysis-files/:fid',async(req:any,reply)=>{
  const {cid,fid}=req.params;
  if(!CHAT_ID.test(cid)||!FILE_ID.test(fid))return reply.code(404).send();
  const conv=chats.get(cid);if(!conv)return reply.code(404).send();
  const turns=visibleTurns(conv);
  if(conv.pendingAnalysis && !conv.pendingAnalysis.regenerating)turns.push(conv.pendingAnalysis.turnId);
  try{
   const file=files.read({conversationId:cid,turnId:turns[0]??'000000000000',visibleTurnIds:turns},fid);
   return reply.type('application/octet-stream').header('Content-Disposition',`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    .header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox")
    .header('Cache-Control','no-store').send(file.data);
  }catch{return reply.code(404).send();}
 });
}
