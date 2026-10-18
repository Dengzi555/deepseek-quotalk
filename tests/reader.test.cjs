const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
// Minimal event/DOM harness: runs the actual content script and its async handlers.
// This is not a rendering test or a substitute for a real DeepSeek test.
function readerHarness({production=false,preferences={}}={}){
  class Element {
    constructor(tag){this.tag=tag;this.style={};this.children=[];this.listeners={};this.attrs={};this.value='';this.textContent='';this.innerText='paragraph';this.scrollTop=0;this.isConnected=true;this.paused=true;this.readyState=0;}
    pause(){this.paused=true;}
    play(){this.paused=false;return Promise.resolve();}
    load(){this.readyState=0;this.paused=true;}
    append(...xs){this.children.push(...xs);for(const x of xs)x.parentElement=this;}
    replaceChildren(...xs){this.children=[];this.append(...xs);}
    attachShadow(){return this.shadow=new Element('shadow');}
    addEventListener(type,fn){(this.listeners[type] ||= []).push(fn);}
    setAttribute(k,v){this.attrs[k]=v;}
    getAttribute(k){return this.attrs[k];}
    setPointerCapture(){}
    focus(){}
    closest(s){return s==='p,li,pre,blockquote'?this:null;}
    getBoundingClientRect(){return {left:10,top:10,bottom:40};}
    async click(){if(this.disabled)return;for(const fn of this.listeners.click||[])fn({target:this});await flush();}
  }
  const document=new Element('document');document.documentElement=new Element('html');document.scrollingElement=new Element('scroll');document.createElement=tag=>new Element(tag);
  const calls=[],jobs=new Map(),sleepers=[];let text='第一个词';
  const paragraph=new Element('p');
  const ctx={console,document,location:{hash:''},innerWidth:1200,innerHeight:900,performance:{now:()=>1000},getComputedStyle:()=>({overflowY:'visible'}),getSelection:()=>({toString:()=>text,rangeCount:1,anchorNode:{parentElement:paragraph},getRangeAt:()=>({getBoundingClientRect:()=>({left:10,bottom:30})})}),setTimeout:(fn,ms)=>{const t={fn,ms};sleepers.push(t);return t;},clearTimeout:t=>{t.cancelled=true;},requestAnimationFrame:fn=>fn(),__MARGIN_DEMO__:true,MarginCore:{captureContext:()=>({recognized:true,messages:[{role:'user',text:'请结合 Miniclaw 的架构解释'}],currentAnswer:'完整的原回答',truncated:false}),sourceText:s=>s.messages?.[0]?.text||'',prompt:(q,c,p,h,s)=>q+':'+p+':'+s.messages[0].text+':'+s.currentAnswer+':'+JSON.stringify(h)},__marginMock:async(type,data)=>{
    if(type==='start'){calls.push(data);const id=data.id||'job'+calls.length,revision=(jobs.get(id)?.revision||0)+1;jobs.set(id,{id,revision,status:'streaming',text:'正在解释'});return {id,revision};}
    if(type==='state')return jobs.get(data.id);
  }};
  const scopes=[];const originalCapture=ctx.MarginCore.captureContext;ctx.MarginCore.captureContext=(el,q,root,scope)=>{scopes.push(scope);return originalCapture();};
  const inbox=[];ctx.__MARGIN_DEMO__=!production;ctx.MarginCore.answers=()=>[];
  ctx.chrome={storage:{local:{async get(){return {...preferences};},async set(data){Object.assign(preferences,data);},async remove(keys){for(const key of keys)delete preferences[key];}}},runtime:{getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:fn=>inbox.push(fn)},async sendMessage(msg){if(msg.type==='role')return {ok:true,data:{worker:false}};return {ok:true,data:await ctx.__marginMock(msg.type,msg)};}}};
  vm.runInNewContext(fs.readFileSync('extension/ui.js','utf8'),ctx);
  vm.runInNewContext(fs.readFileSync('extension/pet-catalog.js','utf8'),ctx);
  vm.runInNewContext(fs.readFileSync('extension/content.js','utf8'),ctx);
  function all(el=document.documentElement.children[0].shadow){return [el,...el.children.flatMap(all)];}
  const aliases={'旁注':'pet','＋ 旁注追问':'select','追问 ↗':'primary','收起':'window-control','切换主题':'theme-control'};
  const button=label=>all().find(e=>e.tag==='button'&&(aliases[label]?e.className===aliases[label]:e.textContent===label));
  return {get mainScrollTop(){return document.scrollingElement.scrollTop;},sleepers,async fireTimer(ms){const i=sleepers.findIndex(t=>!t.cancelled&&t.ms===ms);if(i<0)throw Error('No matching timer');const [t]=sleepers.splice(i,1);t.fn();await flush();},async setHidden(value){document.hidden=value;for(const fn of document.listeners.visibilitychange||[])fn();await flush();},calls,jobs,button,all,scopes,get host(){return document.documentElement.children[0];},ready:flush,async show(){for(const fn of inbox)fn({type:'show'});await flush();},async movePointer(x,y){for(const fn of document.listeners.pointermove||[])fn({clientX:x,clientY:y});await flush();},async push(job){for(const fn of inbox)fn({type:'job-update',job});await flush();},async key(options={}){const event={key:'Enter',preventDefault(){this.prevented=true;},...options};const input=all().find(e=>e.tag==='textarea');for(const fn of input.listeners.keydown||[])fn(event);await flush();return event;},async select(value){text=value;for(const fn of document.listeners.pointerup||[])fn({composedPath:()=>[],target:paragraph});await button('＋ 旁注追问').click();},async tick(){const fns=sleepers.splice(0);for(const t of fns)if(!t.cancelled)t.fn();await flush();}};
}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}

