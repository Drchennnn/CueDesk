'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const UI_JS = path.join(ROOT, 'cuedesk/ui/dist/index-hyFYaQxP.js');
const UI_CSS = path.join(ROOT, 'cuedesk/ui/dist/index-BJg-OUFD.css');
const BASELINE_ASAR = path.join(ROOT, 'releases/MeetingCopilot/app/resources/app.asar');

test('3-layer IPC contract: every window.mc call in renderer exists in preload, and every preload channel exists in main', t => {
  if (!fs.existsSync(BASELINE_ASAR)) {
    t.skip('Read-only baseline releases/MeetingCopilot/app/resources/app.asar not present');
    return;
  }
  assert.ok(fs.existsSync(UI_JS), 'compiled UI JS bundle must exist');
  assert.ok(fs.existsSync(UI_CSS), 'compiled UI CSS bundle must exist');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-contract-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const mainFile = path.join(tmp, 'main.cjs');
  const preloadFile = path.join(tmp, 'preload.cjs');

  const py = `
import importlib.util
from pathlib import Path
spec_pb = importlib.util.spec_from_file_location("pb", r"${path.join(ROOT, 'cuedesk/release/patch_baseline.py').replace(/\\/g, '\\\\')}")
pb = importlib.util.module_from_spec(spec_pb)
spec_pb.loader.exec_module(pb)
spec_asar = importlib.util.spec_from_file_location("asar_util", r"${path.join(ROOT, 'cuedesk/release/asar_util.py').replace(/\\/g, '\\\\')}")
asar_util = importlib.util.module_from_spec(spec_asar)
spec_asar.loader.exec_module(asar_util)
raw = Path(r"${BASELINE_ASAR.replace(/\\/g, '\\\\')}").read_bytes()
header, offset = asar_util.read_header(raw)
Path(r"${mainFile.replace(/\\/g, '\\\\')}").write_bytes(pb.patch_main(asar_util.read_member(raw, header, offset, "out/main/index.js")))
Path(r"${preloadFile.replace(/\\/g, '\\\\')}").write_bytes(pb.patch_preload(asar_util.read_member(raw, header, offset, "out/preload/index.js")))
`;
  cp.execFileSync('python', ['-c', py], { stdio: 'pipe' });
  cp.execFileSync('node', ['--check', mainFile], { stdio: 'pipe' });
  cp.execFileSync('node', ['--check', preloadFile], { stdio: 'pipe' });
  cp.execFileSync('node', ['--check', UI_JS], { stdio: 'pipe' });

  const uiCode = fs.readFileSync(UI_JS, 'utf8');
  const preloadCode = fs.readFileSync(preloadFile, 'utf8');
  const mainCode = fs.readFileSync(mainFile, 'utf8');

  // Extract all `window.mc.<prop>` and `window.mc?.<prop>` usages from compiled renderer
  const usedProps = new Set();
  for (const m of uiCode.matchAll(/window\.mc\??\.([a-zA-Z0-9_]+)/g)) {
    usedProps.add(m[1]);
  }
  assert.ok(usedProps.size >= 30, `expected >= 30 window.mc API usages, got ${usedProps.size}`);

  // Extract all keys exposed on `const api = { ... }` in preload
  const apiStart = preloadCode.indexOf('const api = {');
  const apiEnd = preloadCode.indexOf('electron.contextBridge.exposeInMainWorld', apiStart);
  const apiBlock = preloadCode.slice(apiStart, apiEnd);
  const exposedProps = new Set();
  for (const m of apiBlock.matchAll(/^\s+([a-zA-Z0-9_]+)\s*:/gm)) {
    exposedProps.add(m[1]);
  }

  const missingInPreload = [...usedProps].filter(prop => !exposedProps.has(prop));
  assert.deepEqual(missingInPreload, [], `Renderer calls missing in preload: ${missingInPreload.join(', ')}`);

  // Verify every literal string IPC channel invoked/sent/listened by preload exists in main or its tool modules
  const exportCode = fs.readFileSync(path.join(ROOT, 'cuedesk/interview-export.cjs'), 'utf8');
  const combinedMain = `${mainCode}\n${exportCode}`;
  const literalChannels = new Set();
  for (const m of apiBlock.matchAll(/ipcRenderer\.(?:invoke|send|on)\(\s*"([^"]+)"/g)) {
    literalChannels.add(m[1]);
  }
  const missingInMain = [...literalChannels].filter(ch => !combinedMain.includes(`"${ch}"`) && !combinedMain.includes(`'${ch}'`));
  assert.deepEqual(missingInMain, [], `Preload IPC channels missing in main: ${missingInMain.join(', ')}`);
});

