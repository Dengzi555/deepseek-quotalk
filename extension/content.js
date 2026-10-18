(() => {
  if (globalThis.__dsMargin) return;
  globalThis.__dsMargin = true;
  const C = globalThis.MarginCore;
  const demo = !!globalThis.__MARGIN_DEMO__;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function rpc(type, payload = {}) {
    if (demo) return globalThis.__marginMock(type, payload);
    const r = await chrome.runtime.sendMessage({type, ...payload});
    if (!r?.ok) throw new Error(r?.error || '扩展连接已断开，请刷新网页');
    return r.data;
  }
  function mount() {
    const host = document.createElement('div');
    host.id = 'ds-margin-extension';
    host.setAttribute('contenteditable','false');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    document.documentElement.append(host);
    const root = host.attachShadow({mode:'open'});
    root.innerHTML = '<style>' + globalThis.MarginStyle + '</style>';
    let themeOverride=null,themeTouched=false;
    const themeStorage=!demo&&typeof chrome!=='undefined'?chrome.storage?.local:null;
    function syncTheme(){
      if(themeOverride){host.setAttribute('data-theme',themeOverride);return;}
      const html=document.documentElement,body=document.body;
      const explicit=(html.getAttribute('data-theme')||body?.getAttribute('data-theme')||'').toLowerCase();
      let dark;
      if(explicit==='dark'||explicit==='light')dark=explicit==='dark';
      else if(html.classList?.contains('dark')||body?.classList?.contains('dark')||body?.hasAttribute?.('data-ds-dark-theme'))dark=true;
      else{
        const color=getComputedStyle(body||html).backgroundColor||'',rgba=color.match(/[\d.]+/g)?.map(Number);
        if(rgba?.length>=3&&(rgba.length<4||rgba[3]>0))dark=rgba[0]*.2126+rgba[1]*.7152+rgba[2]*.0722<125;
        else dark=typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: dark)').matches;
      }
      host.setAttribute('data-theme',dark?'dark':'light');
    }
    syncTheme();
    if(themeStorage)themeStorage.get('windowTheme').then(saved=>{
      if(!themeTouched&&['dark','light'].includes(saved.windowTheme)){themeOverride=saved.windowTheme;syncTheme();}
    }).catch(()=>{});
    function toggleTheme(){
      themeTouched=true;themeOverride=host.getAttribute('data-theme')==='dark'?'light':'dark';syncTheme();
      if(themeStorage)themeStorage.set({windowTheme:themeOverride}).catch(()=>{});
    }
    if(typeof MutationObserver==='function'){
      const themeObserver=new MutationObserver(syncTheme);
      const options={attributes:true,attributeFilter:['class','style','data-theme','data-ds-dark-theme']};
      themeObserver.observe(document.documentElement,options);if(document.body)themeObserver.observe(document.body,options);
    }
    if(typeof matchMedia==='function')matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',syncTheme);
    return {host, root, toggleTheme};
  }
  let host, root, toggleTheme;
  function node(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; return el; }
  function button(text, fn, cls='') { const b = node('button', cls, text); b.type='button'; b.addEventListener('click', fn); return b; }
  function inside(e) { return e.composedPath().includes(host); }

  async function worker() {
    document.dispatchEvent(new Event('ds-margin-arm-stream-watch'));
    let busy = false, fetching=false, attemptKey = '', connectionError = '';
    async function run(job) {
      busy=true;attemptKey=job.id+':'+job.revision;
      let observer=null, streamTimer=null, watching=true, publishing=Promise.resolve(), publishError=null,wakeSample=null,lastSampleAt=0,networkEnded=false;
      const streams=new Set(),liveStreams=new Set();
      let requestReported=false;
      function reportRequest(){if(!requestReported){requestReported=true;rpc('request-started',{id:job.id,revision:job.revision}).catch(()=>{requestReported=false;});}}
      let last=['running','streaming'].includes(job.status)?job.text||'':'',lastChange=Date.now(),seen=!!last,observedGenerating=false,networkText='';
      function onStream(event){
        try{const data=JSON.parse(event.detail);if(!Number.isSafeInteger(data.id))return;
          if(data.phase==='request'||data.phase==='start'){streams.add(data.id);if(data.phase==='start')liveStreams.add(data.id);networkEnded=false;reportRequest();}
          else if(data.phase==='text'&&streams.has(data.id)&&typeof data.text==='string'&&data.text.length<=100000&&data.text.trim()){
            networkText=data.text;publishText(networkText);
          }
          else if(data.phase==='error'&&streams.has(data.id)){streams.delete(data.id);liveStreams.delete(data.id);publishError=new Error('网页回答连接中断，请检查回答标签页后重新提问。');}
          else if(streams.has(data.id)){streams.delete(data.id);liveStreams.delete(data.id);if(data.phase==='end'&&!streams.size)networkEnded=true;}
          wakeSample?.();
        }catch{}
      }
      document.addEventListener('ds-margin-stream',onStream);
      const update = (status,text='',error='',extra={})=>rpc('update',{id:job.id,revision:job.revision,status,text,error,...extra});
      function publishText(text){
        seen=true;
        if(text!==last){last=text;lastChange=Date.now();publishing=publishing.then(()=>update('streaming',text)).catch(e=>{publishError=e;});}
      }
      try {
        await update('running',last,'',{stage:'loading'});
        let input = C.input();
        const readyDeadline=Date.now()+15000;
        while(!input&&Date.now()<readyDeadline){await sleep(150);input=C.input();}
        if (!input) throw new Error('未找到输入框，请在回答标签页确认已登录，再回到小窗重新提问。');
        const existing = input.value ?? input.textContent;
        const resume=['running','streaming'].includes(job.status);
        if (!resume && existing.trim() && existing!==job.prompt) throw new Error('输入框中已有文字。请先处理草稿，再重试；扩展不会覆盖草稿。');
        const before=C.answers(); const count=job.baseline?.count ?? before.length; const old=job.baseline?.old ?? (before.at(-1)?.innerText || '');
        if(!resume){
          await update('running','','',{baseline:{count,old},stage:'filling'});
          C.write(input,job.prompt);await sleep(350);
          if((input.value??input.textContent)!==job.prompt)throw new Error('网页未保留填入的问题，请检查回答标签页是否已加载完成。');
          await update('running','','',{stage:'submitting'});
          const submit=C.submit(input);
          if(submit){
            if(submit.disabled||submit.getAttribute('aria-disabled')==='true')throw new Error('发送按钮不可用，请等待或在本页手动发送。');
            submit.click();
          }else{
            C.enter(input);
          }
        }
        let initialized=false;
        function reportInitialized(){
          if(initialized)return;initialized=true;
          rpc('initialized',{id:job.id,revision:job.revision}).catch(()=>{initialized=false;});
        }
        if(resume&&seen)reportInitialized();
        function sample(){
          if(!watching)return;
          if(networkText){reportInitialized();return;}
          lastSampleAt=Date.now();
          const nodes=C.answers(),lastNode=nodes.at(-1);
          const fresh=nodes.length>count||(lastNode?.innerText&&lastNode.innerText!==old);
          const text=(fresh?lastNode?.innerText:'')||'';
          if(!text.trim())return;
          reportInitialized();
          publishText(text);
        }
        if(typeof MutationObserver==='function'){
          observer=new MutationObserver((mutations=[])=>{
            if(!watching)return;
            if(Date.now()-lastSampleAt>=120||mutations.some(m=>m.type==='attributes')){try{sample();wakeSample?.();}catch(e){publishError=e;}return;}
            if(streamTimer!==null||!watching)return;
            streamTimer=setTimeout(()=>{streamTimer=null;try{sample();wakeSample?.();}catch(e){publishError=e;}},120);
          });
          observer.observe(document.body||document.documentElement,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['disabled','aria-disabled','aria-label','title','aria-busy','data-is-streaming']});
        }
        sample();
        const submittedAt=Date.now();let waitingReported=false;
        const deadline=Date.now()+300000;
        while(Date.now()<deadline) {
          await new Promise(resolve=>{const timer=setTimeout(()=>{wakeSample=null;resolve();},100);wakeSample=()=>{clearTimeout(timer);wakeSample=null;resolve();};});
          if(publishError)throw publishError;
          const state=C.generationState();observedGenerating ||= state==='running';
          sample();
          if(!resume&&!seen&&!requestReported&&!observedGenerating&&Date.now()-submittedAt>=15000){
            const draft=C.input();
            if(draft&&(draft.value??draft.textContent)===job.prompt){
              const visibility=document.visibilityState==='hidden'?'不可见':'可见';
              const focus=typeof document.hasFocus==='function'?(document.hasFocus()?'已聚焦':'未聚焦'):'焦点未知';
              throw new Error(`问题仍在回答页输入框，尚未确认发出（${visibility}，${focus}）。请查看回答页是否加载完成、发送按钮是否可用；扩展未重复发送。`);
            }
            if(!waitingReported){waitingReported=true;await update('running','','',{stage:'waiting'});}
          }
          if(seen) {
            const quiet=Date.now()-lastChange;
            const domFinished=!networkText&&!liveStreams.size&&state!=='running'&&(state==='idle'||observedGenerating||quiet>=100);
            if((networkEnded&&(networkText||quiet>=120))||domFinished) { watching=false;await publishing;if(publishError)throw publishError;await update('done',last);return; }
          }
        }
        watching=false;await publishing;if(publishError)throw publishError;
        if(seen) { await update('done',last); }
        else throw new Error('5 分钟内未识别到回答，请检查回答标签页的登录、验证和发送状态。');
      } catch(e) { watching=false;await publishing;await update('error','',e.message).catch(()=>{}); }
      finally {watching=false;document.removeEventListener('ds-margin-stream',onStream);observer?.disconnect();if(streamTimer!==null)clearTimeout(streamTimer);busy=false;}
    }
    async function poll(){
      if(busy||fetching)return;fetching=true;
      try {const job=await rpc('work');fetching=false;connectionError='';if(job && job.id+':'+job.revision!==attemptKey && ['queued','running','streaming'].includes(job.status)) await run(job);}
      catch(e){if(connectionError!==e.message){connectionError=e.message;console.warn('[deepseek-quotalk] 后台连接异常：',e.message);}}
      finally{fetching=false;}
    }
    chrome.runtime.onMessage?.addListener(msg=>{if(msg.type==='wake')void poll();});
    void poll();setInterval(poll,1200);
  }

  function reader() {
    let prepared=false,contextScope='current',scopeTouched=false;
    const preferences=!demo&&typeof chrome!=='undefined'?chrome.storage?.local:null;
    const pickButton=button('追问',()=>openSelection(),'select');root.append(pickButton);
    const panel=node('section','panel');panel.setAttribute('aria-label','追问窗口');root.append(panel);
    let petDrag=null,petMoved=false;
    const launcher=button('',()=>{
      if(petMoved){petMoved=false;return;}
      closePetMenu();
      if(panel.style.display==='flex')collapsePanel();
      else{if(!current)openGeneral();else showPanel();input.focus();}
    },'pet');launcher.setAttribute('aria-label','点击提问，拖动调整位置');launcher.setAttribute('aria-expanded','false');
    const catalog=globalThis.MarginPetCatalog,petActions=catalog.groups.flatMap(g=>g.actions);
    const thinkingRecords=new Set();
    let petHidden=false,menuSection=null,manualAction=null,playingAction=null,failedAction=null;
    const assetURL=file=>demo?'../extension/assets/'+file:chrome.runtime.getURL('assets/'+file);
    const character=node('img');character.alt='';character.draggable=false;
    character.addEventListener('error',()=>{launcher.replaceChildren(node('span','pet-fallback','◉'));launcher.style.height='36px';});
    const video=node('video','pet-video');video.muted=true;video.defaultMuted=true;video.playsInline=true;video.controls=false;video.preload='metadata';video.style.display='none';video.setAttribute('aria-hidden','true');video.setAttribute('playsinline','');
    launcher.append(character,video);root.append(launcher);
    const petMenu=node('div','pet-menu'),menuButtons=[],actionButtons=[],actionGroups=[],menuPanes={};petMenu.setAttribute('role','menu');petMenu.setAttribute('aria-label','桌宠菜单');petMenu.style.display='none';root.append(petMenu);
    function menuGroup(id,label){
      const row=button(label+' ›',()=>{menuSection=menuSection===id?null:id;for(const [key,pane] of Object.entries(menuPanes))pane.style.display=key===menuSection?'grid':'none';for(const b of menuButtons)b.setAttribute('aria-expanded',b.getAttribute('data-section')===menuSection?'true':'false');},'pet-menu-row');
      row.setAttribute('role','menuitem');row.setAttribute('aria-haspopup','true');row.setAttribute('aria-expanded','false');row.setAttribute('data-section',id);menuButtons.push(row);petMenu.append(row);
      const pane=node('div','pet-menu-pane');pane.style.display='none';menuPanes[id]=pane;petMenu.append(pane);return pane;
    }
    const sizePane=menuGroup('size','形象大小'),actionPane=menuGroup('action','动作');
    const exitButton=button('退出',()=>{petHidden=true;closePetMenu();collapsePanel();launcher.style.display='none';pickButton.style.display='none';video.pause();},'pet-menu-row pet-exit');exitButton.setAttribute('role','menuitem');menuButtons.push(exitButton);petMenu.append(exitButton);
    let sizeTouched=false;
    const sizeButtons=[],sizes=[{id:'small',label:'小',pixels:96},{id:'medium',label:'中',pixels:144},{id:'large',label:'大',pixels:192}];
    function closePetMenu(){petMenu.style.display='none';menuSection=null;for(const pane of Object.values(menuPanes))pane.style.display='none';for(const b of menuButtons)b.setAttribute('aria-expanded','false');}
    let randomMinutes=0,randomTimer=null,randomTouched=false;
    const randomRow=node('label','random-action'),randomSelect=node('select');
    randomSelect.setAttribute('aria-label','随机自动播放间隔');
    for(const [value,label] of [['0','关闭'],['1','每 1 分钟'],['3','每 3 分钟'],['5','每 5 分钟'],['10','每 10 分钟']]){const option=node('option','',label);option.value=value;randomSelect.append(option);}
    randomSelect.value='0';randomRow.append(node('span','','随机自动播放'),randomSelect);actionPane.append(randomRow);
    const randomPool=petActions.filter(action=>action.id!==catalog.idle&&action.id!==catalog.thinking);
    function scheduleRandom(){
      if(randomTimer!==null)clearTimeout(randomTimer);randomTimer=null;
      if(!randomMinutes)return;
      randomTimer=setTimeout(()=>{
        randomTimer=null;
        if(!petHidden&&!document.hidden&&!thinkingRecords.size&&!manualAction&&randomPool.length){
          manualAction=randomPool[Math.floor(Math.random()*randomPool.length)].id;playingAction=null;failedAction=null;syncPetPose();
        }
        scheduleRandom();
      },randomMinutes*60000);
    }
    randomSelect.addEventListener('change',()=>{
      const value=Number(randomSelect.value);if(![0,1,3,5,10].includes(value))return;
      randomTouched=true;randomMinutes=value;scheduleRandom();
      if(preferences)preferences.set({randomActionMinutes:value}).catch(()=>{});
    });
    if(preferences)preferences.get('randomActionMinutes').then(saved=>{
      if(!randomTouched&&[0,1,3,5,10].includes(saved.randomActionMinutes)){randomMinutes=saved.randomActionMinutes;randomSelect.value=String(randomMinutes);scheduleRandom();}
    }).catch(()=>{});
    const actionHint=node('div','action-hint');actionHint.setAttribute('aria-live','polite');actionPane.append(actionHint);
    function showPoster(){video.style.display='none';character.style.display='block';}
    function playVideo(){
      if(petHidden||document.hidden)return;
      if(!video.paused)return;
      const source=video.src;
      video.play().catch(()=>{if(video.src===source){showPoster();actionHint.textContent='播放被浏览器暂停，点击桌宠重试。';}});
    }
    video.addEventListener('loadeddata',()=>{if(!petHidden&&failedAction!==playingAction){video.style.display='block';character.style.display='none';playVideo();}});
    video.addEventListener('playing',()=>{if(!petHidden){video.style.display='block';character.style.display='none';}});
    video.addEventListener('error',()=>{failedAction=playingAction;video.pause();showPoster();actionHint.textContent='动画加载失败，已显示静态形象。可选择其他动作重试。';});
    video.addEventListener('ended',()=>{if(manualAction){manualAction=null;syncPetPose();}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)video.pause();else syncPetPose();});
    function syncPetPose(){
      const thinking=thinkingRecords.size>0;
      const src=assetURL('pet-with-you/poster.svg');
      if(character.src!==src)character.src=src;
      launcher.setAttribute('data-pose',thinking?'thinking':'regular');
      if(petHidden){video.pause();showPoster();return;}
      const id=manualAction||(thinking?catalog.thinking:catalog.idle),action=petActions.find(a=>a.id===id);
      video.loop=!manualAction;launcher.setAttribute('data-animation',id);
      for(const b of actionButtons)b.setAttribute('aria-checked',b.getAttribute('data-action-id')===id?'true':'false');
      if(playingAction!==id){
        playingAction=id;failedAction=null;actionHint.textContent='正在播放：'+action.label;showPoster();
        video.src=demo?'../extension/'+action.file:chrome.runtime.getURL(action.file);
        video.load();
      }
      if(failedAction!==id){if(video.readyState>=2){video.style.display='block';character.style.display='none';}playVideo();}
    }
    const sizeRow=node('div','pet-sizes');sizeRow.setAttribute('role','group');sizeRow.setAttribute('aria-label','形象大小');sizePane.append(sizeRow);
    function applySize(id,persist=false){
      const size=sizes.find(s=>s.id===id)||sizes[1];
      launcher.style.width=size.pixels+'px';launcher.style.height=size.pixels+'px';launcher.setAttribute('data-size',size.id);
      if(launcher.style.left&&launcher.style.left!=='auto')launcher.style.left=Math.max(4,Math.min(innerWidth-size.pixels-4,parseFloat(launcher.style.left)))+'px';
      if(launcher.style.top&&launcher.style.top!=='auto')launcher.style.top=Math.max(4,Math.min(innerHeight-size.pixels-4,parseFloat(launcher.style.top)))+'px';
      for(const b of sizeButtons)b.setAttribute('aria-checked',b.getAttribute('data-size-id')===size.id?'true':'false');
      if(persist){sizeTouched=true;if(preferences)preferences.set({petSize:size.id}).catch(()=>{});}
    }
    for(const size of sizes){const b=button(size.label,()=>applySize(size.id,true),'size-option');b.setAttribute('role','menuitemradio');b.setAttribute('aria-label',size.label+'号形象');b.setAttribute('data-size-id',size.id);sizeButtons.push(b);sizeRow.append(b);}
    const automatic=button('恢复自动状态',()=>{manualAction=null;failedAction=null;playingAction=null;syncPetPose();closePetMenu();},'action-option');automatic.setAttribute('role','menuitem');actionPane.append(automatic);
    for(const [index,group] of catalog.groups.entries()){
      const section=node('details','action-group'),summary=node('summary','',group.label+' · '+group.actions.length);section.open=index===0;section.append(summary);actionPane.append(section);const buttons=[];
      for(const action of group.actions){const b=button(action.label,()=>{manualAction=action.id;if(playingAction===action.id)playingAction=null;syncPetPose();closePetMenu();},'action-option');b.setAttribute('role','menuitemradio');b.setAttribute('data-action-id',action.id);b.setAttribute('aria-checked','false');section.append(b);actionButtons.push(b);buttons.push(b);}
      actionGroups.push({section,buttons});
    }
    const credits=node('div','pet-credits');
    for(const [label,url] of [['动画原作','https://github.com/PC2005-cloud/dsh-pet'],['pet-with-you','https://github.com/Refining-colors/pet-with-you']]){const a=node('a','',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';credits.append(a);}
    credits.append(node('span','','素材仅限非商用'));actionPane.append(credits);
    syncPetPose();applySize();
    if(preferences){
      preferences.get('petSize').then(saved=>{if(!sizeTouched)applySize(saved.petSize);}).catch(()=>{});
      preferences.remove?.(['petSkin','petSizes']).catch(()=>{});
    }
    launcher.addEventListener('contextmenu',e=>{
      e.preventDefault();petMoved=false;
      const r=launcher.getBoundingClientRect(),x=e.clientX||r.left,y=e.clientY||r.top;
      closePetMenu();petMenu.style.left=Math.max(4,Math.min(innerWidth-248,x))+'px';petMenu.style.top=Math.max(4,Math.min(innerHeight-440,y-100))+'px';petMenu.style.display='grid';menuButtons[0].focus();
    });
    document.addEventListener('pointerdown',e=>{const path=e.composedPath();if(!path.includes(petMenu)&&!path.includes(launcher))closePetMenu();},true);
    petMenu.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();closePetMenu();launcher.focus();}
      else if(e.key==='ArrowDown'||e.key==='ArrowUp'){if(e.target===randomSelect)return;e.preventDefault();const extras=menuSection==='size'?sizeButtons:menuSection==='action'?[randomSelect,automatic,...actionGroups.filter(g=>g.section.open).flatMap(g=>g.buttons)]:[],buttons=[...menuButtons.filter(b=>b.style.display!=='none'),...extras],at=buttons.indexOf(root.activeElement),next=(at+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();}
    });
    launcher.addEventListener('pointerdown',e=>{
      if(e.button!==undefined&&e.button!==0)return;
      closePetMenu();
      const r=launcher.getBoundingClientRect();petDrag={x:e.clientX,y:e.clientY,left:r.left,top:r.top,width:r.width||96,height:r.height||96};petMoved=false;launcher.setPointerCapture(e.pointerId);
    });
    launcher.addEventListener('pointermove',e=>{
      if(!petDrag)return;
      const dx=e.clientX-petDrag.x,dy=e.clientY-petDrag.y;
      if(Math.hypot(dx,dy)<5&&!petMoved)return;
      petMoved=true;launcher.style.right='auto';launcher.style.bottom='auto';
      launcher.style.left=Math.max(4,Math.min(innerWidth-petDrag.width-4,petDrag.left+dx))+'px';
      launcher.style.top=Math.max(4,Math.min(innerHeight-petDrag.height-4,petDrag.top+dy))+'px';
    });
    launcher.addEventListener('pointerup',()=>{petDrag=null;});
    launcher.addEventListener('pointercancel',()=>{petDrag=null;petMoved=false;});
    launcher.addEventListener('lostpointercapture',()=>{petDrag=null;});
    function showPanel(){petHidden=false;launcher.style.display='';panel.style.display='flex';syncPetPose();launcher.setAttribute('aria-expanded','true');if(!demo&&!prepared){prepared=true;rpc('prepare').catch(()=>{prepared=false;});}}
    function collapsePanel(){panel.style.display='none';launcher.setAttribute('aria-expanded','false');}
    const head=node('header'),grip=node('span','window-grip');grip.setAttribute('aria-hidden','true');head.append(grip);panel.append(head);
    const themeButton=button('◐',()=>toggleTheme(),'theme-control');themeButton.setAttribute('aria-label','切换深浅色模式');themeButton.title='切换深浅色模式';head.append(themeButton);
    const collapse=button('−',collapsePanel,'window-control');collapse.setAttribute('aria-label','收起窗口');collapse.title='收起';head.append(collapse);
    const body=node('div','body'),quote=node('blockquote');
    const empty=node('div','empty');empty.append(node('div','empty-mark','⌁'),node('div','empty-title','有什么想继续聊的？'),node('div','empty-hint','直接提问，或选中正文中的一句话。'));
    const entries=node('div'),status=node('div','status');status.setAttribute('aria-live','polite');body.append(quote,empty,entries,status);panel.append(body);
    const footer=node('footer'),composer=node('div','composer'),input=node('textarea');input.placeholder='问点什么…';input.setAttribute('aria-label','输入问题');composer.append(input);
    const actions=node('div','actions'),keyboardHint=node('div','composer-hint','Enter 发送 · Shift + Enter 换行');composer.append(actions);footer.append(composer);panel.append(footer);
    const scopeSelect=node('select','context-scope');scopeSelect.setAttribute('aria-label','关联上下文范围');scopeSelect.title='关联上下文范围';
    for(const [value,label] of [['current','仅当前回答'],['2','最近 2 轮'],['4','最近 4 轮'],['all','全部对话']]){const option=node('option','',label);option.value=value;scopeSelect.append(option);}
    scopeSelect.value=contextScope;
    const meta=node('div','composer-meta');footer.append(meta);meta.append(scopeSelect,keyboardHint);
    scopeSelect.addEventListener('change',()=>{
      if(!['current','2','4','all'].includes(scopeSelect.value))return;
      scopeTouched=true;contextScope=scopeSelect.value;if(preferences)preferences.set({contextScope}).catch(()=>{});
    });
    if(preferences)preferences.get('contextScope').then(saved=>{if(!scopeTouched&&['current','2','4','all'].includes(saved.contextScope)){contextScope=saved.contextScope;scopeSelect.value=contextScope;}}).catch(()=>{});
    let current=null, dragging=false;
    const saved=[],liveReplies=new Map();
    function generalContext(scope=contextScope){const last=C.answers().at(-1);return {last,source:C.captureContext(last||null,'',document,scope)};}
    function openGeneral(){
      const {last,source}=generalContext();
      current={id:null,selection:{quote:'当前对话（未划选文字）',context:'',source:last,general:true},sourceContext:source,nodes:[],entry:null,busy:false,queue:[],processing:false,history:[],status:''};
      saved.push(current);restore(current);
    }
    const explain=button('解释一下',()=>{input.value='请用通俗的语言解释这段内容。';send();});
    const example=button('举个例子',()=>{input.value='请用一个具体例子说明这段内容。';send();});
    const submit=button('↑',send,'primary');submit.setAttribute('aria-label','发送问题');submit.title='发送（Enter）';
    actions.append(explain,example,submit);
    function lockButtons(){for(const b of [submit,explain,example])b.disabled=!current;}
    function setStatus(record,text){record.status=text+(record.queue?.length?`（${record.queue.length} 条排队）`:'');if(current===record){status.textContent=record.status;status.setAttribute('data-busy',record.busy?'true':'false');}}
    function applyReply(record,answer,job){
      if(['done','error'].includes(job.status)&&!record.queue.length){thinkingRecords.delete(record);syncPetPose();}
      const follow=current===record&&body.scrollHeight-body.scrollTop-body.clientHeight<70;
      const text=job.text||'等待网页回答…';if(answer.textContent!==text)answer.textContent=text;
      answer.setAttribute('data-streaming',job.status==='streaming'?'true':'false');
      const stages={loading:'正在等待回答页输入框…',filling:'正在填入问题…',submitting:'已尝试发送，等待网页确认…',waiting:'尚未确认网页请求，请查看回答标签页是否已发送。'};
      setStatus(record,job.status==='queued'?'已排队，可以继续阅读或提问。':job.status==='running'?(job.requestStarted?'问题已发出，等待 DeepSeek 回答…':stages[job.stage]||'正在连接回答页…'):job.status==='streaming'?'正在回答…':job.status==='error'?job.error||'回答失败。':'回答完成');
      if(follow)body.scrollTop=body.scrollHeight;
    }
    function restore(s){current=s;entries.replaceChildren(...s.nodes);quote.textContent=s.selection.quote;quote.style.display=s.selection.general?'none':'block';empty.style.display=s.nodes.length?'none':'block';showPanel();status.textContent=s.status;status.setAttribute('data-busy',s.busy?'true':'false');lockButtons();}
    function openSelection(){
      if(!pending)return;
      const previous=saved.find(s=>s.selection.quote===pending.quote&&s.selection.context===pending.context&&s.selection.source===pending.source);
      if(previous)restore(previous);
      else {current={id:null,selection:pending,sourceContext:pending.sourceContext,nodes:[],entry:null,busy:false,queue:[],processing:false,history:[],status:''};saved.push(current);restore(current);}
      pickButton.style.display='none';input.value='';input.focus();
    }
    let pending;
    document.addEventListener('pointerup',e=>{
      if(inside(e))return;
      const selection=getSelection();const text=selection?.toString().trim();
      if(!text || text.length<2 || !selection.rangeCount){pickButton.style.display='none';return;}
      const element=selection.anchorNode?.parentElement;
      if(!element || element.closest('textarea,input,[contenteditable="true"],nav,aside'))return;
      const paragraph=element.closest('p,li,pre,blockquote') || element;
      const quoteText=text.slice(0,3000);
      pending={quote:quoteText,context:paragraph.innerText.slice(0,6000),source:element,sourceContext:C.captureContext(element,quoteText,document,contextScope)};
      const rect=selection.getRangeAt(0).getBoundingClientRect();
      pickButton.style.left=Math.max(8,Math.min(innerWidth-150,rect.left))+'px';
      pickButton.style.top=Math.max(8,Math.min(innerHeight-50,rect.bottom+8))+'px';pickButton.style.display='block';
    });
    input.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229&&!e.repeat){e.preventDefault();send();}
    });
    function send(){
      if(!current || !input.value.trim())return;
      const record=current,question=input.value.trim();input.value='';
      empty.style.display='none';
      const box=node('div','entry'),q=node('div','q',question),answer=node('div','answer',record.busy?'已排队，等待上一条回答…':'等待网页回答…');box.append(q,answer);entries.append(box);record.entry=answer;record.nodes.push(box);
      record.queue.push({question,answer,scope:contextScope});
      if(record.processing)setStatus(record,'已收下新问题，上一条完成后自动发送。');
      void drain(record);
    }
    async function drain(record){
      if(record.processing)return;
      record.processing=true;record.busy=true;manualAction=null;thinkingRecords.add(record);syncPetPose();
      try{while(record.queue.length)await ask(record,record.queue.shift());}
      finally{record.processing=false;record.busy=false;thinkingRecords.delete(record);syncPetPose();record.activeEntry=null;if(current===record)status.setAttribute('data-busy','false');lockButtons();}
    }
    async function ask(record,{question,answer,scope}){
      const selection=record.selection;record.activeEntry=answer;answer.textContent='等待网页回答…';setStatus(record,'正在提交问题…');
      let id;
      try{
        if(selection.general){const latest=generalContext(scope);record.sourceContext=latest.source;selection.source=latest.last;}
        else if(selection.source?.isConnected)record.sourceContext=C.captureContext(selection.source,selection.quote,document,scope);
        else if(scope==='current')record.sourceContext={...record.sourceContext,messages:[]};
        const result=await rpc('start',{id:record.id,prompt:C.prompt(selection.quote,selection.context,question,record.history,record.sourceContext),question});id=result.id;record.id=id;
        const live={record,answer,revision:result.revision,latest:null,wake:null};liveReplies.set(id,live);
        const deadline=Date.now()+1800000;
        while(Date.now()<deadline){
          const before=live.latest;
          await new Promise(resolve=>{const timer=setTimeout(()=>{live.wake=null;resolve();},900);live.wake=()=>{clearTimeout(timer);live.wake=null;resolve();};});
          const job=live.latest&&live.latest!==before?live.latest:await rpc('state',{id});
          if(!live.latest?.updated||!job.updated||job.updated>=live.latest.updated){live.latest=job;applyReply(record,answer,job);}
          if(job.status==='error')throw new Error(job.error);
          if(job.status==='done'){record.history.push({question,answer:job.text});setStatus(record,'回答完成');return;}
        }
        throw new Error('等待超时，请检查回答标签页是否正常。');
      }catch(e){answer.textContent=answer.textContent==='等待网页回答…'?'尚未收到回答。':answer.textContent;setStatus(record,e.message);}
      finally{answer.setAttribute('data-streaming','false');if(id&&liveReplies.get(id)?.answer===answer)liveReplies.delete(id);}
    }
    let drag;
    head.addEventListener('pointerdown',e=>{
      if(e.target.closest('button'))return;dragging=true;const r=panel.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top};head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove',e=>{if(!dragging)return;panel.style.right='auto';panel.style.left=Math.max(0,Math.min(innerWidth-80,drag.left+e.clientX-drag.x))+'px';panel.style.top=Math.max(0,Math.min(innerHeight-80,drag.top+e.clientY-drag.y))+'px';});
    head.addEventListener('pointerup',()=>dragging=false);
    head.addEventListener('lostpointercapture',()=>dragging=false);
    lockButtons();
    const receiveUpdate=msg=>{
      if(msg.type==='show'){if(!current)openGeneral();else showPanel();}
      if(msg.type==='job-update'&&msg.job){
        const job=msg.job,live=liveReplies.get(job.id);
        if(!live||live.revision!==job.revision||typeof job.text!=='string')return;
        if(live.latest?.updated&&job.updated<live.latest.updated)return;
        live.latest=job;applyReply(live.record,live.answer,job);live.wake?.();
      }
    };
    if(demo)globalThis.__marginSubscribe?.(receiveUpdate);
    else chrome.runtime.onMessage.addListener(receiveUpdate);
  }
  (async()=>{
    let isWorker=location.hash.startsWith('#ds-margin-worker=');
    if(!demo&&!isWorker){try{isWorker=(await rpc('role')).worker;}catch{}}
    if(isWorker)worker();else{({host,root,toggleTheme}=mount());reader();}
  })();
})();
