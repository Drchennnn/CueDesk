'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const mr = require('../meeting-copilot/tools/model-reasoning.cjs');
const { createRouter } = require('../meeting-copilot/multimodal-router.cjs');

test('model-reasoning builds safe reasoning_effort fields and maps DashScope hosts cleanly', () => {
  assert.equal(mr.normalizeReasoningEffort(''), 'default');
  assert.equal(mr.normalizeReasoningEffort('HIGH'), 'high');
  assert.equal(mr.normalizeReasoningEffort('bogus'), 'default');

  // Default sends ZERO extra fields (100% compatible with non-reasoning models)
  assert.deepEqual(mr.buildReasoningBodyFields('default', { baseUrl: 'https://api.example.com/v1', model: 'gpt-4o' }), {});

  // Standard OpenAI / Codex / Gemini / One-API / New-API endpoints send reasoning_effort
  assert.deepEqual(
    mr.buildReasoningBodyFields('none', { baseUrl: 'https://beefapi.com/v1', model: 'gpt-6-sol' }),
    { reasoning_effort: 'none' }
  );
  assert.deepEqual(
    mr.buildReasoningBodyFields('high', { baseUrl: 'https://beefapi.com/v1', model: 'gpt-6.1-sol' }),
    { reasoning_effort: 'high' }
  );
  assert.deepEqual(
    mr.buildReasoningBodyFields('xhigh', { baseUrl: 'https://openrouter.ai/api/v1', model: 'o3' }),
    { reasoning_effort: 'xhigh' }
  );

  // Alibaba DashScope maps to enable_thinking + thinking_budget
  assert.deepEqual(
    mr.buildReasoningBodyFields('none', { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-plus' }),
    { enable_thinking: false }
  );
  assert.deepEqual(
    mr.buildReasoningBodyFields('low', { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-plus' }),
    { enable_thinking: true, thinking_budget: 2048 }
  );

  // Temperature omission only for active reasoning on OpenAI o-series / gpt-5 / gpt-6 models
  assert.equal(mr.shouldOmitTemperature('default', { model: 'gpt-5' }), false);
  assert.equal(mr.shouldOmitTemperature('none', { model: 'gpt-6-sol' }), false);
  assert.equal(mr.shouldOmitTemperature('high', { model: 'o3-mini' }), true);
  assert.equal(mr.shouldOmitTemperature('medium', { model: 'gpt-6.1-sol' }), true);
  assert.equal(mr.shouldOmitTemperature('high', { model: 'deepseek-chat' }), false);
});

test('fetchModelList fetches, normalizes, deduplicates, and falls back /models -> /v1/models', async t => {
  const seenAuth = [];
  const server = http.createServer((req, res) => {
    seenAuth.push(req.headers.authorization || '');
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'gpt-6.1-sol' },
          { id: 'models/gemini-2.5-pro' },
          { id: 'gpt-6.1-sol' },
          { id: 'claude-sonnet-4' }
        ]
      }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();

  // Direct /v1 base URL
  const res1 = await mr.fetchModelList({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-test-models' });
  assert.equal(res1.ok, true);
  assert.deepEqual(res1.models, ['claude-sonnet-4', 'gemini-2.5-pro', 'gpt-6.1-sol']);
  assert.equal(seenAuth[0], 'Bearer sk-test-models');

  // Bare host without /v1 -> auto-falls back from /models (404) to /v1/models (200)
  const res2 = await mr.fetchModelList({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'sk-test-models' });
  assert.equal(res2.ok, true);
  assert.equal(res2.models.length, 3);

  // Rejects missing URL
  await assert.rejects(() => mr.fetchModelList({ baseUrl: '' }), /Base URL/);
});

test('multimodal-router persists per-endpoint reasoningEffort and exposes getEndpointApiKey', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mm-reasoning-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const promptsDir = path.join(dir, 'defaults');
  fs.mkdirSync(promptsDir, { recursive: true });
  for (const name of ['common.md', 'written.md', 'interview.md', 'auto.md', 'original-vision.md']) {
    fs.writeFileSync(path.join(promptsDir, name), `# ${name}\n默认`);
  }
  const fakeSafe = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => b.toString('utf8')
  };
  const router = createRouter({
    directory: path.join(dir, 'mm'),
    defaultsDirectory: promptsDir,
    safeStorage: fakeSafe,
    transport: async () => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) })
  });
  router.initialize();
  const saved = router.applyPatch({
    enabled: true,
    mode: 'written',
    endpoints: [
      { id: 'v1', name: '视觉快', enabled: true, baseUrl: 'https://beefapi.com/v1', model: 'gpt-6-sol', reasoningEffort: 'low', apiKey: 'sk-secret-1' },
      { id: 'v2', name: '视觉深', enabled: true, baseUrl: 'https://beefapi.com/v1', model: 'gpt-6.1-sol', reasoningEffort: 'high', apiKey: 'sk-secret-2' }
    ]
  });
  assert.equal(saved.endpoints[0].reasoningEffort, 'low');
  assert.equal(saved.endpoints[1].reasoningEffort, 'high');
  assert.equal(router.getEndpointApiKey('v1'), 'sk-secret-1');
  assert.equal(router.getEndpointApiKey('v2'), 'sk-secret-2');
  assert.equal(router.getEndpointApiKey('missing'), '');
});

test('settingsPatch diffs llm.reasoningEffort and SettingsView has zero vendor presets', async () => {
  const mod = await import(pathToFileURL(path.resolve(__dirname, '../meeting-copilot/ui/src/core/settingsPatch.js')).href);
  const base = {
    baseUrl: 'https://beefapi.com/v1',
    model: 'gpt-6.1-sol',
    reasoningEffort: 'default',
    answerLang: 'chinese',
    llmProviderId: 'custom'
  };
  const patch = mod.buildSettingsDiffPatch(base, { ...base, reasoningEffort: 'medium' }, { includeSections: ['llm'] });
  assert.deepEqual(patch, { llm: { reasoningEffort: 'medium' } });

  const settingsSrc = fs.readFileSync(path.resolve(__dirname, '../meeting-copilot/ui/src/components/SettingsView.jsx'), 'utf8');
  assert.equal(settingsSrc.includes('服务商预设'), false, 'SettingsView must not show hardcoded vendor presets');
  assert.equal(settingsSrc.includes('renderProviderSelect'), false, 'renderProviderSelect must be removed');
  assert.ok(settingsSrc.includes('获取模型列表'), 'SettingsView must expose dynamic model list fetcher');
  assert.ok(settingsSrc.includes('思考等级'), 'SettingsView must expose reasoningEffort selector');
});
