import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../src/memory/store.js';
import { registerMemoryRoutes } from '../src/memory/routes.js';
const directory = await mkdtemp(join(tmpdir(), 'sawot-memory-api-'));
const app = Fastify();
try {
 const store = new MemoryStore(directory); await store.init(); registerMemoryRoutes(app,store);
 const scope = await store.beginTurn({conversationId:'conversation',turnId:'turn',sourceMessageId:'source',text:'I live in Warsaw'});
 const event = await store.capture(scope,{text:'User lives in Warsaw',topic:'current city',category:'location',quote:scope.text});
 const id=event.memories[0].id;
 assert.equal((await app.inject({method:'GET',url:'/api/memory'})).json().memories.length,1);
 assert.equal((await app.inject({method:'POST',url:'/api/memory/clear',payload:{confirm:false}})).statusCode,400);
 assert.equal((await app.inject({method:'PATCH',url:`/api/memory/${id}`,payload:{text:'User lives in Kraków',revision:0}})).statusCode,409);
 const pending=await store.beginTurn({conversationId:'conversation',turnId:'pending',sourceMessageId:'pending',text:'I prefer Python'});
 assert.equal((await app.inject({method:'PATCH',url:`/api/memory/${id}`,payload:{text:'User lives in Kraków',revision:1}})).json().revision,2);
 await assert.rejects(store.capture(pending,{text:'User prefers Python',topic:'language',quote:pending.text}));
 assert.equal((await app.inject({method:'GET',url:`/api/memory/activity/${event.id}`})).json().memories[0].current.text,'User lives in Kraków');
 assert.equal((await app.inject({method:'DELETE',url:`/api/memory/${id}`,payload:{revision:2}})).statusCode,200);
 const activity=(await app.inject({method:'GET',url:`/api/memory/activity/${event.id}`})).json();
 assert.equal(activity.memories[0].status,'deleted');assert.equal(activity.memories[0].text,undefined);
 assert.equal((await app.inject({method:'PATCH',url:'/api/memory/settings',payload:{enabled:false}})).json().enabled,false);
 assert.equal((await app.inject({method:'POST',url:'/api/memory/clear',payload:{confirm:true}})).statusCode,200);
 console.log('Memory management API confirmation, revisions, pending invalidation and redaction tests passed');
} finally {await app.close();await rm(directory,{recursive:true,force:true});}
