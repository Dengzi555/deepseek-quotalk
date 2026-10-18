const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
async function flush(){for(let i=0;i<16;i++)await Promise.resolve();}
function harness({observe=false,deferInput=false,deferAnswer=false,ignoreEnter=false}={}){
  const timers=[],intervals=[],answers=[],updates=[],jobs=[],observers=[],initialized=[],requests=[];let sent=0,clock=0,ready=false,running=false,inputReady=!deferInput;
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.listeners={};this.textContent='';this.innerText='';this.isConnected=true;}
    append(...xs){this.children.push(...xs);for(const x of xs)x.parentElement=this;}
    attachShadow(){return new Element('shadow');}
    addEventListener(t,f){(this.listeners[t] ||= []).push(f);}
    setAttribute(){}
    getAttribute(){return null;}
    getClientRects(){return [{}];}
    querySelectorAll(){return [];}
    focus(){}
  }
  class Textarea extends Element{
    constructor(){super('textarea');this._value='';}
    get value(){return this._value;}
    set value(v){this._value=v;}
    dispatchEvent(e){
      if(e.type==='keydown'&&e.key==='Enter'){
        if(ignoreEnter)return true;
        sent++;if(!deferAnswer){const a=new Element('p');a.innerText='回答'+sent;answers.push(a);}this.value='';
      }
      return true;
    }
  }
  const input=new Textarea(),parent=new Element('form');parent.append(input);
  const sendButton=new Element('button'),stopButton=new Element('button');sendButton.getAttribute=k=>k==='aria-label'?'Send':null;stopButton.getAttribute=k=>k==='aria-label'?'Stop generating':null;
  parent.querySelectorAll=()=>ready?[sendButton]:[];
  const listeners={};
  const document={documentElement:new Element('html'),createElement:tag=>new Element(tag),addEventListener(type,fn){(listeners[type]||=[]).push(fn);},removeEventListener(type,fn){listeners[type]=(listeners[type]||[]).filter(x=>x!==fn);},dispatchEvent(event){for(const fn of listeners[event.type]||[])fn(event);return true;},querySelectorAll(selector){
    if(selector.startsWith('textarea'))return inputReady?[input]:[];
    if(selector==='[data-message-role="assistant"]')return answers;
    if(selector.startsWith('button')&&running)return [stopButton];
    return [];
  }};
  class E{constructor(type,options){this.type=type;Object.assign(this,options);}}
  const ctx={document,location:{hash:'#ds-margin-worker=shared'},Date:{now:()=>clock},getComputedStyle:()=>({visibility:'visible'}),HTMLTextAreaElement:Textarea,KeyboardEvent:E,InputEvent:E,Event:E,setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{t.cancelled=true;},setInterval:fn=>intervals.push(fn),chrome:{runtime:{async sendMessage(msg){
    let data;
    if(msg.type==='work')data=jobs.find(j=>['queued','running','streaming'].includes(j.status))||null;
    if(msg.type==='initialized')initialized.push(msg);
    if(msg.type==='request-started')requests.push(msg);
    if(msg.type==='update'){
      const j=jobs.find(j=>j.id===msg.id);Object.assign(j,{status:msg.status,text:msg.text,baseline:msg.baseline||j.baseline});updates.push({...msg,at:clock});
    }
    return {ok:true,data:data?structuredClone(data):data};
  }}}};
  if(observe)ctx.MutationObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}};
  vm.runInNewContext(fs.readFileSync('extension/core.js','utf8'),ctx);
  vm.runInNewContext(fs.readFileSync('extension/content.js','utf8'),ctx);
  async function step({tickDelay=0,onlyMs}={}){
    await flush();const pending=timers.splice(0);
    for(const t of pending){if(t.cancelled)continue;if(onlyMs!==undefined&&t.ms!==onlyMs){timers.push(t);continue;}clock+=Math.max(t.ms,tickDelay);t.fn();}
    await flush();
  }
  return {jobs,updates,document,observers,initialized,requests,stream(phase,id=1,extra={}){document.dispatchEvent({type:'ds-margin-stream',detail:JSON.stringify({id,phase,...extra})});},revealInput(){inputReady=true;},get clock(){return clock;},get sent(){return sent;},get pendingTimers(){return timers.filter(t=>!t.cancelled).length;},begin:async()=>{await flush();return intervals[0]();},step,signal(state){running=state==='running';ready=state==='idle';for(const o of observers)if(o.active)o.callback([{type:'attributes'}]);},mutate(text){answers.at(-1).innerText=text;for(const o of observers)if(o.active)o.callback();},async run({tickDelay=0,steps=110}={}){await flush();const promise=intervals[0]();for(let i=0;i<steps;i++)await step({tickDelay});await promise;}};
}
test('worker sends with Enter when send button is unlabeled, then processes another quote with revision 1',async()=>{
  const h=harness();h.jobs.push({id:'word-a',revision:1,status:'queued',prompt:'主动回忆'});await h.run();
  assert.equal(h.sent,1);assert.equal(h.jobs[0].status,'done');assert.equal(h.jobs[0].text,'回答1');
  h.jobs.push({id:'word-b',revision:1,status:'queued',prompt:'间隔重复'});await h.run();
  assert.equal(h.sent,2,'another quote with the same revision number must still run');
  assert.equal(h.jobs[1].status,'done');assert.equal(h.jobs[1].text,'回答2');
  assert.ok(h.updates.some(u=>u.id==='word-b'&&u.status==='streaming'&&u.text==='回答2'));
});
test('background timer throttling does not require forty wakeups to finish a stable answer',async()=>{
  const h=harness();h.jobs.push({id:'slow-tab',revision:1,status:'queued',prompt:'追问'});
  await h.run({tickDelay:60000,steps:5});
  assert.equal(h.jobs[0].status,'done');assert.equal(h.jobs[0].text,'回答1');assert.equal(h.pendingTimers,0);
});
test('worker adds no overlay, launcher, or manual calibration buttons to the answer page',async()=>{
  const h=harness();assert.equal(h.document.documentElement.children.length,0);
  h.jobs.push({id:'silent',revision:1,status:'queued',prompt:'正常追问'});await h.run();
  assert.equal(h.jobs[0].status,'done');assert.equal(h.document.documentElement.children.length,0);
});
test('DOM changes publish new text before the next polling sample and disconnect after completion',async()=>{
  const h=harness({observe:true});h.jobs.push({id:'real-stream',revision:1,status:'queued',prompt:'逐步回答'});
  const finished=h.begin();await h.step();await h.step();
  assert.equal(h.jobs[0].status,'streaming');
  h.mutate('回答正在逐步增长');await h.step({onlyMs:120});
  assert.equal(h.jobs[0].text,'回答正在逐步增长');assert.equal(h.jobs[0].status,'streaming');
  for(let i=0;i<110;i++)await h.step();await finished;
  assert.equal(h.jobs[0].status,'done');assert.equal(h.observers[0].active,false);
});
test('generation-finished signal ends synchronization without a twenty-second quiet wait',async()=>{
  const h=harness({observe:true});h.jobs.push({id:'finish-signal',revision:1,status:'queued',prompt:'追问'});
  const finished=h.begin();await h.step();await h.step();
  h.signal('running');await flush();h.signal('idle');await flush();await finished;
  assert.equal(h.jobs[0].status,'done');assert.ok(h.clock<3500);
});
test('unknown completion signal falls back within a few seconds rather than twenty',async()=>{
  const h=harness();h.jobs.push({id:'fallback',revision:1,status:'queued',prompt:'追问'});
  await h.run({steps:25});assert.equal(h.jobs[0].status,'done');
  const done=h.updates.find(u=>u.status==='done');assert.ok(done);
  assert.ok(done.at<900,'unknown DOM completion should use the requested 0.1 second quiet threshold');
});