test('two characters retain separate sizes and whale defaults to small',async()=>{
  const preferences={petSize:'large'},h=readerHarness({production:true,preferences});await h.ready();
  const pet=h.button('旁注');assert.equal(pet.getAttribute('data-skin'),'maid');assert.equal(pet.style.width,'192px');
  const whale=h.all().find(e=>e.getAttribute('data-skin-id')==='whale');
  await whale.click();assert.equal(pet.style.width,'96px');assert.match(pet.children[0].src,/deepseek-whale-blue.svg$/);
  const row=h.all().find(e=>e.getAttribute('data-section')==='action');assert.equal(row.style.display,'none');
  await h.all().find(e=>e.getAttribute('data-size-id')==='medium').click();assert.equal(preferences.petSizes.whale,'medium');
  await h.all().find(e=>e.getAttribute('data-skin-id')==='maid').click();assert.equal(pet.style.width,'192px');assert.equal(row.style.display,'');
  await whale.click();const reopened=readerHarness({production:true,preferences});await reopened.ready();
  assert.equal(reopened.button('旁注').getAttribute('data-skin'),'whale');assert.equal(reopened.button('旁注').style.width,'144px');
  assert.equal(h.calls.length,0);
});

test('whale ignores random and late video events while replies still restore the correct pose',async()=>{
  const h=readerHarness({production:true});await h.ready();await chooseRandom(h,1);
  await h.select('追问');await h.button('解释一下').click();
  await h.all().find(e=>e.getAttribute('data-skin-id')==='whale').click();
  await mediaEvent(h,'loadeddata');await mediaEvent(h,'playing');await h.fireTimer(60000);
  const pet=h.button('旁注'),video=h.all().find(e=>e.tag==='video');
  assert.equal(video.style.display,'none');assert.equal(video.paused,true);assert.equal(pet.children[0].style.display,'block');
  assert.equal(pet.getAttribute('data-pose'),'thinking');
  await h.all().find(e=>e.getAttribute('data-skin-id')==='maid').click();assert.match(video.src,/a100.webm$/);
  await h.push({id:'job1',revision:1,status:'done',text:'完成',updated:10});assert.match(video.src,/a000.webm$/);assert.equal(h.calls.length,1);
});

test('character preview plays only with its menu open',async()=>{
  const h=readerHarness(),pet=h.button('旁注');
  for(const fn of pet.listeners.contextmenu)fn({preventDefault(){},clientX:100,clientY:100});
  await h.button('选择形象 ›').click();
  const preview=h.all().find(e=>e.getAttribute('data-skin-id')==='maid').children[0];
  assert.equal(preview.tag,'video');assert.equal(preview.paused,false);
  await h.button('形象大小 ›').click();assert.equal(preview.paused,true);
});

