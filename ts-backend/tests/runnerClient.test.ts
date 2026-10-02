import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {RunnerClient} from '../src/analysis/runnerClient.js';import {AnalysisError} from '../src/analysis/types.js';
test('readiness disappearing at admission returns unavailable',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'runner-client-'));const socket=join(dir,'runner.sock');
 const server=http.createServer((req,res)=>{
  req.resume();res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/ready')res.end(JSON.stringify({ready:true,runtime:'runsc',inputPaths:'stable-v1',imageDigest:'sha256:'+'a'.repeat(64)}));
  else {res.statusCode=503;res.end(JSON.stringify({error:'unavailable'}));}
 });
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});
  await assert.rejects(new RunnerClient(socket).run('print(1)',[],new AbortController().signal),(e:unknown)=>e instanceof AnalysisError&&e.status==='unavailable');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(dir,{recursive:true,force:true});}
});
