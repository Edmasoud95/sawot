import { randomUUID,createHash } from 'node:crypto';
import { mkdirSync,openSync,closeSync,writeSync,writeFileSync,readFileSync,renameSync,unlinkSync,readdirSync,existsSync,fstatSync,fsyncSync,constants } from 'node:fs';
import {join} from 'node:path';
import {safeFileName} from '../publicFetch.js';
import {AnalysisScope,AnalysisFile,FILE_ID,CHAT_ID} from './types.js';
import {LIMITS} from './limits.js';
export interface Reservation { id:string;scope:AnalysisScope;count:number;bytes:number }
type Metadata=Pick<AnalysisFile,'name'|'mediaType'|'inputIds'|'source'|'uploadId'>;
const id=()=>randomUUID().replaceAll('-','');
export class AnalysisFileStore {
 private files:AnalysisFile[]=[];
 private reservations=new Map<string,Reservation>();
 private deleted=new Set<string>();
 private closed=false;
 constructor(private root:string,private alive:(scope:AnalysisScope)=>boolean) {
  mkdirSync(root,{recursive:true,mode:0o700});
  const lock=join(root,'writer.lock');
  if(existsSync(lock)) {
   const pid=Number(readFileSync(lock,'utf8'));
   if(!Number.isSafeInteger(pid)||pid<=0) throw Error('Invalid analysis writer lock');
   try {process.kill(pid,0);throw Error('Analysis storage already has a writer');}
   catch(e:any){if(e.code!=='ESRCH')throw e; unlinkSync(lock);}
  }
  const fd=openSync(lock,'wx',0o600);writeSync(fd,String(process.pid));closeSync(fd);
  try {
   if(existsSync(join(root,'manifest.json'))) this.files=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
   if(!Array.isArray(this.files)||this.files.some(f=>!FILE_ID.test(f.id)||!CHAT_ID.test(f.conversationId))) throw Error('Invalid analysis manifest');
   for(const file of readdirSync(root)) if((file.endsWith('.part')||FILE_ID.test(file))&&!this.files.some(f=>f.id===file)) unlinkSync(join(root,file));
  }catch(e){this.close();throw e;}
 }
 close(){if(!this.closed){this.closed=true;unlinkSync(join(this.root,'writer.lock'));}}
 private persist(){
  const temp=join(this.root,'manifest.tmp');const fd=openSync(temp,'w',0o600);
  try{writeFileSync(fd,JSON.stringify(this.files));fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temp,join(this.root,'manifest.json'));
  const dir=openSync(this.root,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
 }
 private live(scope:AnalysisScope){if(this.closed||this.deleted.has(scope.conversationId)||!CHAT_ID.test(scope.conversationId)||!CHAT_ID.test(scope.turnId)||!this.alive(scope))throw Error('Conversation or turn no longer available');}
 reserve(scope:AnalysisScope,count:number,bytes:number):Reservation {
  this.live(scope);
  if(!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(bytes)||bytes<0)throw Error('Invalid reservation');
  const entries=[...this.files.map(f=>({cid:f.conversationId,count:1,bytes:f.size})),...Array.from(this.reservations.values(),r=>({cid:r.scope.conversationId,count:r.count,bytes:r.bytes}))];
  const own=entries.filter(e=>e.cid===scope.conversationId);
  if(own.reduce((a,e)=>a+e.count,0)+count>LIMITS.conversationFiles||own.reduce((a,e)=>a+e.bytes,0)+bytes>LIMITS.conversationBytes||entries.reduce((a,e)=>a+e.bytes,0)+bytes>LIMITS.globalBytes)throw Error('Analysis file quota exceeded; delete unused conversations');
  const r={id:id(),scope:{...scope,visibleTurnIds:[...scope.visibleTurnIds]},count,bytes};this.reservations.set(r.id,r);return r;
 }
 release(r:Reservation){this.reservations.delete(r.id);}
 async add(r:Reservation,metadata:Metadata,chunks:AsyncIterable<Uint8Array>|Iterable<Uint8Array>,signal?:AbortSignal):Promise<AnalysisFile>{
  if(this.reservations.get(r.id)!==r||r.count<1)throw Error('Invalid reservation');this.live(r.scope);
  const uid=id(),temp=join(this.root,uid+'.part');const fd=openSync(temp,'wx',0o600);
  let size=0;const digest=createHash('sha256');
  try{
   for await(const chunk of chunks){signal?.throwIfAborted();this.live(r.scope);size+=chunk.length;if(size>Math.min(r.bytes,LIMITS.outputFileBytes))throw Error('File exceeds limit');writeFileSync(fd,chunk);digest.update(chunk);}
   signal?.throwIfAborted();this.live(r.scope);fsyncSync(fd);
   const file:AnalysisFile={...metadata,name:safeFileName(metadata.name),mediaType:metadata.mediaType.slice(0,160),id:uid,conversationId:r.scope.conversationId,turnId:r.scope.turnId,size,sha256:digest.digest('hex')};
   renameSync(temp,join(this.root,uid));this.files.push(file);
   try{this.persist();}catch(e){this.files.pop();unlinkSync(join(this.root,uid));throw e;}
   r.count--;r.bytes-=size;if(!r.count)this.release(r);return file;
  }finally{closeSync(fd);if(existsSync(temp))unlinkSync(temp);}
 }
 listVisible(scope:AnalysisScope):AnalysisFile[]{return this.files.filter(f=>f.conversationId===scope.conversationId&&(f.turnId===scope.turnId||scope.visibleTurnIds.includes(f.turnId))).map(f=>({...f}));}
 read(scope:AnalysisScope,fileId:string){
  this.live(scope);if(!FILE_ID.test(fileId))throw Error('Invalid file ID');
  const f=this.listVisible(scope).find(f=>f.id===fileId);if(!f)throw Error('File not available to this conversation');
  const fd=openSync(join(this.root,f.id),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size!==f.size||stat.size>LIMITS.outputFileBytes)throw Error('Invalid analysis file');return {...f,data:readFileSync(fd)};}finally{closeSync(fd);}
 }
 prune(cid:string,turns:string[]){
  const removed=this.files.filter(f=>f.conversationId===cid&&!turns.includes(f.turnId));
  // Persist visibility first; orphan files are then recoverable at startup.
  this.files=this.files.filter(f=>!removed.includes(f));this.persist();
  for(const f of removed)try{unlinkSync(join(this.root,f.id));}catch(e:any){if(e.code!=='ENOENT')throw e;}
 }
 deleteConversation(cid:string){this.deleted.add(cid);for(const r of this.reservations.values())if(r.scope.conversationId===cid)this.release(r);this.prune(cid,[]);}
}
