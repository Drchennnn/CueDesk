'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { createKbWorkspace } = require('../cuedesk/tools/kb-workspace.cjs');
const { createMemoryStore } = require('../cuedesk/tools/memory-store.cjs');

test('M05: LCS lineDiff aligns top insertion, middle deletion, append, and single edit without shifting unchanged lines', async () => {
  const { computeLineDiff } = await import(
    pathToFileURL(path.resolve(__dirname, '../cuedesk/ui/src/core/lineDiff.js')).href
  );

  // 1. Top single-line insertion (exact audit repro case!)
  const orig = ['# 缓存测试', '', '| 项 | 值 |', '| --- | --- |', '| TTL | 60s |', '', '结尾说明'].join('\n');
  const insertedTop = ['新增顶部说明', ...orig.split('\n')].join('\n');
  const d1 = computeLineDiff(orig, insertedTop);
  assert.equal(d1.addedCount, 1);
  assert.equal(d1.removedCount, 0);
  assert.equal(d1.unchangedCount, orig.split('\n').length);
  assert.equal(d1.rows[0].kind, 'add');
  assert.equal(d1.rows[0].text, '新增顶部说明');
  assert.ok(d1.rows.slice(1).every(r => r.kind === 'same'));

  // 2. Middle deletion
  const lines = ['L1', 'L2', 'L3', 'L4', 'L5'];
  const d2 = computeLineDiff(lines.join('\n'), ['L1', 'L2', 'L4', 'L5'].join('\n'));
  assert.equal(d2.addedCount, 0);
  assert.equal(d2.removedCount, 1);
  assert.equal(d2.rows.find(r => r.kind === 'del').text, 'L3');

  // 3. Bottom append
  const d3 = computeLineDiff(lines.join('\n'), [...lines, 'L6'].join('\n'));
  assert.equal(d3.addedCount, 1);
  assert.equal(d3.removedCount, 0);
  assert.equal(d3.rows.at(-1).text, 'L6');

  // 4. Single-line modification
  const d4 = computeLineDiff(lines.join('\n'), ['L1', 'L2', 'L3-edited', 'L4', 'L5'].join('\n'));
  assert.equal(d4.addedCount, 1);
  assert.equal(d4.removedCount, 1);
  assert.equal(d4.unchangedCount, 4);
});

test('M03: createRolePackage writes empty priority_projects when none chosen and exact list when chosen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-m03-'));
  try {
    const kb = createKbWorkspace({ getRoot: () => root });
    const res1 = kb.createRolePackage({ company: '测试公司A', roleName: '后端实习生', priorityProjects: [] });
    const jd1 = fs.readFileSync(path.join(root, res1.jdPath), 'utf8');
    assert.match(jd1, /priority_projects:\s*\[\]/);
    assert.doesNotMatch(jd1, /SRAG|IOD/);

    const res2 = kb.createRolePackage({ company: '测试公司B', roleName: '后端实习生', priorityProjects: ['缓存测试'] });
    const jd2 = fs.readFileSync(path.join(root, res2.jdPath), 'utf8');
    assert.match(jd2, /priority_projects:\s*\n\s*-\s*缓存测试/);
    assert.doesNotMatch(jd2, /SRAG|IOD/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('M04: archiveSessionToRole checks missing rulebook, avoids dangling refs, and supports ensureReviewRulebook()', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-m04-'));
  const snapDir = path.join(root, '.snaps');
  try {
    const kb = createKbWorkspace({ getRoot: () => root });
    const mem = createMemoryStore({ getRoot: () => root, snapshotDir: snapDir });
    const role = kb.createRolePackage({ company: 'Acme', roleName: 'Backend' });
    const sampleSession = {
      id: 'sess-m04',
      name: 'Acme 一面',
      audioSource: 'system',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      segments: [{ id: 1, speaker: 'them', text: '介绍一下缓存穿透？' }],
      questions: [{ id: 'q1', prompt: '介绍一下缓存穿透？', activeAttemptId: 'a1', attempts: [{ id: 'a1', text: '布隆过滤器+缓存空值' }] }]
    };

    // 1. Clean directory without 复盘与更新规则.md
    const r1 = mem.archiveSessionToRole({ session: sampleSession, roleDirectory: role.directory, roundLabel: '一面' });
    assert.equal(r1.prerequisites.rulebookExists, false);
    assert.deepEqual(r1.prerequisites.missingFiles, ['复盘与更新规则.md']);
    assert.equal(fs.existsSync(r1.rawMdPath), true);
    assert.equal(fs.existsSync(r1.sessionJsonPath), true);
    assert.doesNotMatch(r1.agentPrompt, /复盘与更新规则\.md/, 'Fallback prompt must not cite a nonexistent rulebook file');

    // 2. Generate standard rulebook and re-archive
    const init = mem.ensureReviewRulebook();
    assert.equal(init.ok, true);
    assert.equal(init.created, true);
    assert.equal(fs.existsSync(init.rulebookPath), true);

    const r2 = mem.archiveSessionToRole({ session: sampleSession, roleDirectory: role.directory, roundLabel: '一面' });
    assert.equal(r2.prerequisites.rulebookExists, true);
    assert.deepEqual(r2.prerequisites.missingFiles, []);
    assert.match(r2.agentPrompt, /复盘与更新规则\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('M01/M20/M21: static source invariants hold across UI components', () => {
  const uiDir = path.resolve(__dirname, '../cuedesk/ui/src/components');
  const shared = fs.readFileSync(path.join(uiDir, 'SharedWidgets.jsx'), 'utf8');
  const settings = fs.readFileSync(path.join(uiDir, 'SettingsView.jsx'), 'utf8');
  const home = fs.readFileSync(path.join(uiDir, 'HomeView.jsx'), 'utf8');
  const kb = fs.readFileSync(path.join(uiDir, 'KnowledgeView.jsx'), 'utf8');

  // M01: No @mc/runtime ConnectionResult import; TEST_RESULT_COPY.success is a function; ErrorBoundary present
  assert.doesNotMatch(shared, /\bConnectionResult\b.*from\s+['"]@mc\/runtime['"]/s);
  assert.match(shared, /export class ErrorBoundary/);
  assert.match(settings, /success:\s*\(ms\)\s*=>/);

  // M21: ServiceHealthModal does not render legacy diagnostics or rerunOnboarding buttons, and KB routes to 'kb'
  assert.doesNotMatch(shared, /rerunOnboarding/);
  assert.doesNotMatch(shared, /item\.id\s*===\s*'kb'\s*\?\s*'interview'/);

  // M03: NewRoleModal does not prefill SRAG or IOD
  assert.doesNotMatch(kb, /useState\(['"]SRAG/);

  // M20: Zero native <select> elements left in component JSX (ignoring comments)
  for (const file of fs.readdirSync(uiDir).filter(f => f.endsWith('.jsx'))) {
    const content = fs.readFileSync(path.join(uiDir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(content, /<select[\s>]/, `Native <select> found in ${file}`);
  }

  // M02: WrittenCompactView never falls back to sessions[0]
  const mainJsx = fs.readFileSync(path.resolve(__dirname, '../cuedesk/ui/src/main.jsx'), 'utf8');
  assert.doesNotMatch(mainJsx, /activeSession\s*\|\|\s*sessions\[0\]/);
  assert.match(home, /onEnterWrittenCompact\(\{\s*fresh:\s*true\b/);
});
