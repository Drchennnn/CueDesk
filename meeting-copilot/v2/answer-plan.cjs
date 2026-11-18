'use strict';
const {facets,generalKnowledge,noise}=require('./query.cjs');
// One request may need both technical knowledge and a personal example.
// This is a local retrieval/depth policy, not a claim to know the user's skills.
function planQuestion(q,dialogue,persona){
 const concept=generalKnowledge(q)||/是什么|什么是|原理|概念|区别|如何理解|怎么理解|意味着|能做什么|用途|有什么作用/.test(q);
 const judgment=/你觉得|你认为|最难|难点|挑战|取舍|怎么看|如何选|怎么选|如何评估|怎么评估/.test(q);
 const method=/怎么|如何|怎样|排查|实现|处理|优化|设计|架构|方案/.test(q);
 const asksInstance=/哪次|讲一次|讲一遍你的实际|具体.{0,8}事故|那次/.test(q);
 const mixed=dialogue.experience&&(concept||/一般|假设|如果/.test(q)||!asksInstance&&/怎么|如何|怎样|思路/.test(q));
 const strictPersonal=dialogue.confirm_prior_design||dialogue.experience&&!mixed;
 const design=dialogue.design||/架构|系统设计|设计方案/.test(q);
 const demanding=design&&/跨地域|多地域|跨机房|强一致|千万|亿级|两地三中心|容灾|全球/.test(q);
 const bounded=Boolean(demanding&&persona&&!persona.skills.some(s=>s.level==='independent'&&/架构|分布式/.test(s.area)));
 const technical=concept||design||facets(q).length>0||dialogue.intents?.includes('technical');
 const enumeration=technical&&!bounded&&/(?:有哪些|有什么|哪几种|几种|常见|常用).{0,12}(?:方法|策略|方式|类型|结构|模型|方案)|(?:方法|策略|方式|类型|结构|模型|方案).{0,10}(?:有哪些|有什么|哪几种|几种)|怎么分类|如何分类|有(?:哪|几).{0,4}种/.test(q);
 return {
  presentation:{mode:technical?(enumeration?'named_methods':'term_then_plain'):'natural_answer',instruction:technical?'先说必要的专业名称，紧接一句人话解释它做什么、为什么用。方法分类题可列3—4种常见做法，每种名称加一句解释；具体项目只说材料支持的实际做法，架构题只命名用到的关键设计。一般知识不改写成本人做过，不为显得专业补高级术语。':'按当前问题自然回答，不强加技术分类。'},
  question_types:[...new Set([...(dialogue.project_ids?.length?['project_deep_dive']:[]),...(concept||!design&&!dialogue.experience&&facets(q).length?['technical_knowledge']:[]),...(design?['scenario_design']:[]),...(!concept&&!design&&(method||dialogue.intents?.includes('method'))&&/你|平时|自己|排查/.test(q+' '+dialogue.subject_question)&&(!dialogue.project_ids?.length||/流程|排查|验证|测试|怎么用|如何用|习惯|平时/.test(q))?['personal_method']:[]),...(/了解过|熟悉|熟不熟|掌握|会不会用/.test(q)?['ability']:[])])],
  requested_facets:facets(q).map(({id,label})=>({id,label})),
  intents:[...new Set([...(dialogue.intents||[]),...(concept?['concept']:[]),...(judgment?['judgment']:[]),...(mixed?['mixed']:[])])],
  strict_personal:strictPersonal,mixed,allow_reference:!strictPersonal,
  allow_project_example:!strictPersonal&&!concept&&(judgment||method||design),
  reference_first:!strictPersonal&&!dialogue.experience&&!design&&(technical||judgment),
  reference_policy:'优先使用匹配的本地技术参考；采用其中的解释或方法时引用对应来源，项目事实和假设设计分别表述；没有直接支持的内容不凑引用。',
  response_depth:bounded?'bounded_design':design?'small_design':concept?'foundation':judgment?'judgment_with_one_example':'focused_answer',
  has_confirmed_profile:Boolean(persona),
  scope_rules:{
   use:'先理解问题，再读相关技术材料，筛选当前能力范围内的必要概念/基础做法，再决定是否结合直接相关项目。',
   trim:'保留能解释清楚的基础部分；略去非必要的高级组件、算法推导、生产调优和未经确认的工具实践。不能略掉题目硬条件后声称方案已经满足。',
   design:'只设计一个最小可行的链路，按假设需求解释一个关键取舍；复杂规模或高可靠要求超出能力时说明不能给可靠细节，再讲可解释的基础方案和待验证条件。',
   boundary:'明确未实践/不熟可以按画像如实说明；画像未覆盖的技术保持未知，不能由检索不到推断没接触，也不能凭参考答案代说熟悉。',
   no_hit:'找不到直接相关的技术材料时，允许用模型通用知识给简短基础解释或假设方案；没有把握的机制明确不确定，不编技术细节、个人经历或引用。',
   example:'项目必须与本题的技术问题或处理方法直接相关，只举一个；技术参考用于理解与一般方案，项目事实用于本人实际动作，不把二者互相当证据。'
  }
 };
}
function referenceMatch(terms,title,body){
 const meaningful=terms.filter(t=>!noise(t));
 const titleHits=meaningful.filter(t=>title.includes(t));
 const bodyHits=meaningful.filter(t=>body.includes(t));
 const coverage=meaningful.length?bodyHits.length/meaningful.length:0;
 return {title_hits:titleHits.length,body_hits:bodyHits.length,coverage,
  usable:meaningful.length>0&&(titleHits.length>=Math.min(2,meaningful.length)||meaningful.length===1&&bodyHits.length===1||bodyHits.length>=3&&coverage>=0.35)};
}
function finishPlan(plan,evidence){
 const knowledge=evidence.filter(e=>['technical_reference','technical_note'].includes(e.document_type));
 const facts=evidence.filter(e=>['project_fact','experiment','personal_experience','resume'].includes(e.document_type));
 return {...plan,knowledge_status:knowledge.length?'local_candidates':'no_direct_local_knowledge',
  knowledge_ids:knowledge.map(e=>e.evidence_id),project_fact_ids:facts.map(e=>e.evidence_id),
  fallback_allowed:!plan.strict_personal,
  fallback_note:'候选材料仍需按问题条件和能力画像逐段取舍，命中不代表正确或全部可讲。'};
}
module.exports={planQuestion,referenceMatch,finishPlan};
