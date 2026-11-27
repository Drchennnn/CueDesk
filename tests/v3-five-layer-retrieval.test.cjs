'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInterviewLibrary } = require('../cuedesk/v2/library.cjs');
const { parseFrontmatter } = require('../cuedesk/v2/store.cjs');

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

test('Layer 2 memory reserves fair per-bucket shares, prioritizes query-relevant pitfalls, and filters company_insight by role', async (t) => {
  const { lib, root } = makeFixture(t);
  writeFile(root, '面试记忆/表达与偏好.md', [
    '---',
    'knowledge_kind: interview_memory',
    'memory_bucket: speaking_style',
    '---',
    '# 表达偏好',
    '- ' + '风格规则一：先给一句话结论，再展开做法和例子。'.repeat(12),
    '- ' + '风格规则二：篇幅克制，不要背诵模板术语。'.repeat(12)
  ].join('\n'));
  writeFile(root, '面试记忆/薄弱项与踩坑.md', [
    '---',
    'knowledge_kind: interview_memory',
    'memory_bucket: weakness_pitfall',
    '---',
    '# 避坑清单',
    '- [避坑A] 普通占位避坑项，用于测试靠前条目不会挤掉命中当前问题的关键避坑项。' + '补充说明。'.repeat(25),
    '- [避坑B] 另一条无关占位避坑项，测试排序优先级。' + '补充说明。'.repeat(25),
    '- [纠偏 · 九寨沟回归预测] 切勿说成二分类，应说明未来三天客流回归预测加旺淡季阈值预警。'
  ].join('\n'));
  writeFile(root, '面试记忆/公司与岗位洞察.md', [
    '---',
    'knowledge_kind: interview_memory',
    'memory_bucket: company_insight',
    '---',
    '# 公司洞察',
    '- **公司甲**：重点考察 Agent Trace 与 Evaluator 基础设施。',
    '- **公司乙**：重点考察链上钱包对账与幂等。'
  ].join('\n'));

  await lib.save({ enabled: true, root, role: '公司甲-评测实习' });
  // Tight 700-char budget: speaking_style alone exceeds 700 chars, yet pitfalls + matched company insight must still appear
  const msgs = await lib.build({ question: '九寨沟客流预测是不是二分类模型？', memoryMaxChars: 700 }, []);
  const mem = JSON.parse(msgs[1].content).interview_memory;
  assert(mem, 'memory context must be present');
  const buckets = Object.fromEntries(mem.sections.map(s => [s.bucket, s.items.join('\n')]));
  assert(buckets.speaking_style, 'speaking_style should receive guaranteed share');
  assert(buckets.weakness_pitfall && buckets.weakness_pitfall.includes('九寨沟回归预测'), 'query-relevant pitfall must be prioritized and preserved');
  assert(buckets.company_insight && buckets.company_insight.includes('公司甲'), 'matched company insight must not be starved');
  assert(!buckets.company_insight.includes('公司乙'), 'unrelated company insight must be excluded when role is selected');
});

test('Skill-anchored resume follow-up retrieves matching project_fact evidence without naming a project', async (t) => {
  const { lib, root } = makeFixture(t);
  writeFile(root, '项目资料/星海数据平台.md', [
    '---',
    'knowledge_kind: project_fact',
    'aliases:',
    '  - StarSea',
    '---',
    '# 星海数据平台（个人主责）',
    '## SQLite 存储与表设计',
    '使用 SQLite 存储 `ingestion_jobs` 与 `audit_logs` 两张表，记录文件哈希和幂等状态。'
  ].join('\n'));
  await lib.save({ enabled: true, root, role: '公司甲-评测实习' });
  const msgs = await lib.build({ question: '你简历上写了 SQLite，能讲讲你在项目里用 SQLite 存了什么表吗？' }, []);
  assert(!msgs.blockedUnknown, 'skill-anchored resume query must not block when project evidence exists');
  const hit = msgs.evidence.find(e => e.document_type === 'project_fact' && e.excerpt.includes('ingestion_jobs'));
  assert(hit, 'matching project_fact chunk must be retrieved for skill-anchored resume follow-up');
  assert.equal(hit.may_support_personal_action, true);
});