async function chooseRandom(h,value){
  const control=h.all().find(e=>e.getAttribute('aria-label')==='随机自动播放间隔');
  control.value=String(value);for(const fn of control.listeners.change)fn();await h.ready();return control;
}

test('random playback remembers intervals, plays once, and can be disabled',async()=>{
  const preferences={},h=readerHarness({production:true,preferences});await h.ready();
  assert.equal(h.sleepers.some(t=>t.ms===60000),false);
  const control=await chooseRandom(h,1);assert.deepEqual(control.children.map(e=>e.value),['0','1','3','5','10']);
  await h.fireTimer(60000);const video=h.all().find(e=>e.tag==='video');
  assert.equal(video.loop,false);assert.doesNotMatch(video.src,/a(?:000|100|09[1-6])\.webm$/);
  await mediaEvent(h,'ended');assert.match(video.src,/a000.webm$/);
  await chooseRandom(h,3);assert.equal(preferences.randomActionMinutes,3);
  const restored=readerHarness({production:true,preferences});await restored.ready();
  assert.ok(restored.sleepers.some(t=>!t.cancelled&&t.ms===180000));
  await chooseRandom(h,0);assert.equal(h.sleepers.some(t=>!t.cancelled&&[60000,180000].includes(t.ms)),false);
  assert.equal(h.calls.length,0);
});

test('random playback skips manual actions, thinking, exit and hidden pages',async()=>{
  const h=readerHarness({production:true});await h.ready();await chooseRandom(h,1);
  const video=h.all().find(e=>e.tag==='video');
  await h.button('吃白饭').click();const manual=video.src;await h.fireTimer(60000);assert.equal(video.src,manual);
  await mediaEvent(h,'ended');await h.select('追问');await h.button('解释一下').click();
  await h.fireTimer(60000);assert.match(video.src,/a100.webm$/);
  await h.push({id:'job1',revision:1,status:'done',text:'完成',updated:10});
  await h.setHidden(true);await h.fireTimer(60000);assert.match(video.src,/a000.webm$/);
  await h.setHidden(false);await h.button('退出').click();await h.fireTimer(60000);
  assert.match(video.src,/a000.webm$/);assert.equal(video.paused,true);assert.equal(h.calls.length,1);
});

