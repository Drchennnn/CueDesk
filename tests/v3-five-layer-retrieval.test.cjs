'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInterviewLibrary } = require('../meeting-copilot/v2/library.cjs');
const { parseFrontmatter } = require('../meeting-copilot/v2/store.cjs');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function makeFixture(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-v3-layers-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const root = path.join(tmp, 'kb');
  const cfg = path.join(tmp, 'interview-library.json');

  // Layer 1: Personal truth with custom frontmatter alias (not hardcoded in dialogue.cjs!)
  writeFile(root, '简历.md', '# 简历\n\n## 教育背景\n测试大学 计算机硕士 2026.09—2027.06\n');
  writeFile(root, '项目资料/星海数据平台.md', [
    '---',
    'knowledge_kind: project_fact',
    'aliases:',
    '  - 星海平台',
    '  - StarSea',
    '---',
    '# 星海数据平台',
    '## 个人主责',
    '我负责 StarSea 的日志清洗管道与批处理校验脚本，使用 Python 处理增量文件。'
  ].join('\n'));

  // Layer 2: Interview memory (speaking_style + weakness_pitfall + pending_fact gate)
  writeFile(root, '面试记忆/表达与偏好.md', [
    '---',
    'knowledge_kind: interview_memory',
    'memory_bucket: speaking_style',
    '---',
    '# 表达偏好',
    '- 先给一句话结论，再展开细节，保持克制口吻。'
  ].join('\n'));
  writeFile(root, '面试记忆/薄弱项与踩坑.md', [
    '---',
    'knowledge_kind: interview_memory',
    'memory_bucket: weakness_pitfall',
    '---',
    '# 避坑清单',
    '- 涉及模型推理时要区分本地训练和外部 API 调用。'
  ].join('\n'));
  writeFile(root, '面试记忆/待审核新事实.md', [
    '---',
    'knowledge_kind: interview_memory',
    'memory_bucket: pending_fact',
    '---',
    '# 待审核新事实',
    '- [ ] **[pending]** 未经审核的机密假设经历 SECRET_UNAPPROVED_FACT_999'
  ].join('\n'));

  // Layer 3: Role A and Role B with role_prep & JD frontmatter
  writeFile(root, '岗位档案/公司甲-评测实习/JD.md', [
    '---',
    'company: 公司甲',
    'role: 评测实习',
    'status: preparing',
    'location: 深圳',
    'resume_ref: 简历.md',
    'priority_projects:',
    '  - StarSea',
    'rounds: []',
    '---',
    '# 公司甲 评测实习 JD',
    '负责 Agent 观测与评测流水线。'
  ].join('\n'));
  writeFile(root, '岗位档案/公司甲-评测实习/岗位准备/预测题与场景设计.md', [
    '---',
    'knowledge_kind: role_prep',
    'company: 公司甲',
    '---',
    '# 预测题',
    '## 金融评测沙箱设计',
    '如果由我设计金融评测沙箱，我会隔离生产账号，使用只读回放夹具和双阶段评分器（代码断言+语义评估）。'
  ].join('\n'));
  writeFile(root, '岗位档案/公司甲-评测实习/岗位准备/专项练习.md', [
    '---',
    'knowledge_kind: practice_drill',
    '---',
    '# 练习',
    'DRILL_ONLY_SENTINEL_777 金融评测沙箱练习草稿'
  ].join('\n'));
  writeFile(root, '岗位档案/公司甲-评测实习/面试记录/2026-11-25-一面/原始转录与AI参考.md', '# 原始转录\nARCHIVE_RAW_SENTINEL_888 金融评测沙箱');

  writeFile(root, '岗位档案/公司乙-交易测试/JD.md', [
    '---',
    'company: 公司乙',
    'role: 交易测试',
    'status: waiting',
    '---',
    '# 公司乙 JD',
    '负责交易所钱包与订单对账测试。'
  ].join('\n'));
  writeFile(root, '岗位档案/公司乙-交易测试/岗位准备/预测题与场景设计.md', [
    '---',
    'knowledge_kind: role_prep',
    'company: 公司乙',
    '---',
    '# 预测题',
    '## 钱包链上对账测试',
    'ROLE_B_ONLY_SENTINEL 如果测试充值上账，我会校对链上确认数、nonce、gas 与内部账本精度。'
  ].join('\n'));

  // Layer 4: Real-asked Q&A supplement
  writeFile(root, '通用技术知识/实战真题补充/Agent实战真题.md', [
    '---',
    'knowledge_kind: interview_asked_qa',
    'topic: Agent实战',
    '---',
    '# Agent 实战真题',
    '## Agent 的 Trace、Span 和 Evaluator 如何串联？',
    '一次完整请求记为 Trace，里面的检索、模型和工具调用记为父子 Span；Evaluator 先用代码断言校验结构，再用语义 Rubric 评分。'
  ].join('\n'));

  const lib = createInterviewLibrary({ file: cfg });
  return { lib, root, cfg };
}

