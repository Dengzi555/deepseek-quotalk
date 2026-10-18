const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../extension/core.js');
function fixture({semantic=true}={}){
  const nodes=[];
  function message(role,text){
    const m={role,innerText:text,index:nodes.length,parent:null,getClientRects:()=>[{}],getAttribute:k=>semantic&&k==='data-message-role'?role:null,querySelector:()=>role==='assistant'?{}:null,contains(el){for(let p=el;p;p=p.parent)if(p===this)return true;return false;},closest:()=>null,compareDocumentPosition(other){return this.index<other.index?4:2;}};
    nodes.push(m);return m;
  }
  for(let i=0;i<5;i++){message('user','原始提问'+i+'，主题是 Miniclaw');message('assistant','原始回答'+i);}
  const question=message('user','请结合 Miniclaw 解释子代理怎么调度');
  const answer=message('assistant','本次完整回答开头。子代理独立处理任务。本次完整回答结尾。');
  message('user','后来的问题不应传入');message('assistant','后来的回答不应传入');
  const selected={parent:answer,closest:()=>answer};
  return {selected,answer,question,root:{querySelectorAll:()=>nodes}};
}
test('captures the loaded conversation beyond six messages and keeps the selected answer separately',()=>{
  global.getComputedStyle=()=>({visibility:'visible'});
  const f=fixture(),source=C.captureContext(f.selected,'子代理',f.root);
  assert.equal(source.messages.length,13);assert.equal(source.recognized,true);
  assert.ok(source.messages.some(m=>m.role==='user'&&m.text.includes('Miniclaw 解释子代理')));
  assert.equal(source.currentAnswer,f.answer.innerText);
  assert.match(JSON.stringify(source),/后来的/);assert.match(JSON.stringify(source),/原始提问0/);
  const p=C.prompt('子代理','所在段落','它为什么要独立？',[],source);
  assert.match(p,/原窗口的对话/);assert.match(p,/Miniclaw 解释子代理/);assert.match(p,/本次完整回答结尾/);
});
test('supports ds-message containers without explicit role attributes',()=>{
  global.getComputedStyle=()=>({visibility:'visible'});
  const f=fixture({semantic:false}),source=C.captureContext(f.selected,'子代理',f.root);
  assert.ok(source.messages.some(m=>m.role==='user'&&m.text.includes('Miniclaw 解释子代理')));assert.equal(source.currentAnswer,f.answer.innerText);
});
test('oversized conversation retains the initial request and latest exchanges within its budget',()=>{
  const input=[{role:'user',text:'最初约定：研究 Miniclaw'}];
  for(let i=0;i<50;i++)input.push({role:'assistant',text:'长对话'+i+'。'.repeat(1200)});
  input.push({role:'user',text:'最近的问题：解释 follow-up'});
  const packed=C.packMessages(input),text=C.sourceText({messages:packed.messages});
  assert.equal(packed.truncated,true);assert.match(text,/最初约定/);assert.match(text,/最近的问题/);assert.match(text,/部分较早的对话/);
  assert.ok(packed.messages.reduce((n,m)=>n+m.text.length+30,0)<=14000);
});
test('long source content is marked and bounded without losing the selected passage near the end',()=>{
  global.getComputedStyle=()=>({visibility:'visible'});
  const f=fixture();f.answer.innerText='前言'.repeat(20000)+'目标词子代理：解释细节'+'尾部'.repeat(500);
  f.question.innerText='背景'.repeat(50000);
  const source=C.captureContext(f.selected,'目标词子代理',f.root);
  assert.equal(source.truncated,true);assert.ok(source.currentAnswer.length<=18000);assert.match(source.currentAnswer,/目标词子代理/);
  const prompt=C.prompt('q'.repeat(4000),'c'.repeat(10000),'w'.repeat(5000),[{question:'h'.repeat(5000),answer:'a'.repeat(5000)}],source);
  assert.ok(prompt.length<48000);assert.match(prompt,/内容过长，已截取/);
});
test('missing DOM messages produces an explicit fallback instead of invented conversation',()=>{
  const source=C.captureContext({closest:()=>null},'词',{querySelectorAll:()=>[]});
  assert.equal(source.recognized,false);assert.deepEqual(source.messages,[]);
  assert.match(C.prompt('词','唯一可见段落','解释',[],source),/未识别到此前对话/);
});
test('context scopes retain the selected answer and vary how many user rounds are included',()=>{
  global.getComputedStyle=()=>({visibility:'visible'});const f=fixture();
  const capture=scope=>C.captureContext(f.selected,'子代理',f.root,scope);
  const current=capture('current');assert.deepEqual(current.messages,[]);assert.equal(current.currentAnswer,f.answer.innerText);
  assert.equal(capture('2').messages.filter(m=>m.role==='user').length,2);
  assert.equal(capture('4').messages.filter(m=>m.role==='user').length,4);
  assert.equal(capture('all').messages.length,13);
});
test('current-answer scope does not scan the entire message history',()=>{
  const f=fixture(),root={querySelectorAll(){throw new Error('history scan must not happen');}};
  const source=C.captureContext(f.selected,'子代理',root,'current');assert.equal(source.currentAnswer,f.answer.innerText);assert.deepEqual(source.messages,[]);
});
