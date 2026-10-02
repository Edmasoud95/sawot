import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {LIMITS} from './limits.js';
import {FILE_ID,AnalysisError,type Runner,type Readiness,type AnalysisInput,type RunnerResult} from './types.js';
export class RunnerClient implements Runner {
 constructor(private socketPath:string){}
 private request(method:string,path:string,body:Buffer|undefined,signal:AbortSignal,cap=256*1024):Promise<Buffer>{
  signal.throwIfAborted();
  return new Promise((accept,reject)=>{
   const req=http.request({socketPath:this.socketPath,path,method,agent:false,signal,
    headers:{'Content-Length':body?.length ?? 0,'Content-Type':'application/json'},maxHeaderSize:8192},res=>{
     const chunks:Buffer[]=[];let size=0;
     res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>cap){req.destroy(Error('Runner response exceeds limit'));return;}chunks.push(chunk);});
     res.on('error',reject);res.on('end',()=>res.statusCode && res.statusCode>=200&&res.statusCode<300?accept(Buffer.concat(chunks)):reject(new AnalysisError(res.statusCode===429?'busy':res.statusCode===503?'unavailable':'policy_rejected',res.statusCode===503?'Python sandbox unavailable':'Runner request rejected')));
    });
   req.on('error',()=>reject(new AnalysisError(signal.aborted ? (signal.reason?.name==='TimeoutError'?'timeout':'cancelled') : 'unavailable','Runner connection unavailable')));req.end(body);
  });
 }
 async ready():Promise<Readiness>{
  try{
   const value=JSON.parse((await this.request('GET','/v1/ready',undefined,AbortSignal.timeout(3000))).toString());
   if(value.ready!==true||value.runtime!=='runsc'||value.inputPaths!=='stable-v1'||!/^sha256:[0-9a-f]{64}$/.test(value.imageDigest))throw Error('Invalid readiness');
   return value;
  }catch{return {ready:false,runtime:'runsc',imageDigest:'',reason:'Python sandbox unavailable'};}
 }
 async run(code:string,inputs:AnalysisInput[],signal:AbortSignal):Promise<RunnerResult>{
  signal.throwIfAborted();
  if(!(await this.ready()).ready)throw new AnalysisError('unavailable','Python sandbox unavailable');
  if(inputs.some(i=>!FILE_ID.test(i.id))||new Set(inputs.map(i=>i.id)).size!==inputs.length||Buffer.byteLength(code)>LIMITS.sourceBytes||inputs.length>LIMITS.inputFiles||inputs.reduce((n,i)=>n+i.data.length,0)>LIMITS.inputBytes)throw Error('Execution input limit exceeded');
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(45000)]);
  let id:string|undefined;
  try{
   const created=JSON.parse((await this.request('POST','/v1/jobs',Buffer.from(JSON.stringify({code,inputs:inputs.map(i=>({id:i.id,name:i.name,size:i.data.length}))})),bounded)).toString());
   if(!FILE_ID.test(created.id)||!Array.isArray(created.inputs)||created.inputs.length!==inputs.length||created.inputs.some((v:unknown,i:number)=>v!==String(i)))throw Error('Invalid runner job');
   id=created.id;
   for(let i=0;i<inputs.length;i++)await this.request('PUT',`/v1/jobs/${id}/inputs/${i}`,inputs[i].data,bounded);
   await this.request('POST',`/v1/jobs/${id}/start`,Buffer.alloc(0),bounded);
   let result:any;
   for(;;){
    const state=JSON.parse((await this.request('GET',`/v1/jobs/${id}`,undefined,bounded)).toString());
    if(state.state==='finished'){result=state.result;break;}
    if(state.state!=='running')throw Error('Invalid runner state');
    await delay(150,undefined,{signal:bounded});
   }
   if(!['success','python_error','timeout','resource_limit','cancelled','unavailable','policy_rejected','busy'].includes(result.status)||typeof result.stdout!=='string'||typeof result.stderr!=='string'||!Array.isArray(result.outputs)||result.outputs.length>LIMITS.outputFiles||!Number.isFinite(result.durationMs)||!([null,0].includes(result.exitCode)||Number.isInteger(result.exitCode)))throw Error('Invalid runner result');
   const outputs:RunnerResult['outputs']=[];let total=0;
   for(const output of result.outputs){
    if(typeof output.id!=='string'||!/^\d{1,2}$/.test(output.id)||typeof output.name!=='string'||!Number.isSafeInteger(output.size)||output.size<0||output.size>LIMITS.outputFileBytes||(total+=output.size)>LIMITS.outputBytes||!/^[0-9a-f]{64}$/.test(output.sha256))throw Error('Invalid runner output');
    const data=await this.request('GET',`/v1/jobs/${id}/outputs/${output.id}`,undefined,bounded,LIMITS.outputFileBytes);
    if(data.length!==output.size||createHash('sha256').update(data).digest('hex')!==output.sha256)throw Error('Runner output integrity failure');
    outputs.push({name:output.name,data});
   }
   const stdout=Buffer.from(result.stdout).subarray(0,LIMITS.logBytes);
   const stderr=Buffer.from(result.stderr).subarray(0,LIMITS.logBytes-stdout.length);
   return {status:result.status,stdout:stdout.toString(),stderr:stderr.toString(),exitCode:result.exitCode,durationMs:result.durationMs,truncated:!!result.truncated||Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)>LIMITS.logBytes,outputs};
  }finally{
   if(id)await this.request('DELETE',`/v1/jobs/${id}`,undefined,AbortSignal.timeout(5000)).catch(()=>{});
  }
 }
}
