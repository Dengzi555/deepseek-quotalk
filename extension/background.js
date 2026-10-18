const read = async id => (await chrome.storage.session.get(id))[id];
const put = async job => chrome.storage.session.set({[job.id]: job});
const saveChannel = channel => chrome.storage.session.set({[channel.key]: channel});
const valid = sender => sender.tab && sender.url?.startsWith('https://chat.deepseek.com/');
const active = job => job && ['queued', 'running', 'streaming'].includes(job.status);
let serial = Promise.resolve();
function enqueue(fn) { const result = serial.then(fn); serial = result.catch(() => {}); return result; }
async function markInitialized(channel){
  const changed=!channel.initialized;channel.initialized=true;
  if(channel.returnPending)await returnToReader(channel);
  else if(changed)await saveChannel(channel);
}
async function returnToReader(channel){
  if(!channel.returnPending)return;
  channel.returnPending=false;
  try{
    const [worker,owner]=await Promise.all([chrome.tabs.get(channel.worker),chrome.tabs.get(channel.owner)]);
    // A user-selected third tab must never be replaced by the automatic return.
    if(worker.active&&worker.windowId===owner.windowId)await chrome.tabs.update(owner.id,{active:true});
  }catch{}
  await saveChannel(channel);
}
async function failChannel(channel, error) {
  for (const id of [channel.current, ...channel.queue].filter(Boolean)) {
    const job = await read(id);
    if (active(job)) await put({...job, status: 'error', error, updated: Date.now()});
  }
  await chrome.storage.session.remove('worker:' + channel.worker);
  await chrome.storage.session.remove(channel.key);
}
async function channelForOwner(owner) {
  const key = 'channel:' + owner;
  let channel = await read(key);
  if (channel?.worker) {
    let tab;
    try {tab=await chrome.tabs.get(channel.worker);if(tab.url&&!tab.url.startsWith('https://chat.deepseek.com/'))throw Error('navigated');}
    catch {tab=null;await failChannel(channel,'回答标签页已关闭或离开 DeepSeek，请重新提问。');}
    if(tab&&channel.mode==='tab')return channel;
    if(tab)await failChannel(channel,'回答通道已更新，请重新提问。');
  }
  const source=await chrome.tabs.get(owner);
  const tab=await chrome.tabs.create({windowId:source.windowId,url:'https://chat.deepseek.com/#ds-margin-worker=shared',active:false});
  if(!tab?.id)throw new Error('未找到回答标签页，请重新提问。');
  channel = {key, owner, worker: tab.id,mode:'tab',current: null, queue: [],initialized:false};
  await saveChannel(channel);
  await chrome.storage.session.set({['worker:' + tab.id]: key});
  return channel;
}
async function dispatch(channel) {
  const current = channel.current && await read(channel.current);
  if (active(current)) return current;
  channel.current = null;
  while (channel.queue.length) {
    const job = await read(channel.queue.shift());
    if (job?.status === 'queued') { channel.current = job.id; await saveChannel(channel); return job; }
  }
  await saveChannel(channel); return null;
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  enqueue(async () => {
    if (!valid(sender)) throw new Error('仅支持 DeepSeek 网页');
    if(msg.type==='prepare'){await channelForOwner(sender.tab.id);return {};}
    if (msg.type === 'start') {
      if (typeof msg.prompt !== 'string' || msg.prompt.length > 48000) throw new Error('问题及语境过长');
      let job = msg.id && await read(msg.id);
      if (msg.id && !job) throw new Error('会话已失效，请重新划选文字。');
      if (job && job.owner !== sender.tab.id) throw new Error('会话不属于当前页面');
      const channel = await channelForOwner(sender.tab.id);
      if(msg.id)job=await read(msg.id);
      if (active(job)) throw new Error('这条旁注还在回答，可划选其他文字提问。');
      job = {...job, id: job?.id || crypto.randomUUID(), owner: sender.tab.id, worker: channel.worker, prompt: msg.prompt, question: msg.question, status: 'queued', stage:'loading', text: '', error: '', baseline: null, requestStarted:false, revision: (job?.revision || 0) + 1, updated: Date.now()};
      await put(job);
      channel.queue.push(job.id); await saveChannel(channel);
      if(!channel.initialized&&!channel.startupAttempted){
        await chrome.tabs.update(channel.worker,{active:true});
        channel.startupAttempted=true;channel.returnPending=true;await saveChannel(channel);
      }
      chrome.tabs.sendMessage(channel.worker,{type:'wake'}).catch(()=>{});
      return {id: job.id, revision: job.revision};
    }
    const channelKey = await read('worker:' + sender.tab.id);
    const channel = channelKey && await read(channelKey);
    if (msg.type === 'role') return {worker: !!channel};
    if (msg.type === 'work') {
      return channel?.worker === sender.tab.id ? dispatch(channel) : null;
    }
    const job = msg.id && await read(msg.id);
    if (!job) throw new Error('会话已失效（浏览器重启后需新建旁注）');
    if (msg.type === 'state' && job.owner === sender.tab.id) return job;
    if(msg.type==='request-started'&&job.worker===sender.tab.id&&channel?.current===job.id&&msg.revision===job.revision&&active(job)){
      job.requestStarted=true;job.updated=Date.now();await markInitialized(channel);await put(job);
      chrome.tabs.sendMessage(job.owner,{type:'job-update',job:{id:job.id,revision:job.revision,status:job.status,stage:job.stage,requestStarted:true,text:job.text,error:job.error,updated:job.updated}}).catch(()=>{});return {};
    }
    if(msg.type==='initialized'&&job.worker===sender.tab.id&&channel?.current===job.id&&msg.revision===job.revision){
      await markInitialized(channel);return {};
    }
    if (msg.type === 'update' && job.worker === sender.tab.id && channel?.current === job.id) {
      if (msg.revision !== job.revision || !active(job)) return {};
      if (!['running', 'streaming', 'done', 'error'].includes(msg.status)) throw new Error('无效状态');
      job.status = msg.status;
      if(['loading','filling','submitting','waiting'].includes(msg.stage))job.stage=msg.stage;
    if(msg.baseline && Number.isInteger(msg.baseline.count) && msg.baseline.count>=0)job.baseline={count:msg.baseline.count,old:String(msg.baseline.old||'').slice(0,100000)};
      job.text = String(msg.text || '').slice(0, 100000);
      job.error = String(msg.error || '').slice(0, 1000);
      job.updated = Date.now();
      await put(job);
      if((msg.status==='streaming'||msg.status==='done')&&job.text)await markInitialized(channel);
      if(msg.status==='error')await returnToReader(channel);
      chrome.tabs.sendMessage(job.owner, {type:'job-update',job:{id:job.id,revision:job.revision,status:job.status,stage:job.stage,requestStarted:job.requestStarted,text:job.text,error:job.error,updated:job.updated}}).catch(()=>{});
      return {};
    }
    throw new Error('无权操作此会话');
  }).then(data => reply({ok: true, data}), e => reply({ok: false, error: e.message}));
  return true;
});
chrome.action.onClicked.addListener(tab => {
  if (tab.url?.startsWith('https://chat.deepseek.com/')) chrome.tabs.sendMessage(tab.id, {type: 'show'}).catch(() => {});
  else chrome.tabs.create({url: 'https://chat.deepseek.com/'});
});
chrome.tabs.onRemoved.addListener(tabId => enqueue(async () => {
  const workerKey = await read('worker:' + tabId);
  const channel = workerKey && await read(workerKey);
  if (channel) await failChannel(channel, '后台回答页已关闭，请重新提问。');
  const ownerChannel = await read('channel:' + tabId);
  if (ownerChannel) await failChannel(ownerChannel, '阅读页面已关闭');
  const items = await chrome.storage.session.get(null);
  for (const [key, job] of Object.entries(items)) {
    if (key.startsWith('worker:') || key.startsWith('channel:')) continue;
    if (job?.owner === tabId) await chrome.storage.session.remove(key);
    else if (job?.worker === tabId) await put({...job, status: 'error', error: '追问标签页已关闭', updated: Date.now()});
  }
}));
