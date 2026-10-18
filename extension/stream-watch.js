// Runs in the page world only after the worker arms it. Observe lifecycle of
// existing chat streams; never issue a request. Visible reply text is relayed
// locally so background-page rendering is not required for synchronization.
(() => {
  let installed=false,sequence=0;
  function arm(){
    if(installed||typeof window.fetch!=='function')return;installed=true;
    const original=window.fetch;
    const emit=(id,phase,extra={})=>{try{document.dispatchEvent(new CustomEvent('ds-margin-stream',{detail:JSON.stringify({id,phase,...extra})}));}catch{}};
    window.fetch=async function(...args){
      let requestId=null;
      try{
        const url=new URL(args[0]?.url||args[0],location.href),method=String(args[1]?.method||args[0]?.method||'GET').toUpperCase();
        if(url.origin===location.origin&&method==='POST'&&/(?:completion|generate|response)(?:\/|$)/i.test(url.pathname))requestId=++sequence;
      }catch{}
      let response;
      try{const pending=Reflect.apply(original,this,args);if(requestId!==null)emit(requestId,'request');response=await pending;}
      catch(error){if(requestId!==null)emit(requestId,'error');throw error;}
      try{
        const url=new URL(response.url||args[0]?.url||args[0],location.href);
        const method=String(args[1]?.method||args[0]?.method||'GET').toUpperCase();
        const type=response.headers.get('content-type')||'';
        if(url.origin!==location.origin||method!=='POST'||!/(?:completion|generate|response)(?:\/|$)/i.test(url.pathname)||!/(?:text\/event-stream|application\/x-ndjson)/i.test(type)||!response.ok||!response.body)return response;
        const reader=response.clone().body.getReader(),id=requestId??++sequence;emit(id,'start');
        void(async()=>{
          try{
            const decoder=new TextDecoder(),answer=globalThis.MarginStreamDecoder?.create();
            let pending='',data=[],event='',latest='',sent='',lastPush=0,ended=false;
            function publish(force=false){if(latest&&latest!==sent&&(force||!sent||Date.now()-lastPush>=80)){sent=latest;lastPush=Date.now();emit(id,'text',{text:latest});}}
            function frame(){
              const payload=data.join('\n');data=[];
              if(payload==='[DONE]'||/^(?:done|complete|end|finish|close)$/i.test(event)){ended=true;event='';return;}
              event='';if(!payload||!answer)return;
              try{const decoded=answer.push(JSON.parse(payload));latest=decoded.text;publish();if(decoded.finished)ended=true;}catch{}
            }
            function line(value){
              if(!value){frame();return;}
              if(value.startsWith('data:'))data.push(value.slice(5).trimStart());
              else if(value.startsWith('event:'))event=value.slice(6).trim();
              else if(value.trimStart().startsWith('{')){data=[value];frame();}
            }
            while(true){
              const chunk=await reader.read();if(chunk.done)break;
              pending+=decoder.decode(chunk.value,{stream:true});
              const lines=pending.split(/\r?\n/);pending=lines.pop().slice(-1048576);
              for(const value of lines){line(value);if(ended)break;}
              if(ended){
                publish(true);emit(id,'end');void reader.cancel().catch(()=>{});return;
              }
            }
            pending+=decoder.decode();if(pending)line(pending);frame();publish(true);
            emit(id,'end');
          }
          catch{emit(id,'error');}
          finally{try{reader.releaseLock();}catch{}}
        })();
      }catch{}
      return response;
    };
  }
  document.addEventListener('ds-margin-arm-stream-watch',arm);
  if(location.hash.startsWith('#ds-margin-worker='))arm();
})();
