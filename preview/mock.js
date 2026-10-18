globalThis.__MARGIN_DEMO__=true;
const mockJobs=new Map();
const mockListeners=new Set();
globalThis.__marginSubscribe=fn=>mockListeners.add(fn);
globalThis.__marginMock=async(type,data)=>{
  if(type==='start'){
    const id=data.id||crypto.randomUUID(),revision=(mockJobs.get(id)?.revision||0)+1;
    const text=`这是一条预设的演示回答，用于体验浮窗交互。\n\n你问的是：“${data.question}”\n\n以学习为例：看完一段说明后，先把它遮住，用自己的话讲给别人听。讲不清的地方，就是下一次追问的起点。\n\n实际扩展中，每个阅读页复用一个 DeepSeek 回答标签页，依次处理追问，再将真实回答同步到这里。`;
    const job={id,revision,text,started:Date.now(),status:'streaming'};mockJobs.set(id,job);
    const timer=setInterval(()=>{
      const n=Math.floor((Date.now()-job.started)/18),status=n>=text.length?'done':'streaming';
      for(const fn of mockListeners)fn({type:'job-update',job:{id,revision,text:text.slice(0,n),status,updated:Date.now()}});
      if(status==='done')clearInterval(timer);
    },100);
    return {id,revision};
  }
  if(type==='state'){
    const j=mockJobs.get(data.id),n=Math.floor((Date.now()-j.started)/18);
    return {...j,text:j.text.slice(0,n),status:n>=j.text.length?'done':'streaming',updated:Date.now()};
  }
  return {};
};
