'use strict';
// Dialogue focus comes from questions and persisted state, never from AI answers.
const path = require('node:path');
const { classifyTurn } = require('./turn-policy.cjs');
const { generalKnowledge } = require('./query.cjs');
const PERSONAL = /做过|用过|处理过|参与过|承担过|遇到过|实习过|生产经验|真实经历|线上事故|失败.{0,6}(?:经验|经历)|实践当中.{0,8}痛点|在哪.{0,5}学习|自己探索|你.{0,12}交易|当时.{0,15}(?:交易|做了|用了)|有.{0,24}(?:经验|经历|生产实践)|讲.{0,10}(?:真实|实际).{0,12}(?:事故|经历|案例)/;
const DESIGN = /如果|假设|你会|会怎么|会如何|重新设计|怎么设计|如何设计|万人|扩展|扩成|改成|收费|迭代|给你.{0,12}(?:周|天)/;
const FOLLOW = /这里面|这部分|这一步|这套|这两个|这个|那个|它|刚才|上面|前面|当时|其中|每一版|每次|都这样|都是这样|一直这样|这么|那样|一次次|^那|^所以|继续|具体|为什么|怎么|如何|哪个模块|什么模型|什么大模型|困难|难点|失败|痛点|限制|局限|效果|指标|权重|方差|准确率|问题解决|处理的/;
const RESET = /不聊项目|不说项目|不谈项目|不聊这个|先不说|换个话题|换题|不聊了|基础知识|通用问题/;
const CONCEPTS = /spring\s*boot|websocket|python|http\/?[123]?|kafka|redis|mysql|cpu|gil|react|vue|线程|进程|异步|支付|退款|副本|灰度|多租户/ig;
function cleanQuestion(q) { return q.replace(/(?:不聊|不说|不谈)项目(?:了)?[，,。]?/g, '').trim(); }
function intent(question) {
  const q = cleanQuestion(question), labels = [];
  if (DESIGN.test(q)) labels.push('design');
  if (PERSONAL.test(q) || /负责|职责|项目|当时|困难|难点/.test(q)) labels.push('fact');
  if (/原理|区别|为什么选|参数|模型|算法|怎么实现|线程|进程|异步|HTTP|WebSocket/i.test(q)) labels.push('technical');
  if (/平时|流程|方法|排查|新项目|工具|怎么用|如何用|验证|测试|检查|回归/.test(q)) labels.push('method');
  if (/介绍自己|自我介绍/.test(q)) labels.push('intro');
  return labels.length ? labels : ['general'];
}
function catalog(documents) {
  return documents.filter(d => d.project_id).map(d => {
    const text = path.basename(d.file_path) + ' ' + d.title;
    const aliases = [...new Set([...(Array.isArray(d.aliases) ? d.aliases : []), ...(text.match(/[A-Z]{2,}|九寨沟/g) || [])])];
    if (/SRAG/.test(text)) aliases.push('RAG', '课程问答', '课程检索');
    if (/九寨沟/.test(text)) aliases.push('客流预测', '客流项目');
    if (/IOD/i.test(text)) aliases.push('IOD2', 'IOD二期', '华为', '华为校企合作', '室内外识别', '多源感知');
    return { id: d.project_id, title: d.title, aliases: [...new Set(aliases)] };
  });
}
function mentioned(q, projects) {
  return projects.filter(p => p.aliases.some(a => {
    if (a === 'RAG' && (/是什么|什么是|区别|微调|原理|定义|概念/.test(q) || generalKnowledge(q)) && !/项目|课程|你的RAG|你们的RAG/i.test(q)) return false;
    return /^[a-z]+$/i.test(a) ? new RegExp('(?:^|[^a-z])' + a + '(?![a-z])', 'i').test(q) : q.includes(a);
  })).map(p => p.id);
}
function scenarioFrame(q, prior, active, reset, ids) {
  if (!active) return null;
  const frame = !reset && prior?.scenario ? { ...prior.scenario, constraints: [...prior.scenario.constraints] } : { constraints: [], referent: ids.length ? 'named_project' : 'unspecified_product' };
  const add = (kind, value) => {
    frame.constraints = frame.constraints.filter(c => c.kind !== kind);
    frame.constraints.push({ kind, value, source: 'interviewer_question', quote: q.slice(0, 450) });
  };
  const audience = q.match(/(?:\d+(?:\.\d+)?(?:万|亿)?|[一二两三四五六七八九十百千万亿]+)(?:个)?人/);
  if (audience) add(/并发|同时/.test(q) ? 'concurrent_users' : 'total_users', audience[0].replace('个',''));
  const versions = q.match(/(?:\d+|[一二两三四五六七八九十百]+)(?:个)?版本/);
  if (versions) add('version_iterations', versions[0]);
  if (/插件|浏览器/.test(q)) add('execution', 'browser_or_plugin');
  if (/不(?:要|用|必).{0,4}后端|无需后端|纯前端|(?:为什么|为何).{0,8}(?:一定|必须).{0,4}后端|为什么不能.{0,8}(?:前端|插件)/.test(q)) add('backend_requirement', 'backend_not_assumed');
  if (/不收费|免费/.test(q)) add('business_model', 'free');
  else if (/收费|付费/.test(q)) add('business_model', 'paid_hypothesis');
  if (/调用.{0,12}(?:你的|自己(?:的)?)(?:模型)?(?:号|账号)|统一.{0,6}(?:模型|账号|密钥)|模型.{0,6}封装/.test(q)) add('model_access', 'provider_account_proxy');
  frame.unconfirmed = ['实时并发与调用频率', '是否需要共享数据或跨设备同步', '账号、数据与模型密钥由谁管理'].filter((_, i) => i !== 0 || !frame.constraints.some(c => c.kind === 'concurrent_users'));
  return frame;
}
function step(question, prior, projects) {
  const q = cleanQuestion(question), explicit = mentioned(q, projects), turn = classifyTurn(q);
  if (turn.action === 'ignore' || turn.action === 'wait') return { ...prior, turn, pending_question: turn.action === 'wait' ? q : prior?.pending_question };
  if (turn.action === 'update' && prior && !explicit.length && !DESIGN.test(q)) return { ...prior, turn };
  const concepts = [...q.matchAll(CONCEPTS)].map(m => m[0].toLowerCase());
  const anchorConcepts = String(prior?.anchor_question || '').toLowerCase();
  const explicitDesign = DESIGN.test(q)&&!/你本人|你.{0,6}已经|实际.{0,6}(?:做过|完成|做完)|你.{0,12}做完/.test(q)&&!(/呢[？?。]?$/.test(q)&&prior?.anchor_question&&!explicit.length&&!/设计|构建|改造|扩展/.test(q));
  const personal = PERSONAL.test(q) || /你本人.{0,20}(?:做完|完成|实现|上线)|你.{0,6}已经.{0,12}(?:做|完成|实现)/.test(q);
  const relative = /这里面|这部分|这一步|这套|这两个|这个|那个|它|刚才|上面|前面|当时|上题|接着|仍是|^那|^所以|继续/.test(q);
  const projectFeature = Boolean(prior?.project_ids?.length && /Wi[\s-]?Fi|\bAP\b|光照|强弱信号|信号.{0,8}数据|特征|协方差|标量/i.test(q));
  const independentKnowledge = !projectFeature && (generalKnowledge(q) || /是什么|区别|怎么选|如何选|怎样选|原理/.test(q) && !relative && !/项目|角色|职责|做过/.test(q));
  const newConcept = concepts.some(c => !anchorConcepts.includes(c));
  const newScenario = explicitDesign && !relative && !explicit.length && /假设(?:做|一个|一次)|再换题|换题|做一个/.test(q);
  const newPlan = /岗位|职位|学习计划|职业规划/.test(q) && /安排|计划|学习|交付|三周|两周/.test(q);
  const methodSwitch = /聊回|换(?:个|一个)?话题|回到/.test(q) && /(?:代码|编程|工具|开发).{0,20}(?:怎么|如何)|(?:怎么|如何).{0,20}(?:代码|编程|工具|开发)/.test(q);
  const newWork = explicitDesign && !explicit.length && /(?:新构建|构建|开始).{0,4}项目|拿到.{0,6}新需求|从零.{0,8}项目/.test(q) && !/这个项目|这个系统/.test(q);
  const reset = RESET.test(question) || independentKnowledge || newScenario || newPlan || methodSwitch || newWork || (personal && newConcept && !relative);
  let ids = explicit;
  if (!ids.length && !reset && prior?.project_ids?.length && (FOLLOW.test(q)||projectFeature||turn.correction)) ids = prior.project_ids;
  const inherited = !explicit.length && ids.length > 0;
  const genericContinuation = !ids.length && !reset && prior?.anchor_question && (relative || FOLLOW.test(q) || /(?:呢|是吧)[？?。]?$/.test(q)&&!newConcept);
  const continuing = Boolean(inherited || genericContinuation);
  const experience = personal && !explicitDesign;
  const design = explicitDesign || Boolean(continuing && prior?.design && !experience);
  const anchor = continuing && !turn.correction ? prior.anchor_question : q;
  const specific = /切块|切割|chunk|分块|重叠|父子|图片|公式|困难|难点|问题出在|视觉|读图|RRF|稀疏|Dense|Sparse|解析|索引|前端|后端|数据库|光照|Wi-Fi|平滑|F1|RMSE|权重|方差|CPU|线程|进程|异步/i.test(q);
  const topic = inherited || genericContinuation ? (specific ? q : prior.topic_question || anchor) : q;
  const substantive=/切块|切割|chunk|分块|重叠|父子|图片|公式|解析|索引|前端|后端|数据库|光照|Wi-Fi|CPU|线程|进程|异步|Redis|MySQL|Kafka|HTTP|模型|算法/i.test(q);
  const subject=continuing&&!turn.correction?(substantive?q:prior.subject_question||prior.topic_question||anchor):q;
  const effective = inherited || genericContinuation ? [...new Set([anchor, subject, topic, q])].join('\n') : q;
  const labels = intent(q).filter(label=>label!=='design'||design);
  if(continuing&&/每一版|每次|都这样|都是这样|一直这样|一次次/.test(q)&&prior?.intents?.includes('method')&&!labels.includes('method'))labels.push('method');
  if (ids.length && !labels.includes('design') && !labels.includes('fact')) labels.push('fact');
  return {
    turn, pending_question: null,
    scenario: scenarioFrame(q, prior, design, reset || !continuing, ids),
    project_reference_unresolved: !ids.length && !reset && Boolean(prior?.project_reference_unresolved || /项目/.test(q) && !design),
    subject_question:subject.slice(0,300),
    project_ids: ids, project_titles: projects.filter(p => ids.includes(p.id)).map(p => p.title),
    anchor_question: anchor.slice(0, 300), topic_question: topic.slice(0, 300), last_question: q.slice(0, 300), inherited, continuation:Boolean(inherited||genericContinuation),
    effective_question: effective, intents: labels, design, experience,
    confirm_prior_design: Boolean(prior?.design && experience && /这些|这个|完成|做完|实现|上线/.test(q)||!ids.length&&experience&&/这套|这种方案|上述|以上方案/.test(q)),
    generic: !ids.length && !experience && !labels.includes('intro') && !(/项目|职责/.test(q)),
    clarify: (!prior?.anchor_question && !explicit.length && /^(为什么|怎么做|具体怎么做|然后呢|比如呢)[？?。]?$/.test(q)) || (ids.length>1&&!explicit.length&&/它(?!们)|这个项目|那个项目/.test(q)) || (!ids.length && !design && /(?:这个|那个|该)项目/.test(q) && /多久|当时|难点|困难/.test(q))
  };
}
function resolve(input, documents, namespace) {
  const projects = catalog(documents), q = String(input.freeQuestion || input.question || '请根据当前内容回答');
  const persisted = input.dialogueState;
  const historyMatches = !persisted || persisted.namespace === namespace && persisted.session_id === input.sessionId;
  let previous = persisted && historyMatches ? persisted : null;
  const segments = (input.recentTranscript || []).map(s => typeof s === 'string' ? { text: s } : s).filter(s => s?.text);
  const key = s => JSON.stringify([s.speaker || 'them', s.id ?? null, s.startTs ?? null, s.endTs ?? null, s.text]);
  const seen = new Set(previous?.transcript_seen || []);
  if (previous) {
    previous = { ...previous, project_ids: (previous.project_ids || []).filter(id => projects.some(p => p.id === id)) };
    for (const segment of segments) {
      if (!seen.has(key(segment))) previous = consume(segment, previous);
    }
  } else {
    const questions = historyMatches ? input.dialogueQuestions || (input.history || []).filter(m => m.role === 'user').map(m => m.content) : [];
    for (const question of questions.slice(-80)) if (typeof question === 'string' && question !== q) previous = step(question, previous, projects);
    for (const segment of segments) previous = consume(segment, previous);
  }
  function consume(segment, prior) {
    if (segment.isFinal === false || segment.final === false || segment.text === q) return prior;
    // Candidate audio may establish the topic, but never certifies personal facts.
    if (segment.speaker === 'me') {
      const ids = mentioned(segment.text, projects);
      if (ids.length === 1 && !prior?.project_ids?.length) return { ...step('介绍' + projects.find(p => p.id === ids[0]).title + '项目', prior, projects), focus_source: 'candidate_transcript_topic_only' };
      return prior;
    }
    if (segment.speaker && segment.speaker !== 'them') return prior;
    return step(segment.text, prior, projects);
  }
  const turn = classifyTurn(q, input);
  const state = turn.action === 'wait' ? { ...previous, turn, pending_question: q } : step(q, previous, projects);
  return { project_ids: [], project_titles: [], intents: ['general'], effective_question: q, ...state, turn,
    transcript_seen: [...new Set([...(persisted?.namespace === namespace && persisted?.session_id === input.sessionId ? persisted.transcript_seen || [] : []), ...segments.map(key)])].slice(-100),
    namespace, session_id: input.sessionId || null };
}
module.exports = { resolve, intent, catalog, PERSONAL, cleanQuestion };
