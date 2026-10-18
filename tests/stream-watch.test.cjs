const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function fixture(response,{worker=true}={}){
  const events=[],listeners={},calls=[];
  const document={addEventListener(type,fn){(listeners[type]||=[]).push(fn);},dispatchEvent(event){if(event.type==='ds-margin-stream')events.push(JSON.parse(event.detail));for(const fn of listeners[event.type]||[])fn(event);}};
  const original=async(...args)=>{calls.push(args);return response;},window={fetch:original};
  class CustomEvent{constructor(type,options){this.type=type;this.detail=options?.detail;}}
  const context=vm.createContext({window,document,CustomEvent,URL,TextDecoder,location:{href:'https://chat.deepseek.com/',origin:'https://chat.deepseek.com',hash:worker?'#ds-margin-worker=shared':''}});
  vm.runInContext(fs.readFileSync('extension/stream-decoder.js','utf8'),context);
  vm.runInContext(fs.readFileSync('extension/stream-watch.js','utf8'),context);
  return {events,calls,window,original,document};
}
async function settle(predicate){for(let i=0;i<50;i++){if(predicate())return;await new Promise(setImmediate);}assert.ok(predicate(),'stream event did not arrive');}
test('observes end of an existing chat stream without replacing its response or making a second request',async()=>{
  const payload='data: {"reply":"private fixture text"}\n\n';
  const response=new Response(payload,{headers:{'content-type':'text/event-stream'}}),h=fixture(response);
  const actual=await h.window.fetch('https://chat.deepseek.com/api/v0/chat/completion',{method:'POST',body:'private question'});
  assert.equal(actual,response);assert.equal(await actual.text(),payload);await settle(()=>h.events.some(e=>e.phase==='end'));
  assert.equal(h.calls.length,1);assert.deepEqual(h.events.map(e=>e.phase),['request','start','end']);
  for(const e of h.events)assert.deepEqual(Object.keys(e).sort(),['id','phase']);
});
test('only arms on the worker and ignores ordinary page fetches',async()=>{
  const response=new Response('ordinary response'),h=fixture(response,{worker:false});
  assert.equal(h.window.fetch,h.original);
  h.document.dispatchEvent({type:'ds-margin-arm-stream-watch'});assert.notEqual(h.window.fetch,h.original);
  assert.equal(await h.window.fetch('https://chat.deepseek.com/assets/app.js'),response);assert.equal(h.events.length,0);
});
test('standard SSE done sentinel finishes even if the connection remains open',async()=>{
  let controller;const stream=new ReadableStream({start(c){controller=c;}});
  const response=new Response(stream,{headers:{'content-type':'text/event-stream'}}),h=fixture(response);
  await h.window.fetch('https://chat.deepseek.com/api/v0/chat/completion',{method:'POST'});
  controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));await settle(()=>h.events.some(e=>e.phase==='end'));
  assert.deepEqual(h.events.map(e=>e.phase),['request','start','end']);controller.close();
});

test('request dispatch is reported before waiting for response headers',async()=>{
  const events=[],listeners={};let resolveHeaders;
  const document={addEventListener(t,f){(listeners[t]||=[]).push(f);},dispatchEvent(e){if(e.type==='ds-margin-stream')events.push(JSON.parse(e.detail));for(const f of listeners[e.type]||[])f(e);}};
  class CustomEvent{constructor(type,o){this.type=type;this.detail=o.detail;}}
  const response=new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  const context=vm.createContext({window:{fetch:()=>new Promise(resolve=>{resolveHeaders=resolve;})},document,CustomEvent,URL,TextDecoder,location:{href:'https://chat.deepseek.com/',origin:'https://chat.deepseek.com',hash:'#ds-margin-worker=shared'}});
  vm.runInContext(fs.readFileSync('extension/stream-watch.js','utf8'),context);
  const pending=context.window.fetch('/api/v0/chat/completion',{method:'POST'});
  assert.deepEqual(events.map(e=>e.phase),['request']);resolveHeaders(response);assert.equal(await pending,response);
});

test('visible reply is relayed before DOM rendering and FINISHED flushes the complete text',async()=>{
  let controller;const stream=new ReadableStream({start(c){controller=c;}}),encoder=new TextEncoder();
  const response=new Response(stream,{headers:{'content-type':'text/event-stream'}}),h=fixture(response);
  assert.equal(await h.window.fetch('https://chat.deepseek.com/api/v0/chat/completion',{method:'POST'}),response);
  const frame=obj=>'data: '+JSON.stringify(obj)+'\r\n\r\n';
  controller.enqueue(encoder.encode(frame({v:{response:{fragments:[{type:'THINK',content:'private thinking'}]}}})+frame({p:'response/fragments',o:'APPEND',v:[{type:'RESPONSE',content:'首段'}]})));
  await settle(()=>h.events.some(e=>e.phase==='text'));
  assert.equal(h.events.find(e=>e.phase==='text').text,'首段');assert.equal(h.events.some(e=>e.phase==='end'),false);
  const tail=encoder.encode(frame({p:'response/fragments/-1/content',o:'APPEND',v:'，接着输出中文'} )+frame({p:'response/status',o:'SET',v:'FINISHED'}));
  for(let i=0;i<tail.length;i+=7)controller.enqueue(tail.slice(i,i+7));
  await settle(()=>h.events.some(e=>e.phase==='end'));
  assert.equal(h.events.filter(e=>e.phase==='text').at(-1).text,'首段，接着输出中文');
  assert.doesNotMatch(JSON.stringify(h.events),/private thinking/);assert.equal(h.calls.length,1);controller.close();
});
