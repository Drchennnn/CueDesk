'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

const workers = new Map();
process.once('exit', () => {
  for (const worker of workers.values()) worker.child?.kill();
});

function embeddingKey(options) {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY;
  const {safeStorage} = require('electron');
  const settings = JSON.parse(fs.readFileSync(options.credential_settings, 'utf8').replace(/^\uFEFF/, ''));
  const encrypted = settings.asr?.realtime?.apiKeyEnc;
  if (!encrypted || !safeStorage.isEncryptionAvailable()) throw Error('百炼 Embedding 密钥不可用');
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

function createVectorClient() {
  async function request(options, route, body, timeout = 2500) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'http:') throw Error('向量服务必须绑定本机回环地址');
    const response = await fetch(new URL(route, endpoint), {
      method: body ? 'POST' : 'GET',
      headers: {'content-type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout)
    });
    if (!response.ok) throw Error('向量服务 HTTP ' + response.status);
    return response.json();
  }
  async function health(options) {
    const state = await request(options, '/health');
    if (state.snapshot_sha256 !== options.snapshot_sha256) throw Error('向量服务快照与当前配置不一致');
    return state;
  }
  async function start(options) {
    try { return await health(options); }
    catch (error) { if (options.auto_start === false) throw error; }
    let worker = workers.get(options.endpoint);
    if (worker?.starting) return worker.starting;
    if (worker?.retryAfter > Date.now()) throw Error('向量服务启动失败，稍后自动重试');
    worker = {child: null};
    workers.set(options.endpoint, worker);
    worker.starting = (async () => {
      const log = fs.openSync(path.join(path.dirname(options.runtime_config), 'service.log'), 'a');
      try {
        worker.child = spawn(options.python, [options.service_script, '--config', options.runtime_config, '--parent-pid', String(process.pid)], {
          windowsHide: true, stdio: ['ignore', log, log],
          env: {...process.env, DASHSCOPE_API_KEY: embeddingKey(options), PYTHONIOENCODING: 'utf-8'}
        });
        worker.child.unref();
      } finally { fs.closeSync(log); }
      let failure;
      worker.child.on('error', error => { failure = error; });
      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        if (failure || worker.child.exitCode !== null) throw failure || Error('向量服务启动时退出');
        try { return await health(options); } catch { /* Wait for the local database to load. */ }
      }
      throw Error('向量服务启动超时');
    })().catch(error => {
      worker.child?.kill();
      worker.retryAfter = Date.now() + 30000;
      throw error;
    }).finally(() => { worker.starting = null; });
    return worker.starting;
  }
  return {
    async health(options) {
      if (!options?.enabled) return {enabled: false, online: false};
      try {
        const state = await health(options);
        return {enabled: true, online: true, ...state};
      } catch (error) {
        return {enabled: true, online: false, error: error.message};
      }
    },
    async warm(options) {
      if (options?.enabled) await start(options);
    },
    async search(options, question, store, contextQuestion = '', previousAssistantDraft = '', extra = {}) {
      if (!options?.enabled || path.resolve(options.library_root) !== store.root) return {hits: [], active: false};
      try {
        await start(options);
        const response = await request(options, '/search', {question, context_question: contextQuestion,
          previous_assistant_draft: previousAssistantDraft.slice(-1400),
          skip_rewrite: Boolean(extra?.skipRewrite), limit: 8}, 9500);
        if (response.snapshot_sha256 !== options.snapshot_sha256) throw Error('检索快照不匹配');
        const docs = new Map(store.manifest.documents.filter(d => d.status === 'active').map(d => [d.document_id, d]));
        const hits = response.hits.filter(hit => {
          const doc = docs.get(hit.document_id);
          return doc?.document_type === 'technical_reference' && doc.content_hash === hit.document_hash &&
            store.index[hit.document_id]?.some(c => c.chunk_id === hit.chunk_id && c.content_hash === hit.content_hash);
        });
        if (response.hits.length && !hits.length) throw Error('向量索引内容已变更，需要同步索引');
        return {active: true, hits, model: response.model, rerank_active: response.rerank_active, query_plan: response.query_plan,
          diagnostic: response.warning, milliseconds: response.milliseconds};
      } catch (error) {
        return {active: false, hits: [], diagnostic: '向量检索暂不可用，使用本地关键词检索：' + error.message};
      }
    }
  };
}

module.exports = {createVectorClient};
