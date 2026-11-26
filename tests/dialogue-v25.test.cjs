'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {resolve}=require('../cuedesk/v2/dialogue.cjs');
const {classifyTurn}=require('../cuedesk/v2/turn-policy.cjs');
const docs=['SRAG','IOD','九寨沟'].map(title=>({title,project_id:title,file_path:'项目资料/'+title+'.md'}));
const run=(question,state,extra={})=>resolve({question,sessionId:'same-session',dialogueState:state,...extra},docs,'test-root-role');

test('initial ambiguous project needs clarification and backend correction preserves scenario',()=>{
 assert.equal(run('好的。').effective_question,'好的。');
 assert(run('这个项目当时做了多久，遇到了什么困难？').clarify);
 let state=run('假设一个工具给一万人使用并迭代十个版本，你会怎么做？');
 state=run('为什么一定要用后端？这个工具完全可以做成前端插件再分发。',state);
 assert(state.turn.correction);
 assert(state.scenario.constraints.some(c=>c.kind==='backend_requirement'&&c.value==='backend_not_assumed'));
 assert(state.scenario.constraints.some(c=>c.kind==='total_users'));
});

test('mismatched persisted sessions cannot replay stale question history into a short followup',()=>{
 const prior=run('介绍SRAG项目');
 const state=resolve({question:'然后呢？',sessionId:'different',dialogueState:prior,
  dialogueQuestions:['介绍SRAG项目'],history:[{role:'user',content:'介绍SRAG项目'}]},docs,'test-root-role');
 assert.deepEqual(state.project_ids,[]);
 assert(!state.continuation);
 assert(state.clarify);
});
test('short requests, imperatives and acknowledgements are distinguished without a length cutoff',()=>{
 for(const q of ['为什么','比如呢？','然后呢？','介绍一下你的项目','具体怎么做','你做了什么？'])assert.equal(classifyTurn(q).action,'answer',q);
 for(const q of ['嗯。','对的','好的。OK。','y.'])assert.equal(classifyTurn(q).action,'ignore',q);
 assert.equal(classifyTurn('这就是实习的目的嘛，对吧？你实习就是看一下公司在做什么，OK。').action,'update');
 assert.equal(classifyTurn('这是很长的一段背景说明，其中没有实际向候选人提问，只是在介绍团队现在承担的一些工作。').action,'update');
});
test('incomplete feedback and ASR partials wait even when they contain a question word',()=>{
 assert.equal(classifyTurn('你刚才说的流程或者做法是是。').action,'wait');
 assert.equal(classifyTurn('你如何开始一个新项目？',{isFinal:false}).action,'wait');
 assert.equal(classifyTurn('你刚才说的流程和我们这里差不多。').action,'update');
 const open=classifyTurn('你是在哪里学习这些方法的，自己探索的吗？还是。');assert.equal(open.action,'answer');assert(open.open_alternative);
});
test('overlapping transcript windows are consumed once; acknowledgements do not become anchors',()=>{
 const segs=[{id:1,speaker:'them',text:'讲讲RAG项目'}];
 let a=run(segs[0].text,null,{mode:'continuous',recentTranscript:segs});
 segs.push({id:2,speaker:'them',text:'换个项目，介绍IOD'});
 a=run(segs[1].text,a,{mode:'continuous',recentTranscript:segs});
 segs.push({id:3,speaker:'them',text:'嗯。'});
 const b=run('那遇到了什么困难？',a,{mode:'continuous',recentTranscript:segs});
 assert.deepEqual(b.project_ids,['IOD']);assert(!b.anchor_question.includes('嗯'));assert(!b.effective_question.includes('RAG'));
 const c=run('嗯。',b,{mode:'continuous',recentTranscript:segs});assert.equal(c.anchor_question,b.anchor_question);
});
test('ambiguous project duration cannot bind itself to an AI-selected project',()=>{
 const a=run('你有做过什么项目，在里面是什么角色？');
 const b=run('这个项目当时做了多久，遇到了什么困难？',a,{history:[{role:'assistant',content:'我选择讲IOD'}]});
 assert.equal(b.project_ids.length,0);assert(b.clarify);
 const c=run('这个项目当时做了多久？',a,{recentTranscript:[{id:1,speaker:'me',text:'我先讲一下SRAG课程问答项目'}]});
 assert.deepEqual(c.project_ids,['SRAG']);assert(!c.clarify);assert.equal(c.focus_source,undefined);
});
test('scene conditions persist through correction and short followups without becoming real work',()=>{
 let a=run('如果拿到一个新需求，新构建一个项目，你会怎么做？');
 a=run('把这个东西给1万个人用，再迭代10个版本，怎么做？',a);
 a=run('为什么不能用前端插件分发，跑在各自的浏览器里？',a);
 a=run('如果要收费呢？',a);
 const b=run('那后端调用自己的模型账号呢？',a);
 assert(b.design);assert(!b.experience);assert.equal(b.project_ids.length,0);
 assert(b.scenario.constraints.some(c=>c.kind==='total_users'&&c.value==='1万人'));
 assert(!b.scenario.constraints.some(c=>c.kind==='concurrent_users'));
 for(const kind of ['version_iterations','execution','business_model','model_access'])assert(b.scenario.constraints.some(c=>c.kind===kind),kind);
 assert(b.scenario.constraints.every(c=>c.source==='interviewer_question'));
 const c=run('那你本人做完这套收费系统了吗？',b);assert(c.confirm_prior_design);assert(c.experience);
 const d=run('换个话题，如何用AI工具写代码？',b);assert(!d.design);assert.equal(d.scenario,null);
});
test('new unrelated scenarios discard old scale; revised constraints replace their old value',()=>{
 let a=run('假设一个插件要给200个人用，怎么设计？');
 a=run('改成500个人用呢？',a);assert.equal(a.scenario.constraints.filter(c=>c.kind==='total_users').length,1);
 assert(a.scenario.constraints.some(c=>c.value==='500人'));
 const b=run('换题，假设做一个会议室预约系统，怎么设计？',a);assert.equal(b.scenario.constraints.length,0);
});
test('correction updates the subject instead of reusing the previous algorithm subtopic',()=>{
 let a=run('RAG项目切块遇到什么困难？');
 const b=run('我不是问算法，我想问你使用AI编程工具的时候卡在哪里？',a);
 assert(b.turn.correction);assert(b.subject_question.includes('AI编程'));assert(!b.subject_question.includes('切块'));
 assert.deepEqual(b.project_ids,['SRAG']);
});
test('starting a new project creates its own scene anchor after a personal-capability discussion',()=>{
 const a=run('你最擅长的是哪个方向？');
 const question='如果拿到一个新需求，新构建一个项目，你会怎么做？';
 const b=run(question,a);assert.equal(b.anchor_question,question);assert(b.design);assert(!b.continuation);
 assert(classifyTurn('OK。OK，然后呢？').followup_only);
});
