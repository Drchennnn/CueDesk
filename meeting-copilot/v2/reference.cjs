'use strict';
const crypto = require('node:crypto');
const digest = s => crypto.createHash('sha256').update(s).digest('hex');

// Imported reference books retain question/answer boundaries, not TOC entries.
function splitReference(text, doc) {
  const lines=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
  const level=Number(/^question_level:\s*(\d)/m.exec(text)?.[1]||4);
  const starts=[],boundaries=[],sections=[];let fence=null,chapter='';
  for(let i=0;i<lines.length;i++){
    const code=/^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if(code){if(!fence)fence=code[1][0];else if(fence===code[1][0])fence=null;continue;}
    if(fence)continue;
    const h=/^(#{1,6})\s+(.+)/.exec(lines[i]);if(!h)continue;
    if(h[1].length===2)chapter=h[2];
    if(h[1].length<level)boundaries.push(i);
    if(level===4&&h[1].length===3&&/^第\d+节/.test(h[2]))sections.push({line:i,question:h[2],chapter});
    if(h[1].length===level&&(/^(?:第\d+节|\d+[.、])/.test(h[2])||level===4))starts.push({line:i,question:h[2],chapter});
  }
  // Some imported books mix h4 questions with standalone h3 system designs.
  // A numbered h3 that owns h4 questions is a section, not an extra Q&A.
  for(const q of sections){const end=boundaries.find(i=>i>q.line)??lines.length;if(!starts.some(s=>s.line>q.line&&s.line<end))starts.push(q);}
  starts.sort((a,b)=>a.line-b.line);
  const chunks=[],occurrences={};
  function emit(start,end,q){
    while(start<end&&!lines[start].trim())start++;
    while(end>start&&!lines[end-1].trim())end--;
    if(end<=start)return;
    const content=lines.slice(start,end).join('\n'),hash=digest(content);
    occurrences[hash]=(occurrences[hash]||0)+1;
    const image_refs=[];
    const pattern=/!\[([^\]]*)\]\(([^\s)]+)\)\s*<!--\s*asset_sha256:\s*([a-f0-9]{64})\s*-->/g;
    for(const m of content.matchAll(pattern)){
      const id=/(?:^|\/)([a-f0-9]{24})\.(?:png|jpg|jpeg|webp|gif)$/i.exec(m[2]);
      if(id)image_refs.push({image_id:id[1],relative_path:m[2],content_hash:m[3],alt:m[1]});
    }
    chunks.push({chunk_id:doc.document_id+':0:'+hash.slice(0,20)+':'+occurrences[hash],document_id:doc.document_id,
      heading:[doc.title,q.chapter,q.question].filter(Boolean).join(' / '),question_title:q.question,
      question_id:digest(q.chapter+' / '+q.question).slice(0,20),document_type:'technical_reference',content,content_hash:hash,
      source_location:{line_range:[start+1,end]},image_refs,
      review_status:/review: corrected/.test(content)?'corrected_selected_points':'external_reference_not_fully_verified'});
  }
  for(let n=0;n<starts.length;n++){
    const q=starts[n],next=starts[n+1]?.line??lines.length,end=boundaries.find(i=>i>q.line&&i<next)??next;
    if(lines.slice(q.line,end).join('\n').length<=4500){emit(q.line,end,q);continue;}
    // Only split oversized answers at paragraph boundaries outside code fences.
    let begin=q.line,blockStart=q.line,code=null;
    for(let i=q.line;i<end;i++){
      const marker=/^\s*(`{3,}|~{3,})/.exec(lines[i]);if(marker){if(!code)code=marker[1][0];else if(code===marker[1][0])code=null;}
      if(!code&&!lines[i].trim()){
        if(lines.slice(begin,i).join('\n').length>4200&&blockStart>begin){emit(begin,blockStart,q);begin=blockStart;}
        blockStart=i+1;
      }
    }
    emit(begin,end,q);
  }
  return chunks;
}
module.exports={splitReference};
