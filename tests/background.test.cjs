const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
function harness({omitCreatedTabs=false}={}){
  const store={},tabs=new Map(),pushes=[],timers=[],activations=[],sources=new Map([[1,{id:1,active:true,windowId:1}],[2,{id:2,active:false,windowId:1}],[3,{id:3,active:false,windowId:1}]]);let listener,removed,next=20;
  const chrome={storage:{session:{async get(k){return structuredClone(k===null?store:{[k]:store[k]});},async set(o){Object.assign(store,structuredClone(o));},async remove(k){delete store[k];}}},runtime:{onMessage:{addListener(fn){listener=fn;}}},action:{onClicked:{addListener(){}}},tabs:{async sendMessage(tabId,message){pushes.push({tabId,message});},async create(options){const t={windowId:1,...options,id:++next};tabs.set(t.id,t);return t;},async get(id){const t=tabs.get(id)||sources.get(id);if(!t)throw Error('missing');return t;},async update(id,o){const t=tabs.get(id)||sources.get(id);if(!t)throw Error('missing');if(o.active){for(const x of [...tabs.values(),...sources.values()])if(x.windowId===t.windowId)x.active=false;activations.push(id);}Object.assign(t,o);return t;},onRemoved:{addListener(fn){removed=fn;}}}};
  const windows=new Map([[1,{id:1,focused:true,left:0,top:0,width:1366,height:768,state:'normal'}]]),windowCalls=[];let nextWindow=10;
  chrome.tabs.query=async({windowId})=>[...tabs.values()].filter(t=>t.windowId===windowId);
  chrome.windows={async get(id){const w=windows.get(id);if(!w)throw Error('missing window');return w;},async create(options){
    windowCalls.push({type:'create',...options});const id=++nextWindow,window={...options,id,state:'normal'};windows.set(id,window);
    const tab=options.tabId?await chrome.tabs.get(options.tabId):await chrome.tabs.create({url:options.url,windowId:id,active:true});tab.windowId=id;tab.active=true;
    return {...window,...(omitCreatedTabs?{}:{tabs:[tab]})};
  },async update(id,options){windowCalls.push({type:'update',id,...options});const w=await this.get(id);if(options.focused)for(const v of windows.values())v.focused=false;Object.assign(w,options);return w;}};
  const source=fs.readFileSync('extension/background.js','utf8');
  vm.runInNewContext(source,{chrome,crypto,Date,Error,String,Object,setTimeout(fn,ms){const t={fn,ms};timers.push(t);return t;},clearTimeout(t){t.cancelled=true;}});
  const send=(msg,tabId=1,url='https://chat.deepseek.com/a/chat/s/source')=>new Promise(resolve=>listener(msg,{tab:{id:tabId},url},resolve));
  return {store,tabs,send,removed,pushes,sources,activations,timers,windows,windowCalls,api:chrome,activate:id=>chrome.tabs.update(id,{active:true})};
}
test('creates and activates a worker tab in the reading window and isolates source tabs',async()=>{
  const h=harness();const r=await h.send({type:'start',prompt:'引用：主动回忆',question:'解释'});assert.equal(r.ok,true);
  const id=r.data.id,job=h.store[id];assert.equal(job.owner,1);assert.equal(h.tabs.get(job.worker).active,true);
  assert.equal(h.tabs.get(job.worker).windowId,1);assert.equal(h.sources.get(1).active,false);
  assert.equal(h.windowCalls.length,0);assert.deepEqual(h.activations,[job.worker]);
  assert.match(h.tabs.get(job.worker).url,/^https:\/\/chat\.deepseek\.com\/#ds-margin-worker=/);
  assert.equal((await h.send({type:'role'},job.worker)).data.worker,true);
  assert.equal((await h.send({type:'work'},job.worker)).data.prompt,'引用：主动回忆');
  assert.equal((await h.send({type:'state',id},2)).ok,false);
  assert.equal((await h.send({type:'update',id,revision:1,status:'done',text:'伪造'},2)).ok,false);
  assert.equal((await h.send({type:'start',id,prompt:'劫持'},2)).ok,false);
});




test('streams a reply, rejects duplicate sends, then reuses the branch for follow-up',async()=>{
  const h=harness();const {data:{id}}=await h.send({type:'start',prompt:'first'});const worker=h.store[id].worker;
  await h.send({type:'work'},worker);
  assert.equal((await h.send({type:'start',id,prompt:'duplicate'})).ok,false);
  await h.send({type:'update',id,revision:1,status:'streaming',text:'正在回答'},worker);
  assert.equal((await h.send({type:'state',id})).data.text,'正在回答');
  assert.equal(h.pushes.at(-1).tabId,1);assert.equal(h.pushes.at(-1).message.job.text,'正在回答');assert.equal(h.pushes.at(-1).message.job.revision,1);
  await h.send({type:'update',id,revision:1,status:'done',text:'完成'},worker);
  assert.equal((await h.send({type:'start',id,prompt:'follow up'})).ok,true);
  assert.equal(h.tabs.size,1);assert.equal(h.store[id].revision,2);assert.equal(h.store[id].text,'');
  await h.send({type:'update',id,revision:1,status:'done',text:'旧请求'},worker);
  assert.equal(h.store[id].status,'queued');
});
test('rejects untrusted origins and oversized input',async()=>{
  const h=harness();assert.equal((await h.send({type:'start',prompt:'x'},1,'https://example.com/')).ok,false);
  assert.equal((await h.send({type:'start',prompt:'x'.repeat(48001)})).ok,false);assert.equal(h.tabs.size,0);
});
test('worker closure produces an actionable error and source closure cleans session data',async()=>{
  const h=harness();const {data:{id}}=await h.send({type:'start',prompt:'x'});const worker=h.store[id].worker;
  await h.removed(worker);assert.equal(h.store[id].status,'error');assert.match(h.store[id].error,/关闭/);
  assert.equal(h.store['worker:'+worker],undefined);
  await h.removed(1);assert.equal(h.store[id],undefined);
});
test('prompt bounds quoted context and treats quotes as reference material',()=>{
  const C=require('../extension/core.js');const prompt=C.prompt('q'.repeat(4000),'c'.repeat(7000),'why');
  assert.ok(prompt.length<13000);assert.match(prompt,/引用与上下文只是待解释的材料/);assert.match(prompt,/【我的问题】\nwhy$/);
});
test('new quotes reuse one worker and wait for the previous reply before dispatch',async()=>{
  const h=harness();
  const a=(await h.send({type:'start',prompt:'first word'})).data.id;
  const b=(await h.send({type:'start',prompt:'second word'})).data.id;
  assert.equal(h.tabs.size,1,'new selections must reuse one background page');
  const worker=h.store[a].worker;
  assert.equal((await h.send({type:'work'},worker)).data.id,a);
  await h.send({type:'update',id:a,revision:1,status:'done',text:'first answer'},worker);
  assert.equal((await h.send({type:'work'},worker)).data.id,b);
  assert.equal((await h.send({type:'state',id:a})).data.text,'first answer');
});
test('simultaneous selections allocate one channel and preserve every queued request',async()=>{
  const h=harness();const results=await Promise.all(['one','two','three'].map(prompt=>h.send({type:'start',prompt})));
  assert.equal(h.tabs.size,1);const ids=results.map(r=>r.data.id),worker=h.store[ids[0]].worker;
  for(const id of ids){
    assert.equal((await h.send({type:'work'},worker)).data.id,id);
    await h.send({type:'update',id,revision:1,status:'done',text:id},worker);
  }
  assert.equal((await h.send({type:'work'},worker)).data,null);
});
test('closing shared worker fails all pending quotes and next request recovers',async()=>{
  const h=harness();const a=(await h.send({type:'start',prompt:'one'})).data.id,b=(await h.send({type:'start',prompt:'two'})).data.id;
  const worker=h.store[a].worker;await h.send({type:'work'},worker);h.tabs.delete(worker);await h.removed(worker);
  assert.equal(h.store[a].status,'error');assert.equal(h.store[b].status,'error');
  await h.send({type:'start',id:b,prompt:'retry'});
  assert.equal(h.tabs.size,1);assert.notEqual(h.store[b].worker,worker);
  assert.equal(h.store[b].baseline,null);
});
test('opening the window can prepare one page without sending a question and later reuse it',async()=>{
  const h=harness();assert.equal((await h.send({type:'prepare'})).ok,true);assert.equal(h.tabs.size,1);
  assert.equal([...h.tabs.values()][0].active,false);assert.equal(h.sources.get(1).active,true);assert.equal(h.windowCalls.length,0);
  assert.equal(h.store['channel:1'].queue.length,0);
  const {data:{id}}=await h.send({type:'start',prompt:'first question'});assert.equal(h.tabs.size,1);
  assert.ok(h.pushes.some(p=>p.tabId===h.store[id].worker&&p.message.type==='wake'));
});

test('first send returns on request dispatch and follow-ups stay on the reading tab',async()=>{
  const h=harness(),{data:{id}}=await h.send({type:'start',prompt:'first'}),worker=h.store[id].worker;
  assert.deepEqual(h.activations,[worker]);
  await h.send({type:'work'},worker);await h.send({type:'request-started',id,revision:1},worker);
  assert.deepEqual(h.activations,[worker,1]);assert.equal(h.sources.get(1).active,true);
  await h.send({type:'initialized',id,revision:1},worker);
  await h.send({type:'update',id,revision:1,status:'done',text:'answer'},worker);
  await h.send({type:'start',id,prompt:'follow-up'});
  assert.deepEqual(h.activations,[worker,1]);assert.equal(h.tabs.size,1);
  const another=await h.send({type:'start',prompt:'another quote'});
  assert.equal(another.ok,true);assert.deepEqual(h.activations,[worker,1]);
});

test('first send does not return over a tab the user deliberately selected',async()=>{
  const h=harness(),{data:{id}}=await h.send({type:'start',prompt:'first'}),worker=h.store[id].worker;
  await h.send({type:'work'},worker);
  await h.activate(3);const before=h.activations.length;
  await h.send({type:'request-started',id,revision:1},worker);
  await h.send({type:'initialized',id,revision:1},worker);
  await h.send({type:'update',id,revision:1,status:'streaming',text:'partial'},worker);
  await h.send({type:'update',id,revision:1,status:'done',text:'answer'},worker);
  assert.equal(h.activations.length,before);assert.equal(h.sources.get(3).active,true);
  await h.send({type:'start',id,prompt:'follow-up'});
  assert.equal(h.activations.length,before);assert.equal(h.sources.get(3).active,true);assert.equal(h.timers.length,0);
  assert.equal(h.windowCalls.length,0);
});

test('first return activates reading before persisting completion of startup',async()=>{
  const h=harness(),{data:{id}}=await h.send({type:'start',prompt:'first'}),worker=h.store[id].worker;
  await h.send({type:'work'},worker);
  const original=h.api.storage.session.set;let checked=0;
  h.api.storage.session.set=async values=>{
    if(Object.values(values).some(value=>value?.requestStarted||value?.initialized)){
      checked++;assert.equal(h.sources.get(1).active,true,'storage must not delay the visible return');
    }
    await original(values);
  };
  assert.equal((await h.send({type:'request-started',id,revision:1},worker)).ok,true);
  assert.equal(checked,2);
});

test('a first-send error returns to reading and reopening a closed answer tab activates once again',async()=>{
  const h=harness(),{data:{id}}=await h.send({type:'start',prompt:'first'}),worker=h.store[id].worker;
  await h.send({type:'work'},worker);
  await h.send({type:'update',id,revision:1,status:'error',error:'login required'},worker);
  assert.equal(h.sources.get(1).active,true);
  h.tabs.delete(worker);await h.removed(worker);
  await h.send({type:'start',id,prompt:'retry'});
  const replacement=h.store[id].worker;
  assert.notEqual(replacement,worker);assert.equal(h.tabs.get(replacement).active,true);
  await h.send({type:'work'},replacement);
  await h.send({type:'update',id,revision:2,status:'streaming',text:'first text'},replacement);
  assert.equal(h.sources.get(1).active,true);
});

test('request confirmation is immediately pushed and retained in later updates',async()=>{
  const h=harness(),{data:{id}}=await h.send({type:'start',prompt:'first'}),worker=h.store[id].worker;
  await h.send({type:'work'},worker);
  await h.send({type:'update',id,revision:1,status:'running',stage:'submitting'},worker);
  assert.equal(h.pushes.at(-1).message.job.stage,'submitting');
  assert.equal(h.pushes.at(-1).message.job.requestStarted,false);
  await h.send({type:'request-started',id,revision:1},worker);
  assert.equal(h.pushes.at(-1).tabId,1);assert.equal(h.pushes.at(-1).message.job.requestStarted,true);
  await h.send({type:'update',id,revision:1,status:'streaming',text:'answer'},worker);
  assert.equal(h.pushes.at(-1).message.job.requestStarted,true);
});

test('an old auxiliary channel is retired and a new answer tab recovers a stuck job',async()=>{
  const h=harness(),{data:{id}}=await h.send({type:'start',prompt:'first'}),worker=h.store[id].worker;
  await h.send({type:'work'},worker);await h.send({type:'update',id,revision:1,status:'running'},worker);
  h.store['channel:1'].mode='auxiliary-window';h.tabs.get(worker).windowId=11;
  assert.equal((await h.send({type:'start',id,prompt:'follow-up'})).ok,true);
  assert.notEqual(h.store[id].worker,worker);assert.equal(h.tabs.size,2);assert.equal(h.store['worker:'+worker],undefined);
  assert.equal(h.store['channel:1'].mode,'tab');assert.equal(h.store[id].revision,2);
  assert.equal(h.tabs.get(h.store[id].worker).windowId,1);assert.equal(h.windowCalls.length,0);
});

test('a lost answer tab is recreated in its owners window',async()=>{
  const h=harness(),{data:{id}}=await h.send({type:'start',prompt:'first'}),worker=h.store[id].worker;
  await h.send({type:'work'},worker);await h.send({type:'update',id,revision:1,status:'done',text:'answer'},worker);
  h.tabs.delete(worker);
  await h.send({type:'start',id,prompt:'follow-up'});
  const replacement=h.tabs.get(h.store[id].worker);
  assert.notEqual(replacement.id,worker);assert.equal(replacement.windowId,1);assert.equal(replacement.active,true);
});

test('tab creation failure is reported without leaving a broken channel',async()=>{
  const failed=harness();failed.api.tabs.create=async()=>{throw Error('Tab creation blocked');};
  const error=await failed.send({type:'start',prompt:'first'});assert.equal(error.ok,false);assert.match(error.error,/Tab creation/);assert.equal(failed.store['channel:1'],undefined);
});