test('a live stream without decoded text cannot finish just because the DOM pauses',async()=>{
  const h=harness();h.jobs.push({id:'live-unknown-format',revision:1,status:'queued',prompt:'追问'});
  const finished=h.begin();await h.step();await h.step();h.stream('start');
  for(let i=0;i<22;i++)await h.step();
  assert.equal(h.jobs[0].status,'streaming');
  h.mutate('最终正文');h.stream('end');await h.step();await h.step();await finished;
  assert.equal(h.jobs[0].status,'done');assert.equal(h.jobs[0].text,'最终正文');
});

test('an explicit generating state protects a long pause from the short completion fallback',async()=>{
  const h=harness({observe:true});h.jobs.push({id:'pause',revision:1,status:'queued',prompt:'追问'});
  const finished=h.begin();await h.step();await h.step();h.signal('running');
  for(let i=0;i<22;i++)await h.step();assert.equal(h.jobs[0].status,'streaming');
  h.mutate('结束正文');h.signal('idle');await flush();await finished;
  assert.equal(h.jobs[0].status,'done');assert.equal(h.jobs[0].text,'结束正文');
});
test('first job waits for a deferred input and confirms initialization only after sending',async()=>{
  const h=harness({deferInput:true});h.jobs.push({id:'first-load',revision:1,status:'queued',prompt:'首次追问'});
  const finished=h.begin();await h.step();await h.step();
  assert.equal(h.sent,0);assert.equal(h.initialized.length,0);assert.notEqual(h.jobs[0].status,'error');
  h.revealInput();for(let i=0;i<60;i++)await h.step();await finished;
  assert.equal(h.sent,1);assert.equal(h.jobs[0].status,'done');assert.equal(h.initialized.length,1);assert.equal(h.initialized[0].id,'first-load');
});
test('stream end completes promptly even when a stale page stop indicator remains',async()=>{
  const h=harness({observe:true});h.jobs.push({id:'stream-end',revision:1,status:'queued',prompt:'追问'});
  const finished=h.begin();await h.step();await h.step();h.signal('running');h.stream('start');h.stream('end');
  await h.step();await h.step();await finished;assert.equal(h.jobs[0].status,'done');assert.ok(h.clock<2000);
});