test('parseFrontmatter extracts scalars and arrays cleanly', () => {
  const fm = parseFrontmatter('---\ncompany: Paradoox\nstatus: waiting\naliases:\n  - Alpha\n  - Beta\nrounds: [r1, r2]\n---\n# Title');
  assert.equal(fm.company, 'Paradoox');
  assert.equal(fm.status, 'waiting');
  assert.deepEqual(fm.aliases, ['Alpha', 'Beta']);
  assert.deepEqual(fm.rounds, ['r1', 'r2']);
});

test('V3 5-layer isolation: aliases, memory gate, role_prep scoping, asked_qa, and archive exclusion', async (t) => {
  const { lib, root } = makeFixture(t);
  await lib.save({ enabled: true, root, role: '公司甲-评测实习' });
  const pub = await lib.getPublic();

  // Check role metadata parsed from JD frontmatter
  const roleA = pub.roles_meta.find(r => r.directory === '公司甲-评测实习');
  assert.equal(roleA.company, '公司甲');
  assert.equal(roleA.status, 'preparing');
  assert.deepEqual(roleA.priority_projects, ['StarSea']);
  assert.equal(pub.layer_summary.role_prep, 1);
  assert.equal(pub.layer_summary.interview_asked_qa, 1);

  // 1. Dynamic project alias from frontmatter ("StarSea") routes to 星海数据平台
  const projMsgs = await lib.build({ question: '介绍一下 StarSea 里你负责了什么？' }, []);
  assert.equal(projMsgs.dialogueState.project_ids.length, 1);
  assert(projMsgs.evidence.some(e => e.document_type === 'project_fact' && e.may_support_personal_action === true));

  // 2. Layer 2 memory injected, pending_fact strictly blocked
  const payload = JSON.parse(projMsgs[1].content);
  assert(payload.interview_memory, 'confirmed interview memory should be injected');
  const serializedMem = JSON.stringify(payload.interview_memory);
  assert(serializedMem.includes('先给一句话结论'));
  assert(!serializedMem.includes('SECRET_UNAPPROVED_FACT_999'), 'pending_fact must NEVER leak into live prompt');

  // 3. Layer 3 role_prep hits ONLY for active role, never supports personal action, and excludes drill/archive
  const prepMsgs = await lib.build({ question: '如果让你设计金融评测沙箱，你会怎么做？' }, []);
  const prepHit = prepMsgs.evidence.find(e => e.document_type === 'role_prep');
  assert(prepHit, 'active role_prep should be retrieved for matching scenario');
  assert.equal(prepHit.may_support_personal_action, false, 'role_prep must never grant personal action authority');
  const fullText = JSON.stringify(prepMsgs);
  assert(!fullText.includes('ROLE_B_ONLY_SENTINEL'), 'other role role_prep must not leak');
  assert(!fullText.includes('DRILL_ONLY_SENTINEL_777'), 'practice_drill must not enter live retrieval');
  assert(!fullText.includes('ARCHIVE_RAW_SENTINEL_888'), 'archived interview transcript must not enter live retrieval');

  // 4. Layer 4 interview_asked_qa hits objective technical question and never supports personal action
  const askedMsgs = await lib.build({ question: 'Agent 观测里的 Trace、Span 和 Evaluator 是怎么串联起来的？' }, []);
  const askedHit = askedMsgs.evidence.find(e => e.document_type === 'interview_asked_qa');
  assert(askedHit, 'real-asked Q&A supplement should be retrieved');
  assert.equal(askedHit.may_support_personal_action, false);
});
