export interface AnalysisEvent {id:string;turnId:string;tool:'download_file'|'run_python';phase:'start'|'complete'|'error';code?:string;error?:string;file?:any;result?:any}
const id=/^[0-9a-f]{32}$/;const chat=/^[0-9a-f]{12}$/;
const clean=(value:unknown,max=65536)=>typeof value==='string'?value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,'').slice(0,max):'';
export function analysisFileUrl(conversationId:string,fileId:string):string|null{
 return chat.test(conversationId)&&id.test(fileId)?`/api/chat/conversations/${conversationId}/analysis-files/${fileId}`:null;
}
function file(value:any){if(!value||!id.test(value.id)||typeof value.name!=='string')return null;return {id:value.id,name:clean(value.name,160),size:Number.isFinite(value.size)?value.size:0,source:value.source};}
export function normalizeAnalysisEvent(value:any):AnalysisEvent|null{
 if(!value||!id.test(value.id)||!chat.test(value.turnId)||!['download_file','run_python'].includes(value.tool)||!['start','complete','error'].includes(value.phase))return null;
 const result=value.result&&typeof value.result==='object'?{status:clean(value.result.status,40),stdout:clean(value.result.stdout),stderr:clean(value.result.stderr),truncated:!!value.result.truncated,files:Array.isArray(value.result.files)?value.result.files.slice(0,10).map(file).filter(Boolean):[]}:undefined;
 return {id:value.id,turnId:value.turnId,tool:value.tool,phase:value.phase,code:clean(value.code),error:clean(value.error,500),file:file(value.file)??undefined,result};
}
export function mergeAnalysisEvents(previous:AnalysisEvent[],event:AnalysisEvent):AnalysisEvent[]{
 const index=previous.findIndex(v=>v.id===event.id);if(index<0)return [...previous,event].slice(-10);
 if(previous[index].phase!=='start'&&event.phase==='start')return previous;
 return previous.map((v,i)=>i===index?event:v);
}
export function safeSource(value:unknown):string|null{
 try{const url=new URL(String(value));return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