test('English answerLang recalls English intro scripts, forces English system output, and keeps evidence streaming clean', async (t) => {
  const { parseAnswer, createAnswerStream } = require('../cuedesk/v2/evidence.cjs');
  const { classifyTurn } = require('../cuedesk/v2/turn-policy.cjs');
  const { lib, root } = makeFixture(t);
  writeFile(root, '通用问答/自我介绍.md', [
    '---',
    '类型: AI参考回答',
    '---',
    '# 自我介绍',
    '',
    '## 约30秒',
    '我是中文30秒版本。',
    '',
    '## 约2分钟',
    '我是中文2分钟版本。',
    '',
    '## English introduction — about 30 seconds',
    'Hi, I am the 30-second English intro.',
    '',
    '## English introduction — about 1 minute',
    'Hi, I am the 1-minute English intro.',
    '',
    '## English introduction — about 2 minutes',
    'Hi, I am the 2-minute English intro.'
  ].join('\n'));
  await lib.save({ enabled: true, root, role: '公司甲-评测实习' });
  const pub = await lib.getPublic();
  const introDoc = pub.documents.find(d => d.file_path === '通用问答/自我介绍.md');
  await lib.save({
    enabled: true,
    root,
    role: '公司甲-评测实习',
    intro_script: { enabled: true, document_id: introDoc.document_id, heading: '约2分钟' }
  });

  // 1. Live voice turn-policy accepts English intro/request statements without '?'
  assert.equal(classifyTurn('Please introduce yourself.').action, 'answer');
  assert.equal(classifyTurn('Tell me about your StarSea project.').action, 'answer');

  // 2. English self-intro queries recall matching English script sections (default 2m, 1m, 30s)
  const en2m = await lib.build({ freeQuestion: 'please introduce yourself', answerLang: 'english' }, []);
  assert(en2m.dialogueState.intents.includes('intro'));
  assert.equal(parseAnswer(en2m.directAnswer, en2m.evidence, true, en2m.answerPolicy).oral_answer, 'Hi, I am the 2-minute English intro.');
  assert.equal(en2m.answerPolicy.lang, 'english');

  const en1m = await lib.build({ freeQuestion: 'tell me about yourself in 1 minute', answerLang: 'english' }, []);
  assert.equal(parseAnswer(en1m.directAnswer, en1m.evidence, true, en1m.answerPolicy).oral_answer, 'Hi, I am the 1-minute English intro.');

  const en30s = await lib.build({ freeQuestion: '30 second intro please', answerLang: 'english' }, []);
  assert.equal(parseAnswer(en30s.directAnswer, en30s.evidence, true, en30s.answerPolicy).oral_answer, 'Hi, I am the 30-second English intro.');

  // Even a Chinese prompt respects the EN toggle
  const zhAskEnToggle = await lib.build({ freeQuestion: '自我介绍', answerLang: 'english' }, []);
  assert.equal(parseAnswer(zhAskEnToggle.directAnswer, zhAskEnToggle.evidence, true, zhAskEnToggle.answerPolicy).oral_answer, 'Hi, I am the 2-minute English intro.');

  // Chinese mode still recalls Chinese 2-minute script cleanly
  const zh2m = await lib.build({ freeQuestion: '自我介绍', answerLang: 'chinese' }, []);
  assert.equal(parseAnswer(zh2m.directAnswer, zh2m.evidence, true, zh2m.answerPolicy).oral_answer, '我是中文2分钟版本。');

  // 3. Non-intro LLM prompt enforces English output and does NOT leave Chinese-only opening
  const enProj = await lib.build({ freeQuestion: 'Tell me about StarSea', answerLang: 'english' }, []);
  assert(enProj[0].content.includes('[OUTPUT LANGUAGE: ENGLISH]'));
  assert(!enProj[0].content.includes('你生成候选人当场能说出的中文回答'));
  assert.equal(enProj.answerPolicy.lang, 'english');
  assert.equal(JSON.parse(enProj[1].content).output_language, 'English');

  // 4. English streaming evidence parser emits smoothly without Chinese injection
  const frames = [];
  const stream = createAnswerStream([{ evidence_id: 'E1' }], r => frames.push(r.oral_answer), { lang: 'english', projectReference: true });
  stream.push('I checked trial 27 in StarSea. [[E1]] ');
  assert(frames.at(-1).includes('trial 27'), 'English sentence should stream before final without Chinese replacement');
  assert(!frames.at(-1).includes('第27次试验'));
  const fin = stream.finish();
  assert.equal(fin.oral_answer.trim(), 'I checked trial 27 in StarSea.');
  const sug = parseAnswer('Check the logs first.', [], true, { lang: 'english', suggestionOnly: true, absenceUnknown: true });
  assert(sug.oral_answer.startsWith('In general, '));
  assert(!sug.oral_answer.includes('如果只谈一般思路'));
});

