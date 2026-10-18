// Decode visible answer text from already received chat frames. No requests,
// credentials, thought text, or arbitrary response metadata are retained.
(() => {
  const LIMIT=100000;
  function create(){
    let fragments=[],flat='',path='',operation='APPEND',finished=false;
    const visible=type=>['RESPONSE','ANSWER','TEXT'].includes(String(type||'').toUpperCase());
    const fragment=value=>({type:String(value?.type||''),content:visible(value?.type)&&typeof value?.content==='string'?value.content.slice(0,LIMIT):''});
    const append=(old,value,op)=>typeof value==='string'?(op==='SET'?value:old+value).slice(0,LIMIT):old;
    const terminal=value=>typeof value==='string'&&['FINISHED','COMPLETED','DONE'].includes(value.toUpperCase());
    function snapshot(response){
      if(!response||typeof response!=='object')return;
      if(Array.isArray(response.fragments)){fragments=response.fragments.slice(0,64).map(fragment);path='response/fragments/-1/content';}
      if(typeof response.content==='string'){flat=response.content.slice(0,LIMIT);path='response/content';}
      if(terminal(response.status))finished=true;
    }
    function apply(packet,base='',depth=0){
      if(!packet||typeof packet!=='object'||depth>8)return;
      const value=packet.v;
      if(value?.response){snapshot(value.response);return;}
      if(packet.response){snapshot(packet.response);return;}
      if(typeof packet.p==='string'){
        const local=packet.p.replace(/^\//,'');
        path=base&&local&&!local.startsWith('response')?base+'/'+local:local||base;
      }
      const current=path,op=typeof packet.o==='string'?packet.o:operation;
      if(op==='APPEND'||op==='SET')operation=op;
      if(op==='BATCH'&&Array.isArray(value)){for(const child of value)apply(child,current,depth+1);return;}
      if(current==='response'&&value&&typeof value==='object'&&!Array.isArray(value)){snapshot(value);return;}
      if(current==='response/status'){if(terminal(value))finished=true;return;}
      if(current==='response/fragments'&&Array.isArray(value)){
        const incoming=value.slice(0,64).map(fragment);
        fragments=(op==='SET'?incoming:fragments.concat(incoming)).slice(0,64);return;
      }
      const match=current.match(/^response\/fragments\/(-?\d+)(?:\/(content|type))?$/);
      if(match){
        let index=Number(match[1]);if(index<0)index=fragments.length+index;
        if(index<0||index>=64)return;
        if(!match[2]&&value&&typeof value==='object'){fragments[index]=fragment(value);return;}
        const target=fragments[index];if(!target)return;
        if(match[2]==='type'&&typeof value==='string'){target.type=value;if(!visible(value))target.content='';}
        if(match[2]==='content'&&visible(target.type))target.content=append(target.content,value,op);
        return;
      }
      if(current==='response/content'||current==='response/answer')flat=append(flat,value,op);
    }
    return {push(packet){apply(packet);return {text:(fragments.filter(f=>f&&visible(f.type)).map(f=>f.content).join('')||flat).slice(0,LIMIT),finished};}};
  }
  globalThis.MarginStreamDecoder={create};
  if(typeof module!=='undefined')module.exports=globalThis.MarginStreamDecoder;
})();
