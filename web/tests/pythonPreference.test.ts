import test from 'node:test';
import assert from 'node:assert/strict';
import {pythonPreference,savePythonPreference} from '../src/lib/pythonPreference.js';
test('Python defaults on, remembers off and on, and tolerates blocked storage',()=>{
 let value:string|null=null;
 Object.assign(globalThis,{localStorage:{getItem:()=>value,setItem:(_key:string,next:string)=>{value=next;}}});
 assert.equal(pythonPreference(),true);
 savePythonPreference(false);assert.equal(pythonPreference(),false);
 savePythonPreference(true);assert.equal(pythonPreference(),true);
 Object.assign(globalThis,{localStorage:{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}}});
 assert.equal(pythonPreference(),true);assert.doesNotThrow(()=>savePythonPreference(false));
});
