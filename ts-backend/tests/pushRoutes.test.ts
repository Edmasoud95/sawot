import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH } from 'node:crypto';
import { PushNotifications } from '../src/pushNotifications.js';
import { registerPushRoutes } from '../src/pushRoutes.js';
const curve=createECDH('prime256v1');curve.generateKeys();
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:Buffer.alloc(16).toString('base64url')}};
test('push API only exposes public key and per-device capability', async t=>{
 const dir=mkdtempSync(join(tmpdir(),'push-api-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const service=new PushNotifications(join(dir,'push.json')); const app=Fastify();t.after(()=>app.close());
 registerPushRoutes(app,service,['https://sawot.test']);
 const key=await app.inject('/api/notifications/key'); assert.deepEqual(key.json(),{available:true,publicKey:service.publicKey()});
 for(const origin of [undefined,'https://evil.test','null']){
 const response=await app.inject({method:'POST',url:'/api/notifications/subscription',headers:origin?{origin}:{},payload:{subscription}});assert.equal(response.statusCode,403);
 }
 const headers={origin:'https://sawot.test'};
 const response=await app.inject({method:'POST',url:'/api/notifications/subscription',headers,payload:{subscription}});
 assert.equal(response.statusCode,200);assert.deepEqual(Object.keys(response.json()),['capability']);const capability=response.json().capability;
 const refresh=await app.inject({method:'POST',url:'/api/notifications/subscription',headers,payload:{subscription,capability}});assert.equal(refresh.json().capability,capability);
 const malformed=await app.inject({method:'POST',url:'/api/notifications/subscription',headers,payload:{subscription:{endpoint:'http://localhost/secret'}}});assert.equal(malformed.statusCode,400);assert.ok(!malformed.body.includes('localhost'));
 const large=await app.inject({method:'POST',url:'/api/notifications/subscription',headers,payload:{subscription,padding:'x'.repeat(17000)}});assert.equal(large.statusCode,413);
 const removed=await app.inject({method:'DELETE',url:'/api/notifications/subscription',headers,payload:{capability}});assert.equal(removed.statusCode,204);
});
test('unavailable push service does not affect server availability',async t=>{
 const app=Fastify();t.after(()=>app.close());registerPushRoutes(app,null,[]);
 assert.deepEqual((await app.inject('/api/notifications/key')).json(),{available:false,publicKey:null});
 assert.equal((await app.inject({method:'POST',url:'/api/notifications/subscription',headers:{origin:'http://localhost'},payload:{subscription}})).statusCode,503);
});
