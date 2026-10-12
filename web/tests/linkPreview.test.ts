import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldPreviewLink } from '../src/lib/linkPreview';

const click = {button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,defaultPrevented:false};
test('touch and pen activation previews links, including touch on a hybrid computer',()=>{
  assert.equal(shouldPreviewLink(click,'touch',false),true);
  assert.equal(shouldPreviewLink(click,'pen',false),true);
  assert.equal(shouldPreviewLink(click,'',true),true);
  assert.equal(shouldPreviewLink(click,'mouse',false),false);
  assert.equal(shouldPreviewLink(click,'',false),false);
});
test('modified, non-primary and already-handled clicks keep their native behavior',()=>{
  for(const override of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true}]) {
    assert.equal(shouldPreviewLink({...click,...override},'touch',true),false);
  }
});