test('case save-error & back-vs-finish: strict session persistence surfaces disk failure and preserves live state vs snapshot', async t => {
  const {
    createEmptySession,
    addQuestionWithAttempt,
    applyLlmEvent,
    selectQuestion,
    serializeSessionsForDisk,
    migrateSessionsFile,
    getActiveAttempt
  } = await import(pathToFileURL(path.join(ROOT, 'cuedesk/ui/src/core/sessionModel.js')).href);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-save-err-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const sessPath = path.join(tmp, 'sessions.json');

  // Replicate patched SessionStore.saveStrict semantics
  function saveStrict(targetPath, data) {
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const tmpFile = `${targetPath}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf8');
      fs.renameSync(tmpFile, targetPath);
      return { ok: true, savedAt: Date.now() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  let s = createEmptySession({ id: 'sess-1', name: '实时保存失败验证' });
  s = addQuestionWithAttempt(s, { questionId: 'q1', requestId: 'r1', prompt: '题1' });
  s = applyLlmEvent(s, {
    requestId: 'r1',
    kind: 'oral',
    oral_answer: '带引用的回答',
    evidence: [{ evidence_id: 'E1', document_title: '简历', excerpt: '真实经历' }],
    evidence_refs: ['E1']
  });
  s = applyLlmEvent(s, { requestId: 'r1', kind: 'done', text: '带引用的回答' });
  s = addQuestionWithAttempt(s, { questionId: 'q2', requestId: 'r2', prompt: '题2' });
  s = applyLlmEvent(s, { requestId: 'r2', kind: 'done', text: '题2回答' });
  s = selectQuestion(s, 'q1');

  // Simulate write failure by pointing target at an existing directory path
  const blockedPath = path.join(tmp, 'blocked-dir');
  fs.mkdirSync(blockedPath);
  const failed = saveStrict(blockedPath, serializeSessionsForDisk([s], s.id));
  assert.equal(failed.ok, false);
  assert.ok(failed.error.length > 0);
  // Session remains readable in memory
  assert.equal(s.selectedQuestionId, 'q1');

  // Recover storage and retry
  const ok = saveStrict(sessPath, serializeSessionsForDisk([s], s.id));
  assert.equal(ok.ok, true);

  // Reopen from disk preserves selected question, answers, and citations
  const reloaded = migrateSessionsFile(JSON.parse(fs.readFileSync(sessPath, 'utf8')));
  const rs = reloaded.sessions[0];
  assert.equal(rs.selectedQuestionId, 'q1');
  assert.equal(rs.questions.length, 2);
  assert.deepEqual(getActiveAttempt(rs.questions[0]).evidenceRefs, ['E1']);
  assert.equal(getActiveAttempt(rs.questions[0]).text, '带引用的回答');
});

test('blank portable-bootstrap seeds light theme while preserving existing dark theme user configs', t => {
  const bootstrap = require(path.join(ROOT, 'cuedesk/release/portable-bootstrap.cjs'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-boot-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const resourcesDir = path.join(tmp, 'app', 'resources');
  const defaultsDir = path.join(tmp, 'config', 'defaults');
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.mkdirSync(defaultsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(path.join(defaultsDir, 'settings.json'), JSON.stringify({ ui: { theme: 'light' } }));
  fs.writeFileSync(path.join(tmp, 'config', 'runtime.json'), JSON.stringify({}));

  let userDataSet = '';
  const fakeApp = {
    getPath: () => dataDir,
    setPath: (_k, v) => { userDataSet = v; }
  };

  // Fresh blank profile -> seeded with light theme
  bootstrap.prepare(fakeApp, resourcesDir);
  assert.equal(userDataSet, dataDir);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8')).ui.theme, 'light');

  // Existing user chose dark theme -> restart does NOT overwrite
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ ui: { theme: 'dark' } }));
  bootstrap.prepare(fakeApp, resourcesDir);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8')).ui.theme, 'dark');
});
