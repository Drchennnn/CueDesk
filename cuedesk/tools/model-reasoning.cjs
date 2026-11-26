'use strict';
const crypto = require('node:crypto');

const REASONING_EFFORT_LEVELS = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

const DASHSCOPE_BUDGETS = {
  minimal: 512,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768
};

function normalizeReasoningEffort(value) {
  const raw = String(value || '').trim().toLowerCase();
  return REASONING_EFFORT_LEVELS.includes(raw) ? raw : 'default';
}

function isDashScopeHost(baseUrl) {
  try {
    const host = new URL(String(baseUrl || '')).hostname.toLowerCase();
    return host === 'dashscope.aliyuncs.com' ||
      host === 'dashscope-intl.aliyuncs.com' ||
      host.endsWith('.maas.aliyuncs.com');
  } catch {
    return false;
  }
}

/**
 * Build OpenAI-compatible reasoning parameters for /chat/completions.
 * - 'default': returns {} (zero extra fields — safe for every non-reasoning model & relay).
 * - DashScope compatible-mode hosts: maps to { enable_thinking, thinking_budget }.
 * - All standard OpenAI / Codex / Gemini OpenAI-compat / OpenRouter / New-API / One-API endpoints:
 *   sends standard { reasoning_effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' }.
 */
function buildReasoningBodyFields(reasoningEffort, { baseUrl = '', model = '' } = {}) {
  const level = normalizeReasoningEffort(reasoningEffort);
  if (level === 'default') return {};

  if (isDashScopeHost(baseUrl)) {
    if (level === 'none') {
      return { enable_thinking: false };
    }
    return {
      enable_thinking: true,
      thinking_budget: DASHSCOPE_BUDGETS[level] || 8192
    };
  }

  // Standard OpenAI-compatible reasoning_effort
  return { reasoning_effort: level };
}

/**
 * OpenAI o-series and GPT-5/6 reasoning models often reject non-default temperature
 * when reasoning_effort is actively enabled. Omit temperature for those requests.
 */
function shouldOmitTemperature(reasoningEffort, { model = '' } = {}) {
  const level = normalizeReasoningEffort(reasoningEffort);
  if (level === 'default' || level === 'none') return false;
  const m = String(model || '').trim().toLowerCase();
  return /^(?:o[134](?:[-.]|$)|gpt-[56](?:[-.]|$))/i.test(m);
}

function cleanBaseUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) throw new Error('请先填写 Base URL');
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error('Base URL 格式无效，请填写以 http:// 或 https:// 开头的地址');
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) {
    throw new Error('Base URL 仅支持不含账号密码的 HTTP(S) 地址');
  }
  return s
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/models$/i, '');
}

function candidateModelsUrls(rawUrl) {
  const base = cleanBaseUrl(rawUrl);
  const list = [`${base}/models`];
  if (!/\/v\d+(?:alpha|beta)?$/i.test(base)) {
    list.push(`${base}/v1/models`);
  }
  return list;
}

function parseModelsPayload(rawBody) {
  let json;
  try {
    json = JSON.parse(String(rawBody || ''));
  } catch {
    throw new Error('接口返回的模型列表不是有效的 JSON');
  }
  const items = Array.isArray(json)
    ? json
    : Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
        ? json.models
        : null;
  if (!items) {
    const msg = json?.error?.message || json?.message;
    throw new Error(msg ? `接口返回异常：${String(msg).slice(0, 160)}` : '响应中未找到模型列表字段（data / models）');
  }
  const seen = new Set();
  const ids = [];
  for (const item of items) {
    const rawId = typeof item === 'string'
      ? item
      : (item?.id || item?.name || item?.model || '');
    const id = String(rawId || '').trim().replace(/^models\//, '');
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  ids.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return ids;
}

const proxySessions = new Map();

async function httpGetJson({ url, apiKey, proxyUrl, electron, fetchImpl, timeoutMs = 15000 }) {
  if (electron?.net && electron?.session) {
    let session = electron.session.defaultSession;
    const cleanProxy = String(proxyUrl || '').trim();
    if (cleanProxy) {
      if (!proxySessions.has(cleanProxy)) {
        const partition = 'models-proxy-' + crypto.createHash('sha256').update(cleanProxy).digest('hex').slice(0, 16);
        const isolated = electron.session.fromPartition(partition);
        proxySessions.set(cleanProxy, isolated.setProxy({ proxyRules: cleanProxy }).then(() => isolated));
      }
      session = await proxySessions.get(cleanProxy);
    }
    return new Promise((resolve, reject) => {
      const req = electron.net.request({ method: 'GET', url, session });
      let settled = false;
      const done = (err, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        err ? reject(err) : resolve(val);
      };
      const timer = setTimeout(() => {
        try { req.abort(); } catch {}
        done(new Error('获取模型列表超时，请检查网络或代理设置'));
      }, timeoutMs);
      req.on('error', (e) => done(new Error(`网络请求失败：${e?.message || '无法连接接口'}`)));
      req.on('response', (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) {
            try { req.abort(); } catch {}
            done(new Error('模型列表响应体过大'));
          } else {
            chunks.push(Buffer.from(chunk));
          }
        });
        res.on('error', (e) => done(new Error(`读取响应失败：${e?.message || ''}`)));
        res.on('end', () => done(null, {
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8')
        }));
      });
      req.setHeader('Accept', 'application/json');
      if (apiKey) req.setHeader('Authorization', `Bearer ${apiKey}`);
      req.end();
    });
  }

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('当前环境不支持 HTTP 请求');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await doFetch(url, { method: 'GET', headers, signal: ac.signal });
    const body = await res.text();
    return { status: res.status, body };
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('获取模型列表超时');
    throw new Error(`网络请求失败：${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchModelList({ baseUrl, apiKey = '', proxyUrl = '', electron = null, fetchImpl = null, timeoutMs = 15000 } = {}) {
  const urls = candidateModelsUrls(baseUrl);
  const startedAt = Date.now();
  let lastError = null;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const res = await httpGetJson({ url, apiKey: String(apiKey || '').trim(), proxyUrl, electron, fetchImpl, timeoutMs });
    if (res.status >= 200 && res.status < 300) {
      const models = parseModelsPayload(res.body);
      return {
        ok: true,
        models,
        count: models.length,
        url,
        latencyMs: Date.now() - startedAt
      };
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`认证失败（HTTP ${res.status}），请检查 API Key 是否正确`);
    }
    if (res.status === 404 && i + 1 < urls.length) {
      lastError = new Error(`HTTP 404（${url}）`);
      continue;
    }
    let detail = '';
    try {
      const parsed = JSON.parse(res.body);
      detail = parsed?.error?.message || parsed?.message || '';
    } catch {
      detail = String(res.body || '').trim().slice(0, 140);
    }
    throw new Error(`获取模型列表失败（HTTP ${res.status}）${detail ? `：${String(detail).slice(0, 140)}` : ''}`);
  }
  throw lastError || new Error('该接口未提供 /models 列表，请直接手动输入模型 ID');
}

module.exports = {
  REASONING_EFFORT_LEVELS,
  normalizeReasoningEffort,
  isDashScopeHost,
  buildReasoningBodyFields,
  shouldOmitTemperature,
  cleanBaseUrl,
  candidateModelsUrls,
  parseModelsPayload,
  fetchModelList
};
