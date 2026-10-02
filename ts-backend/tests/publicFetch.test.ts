import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, validatePublicUrl, fetchPublic } from '../src/publicFetch.js';
test('rejects all non-public and transition addresses', () => {
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.0.0.1','192.0.2.1','224.0.0.1','::1','::ffff:8.8.8.8','64:ff9b::808:808','2002:808:808::','2001:db8::1','fe80::1','fc00::1']) assert.equal(publicAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','1.1.1.1','2606:4700::1111']) assert.equal(publicAddress(ip),true,ip);
});
test('validates every DNS answer, schemes, credentials and ports',async()=>{
 await assert.rejects(validatePublicUrl('https://example.org',async()=>['8.8.8.8','127.0.0.1']));
 for(const url of ['file:///etc/passwd','https://u:p@example.org','http://example.org:8765','http://2130706433','https://[::ffff:8.8.8.8]']) await assert.rejects(validatePublicUrl(url,async()=>['8.8.8.8']),undefined,url);
 const v=await validatePublicUrl('https://example.org/a',async()=>['8.8.8.8']);
 assert.equal(v.address,'8.8.8.8'); assert.equal(v.url.hostname,'example.org');
});
test('cancelled requests cannot resolve or connect',async()=>{
 await assert.rejects(fetchPublic('https://example.org',{signal:AbortSignal.abort(),deadlineMs:performance.now()+100,maxBytes:20,oversize:'reject'}));
});
import {Readable} from 'node:stream';
function response(status:number,headers:Record<string,string>,chunks:Buffer[]=[]):any{
 return Object.assign(Readable.from(chunks),{statusCode:status,headers});
}
test('pins checked address and revalidates each redirect',async()=>{
 const calls:any[]=[];
 const deps={resolve:async(host:string)=>host==='blocked.example'?['127.0.0.1']:['8.8.8.8'],connect:async(url:URL,address:string)=>{calls.push([url.hostname,address]);return response(302,{location:'https://blocked.example/'});}};
 await assert.rejects(fetchPublic('https://example.org',{signal:new AbortController().signal,deadlineMs:performance.now()+1000,maxBytes:10,oversize:'reject'},deps));
 assert.deepEqual(calls,[['example.org','8.8.8.8']]);
});
test('caps bytes even with misleading lengths and rejects encoded responses',async()=>{
 const options={signal:new AbortController().signal,deadlineMs:performance.now()+1000,maxBytes:3,oversize:'reject' as const};
 const deps={resolve:async()=>['8.8.8.8'],connect:async()=>response(200,{'content-length':'1'},[Buffer.from('1234')])};
 const file=await fetchPublic('https://example.org',options,deps);
 await assert.rejects(async()=>{for await(const _ of file.body){};});
 await assert.rejects(fetchPublic('https://example.org',options,{...deps,connect:async()=>response(200,{'content-encoding':'gzip'})}));
 const cut=await fetchPublic('https://example.org',{...options,oversize:'truncate'},deps);let text='';for await(const chunk of cut.body)text+=Buffer.from(chunk);
 assert.equal(text,'123');assert.equal(cut.truncated(),true);
});
test('one deadline bounds DNS resolution',async()=>{
 const result=fetchPublic('https://example.org',{signal:new AbortController().signal,deadlineMs:performance.now()+20,maxBytes:3,oversize:'reject'},{resolve:()=>new Promise(()=>{})});
 await assert.rejects(result,/deadline/);
});
test('reserved IPv6 outside the global unicast allocation is rejected',()=>{
 assert.equal(publicAddress('4000::1'),false); assert.equal(publicAddress('::2'),false);
});
