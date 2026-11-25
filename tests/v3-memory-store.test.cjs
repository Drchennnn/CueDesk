'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMemoryStore } = require('../meeting-copilot/tools/memory-store.cjs');

test('memory-store auto-snapshots external agent edits, supports diff, pending-fact approval, rollback, and session archiving', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mem-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const kbRoot = path.join(tmp, 'kb');
  const snapDir = path.join(tmp, 'snapshots');
  fs.mkdirSync(path.join(kbRoot, '岗位档案', '测试公司-全栈实习'), { recursive: true });
  fs.writeFileSync(path.join(kbRoot, '岗位档案', '测试公司-全栈实习', 'JD.md'), '---\ncompany: 测试公司\nstatus: preparing\nrounds: []\n---\n# JD\n', 'utf8');

  const store = createMemoryStore({ getRoot: () => kbRoot, snapshotDir: snapDir });

  // 1. Initial load creates 4 bucket files and baseline snapshot v1
  const s1 = store.getState();
  assert.equal(s1.latestVersion, 1);
  assert.equal(s1.buckets.length, 4);
  assert.equal(s1.pendingCount, 0);

  // 2. Simulate external Codex/Antigravity edit adding a pending fact
  const pendingPath = path.join(kbRoot, '面试记忆', '待审核新事实.md');
  fs.appendFileSync(pendingPath, '\n- [ ] **[pending]** SRAG 切块策略已补充按页眉分块测试\n', 'utf8');

  const s2 = store.getState();
  assert.equal(s2.latestVersion, 2);
  assert.equal(s2.pendingCount, 1);
  assert.equal(s2.snapshots[0].source, 'external-agent');

  const diff2 = store.getSnapshotDiff(2);
  assert(diff2.changedBuckets.includes('pending_fact'));

  // 3. Approve pending fact -> moves into weakness_pitfall and creates v3
  const pendingItem = s2.buckets.find(b => b.id === 'pending_fact').items.find(i => i.pending);
  assert(pendingItem);
  const s3 = store.resolvePendingFact({ lineIndex: pendingItem.lineIndex, decision: 'approve', targetBucket: 'weakness_pitfall' });
  assert.equal(s3.latestVersion, 3);
  assert.equal(s3.pendingCount, 0);
  const weakness = s3.buckets.find(b => b.id === 'weakness_pitfall').content;
  assert(weakness.includes('SRAG 切块策略已补充按页眉分块测试'));

  // 4. Rollback to v1 restores clean baseline and records v4
  const s4 = store.rollbackSnapshot(1);
  assert.equal(s4.latestVersion, 4);
  assert(!s4.buckets.find(b => b.id === 'weakness_pitfall').content.includes('SRAG 切块策略已补充'));

  // 5. Archive session to role folder (with WAV pointer, zero WAV copied)
  const arch = store.archiveSessionToRole({
    session: {
      id: 'sess_1',
      name: '测试一面',
      role: '测试公司-全栈实习',
      audioSource: 'system',
      createdAt: Date.now(),
      segments: [{ speaker: 'them', text: '介绍一下 RAG 检索链路', endTs: Date.now() }],
      questions: [{ prompt: '介绍一下 RAG 检索链路', attempts: [{ id: 'a1', text: '参考回答文本' }], activeAttemptId: 'a1' }]
    },
    roleDirectory: '测试公司-全栈实习',
    roundLabel: '一面',
    userFeeling: '前面有点快，后面聊顺了',
    audioTakes: [{ takeId: 'take-1', durationSec: 120, tracks: [{ channel: 'them', path: 'C:/tmp/them.wav', bytes: 3840044, durationSec: 120 }] }]
  });
  assert.equal(arch.ok, true);
  assert(fs.existsSync(arch.rawMdPath));
  assert(fs.existsSync(arch.sessionJsonPath));
  assert(fs.existsSync(arch.reflectionPath));
  assert.equal(arch.prerequisites.rulebookExists, false);
  assert(!arch.agentPrompt.includes('复盘与更新规则.md'));
  assert(arch.agentPrompt.includes('前面有点快'));

  // 6. Generating standard rulebook makes subsequent archive prompts cite it
  const initRule = store.ensureReviewRulebook();
  assert.equal(initRule.ok, true);
  const archWithRule = store.archiveSessionToRole({
    session: {
      id: 'sess_1',
      name: '测试一面',
      role: '测试公司-全栈实习',
      audioSource: 'system',
      createdAt: Date.now(),
      segments: [],
      questions: []
    },
    roleDirectory: '测试公司-全栈实习',
    roundLabel: '一面',
    userFeeling: '前面有点快，后面聊顺了'
  });
  assert.equal(archWithRule.prerequisites.rulebookExists, true);
  assert(archWithRule.agentPrompt.includes('复盘与更新规则.md'));
  // Verify NO wav files were copied inside kbRoot
  const archivedFiles = fs.readdirSync(arch.archiveDir);
  assert(!archivedFiles.some(f => f.endsWith('.wav')));
});