test('can select and ask about another word while the first reply is pending',async()=>{
  const h=readerHarness();await h.select('主动回忆');await h.button('解释一下').click();assert.equal(h.calls.length,1);
  await h.select('间隔重复');await h.button('解释一下').click();
  assert.equal(h.calls.length,2,'changing the quote must not inherit the previous request busy flag');
  assert.match(h.calls[1].prompt,/间隔重复/);
});
test('an older reply completing cannot overwrite the currently selected request',async()=>{
  const h=readerHarness();await h.select('主动回忆');await h.button('解释一下').click();
  await h.select('间隔重复');await h.button('解释一下').click();
  h.jobs.set('job1',{id:'job1',status:'done',text:'旧词解释'});await h.tick();
  const status=h.all().find(e=>e.className==='status');assert.doesNotMatch(status.textContent,/已同步，可继续/);
});
test('same-note follow-up is accepted while streaming and sent after the preceding answer',async()=>{
  const h=readerHarness();await h.select('Subagents');await h.button('解释一下').click();
  assert.notEqual(h.button('追问 ↗').disabled,true,'streaming must not lock the follow-up composer');
  const input=h.all().find(e=>e.tag==='textarea');input.value='follow-up 是啥';
  await h.button('追问 ↗').click();assert.equal(input.value,'','accepted question must leave the draft');
  assert.equal(h.calls.length,1,'follow-up must wait for the preceding answer');
  assert.ok(h.all().some(e=>e.className==='q'&&e.textContent==='follow-up 是啥'));
  h.jobs.set('job1',{id:'job1',status:'done',text:'第一条完整解释'});await h.tick();
  assert.equal(h.calls.length,2);assert.match(h.calls[1].prompt,/follow-up 是啥/);
  assert.match(h.calls[1].prompt,/第一条完整解释/,'queued follow-up must include the preceding completed reply');
});
test('Enter sends, Shift+Enter inserts a line, and IME confirmation/repeat never sends',async()=>{
  const h=readerHarness();await h.select('Subagents');const input=h.all().find(e=>e.tag==='textarea');input.value='follow-up 是啥';
  for(const options of [{shiftKey:true},{isComposing:true},{keyCode:229},{repeat:true}]){
    const event=await h.key(options);assert.equal(h.calls.length,0);assert.notEqual(event.prevented,true);
  }
  const sent=await h.key();assert.equal(sent.prevented,true);assert.equal(h.calls.length,1);assert.match(h.calls[0].prompt,/follow-up 是啥/);
});
test('collapse leaves a launcher that restores the same quote, reply and draft',async()=>{
  const h=readerHarness();await h.select('主动回忆');await h.button('解释一下').click();
  h.jobs.set('job1',{id:'job1',status:'done',text:'已经收到的解释'});await h.tick();
  const panel=h.all().find(e=>e.className==='panel'),input=h.all().find(e=>e.tag==='textarea');
  input.value='还想继续问的问题';
  await h.button('收起').click();assert.equal(panel.style.display,'none');
  const launcher=h.button('旁注');assert.ok(launcher,'collapse must leave an obvious way to reopen');assert.notEqual(launcher.style.display,'none');
  await launcher.click();assert.equal(panel.style.display,'flex');assert.notEqual(launcher.style.display,'none');
  assert.equal(input.value,'还想继续问的问题');
  assert.equal(h.all().find(e=>e.tag==='blockquote').textContent,'主动回忆');
  assert.equal(h.all().find(e=>e.className==='answer').textContent,'已经收到的解释');
  assert.equal(h.calls.length,1,'reopening must not submit a new request');
});
test('selected quote still sends context without displaying a context panel',async()=>{
  const h=readerHarness();await h.select('子代理');await h.button('解释一下').click();
  assert.match(h.calls[0].prompt,/Miniclaw/);assert.match(h.calls[0].prompt,/完整的原回答/);
  assert.equal(h.all().some(e=>e.className==='context'||e.className==='context-preview'),false);
});
test('theme toggle applies immediately and persists the choice for a later page',async()=>{
  const preferences={},first=readerHarness({production:true,preferences});await first.ready();
  assert.equal(first.host.getAttribute('data-theme'),'light');
  await first.button('切换主题').click();assert.equal(first.host.getAttribute('data-theme'),'dark');assert.equal(preferences.windowTheme,'dark');
  const second=readerHarness({production:true,preferences});await second.ready();assert.equal(second.host.getAttribute('data-theme'),'dark');
  await second.button('切换主题').click();assert.equal(second.host.getAttribute('data-theme'),'light');assert.equal(preferences.windowTheme,'light');
});
test('pet opens a usable composer without a text selection and toggles the window',async()=>{
  const h=readerHarness();await h.button('旁注').click();
  const panel=h.all().find(e=>e.className==='panel'),input=h.all().find(e=>e.tag==='textarea');
  assert.equal(panel.style.display,'flex');assert.notEqual(h.button('追问 ↗').disabled,true);
  assert.match(h.all().find(e=>e.tag==='video').src,/a000.webm$/);
  input.value='帮我解释当前对话';await h.key();assert.equal(h.calls.length,1);assert.match(h.calls[0].prompt,/当前对话/);
  await h.button('旁注').click();assert.equal(panel.style.display,'none');
  await h.button('旁注').click();assert.equal(panel.style.display,'flex');
});
test('dragging the pet stays within the viewport and does not accidentally open the panel',async()=>{
  const h=readerHarness(),pet=h.button('旁注');
  for(const fn of pet.listeners.pointerdown)fn({clientX:10,clientY:10,pointerId:1,button:0});
  for(const fn of pet.listeners.pointermove)fn({clientX:5000,clientY:5000,pointerId:1});
  for(const fn of pet.listeners.pointerup)fn({pointerId:1});
  assert.ok(parseFloat(pet.style.left)<1200);assert.ok(parseFloat(pet.style.top)<900);
  await pet.click();assert.notEqual(h.all().find(e=>e.className==='panel').style.display,'flex');
  await pet.click();assert.equal(h.all().find(e=>e.className==='panel').style.display,'flex');
});
test('pushes render partial answers before polling and reject obsolete revisions',async()=>{
  const h=readerHarness({production:true});await h.ready();await h.select('流式输出');await h.button('解释一下').click();
  const answer=h.all().find(e=>e.className==='answer');
  await h.push({id:'job1',revision:1,status:'streaming',text:'第一小段',updated:10});
  assert.equal(answer.textContent,'第一小段');assert.equal(answer.getAttribute('data-streaming'),'true');
  await h.push({id:'job1',revision:1,status:'streaming',text:'第一小段，接着往下输出',updated:20});
  assert.equal(answer.textContent,'第一小段，接着往下输出');
  await h.push({id:'job1',revision:0,status:'streaming',text:'过期回复',updated:30});
  assert.equal(answer.textContent,'第一小段，接着往下输出');
  await h.push({id:'job1',revision:1,status:'done',text:'完整回答',updated:40});assert.equal(answer.textContent,'完整回答');assert.equal(answer.getAttribute('data-streaming'),'false');
  assert.doesNotMatch(h.all().find(e=>e.className==='status').textContent,/正在回答/);
});
test('context scope is saved and a queued question keeps the scope chosen when submitted',async()=>{
  const preferences={},h=readerHarness({production:true,preferences});await h.ready();await h.select('上下文');await h.button('解释一下').click();
  assert.equal(h.scopes.at(-1),'current');
  const control=h.all().find(e=>e.className==='context-scope'),input=h.all().find(e=>e.tag==='textarea');
  control.value='2';for(const fn of control.listeners.change)fn();input.value='第二问';await h.key();
  control.value='all';for(const fn of control.listeners.change)fn();
  await h.push({id:'job1',revision:1,status:'done',text:'第一问完成',updated:100});
  assert.equal(h.calls.length,2);assert.equal(h.scopes.at(-1),'2');assert.equal(preferences.contextScope,'all');
  const reopened=readerHarness({production:true,preferences});await reopened.ready();assert.equal(reopened.all().find(e=>e.className==='context-scope').value,'all');
});
test('pet sizes apply immediately, survive reload, and clamp a previously dragged pet',async()=>{
  const preferences={},h=readerHarness({production:true,preferences});await h.ready();const pet=h.button('旁注');
  assert.equal(pet.style.width,'144px');assert.equal(pet.style.height,'144px');
  pet.style.left='1100px';pet.style.top='820px';
  await h.all().find(e=>e.getAttribute('data-size-id')==='large').click();
  assert.equal(pet.style.width,'192px');assert.equal(pet.style.height,'192px');assert.equal(preferences.petSizes.maid,'large');
  assert.equal(pet.style.left,'1004px');assert.equal(pet.style.top,'704px');assert.equal(h.calls.length,0);
  const reopened=readerHarness({production:true,preferences});await reopened.ready();assert.equal(reopened.button('旁注').style.width,'192px');
  await reopened.all().find(e=>e.getAttribute('data-size-id')==='small').click();assert.equal(reopened.button('旁注').style.width,'96px');assert.equal(preferences.petSizes.maid,'small');
});

