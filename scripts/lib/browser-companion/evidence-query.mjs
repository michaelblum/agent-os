import { sessionFail } from './session-model.mjs';

const MAX_LOCATOR_BYTES = 4096;

function boundedLocator(value, kind) {
  const text = String(value ?? '');
  if (!text || Buffer.byteLength(text) > MAX_LOCATOR_BYTES) {
    sessionFail('BROWSER_SESSION_INVALID', `${kind} locator is invalid`);
  }
  return Object.freeze({ kind, value: text });
}

function candidatesFor(input) {
  if (!Array.isArray(input?.candidates) || input.candidates.length < 1 || input.candidates.length > 2) {
    sessionFail('BROWSER_SESSION_INVALID', 'evidence locators are invalid');
  }
  const seen = new Set();
  return input.candidates.map((candidate) => {
    if (!candidate || !['css', 'xpath'].includes(candidate.kind) || seen.has(candidate.kind)) {
      sessionFail('BROWSER_SESSION_INVALID', 'evidence locator identity is invalid');
    }
    seen.add(candidate.kind);
    return boundedLocator(candidate.value, candidate.kind);
  });
}

export function browserEvidenceQueryScript(input) {
  const candidates = candidatesFor(input);
  return `() => {
    const candidates=${JSON.stringify(candidates)};
    const result=[];let used=null;
    const locate=(candidate)=>candidate.kind==='xpath'
      ?document.evaluate(candidate.value,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null)
      :document.querySelectorAll(candidate.value);
    for(const candidate of candidates){
      let count=0,node=null,invalid=false;
      try{const found=locate(candidate);count=candidate.kind==='xpath'?found.snapshotLength:found.length;node=count?(candidate.kind==='xpath'?found.snapshotItem(0):found[0]):null}catch{invalid=true}
      const projected={kind:candidate.kind,value:candidate.value,match_count:count,error:invalid?'invalid_locator':null};result.push(projected);
      if(!used&&!invalid&&node)used={projected,node};
    }
    const strategy=candidates.map(item=>item.kind).join('_then_');
    if(!used)return{status:'missing_selector',extracted_text:null,bounding_box:null,visible:false,selector_resolution:{strategy,candidates:result,used:null}};
    const rect=used.node.getBoundingClientRect();
    const visible=rect.width>0&&rect.height>0&&getComputedStyle(used.node).visibility!=='hidden';
    return{status:'captured',extracted_text:String(used.node.innerText||used.node.textContent||'').replace(/\\s+/g,' ').trim(),bounding_box:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},visible,selector_resolution:{strategy,candidates:result,used:{kind:used.projected.kind,value:used.projected.value,index:0,match_count:used.projected.match_count}}};
  }`;
}
