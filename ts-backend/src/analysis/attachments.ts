import {openSync,closeSync,readFileSync,fstatSync,constants,readdirSync} from 'node:fs';
import {join} from 'node:path';
import type {AnalysisFileStore} from './fileStore.js';
import {CHAT_ID,type AnalysisScope} from './types.js';
import {LIMITS} from './limits.js';
/** Legacy uploads must have both recorded ownership and a visible attachment. */
export async function importAnalysisAttachments(conv:any,scope:AnalysisScope,files:AnalysisFileStore,uploadDir:string,signal:AbortSignal){
 const imported=files.listVisible(scope);
 for(const message of conv.messages){
  for(const a of message.attachments??[]){
   if(!CHAT_ID.test(a.id)||!conv.uploadIds?.includes(a.id)||imported.some(f=>f.uploadId===a.id))continue;
   const matches=readdirSync(uploadDir).filter(f=>f.startsWith(a.id+'.')&&!f.endsWith('.pdftxt'));
   if(matches.length!==1)continue;
   const fd=openSync(join(uploadDir,matches[0]),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try{
    const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>Math.min(10*1024*1024,LIMITS.outputFileBytes))continue;
    const reservation=files.reserve({...scope,turnId:message.id},1,stat.size);
    try{imported.push(await files.add(reservation,{name:String(a.name??'file'),mediaType:'application/octet-stream',inputIds:[],uploadId:a.id},[readFileSync(fd)],signal));}
    finally{files.release(reservation);}
   }finally{closeSync(fd);}
  }
 }
 return imported;
}
