'use strict';
function parseAnswer(raw,evidence=[],final=false,policy={}){
 const valid=new Map(evidence.map(e=>[e.evidence_id,e])),refs=[],invalid=[],claims=[],unknown=[...(policy.requiredUnknown||[])],notes=[];let oral='',cursor=0;
 while(cursor<raw.length){const begin=raw.indexOf('[',cursor);if(begin<0){oral+=raw.slice(cursor);break;}oral+=raw.slice(cursor,begin);
 if(raw[begin+1]!=='['){
  const tail=raw.slice(begin);
  if(!final&&tail==='[')break;
  if(/^\[E(?:\d|$)/.test(tail)){
   const malformed=/^\[E\d+\]+/.exec(tail);if(!malformed){if(!final||!tail.includes(']'))break;}
   if(malformed){invalid.push('malformed:'+malformed[0]);cursor=begin+malformed[0].length;continue;}
  }
  oral+='[';cursor=begin+1;continue;
 }
 const end=raw.indexOf(']]',begin+2);if(end<0){if(final)notes.push('不完整引用标记已隐藏');break;}const tag=raw.slice(begin+2,end).trim();
 if(/^E\d+$/.test(tag)){if(valid.has(tag)){refs.push(tag);const sentence=oral.trim().split(/[。！？\n]|(?<=[.!?])(?=\s|$)/).filter(Boolean).at(-1)||oral.trim().slice(-180);claims.push({claim:sentence,evidence_ids:[tag],status:'reference_valid_support_unverified'});}else invalid.push(tag);}
 else if(tag.startsWith('UNKNOWN:')){
  unknown.push(tag.slice(8));
  // Remove the unfinished clause introducing the hidden fact as one unit.
  if(/[，,、：:]\s*$/.test(oral))oral=oral.replace(/[^。！？\n]*$/,'');
  cursor=end+2;
  if((!oral.trim()||/[。！？]\s*$/.test(oral))&&/^[。；，]/.test(raw.slice(cursor)))cursor++;
  continue;
 }else if(tag.startsWith('NOTE:'))notes.push(tag.slice(5));else invalid.push(tag);cursor=end+2;}
 const en=policy.lang==='english';
 // Hide internal source locators, not numeric facts or ordinary technology names.
 oral=oral.replace(/\bparent_id\b/g,en?'parent chunk ID':'父块 ID').replace(/`([\s\S]*?)`/g,'$1').replace(/(?:[A-Za-z]:[\\/]|\/Users\/)[^\s，。；\n]+/g,en?'(see evidence panel)':'（来源见依据区）').replace(/[\w.\-\u4e00-\u9fff]+\.md(?:#[^\s，。]+)?/gi,en?'(see evidence panel)':'（来源见依据区）').replace(/\b[a-zA-Z][a-zA-Z0-9]*_[a-zA-Z0-9_]+\s*=\s*([-+]?\d+(?:\.\d+)?%?)/g,'$1').replace(/\b[a-zA-Z][a-zA-Z0-9]*_[a-zA-Z0-9_]+\b/g,en?'this field':'这个字段');
 if(!en)oral=oral.replace(/\btrial\s*(\d+)/gi,'第$1次试验');
 const splitSegments=(text,clause=false)=>{
  const re=en?(clause?/(?:[^,;.!?\n，。！？；]|(?<!\s)[.](?!\s|$))+(?:[,;.!?\n，。！？；]+|$)/g:/(?:[^.!?\n。！？；]|(?<!\s)[.](?!\s|$))+(?:[.!?\n。！？；]+|$)/g):(clause?/[^，。！？；\n]*[，。！？；\n]|[^，。！？；\n]+$/g:/[^。！？；\n]*[。！？；\n]|[^。！？；\n]+$/g);
  return text.match(re)||[];
 };
 const trimIncomplete=(text,clause=false)=>{
  if(!en)return text.slice(0,text.search(clause?/[^，。！？；\n]*$/:/[^。！？；\n]*$/));
  const segs=splitSegments(text,clause);
  if(!segs.length)return '';
  const tail=segs.at(-1);
  const done=clause?/[,;.!?\n，。！？；]\s*$/.test(tail):/[.!?\n。！？；]\s*$/.test(tail);
  return done?segs.join(''):segs.slice(0,-1).join('');
 };
 const unsupported=s=>policy.intro&&(/用过|做过|熟悉|掌握|经验|了解|停留|没有|没用过|不会/.test(s)||en&&/\b(?:used|built|worked\s+with|experienced\s+(?:with|in)|familiar\s+with|proficient\s+in|haven't\s+used|never\s+used|no\s+experience)\b/i.test(s))&&(policy.unverifiedTools||[]).some(t=>new RegExp('(?:^|[^a-z])'+t.replace(' ','\\s*')+'(?![a-z])','i').test(s));
 if(policy.intro){
  // Check each completed clause before displaying it; later clauses still stream.
  if(!final)oral=trimIncomplete(oral,false);
  oral=splitSegments(oral,false).filter(s=>{if(!unsupported(s))return true;notes.push('已隐藏缺少本人材料支持的技术经历陈述，请本人确认。');return false;}).join('');
 }
 const unconfirmedDenial=s=>policy.absenceUnknown&&/没(?:有)?[^，。！？；\n]{0,40}(?:做过|用过|算过|计算过|统计过|分析过|接触过|实践|经验|经历|背景|落地过|上线过|运维过|部署过|开发过|实现过|承担过)|未(?:曾)?[^，。！？；\n]{0,8}(?:做|接触|实践|计算|统计|分析)/.test(s);
 const unavailableDetail=s=>policy.projectReference&&/(?:没有|缺少|未找到|暂无|缺乏)[^，。！？；\n]{0,12}(?:资料|记录|依据|证据)|(?:不能|无法|没法)(?:准确)?(?:确认|回答|确定)|(?:这部分|这个细节|这点|具体参数|具体数值)[^，。！？；\n]{0,10}(?:需要|待|还要|我再?|得)(?:本人)?(?:确认|核对|核实)|我这边(?:还|再)?(?:需要)?(?:确认|核对|核实)一下/.test(s);
 const unconfirmedHistory=s=>policy.suggestionOnly&&(/(?:需要|待)[^，。！？；\n]{0,12}(?:本人|我)[^，。！？；\n]{0,8}(?:确认|核实)/.test(s)||/当时|那次|曾经|之前|我们项目|我[^，。！？；\n]{0,16}(?:做过|用过|处理过|负责过|遇到过|承担过|参与过|上线了|实现了|完成了|加了|用了)/.test(s)&&!/^\s*(?:如果|假设)/.test(s));
 if(policy.projectReference){
  // A detail-gap sentence can contain an unfinished lead-in before its final
  // clause. Hold the whole sentence so both parts stay in the private panel.
  if(!final)oral=en?trimIncomplete(oral,false):oral.slice(0,oral.search(/[^。！？\n]*$/));
  oral=(en?splitSegments(oral,false):(oral.match(/[^。！？\n]*[。！？\n]|[^。！？\n]+$/g)||[])).filter(sentence=>{
   if(!unavailableDetail(sentence))return true;
   unknown.push(sentence.trim());notes.push('具体历史细节已移至私下提示，口述保留方法说明。');return false;
  }).join('');
 }
 if(policy.absenceUnknown||policy.suggestionOnly||policy.projectReference){
  // Buffer incomplete clauses so an unsupported denial is never streamed first
  // and removed later. This is a lexical guard, not semantic fact verification.
  if(!final)oral=trimIncomplete(oral,true);
  oral=splitSegments(oral,true).filter(s=>{
   if(unavailableDetail(s)){unknown.push(s.replace(/[，。！？；\n]+$/,'').trim());notes.push('具体历史细节已移至私下提示，口述保留方法说明。');return false;}
   if(!unconfirmedDenial(s)&&!unconfirmedHistory(s))return true;
   unknown.push('该技术的具体个人实践范围尚未确认');notes.push('已隐藏没有本人事实支持的经历陈述或否认');return false;
  }).join('').replace(/^[，。；\s]+/,'');
  if(final&&(policy.absenceUnknown||policy.suggestionOnly))oral=oral.replace(/[，；]+\s*$/,en?'.':'。').trim();
  if(policy.suggestionOnly){
   notes.push('口述为一般参考思路，不代表本人已发生的经历。');
   if(oral.trim()){
    if(en){if(!/^\s*(?:if\b|in\s+general\b|generally\b|hypothetically\b|my\s+understanding\b|i\s+would\b|i'd\b)/i.test(oral))oral='In general, '+oral;}
    else if(!/^\s*(如果|假设|一般|我的理解|我会)/.test(oral))oral='如果只谈一般思路，'+oral;
   }
  }
 }
 const verifiedClaims=claims.filter(c=>!unsupported(c.claim)&&!unconfirmedDenial(c.claim)&&!unconfirmedHistory(c.claim)&&!unavailableDetail(c.claim));const cited=policy.intro?[...new Set(verifiedClaims.flatMap(c=>c.evidence_ids))]:[...new Set(refs)];
 return {oral_answer:oral,evidence_refs:cited,claim_evidence:verifiedClaims,unknown_facts:[...new Set(unknown)],private_notes:[...new Set(notes)],invalid_refs:[...new Set(invalid)],evidence,verification:'仅校验引用ID和原文定位；未自动证明引用支持声明'};
}
function createAnswerStream(evidence,onUpdate,policy={}){let raw='';return {push(delta){raw+=delta;onUpdate(parseAnswer(raw,evidence,false,policy));},finish(text){if(typeof text==='string')raw=text;const result=parseAnswer(raw,evidence,true,policy);onUpdate(result);return result;}};}
module.exports={parseAnswer,createAnswerStream};
