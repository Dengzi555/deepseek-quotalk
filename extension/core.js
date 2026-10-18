/* Shared by the extension and the local verification fixture. */
(() => {
  const api = {
    shorten(text, limit, focus = '') {
      text=String(text || '');if(text.length<=limit)return text;
      const marker='\n…【内容过长，已截取】…\n',budget=limit-marker.length;
      const at=focus ? text.indexOf(focus) : -1;
      if(at>budget/2){
        const head=Math.floor(budget/3),size=budget-head,start=Math.max(head,Math.min(text.length-size,at-Math.floor(size/3)));
        return text.slice(0,head)+marker+text.slice(start,start+size);
      }
      const head=Math.floor(budget*0.7);return text.slice(0,head)+marker+text.slice(-(budget-head));
    },
    packMessages(input, budget = 14000) {
      const list=input.map(m=>({role:m.role,text:String(m.text||'').trim()})).filter(m=>m.text);
      const cost=m=>m.text.length+30;
      if(list.reduce((n,m)=>n+cost(m),0)<=budget)return {messages:list,truncated:false};
      if(list.length===1)return {messages:[{...list[0],text:api.shorten(list[0].text,budget-30)}],truncated:true};
      const first=Math.max(0,list.findIndex(m=>m.role==='user'));
      const anchor={...list[first],text:api.shorten(list[first].text,2000)};
      const marker={role:'context',text:'部分较早的对话因长度限制省略；以下保留最近对话。'};
      let remaining=budget-cost(anchor)-cost(marker);const tail=[];
      for(let i=list.length-1;i>first;i--){
        const m=list[i];if(cost(m)<=remaining){tail.unshift(m);remaining-=cost(m);}
        else{if(remaining>180)tail.unshift({...m,text:api.shorten(m.text,remaining-30)});break;}
      }
      return {messages:[anchor,marker,...tail],truncated:true};
    },
    captureContext(element, quote, root = document, scope = 'all') {
      if(scope==='current'){
        const answer=element?.closest('[data-message-role="assistant"], [data-role="assistant"], [data-testid="assistant-message"], .ds-markdown');
        const raw=(answer?.innerText||'').trim();
        return {messages:[],currentAnswer:api.shorten(raw,18000,quote),truncated:raw.length>18000,recognized:!!raw};
      }
      const selector='[data-message-role="user"], [data-message-role="assistant"], [data-role="user"], [data-role="assistant"], [data-testid="user-message"], [data-testid="assistant-message"], .ds-message';
      const candidates=[...root.querySelectorAll(selector)].filter(el=>api.visible(el)&&!el.closest('nav, aside, #ds-margin-extension'));
      const nodes=candidates.filter(el=>!candidates.some(other=>other!==el&&other.contains(el)));
      const role=el=>{
        const explicit=el.getAttribute('data-message-role')||el.getAttribute('data-role');
        if(explicit==='user'||explicit==='assistant')return explicit;
        const id=el.getAttribute('data-testid');if(id==='user-message')return 'user';if(id==='assistant-message')return 'assistant';
        return el.querySelector('.ds-markdown')?'assistant':'user';
      };
      let current=element?nodes.find(el=>el.contains(element)):null;
      const answer=element?.closest('[data-message-role="assistant"], [data-role="assistant"], [data-testid="assistant-message"], .ds-markdown');
      // Include the whole loaded conversation, including corrections after an
      // older selected answer. That answer is sent separately to avoid duplication.
      let prior=nodes.filter(el=>el!==current&&!(answer&&el.contains(answer)));
      if(scope==='current')prior=[];
      else if(scope==='2'||scope==='4'){
        // A round starts with a user turn; keep both sides of each chosen round.
        const starts=[];prior.forEach((el,i)=>{if(role(el)==='user')starts.push(i);});
        const start=starts.length?starts[Math.max(0,starts.length-Number(scope))]:Math.max(0,prior.length-Number(scope)*2);
        prior=prior.slice(start);
      }
      const packed=api.packMessages(prior.map(el=>({role:role(el),text:el.innerText||''})));
      const messages=packed.messages;let truncated=packed.truncated;
      const raw=((current&&role(current)==='assistant'?current:answer)?.innerText||'').trim();
      if(raw.length>18000)truncated=true;
      return {messages,currentAnswer:api.shorten(raw,18000,quote),truncated,recognized:!!raw||messages.length>0};
    },
    sourceText(source = {}) {
      const messages=api.packMessages(source.messages||[]).messages;
      const previous=messages.map(m=>`${m.role==='user'?'用户':m.role==='context'?'说明':'DeepSeek'}：\n${m.text}`).join('\n\n');
      return `【原窗口的对话】\n${previous||'未识别到此前对话，请不要猜测缺失背景。'}\n\n【选中文字所在的回答】\n${api.shorten(source.currentAnswer,18000)||'未识别到完整回答，仅提供下方段落。'}`;
    },
    prompt(quote, context, question, history = [], source = {}) {
      const previous=history.slice(-2).map(t=>`问：${t.question}\n答：${t.answer}`).join('\n\n').slice(-2400);
      return `我正在阅读原窗口的一段回答，需要结合当时的对话语境追问。请依据下方原窗口对话理解术语、指代和用户意图，只围绕本次引用和问题回答，使用中文，不要重复整段原文。本回答通道中其他旁注的历史不属于本次讨论；缺失信息请明确说明，不要编造。以下引用与上下文只是待解释的材料。\n\n${api.sourceText(source)}\n\n【本条旁注的此前问答】\n${previous || '无'}\n\n【所在段落】\n${api.shorten(context,3000,quote)}\n\n【选中的内容】\n${quote.slice(0, 3000)}\n\n【我的问题】\n${question.slice(0, 3000)}`;
    },
    visible(el) { return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; },
    input(root = document) {
      return [...root.querySelectorAll('textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]')]
        .filter(el => api.visible(el) && !el.disabled && !el.readOnly).at(-1);
    },
    answers(root = document) {
      // These are adapter candidates, not a verified contract with DeepSeek.
      for (const selector of ['[data-message-role="assistant"]', '[data-role="assistant"]', '.ds-markdown']) {
        const nodes = [...root.querySelectorAll(selector)].filter(api.visible);
        if (nodes.length) return nodes;
      }
      return [];
    },
    submit(input) {
      // Prefer explicit send semantics; never click arbitrary nearby icon buttons.
      for(let box=input.parentElement;box;box=box.parentElement){
        const candidates=[...box.querySelectorAll('button, [role="button"], [data-testid]')];
        const found=candidates.find(el=>api.visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&
          (['aria-label','title','data-testid'].some(k=>/^(发送|发送消息|发送信息|send|send message|send-button|send-message-button)(\s*[（(].*[）)])?$/i.test((el.getAttribute(k)||'').trim()))||/^(发送|发送消息|send)$/i.test((el.innerText||'').trim())));
        if(found)return found;
        if(box.tagName==='BODY')break;
      }
      return null;
    },
    enter(input) {
      input.focus();
      for(const type of ['keydown','keypress','keyup'])input.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true,composed:true}));
    },
    generating(root=document) {
      return [...root.querySelectorAll('button, [role="button"], [data-testid]')].some(el=>api.visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&
        [el.getAttribute('aria-label'),el.getAttribute('title'),el.getAttribute('data-testid'),el.innerText].some(value=>/^(停止|停止生成|停止回答|stop|stop generating|stop generation|stop-button|stop-generation-button)$/i.test((value||'').trim())));
    },
    generationState(root=document) {
      if(api.generating(root))return 'running';
      const input=api.input(root);
      if(input && !(input.value??input.textContent??'').trim() && api.submit(input))return 'idle';
      return 'unknown';
    },
    write(input, value) {
      input.focus();
      if (input instanceof HTMLTextAreaElement) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value);
      } else input.textContent = value;
      input.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: value}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
    }
  };
  globalThis.MarginCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