test('pet thinks while replying, including collapsed and queued replies, and restores immediately on completion',async()=>{
  const h=readerHarness({production:true});await h.ready();const pet=h.button('旁注');
  const video=h.all().find(e=>e.tag==='video');
  await h.select('姿态');await h.button('解释一下').click();assert.match(video.src,/a100.webm$/);
  const input=h.all().find(e=>e.tag==='textarea');input.value='继续';await h.key();await h.button('收起').click();
  await h.push({id:'job1',revision:1,status:'done',text:'首问完成',updated:10});assert.equal(h.calls.length,2);assert.match(video.src,/a100.webm$/);
  await h.push({id:'job1',revision:2,status:'done',text:'追问完成',updated:20});assert.match(video.src,/a000.webm$/);
});

test('a reply error restores the regular pose',async()=>{
  const h=readerHarness({production:true});await h.ready();await h.select('错误');await h.button('解释一下').click();
  await h.push({id:'job1',revision:1,status:'error',text:'',error:'发送失败',updated:10});assert.match(h.all().find(e=>e.tag==='video').src,/a000.webm$/);
});

test('completing one quote does not stop thinking while another quote is pending',async()=>{
  const h=readerHarness({production:true,preferences:{petSize:'invalid'}});await h.ready();const pet=h.button('旁注');
  assert.equal(pet.style.width,'144px');
  await h.select('第一词');await h.button('解释一下').click();await h.select('第二词');await h.button('解释一下').click();
  await h.push({id:'job1',revision:1,status:'done',text:'完成一',updated:10});assert.match(h.all().find(e=>e.tag==='video').src,/a100.webm$/);
  await h.push({id:'job2',revision:1,status:'done',text:'完成二',updated:20});assert.match(h.all().find(e=>e.tag==='video').src,/a000.webm$/);
});