test('SQL identifier preservation, topic reset, per-session introDocumentId, availability, batch pending & screenshot archive', async (t) => {
  const { parseAnswer } = require('../cuedesk/v2/evidence.cjs');
  const { createMemoryStore } = require('../cuedesk/tools/memory-store.cjs');
  const { lib, root } = makeFixture(t);

  // 1. SQL identifiers preserved when preserveIdentifiers=true (screenshot/SQL queries)
  const sqlRes = parseAnswer("改写成 created_at >= '2025-01-01' 且 created_at < '2025-01-02'。", [], true, { preserveIdentifiers: true });
  assert(sqlRes.oral_answer.includes('created_at'), 'SQL column names must not be replaced with 这个字段');
  assert(!sqlRes.oral_answer.includes('这个字段'));

  // 2. Per-session introDocumentId override + candidate_profile.identity.availability + topic reset
  writeFile(root, '通用问答/自我介绍.md', '# 通用自我介绍\n\n## 约2分钟\n我是通用两分钟稿。\n');
  writeFile(root, '岗位档案/公司甲-评测实习/岗位准备/英文自我介绍与常见问答.md', '# 岗位专属自我介绍\n\n## 约1分钟中文介绍\n我是公司甲专属中文介绍。\n\n## 约1分钟英文介绍\nI am the Role A English intro.\n');
  writeFile(root, '候选人画像.md', [
    '---',
    'knowledge_kind: candidate_profile',
    '---',
    '# 候选人画像',
    '```json',
    JSON.stringify({
      schema: 1,
      confirmed_at: '2026-11-27',
      identity: { name: '甲', education: '硕士', positioning: 'AI候选人', availability: '最早2026-12-21到岗，每周5天，可实习6个月' },
      skills: [{ area: 'MySQL/PostgreSQL', level: 'conceptual_no_practice', scope: 'MySQL仅课程实践' }]
    }),
    '```'
  ].join('\n'));
  await lib.save({ enabled: true, root, role: '公司甲-评测实习' });
  const pub = await lib.getPublic();
  const genericIntro = pub.documents.find(d => d.file_path === '通用问答/自我介绍.md');
  const roleIntro = pub.documents.find(d => d.file_path.includes('英文自我介绍与常见问答.md'));
  const personaDoc = pub.documents.find(d => d.document_type === 'candidate_profile');
  await lib.save({
    enabled: true,
    root,
    role: '公司甲-评测实习',
    persona_profile: { enabled: true, document_id: personaDoc.document_id },
    intro_script: { enabled: true, document_id: genericIntro.document_id, heading: '约2分钟' }
  });

  // Default uses generic intro; per-session override uses role-specific intro (both ZH and EN)
  const defIntro = await lib.build({ freeQuestion: '自我介绍' }, []);
  assert(defIntro.directAnswer.includes('我是通用两分钟稿'));
  const customZh = await lib.build({ freeQuestion: '自我介绍', libraryOverride: { introDocumentId: roleIntro.document_id } }, []);
  assert(customZh.directAnswer.includes('我是公司甲专属中文介绍'));
  const customEn = await lib.build({ freeQuestion: 'please introduce yourself', answerLang: 'english', libraryOverride: { introDocumentId: roleIntro.document_id } }, []);
  assert(customEn.directAnswer.includes('I am the Role A English intro.'));

  // Availability passed through candidate_profile & supportsAbility
  const availMsgs = await lib.build({ freeQuestion: '你最早什么时候能到岗，一周能来几天？' }, []);
  const availPayload = JSON.parse(availMsgs[1].content);
  assert.equal(availPayload.candidate_profile.identity.availability, '最早2026-12-21到岗，每周5天，可实习6个月');
  assert.equal(availPayload.profile_supports_ability, true);

  // New-question reset clears stale project topic
  const t1 = await lib.build({ sessionId: 's1', freeQuestion: '介绍一下 StarSea' }, []);
  assert.equal(t1.dialogueState.project_ids.length, 1);
  const t2 = await lib.build({ sessionId: 's1', freeQuestion: '有一个需求需要你去测试，你会从哪些方面测？', dialogueState: t1.dialogueState }, []);
  assert.equal(t2.dialogueState.project_ids.length, 0, 'explicit new requirement cue must clear prior project focus');

  // 3. Batch pending resolution creates 1 snapshot + archive saves screenshots to disk
  writeFile(root, '面试记忆/待审核新事实.md', [
    '---',
    'knowledge_kind: interview_memory',
    'memory_bucket: pending_fact',
    '---',
    '# 待审核新事实',
    '- [ ] **[pending]** 条目一待驳回',
    '- [ ] **[pending]** 条目二转入避坑'
  ].join('\n'));
  const snapDir = path.join(path.dirname(root), 'snaps');
  const ms = createMemoryStore({ getRoot: () => root, snapshotDir: snapDir });
  const initSt = ms.getState();
  const pending = initSt.buckets.find(b => b.id === 'pending_fact').items.filter(i => i.pending);
  assert.equal(pending.length, 2);
  const afterBatch = ms.resolvePendingBatch({
    actions: [
      { lineIndex: pending[0].lineIndex, decision: 'reject' },
      { lineIndex: pending[1].lineIndex, decision: 'approve', targetBucket: 'weakness_pitfall', note: '仅基础场景' }
    ]
  });
  assert.equal(afterBatch.latestVersion, initSt.latestVersion + 1, 'batch resolve must create exactly 1 snapshot');
  assert.equal(afterBatch.pendingCount, 0);
  const pitfall = afterBatch.buckets.find(b => b.id === 'weakness_pitfall').content;
  assert(pitfall.includes('条目二转入避坑（本人补充：仅基础场景）'));

  // Screenshot archive writes PNG & embeds markdown link
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const arch = ms.archiveSessionToRole({
    roleDirectory: '公司甲-评测实习',
    roundLabel: '一面',
    session: {
      id: 'sess-shot-1',
      name: '截图归档测试',
      audioSource: 'system',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      segments: [],
      questions: [{
        id: 'q1',
        prompt: '截图提问',
        activeAttemptId: 'a1',
        attempts: [{ id: 'a1', text: '测试回答', images: [tinyPng] }]
      }]
    }
  });
  const shotFile = path.join(arch.archiveDir, 'screenshots', 'Q01-1.png');
  assert(fs.existsSync(shotFile), 'archived screenshot PNG must exist');
  const rawMd = fs.readFileSync(arch.rawMdPath, 'utf8');
  assert(rawMd.includes('![Q01 截图 1](screenshots/Q01-1.png)'));
});
