const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../extension/stream-decoder.js');

test('snapshot, fragment append and inherited path decode only visible answer text',()=>{
  const d=create();
  assert.equal(d.push({v:{response:{fragments:[{type:'THINK',content:'private reasoning'}],status:'WIP'}}}).text,'');
  assert.equal(d.push({p:'response/fragments/-1/content',o:'APPEND',v:'more reasoning'}).text,'');
  assert.equal(d.push({p:'response/fragments',o:'APPEND',v:[{type:'RESPONSE',content:'你'}]}).text,'你');
  assert.equal(d.push({p:'response/fragments/-1/content',o:'APPEND',v:'好'}).text,'你好');
  assert.equal(d.push({v:'，这就是答案'}).text,'你好，这就是答案');
  assert.equal(d.push({p:'response/status',o:'SET',v:'FINISHED'}).finished,true);
});

test('relative BATCH patches keep fragment types separate from metadata',()=>{
  const d=create();d.push({v:{response:{fragments:[]}}});
  d.push({p:'response',o:'BATCH',v:[
    {p:'fragments',o:'APPEND',v:[{type:'THINK',content:'hidden'},{type:'RESPONSE',content:'可见'}]},
    {p:'fragments/-1/content',o:'APPEND',v:'答案'},
    {p:'accumulated_token_usage',v:100},
  ]});
  assert.deepEqual(d.push({p:'response/status',o:'SET',v:'FINISHED'}),{text:'可见答案',finished:true});
});

test('normal content patches and SET operations do not duplicate replacement text',()=>{
  const d=create();d.push({p:'response/content',o:'APPEND',v:'初稿'});
  assert.equal(d.push({v:'内容'}).text,'初稿内容');
  assert.equal(d.push({p:'response/content',o:'SET',v:'修订稿'}).text,'修订稿');
  assert.equal(d.push({p:'response/message_id',v:123}).text,'修订稿');
});

test('unknown fields, thought-only frames and unbound strings are not exposed',()=>{
  const d=create();for(const frame of [{v:'unbound'},{reply:'metadata'},{p:'response/thinking_content',v:'private'},{v:{response:{fragments:[{type:'SEARCH',content:'internal search metadata'}]}}}])assert.equal(d.push(frame).text,'');
});

test('visible text is bounded and malformed fragment indices are ignored',()=>{
  const d=create();d.push({v:{response:{fragments:[{type:'RESPONSE',content:'a'.repeat(100005)}]}}});
  assert.equal(d.push({p:'response/fragments/-999/content',v:'ignored'}).text.length,100000);
  assert.equal(d.push({p:'__proto__/content',v:'ignored'}).text.length,100000);
});