test('pet menu offers four sections and 100 actions without balance performances',async()=>{
  const h=readerHarness(),rows=h.all().filter(e=>e.className?.includes('pet-menu-row'));
  assert.deepEqual(rows.map(e=>e.textContent),['选择形象 ›','形象大小 ›','动作 ›','退出']);
  const panes=h.all().filter(e=>e.className==='pet-menu-pane');assert.equal(panes.length,3);
  await rows[0].click();assert.equal(panes[0].style.display,'grid');
  await rows[1].click();assert.equal(panes[0].style.display,'none');assert.equal(panes[1].style.display,'grid');
  await rows[2].click();assert.equal(panes[1].style.display,'none');assert.equal(panes[2].style.display,'grid');
  assert.equal(h.all().filter(e=>e.getAttribute('data-action-id')).length,100);
  assert.equal(h.all().some(e=>e.textContent.includes('余额')),false);
  assert.equal(panes[2].children[0].className,'random-action');
  assert.equal(h.calls.length,0);
});

test('exit hides the pet and chat; selecting text and clicking follow-up restores both without sending',async()=>{
  const h=readerHarness({production:true});await h.ready();const pet=h.button('旁注');await pet.click();
  await h.button('退出').click();
  assert.equal(pet.style.display,'none');assert.equal(h.all().find(e=>e.className==='panel').style.display,'none');
  await h.select('退出后选中的新词');
  assert.equal(pet.style.display,'');assert.equal(h.all().find(e=>e.className==='panel').style.display,'flex');
  assert.equal(h.all().find(e=>e.tag==='blockquote').textContent,'退出后选中的新词');assert.equal(h.calls.length,0);
  await h.button('解释一下').click();assert.equal(h.calls.length,1);assert.match(h.calls[0].prompt,/退出后选中的新词/);
  assert.match(h.all().find(e=>e.tag==='video').src,/a100.webm$/);
});

test('extension icon can also reopen after exit and preserve the draft and preferences',async()=>{
  const preferences={petSize:'large'},h=readerHarness({production:true,preferences});await h.ready();await h.button('旁注').click();
  const input=h.all().find(e=>e.tag==='textarea');input.value='保留的草稿';await h.button('退出').click();await h.show();
  const pet=h.button('旁注');assert.equal(pet.style.display,'');assert.equal(pet.style.width,'192px');
  assert.equal(input.value,'保留的草稿');assert.equal(h.calls.length,0);
});

async function mediaEvent(h,type){const video=h.all().find(e=>e.tag==='video');if(type==='loadeddata')video.readyState=2;if(type==='ended')video.paused=true;for(const fn of video.listeners[type]||[])fn();await h.ready();return video;}

test('local muted video replaces the poster after loading; a one-shot action ends in automatic idle',async()=>{
  const h=readerHarness(),pet=h.button('旁注'),video=h.all().find(e=>e.tag==='video');
  assert.equal(video.muted,true);assert.equal(video.playsInline,true);assert.equal(video.controls,false);assert.equal(video.loop,true);
  assert.match(video.src,/\.\.\/extension\/assets\/pet-with-you\/a000.webm$/);
  assert.equal(video.style.display,'none');await mediaEvent(h,'loadeddata');assert.equal(video.style.display,'block');assert.equal(pet.children[0].style.display,'none');
  await h.button('吃白饭').click();assert.equal(video.loop,false);const actionSource=video.src;assert.doesNotMatch(actionSource,/a000.webm$/);
  await mediaEvent(h,'ended');assert.equal(video.loop,true);assert.match(video.src,/a000.webm$/);assert.equal(h.calls.length,0);
});

