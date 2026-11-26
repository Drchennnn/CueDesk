'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createKbWorkspace } = require('../cuedesk/tools/kb-workspace.cjs');
const { parseFrontmatter } = require('../cuedesk/v2/store.cjs');

test('kb-workspace creates standardized role package, updates status, protects Qdrant source, and edits persona', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-kb-ws-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  let trashedPath = null;
  const ws = createKbWorkspace({
    getRoot: () => tmp,
    trashItem: async (p) => { trashedPath = p; fs.rmSync(p, { force: true }); }
  });

  // 1. Create standard role package (auto-strips status suffix)
  const created = ws.createRolePackage({
    company: '星辰科技',
    roleName: 'AI应用实习生（未面试）',
    location: '深圳',
    resumeRef: '简历.md',
    priorityProjects: ['SRAG', 'IOD'],
    jdText: '负责构建企业级 Agent 评测工具。'
  });
  assert.equal(created.directory, '星辰科技-AI应用实习生');
  assert(fs.existsSync(path.join(tmp, created.jdPath)));
  assert(fs.existsSync(path.join(tmp, created.prepPath)));

  const jdFm = parseFrontmatter(fs.readFileSync(path.join(tmp, created.jdPath), 'utf8'));
  assert.equal(jdFm.status, 'preparing');
  assert.deepEqual(jdFm.priority_projects, ['SRAG', 'IOD']);

  const prepFm = parseFrontmatter(fs.readFileSync(path.join(tmp, created.prepPath), 'utf8'));
  assert.equal(prepFm.knowledge_kind, 'role_prep');

  // 2. Update status and append round without changing directory name
  ws.updateRoleStatus({ directory: '星辰科技-AI应用实习生', status: 'waiting', roundLabel: '2026-11-26-一面' });
  const jdFm2 = parseFrontmatter(fs.readFileSync(path.join(tmp, created.jdPath), 'utf8'));
  assert.equal(jdFm2.status, 'waiting');
  assert.deepEqual(jdFm2.rounds, ['2026-11-26-一面']);

  // 3. Protected Qdrant directory cannot be edited or trashed
  assert.throws(
    () => ws.writeDocument({ filePath: '通用技术知识/_backup面试问答整理/接入预览/问答/a.md', content: 'hack' }),
    /只读真源/
  );
  await assert.rejects(
    () => ws.trashDocument({ filePath: '候选人画像.md' }),
    /受保护/
  );

  // 4. Persona visual save preserves schema=1 and candidate_profile frontmatter
  ws.savePersona({
    profile: {
      confirmed_at: '2026-11-25',
      candidate: { name: '测试候选人', degree: '硕士在读' },
      skills: [{ area: 'RAG', level: 'guided', note: '熟悉切块与混合检索' }]
    }
  });
  const p = ws.readPersona();
  assert.equal(p.exists, true);
  assert.equal(p.profile.schema, 1);
  assert.equal(p.profile.skills[0].area, 'RAG');

  // 5. Write & trash regular note
  ws.writeDocument({ filePath: '项目资料/临时笔记.md', content: '# 临时\nhello' });
  await ws.trashDocument({ filePath: '项目资料/临时笔记.md' });
  assert(trashedPath && trashedPath.endsWith('临时笔记.md'));
});