test('first reply streams and completes while the background page has not rendered any answer',async()=>{
  const h=harness({observe:true,deferAnswer:true});h.jobs.push({id:'hidden-first',revision:1,status:'queued',prompt:'首次追问'});
  const finished=h.begin();await h.step();await h.step();assert.equal(h.sent,1);
  h.stream('start');h.stream('text',1,{text:'后台尚未渲染，第一段文字已收到'});await flush();
  assert.equal(h.jobs[0].text,'后台尚未渲染，第一段文字已收到');
  h.stream('text',1,{text:'后台尚未渲染，完整回答'});h.stream('end');await h.step();await finished;
  assert.equal(h.jobs[0].status,'done');assert.equal(h.jobs[0].text,'后台尚未渲染，完整回答');
});

test('an empty composer does not prove first reply rendering is initialized; stale DOM cannot overwrite streamed text',async()=>{
  const h=harness({deferAnswer:true});h.jobs.push({id:'not-ready',revision:1,status:'queued',prompt:'追问'});
  const finished=h.begin();await h.step();await h.step();assert.equal(h.initialized.length,0);
  h.stream('start');h.stream('text',99,{text:'not this stream'});await flush();assert.equal(h.jobs[0].text,'');
  h.stream('text',1,{text:'真实正文'});h.stream('end');await h.step();await finished;
  assert.equal(h.jobs[0].text,'真实正文');assert.equal(h.initialized.length,1);
});

test('a fetch dispatch acknowledges startup before any DOM or response headers exist',async()=>{
  const h=harness({deferAnswer:true});h.jobs.push({id:'dispatch',revision:1,status:'queued',prompt:'first'});
  const finished=h.begin();await h.step();await h.step();h.stream('request');await flush();assert.equal(h.requests.length,1);assert.equal(h.initialized.length,0);
  h.stream('start');await flush();assert.equal(h.requests.length,1);
  h.stream('text',1,{text:'answer'});h.stream('end');await h.step();await finished;assert.equal(h.jobs[0].status,'done');
});

test('ignored submission reports a remaining draft instead of pretending startup is still in progress',async()=>{
  const h=harness({ignoreEnter:true});h.jobs.push({id:'unsent',revision:1,status:'queued',prompt:'question'});
  await h.run({steps:200});
  assert.equal(h.sent,0);assert.equal(h.jobs[0].status,'error');
  assert.match(h.updates.at(-1).error,/问题仍在回答页输入框/);
  assert.ok(h.clock<30000);assert.equal(h.requests.length,0);
  assert.deepEqual(h.updates.filter(x=>x.status==='running').map(x=>x.stage),['loading','filling','submitting']);
});

test('a cleared composer alone changes the waiting hint without treating the request as sent',async()=>{
  const h=harness({deferAnswer:true});h.jobs.push({id:'unconfirmed',revision:1,status:'queued',prompt:'question'});
  const finished=h.begin();for(let i=0;i<180;i++)await h.step();
  assert.ok(h.updates.some(x=>x.stage==='waiting'));assert.equal(h.requests.length,0);
  assert.equal(h.jobs[0].status,'running');assert.equal(h.sent,1);
  h.stream('request');h.stream('text',1,{text:'answer'});h.stream('end');await h.step();await finished;
  assert.equal(h.jobs[0].status,'done');assert.equal(h.sent,1);
});