test('manual actions finish in the current automatic pose',async()=>{
  const preferences={},h=readerHarness({production:true,preferences});await h.ready();const pet=h.button('旁注'),video=h.all().find(e=>e.tag==='video');
  await h.button('吃白饭').click();assert.equal(h.calls.length,0);
  await h.select('回答');await h.button('解释一下').click();assert.match(video.src,/a100.webm$/);assert.equal(video.loop,true);
  await h.button('超大伸懒腰').click();assert.equal(video.loop,false);assert.equal(h.calls.length,1);
  await mediaEvent(h,'ended');assert.match(video.src,/a100.webm$/);assert.equal(video.loop,true);
  await h.push({id:'job1',revision:1,status:'done',text:'完成',updated:10});assert.match(video.src,/a000.webm$/);
});

test('exit pauses video, late load cannot reveal it, and selection restores playback',async()=>{
  const h=readerHarness({production:true});await h.ready();const video=await mediaEvent(h,'loadeddata');assert.equal(video.paused,false);
  await h.button('退出').click();assert.equal(video.paused,true);await mediaEvent(h,'loadeddata');assert.equal(video.paused,true);
  await h.select('重新打开');assert.equal(h.button('旁注').style.display,'');assert.equal(video.paused,false);assert.equal(h.calls.length,0);
});

test('video load failure falls back visibly and recovery reloads without blocking follow-up',async()=>{
  const h=readerHarness({production:true});await h.ready();const video=await mediaEvent(h,'error'),pet=h.button('旁注');
  assert.equal(video.style.display,'none');assert.equal(pet.children[0].style.display,'block');assert.equal(video.paused,true);
  assert.match(h.all().find(e=>e.className==='action-hint').textContent,/加载失败/);
  await h.button('恢复自动状态').click();await mediaEvent(h,'loadeddata');assert.equal(video.style.display,'block');
  await h.select('继续追问');await h.button('解释一下').click();assert.equal(h.calls.length,1);
});

test('autoplay rejection shows the poster and clicking the pet retries playback',async()=>{
  const h=readerHarness(),video=h.all().find(e=>e.tag==='video'),pet=h.button('旁注');
  video.pause();video.play=()=>Promise.reject(new Error('Autoplay blocked'));await mediaEvent(h,'loadeddata');
  assert.equal(video.style.display,'none');assert.equal(pet.children[0].style.display,'block');
  video.play=()=>{video.paused=false;return Promise.resolve();};await pet.click();await mediaEvent(h,'playing');assert.equal(video.paused,false);assert.equal(video.style.display,'block');assert.equal(h.calls.length,0);
});


test('a failed fallback image creates no dot and cannot remove the pet video',async()=>{
  const h=readerHarness();const pet=h.button('旁注'),image=pet.children[0],video=pet.children[1];
  for(const fn of image.listeners.error||[])fn();await h.ready();
  assert.equal(h.all().some(e=>e.className==='pet-fallback'),false);
  assert.ok(pet.children.includes(video));assert.equal(pet.style.height,'144px');
  assert.equal(image.style.display,'none');
  await mediaEvent(h,'loadeddata');assert.equal(video.style.display,'block');assert.equal(video.paused,false);
});

test('chat jump button appears only above latest messages and never moves the main page',async()=>{
  const h=readerHarness();await h.select('聊天记录');await h.button('解释一下').click();
  const body=h.all().find(e=>e.className==='body'),jump=h.all().find(e=>e.className==='chat-jump');
  assert.ok(jump);assert.equal(jump.style.display,'none');
  body.scrollHeight=1200;body.clientHeight=400;body.scrollTop=200;
  for(const fn of body.listeners.scroll||[])fn();
  assert.equal(jump.style.display,'flex');
  body.scrollHeight=1400;
  await h.push({id:'job1',revision:1,status:'streaming',text:'新消息仍在继续',updated:10});
  assert.equal(body.scrollTop,200,'streaming must not pull the reader down');
  await jump.click();assert.equal(body.scrollTop,1400);assert.equal(jump.style.display,'none');assert.equal(h.mainScrollTop,0);
  body.scrollTop=300;for(const fn of body.listeners.scroll||[])fn();assert.equal(jump.style.display,'flex');
  await h.select('另一段文字');assert.equal(jump.style.display,'none','empty discussion has no return button');
});
