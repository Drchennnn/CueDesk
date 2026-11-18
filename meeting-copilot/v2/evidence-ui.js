function EvidencePanel({turn}) {
 const h=jsxRuntimeExports.jsx,hs=jsxRuntimeExports.jsxs;
 const [error,setError]=reactExports.useState('');
 const [retired,setRetired]=reactExports.useState([]);
 reactExports.useEffect(()=>{let live=true;
  if(!EvidencePanel.retiredPromise)EvidencePanel.retiredPromise=Promise.resolve().then(()=>window.mc.getInterviewLibrary()).then(s=>s.retired_sources||[]).catch(()=>[]);
  EvidencePanel.retiredPromise.then(paths=>{if(live)setRetired(paths);});return()=>{live=false;};
 },[]);
 if(!turn.evidence&&!turn.unknown_facts?.length&&!turn.private_notes?.length)return null;
 const cited=new Set(turn.evidence_refs||[]);
 const diagnosticView=sourceDiagnostics(turn.diagnostics||[],retired);
 return hs('details',{style:{padding:'6px 10px',borderTop:'1px solid #8884',fontSize:12,maxHeight:'40vh',overflowY:'auto'},children:[
 h('summary',{children:'依据与来源 · '+cited.size+' 条引用 / '+(turn.evidence?.length||0)+' 条检索材料'+(turn.unknown_facts?.length?' · '+turn.unknown_facts.length+' 项待确认':'')}),
 h('p',{children:'引用有效只表示来源存在，不自动证明该来源支持整句话。历史摘录保留当时版本。'}),
 ...(turn.unknown_facts||[]).map((s,i)=>h('p',{style:{color:'#ffcc80'},children:'待本人确认：'+s},'u'+i)),
 ...(turn.private_notes||[]).map((s,i)=>h('p',{children:'私下提醒：'+s},'n'+i)),
 diagnosticView.retiredCount>0&&h('p',{children:'已清理的旧资料已归档，当前仅检索有效来源。'}),
 ...diagnosticView.visible.map((s,i)=>h('p',{children:s},'d'+i)),
 !!turn.invalid_refs?.length&&h('p',{role:'alert',children:'已拒绝不存在或格式无效的引用：'+turn.invalid_refs.join('、')}),
 ...(turn.evidence||[]).slice().sort((a,b)=>Number(cited.has(b.evidence_id))-Number(cited.has(a.evidence_id))).map(e=>hs('div',{style:{padding:'8px 0',borderTop:'1px solid #8884'},children:[
 h('strong',{children:(cited.has(e.evidence_id)?'已引用 · ':'仅检索 · ')+e.document_title}),
 h('div',{children:e.heading+' · '+e.document_type+' · 版本 '+e.version+' · '+(e.source_location.page_number?'第'+e.source_location.page_number+'页':'第'+(e.source_location.line_range||[]).join('—')+'行')}),
 h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:180,overflow:'auto'},children:e.excerpt}),
 h('button',{className:'btn btn-sm',children:'打开原文',onClick:async()=>{try{await window.mc.openInterviewEvidence({document_id:e.document_id,chunk_id:e.chunk_id,content_hash:e.content_hash});setError('');}catch(x){setError(x.message);}}}),
 ...(e.image_refs||[]).map((im,i)=>h('button',{className:'btn btn-sm',children:'查看原图 '+(i+1),onClick:async()=>{try{await window.mc.openInterviewEvidence({document_id:e.document_id,chunk_id:e.chunk_id,content_hash:e.content_hash,image_id:im.image_id});setError('');}catch(x){setError(x.message);}}},im.image_id)),
 e.document_type==='technical_reference'&&h('div',{children:'通用技术参考，不能作为本人经历；部分内容已校对，其余保留外部原文。'})
 ]},e.evidence_id)),error&&h('p',{role:'alert',children:error})
 ]});
}
function sourceDiagnostics(diagnostics,retired){const paths=new Set(retired),prefix='来源已缺失，保留历史身份：';let retiredCount=0;const visible=diagnostics.filter(s=>{if(s.startsWith(prefix)&&paths.has(s.slice(prefix.length))){retiredCount++;return false;}return true;});return {visible,retiredCount};}
if(typeof module!=='undefined')module.exports={sourceDiagnostics};
