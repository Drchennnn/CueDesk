import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionResult,
  DOCS,
  PROVIDER_HELP,
  docUrl,
  findPresetByEndpoint,
  isTestableTarget,
  sanitizeApiKeyInput,
  storedKeyTest
} from '@mc/runtime';
import { IconCheck, IconCopy, IconEyeContact, IconX } from './Icons.jsx';

export function Switch({ checked, onChange, disabled = false, success = false, title, 'aria-label': ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      className={`mc-switch${checked ? ' is-on' : ''}${success ? ' is-success' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange?.(!checked);
      }}
    >
      <span className="mc-switch-thumb" />
    </button>
  );
}

export function cleanAnswerReferences(value) {
  const text = String(value || '');
  const marker = /(?:^|\n)[ \t]*(?:\*\*)?(?:依据|参考来源|资料来源|来源)(?:\*\*)?[：:][ \t]*(?:\*\*)?/g;
  let match;
  while ((match = marker.exec(text))) {
    if ((text.slice(0, match.index).match(/```/g) || []).length % 2) continue;
    const tail = text.slice(marker.lastIndex);
    if (!/\.md(?:#|\b)/i.test(tail) && tail.trim()) continue;
    const end = tail.search(/\r?\n[ \t]*\r?\n/);
    return (text.slice(0, match.index).trimEnd() + (end >= 0 ? '\n\n' + cleanAnswerReferences(tail.slice(end).trimStart()) : '')).trimEnd();
  }
  return text;
}

export function compactWrittenAnswer(value) {
  const raw = String(value || '').trim();
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const option = (line) => {
    const cleaned = line
      .replace(/\*\*|`/g, '')
      .replace(/^(?:答案|正确答案|选项)\s*(?:是|为)?\s*[:：]?\s*/, '')
      .replace(/^(?:第\s*)?\d+\s*(?:题)?\s*[.、:：)）-]\s*/, '')
      .trim();
    const match = cleaned.match(/^[（(\[【]?\s*([A-H](?:[\s,，、/;；]*[A-H])*)\s*[)）\]】.。]?$/i);
    return match ? match[1].replace(/[\s,，、/;；]/g, '').toUpperCase() : null;
  };
  if (!lines.length) return '';
  if (/```/.test(raw)) return raw;
  const options = lines.map(option);
  if (options.every(Boolean)) return options.join('\n');
  if (options[0] && /^(?:原因|解析|解释|说明|因为|Explanation|Reason)[:：\s是]/i.test(lines[1] || '')) {
    return options[0];
  }
  return raw;
}

export function parseAnswerBlocks(value, compact = false) {
  const text = compact ? compactWrittenAnswer(value) : cleanAnswerReferences(value);
  const blocks = [];
  const fence = /^[ \t]*```([^\n`]*)\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  let offset = 0;
  let match;
  while ((match = fence.exec(text))) {
    const before = text.slice(offset, match.index).trim();
    if (before) blocks.push({ kind: 'text', text: before });
    blocks.push({ kind: 'code', language: match[1].trim(), text: match[2].replace(/\r?\n$/, '') });
    offset = fence.lastIndex;
  }
  const after = text.slice(offset).trim();
  if (after) blocks.push({ kind: 'text', text: after });
  return blocks;
}

export function WrittenAnswerContent({ value, fontSize = 14, fontFamily = 'Microsoft YaHei', compact = false }) {
  const [copied, setCopied] = useState(false);
  const text = compactWrittenAnswer(value);
  const blocks = parseAnswerBlocks(value, true);
  const options = /^[A-H]+(?:\n[A-H]+)*$/.test(text);

  const copy = async () => {
    const plain = blocks.map(b => b.text).join('\n\n');
    try {
      await navigator.clipboard.writeText(plain || text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  if (options) {
    return (
      <button
        type="button"
        title={copied ? '已复制' : '点击复制答案'}
        onClick={copy}
        style={{
          border: 0, padding: 0, margin: 0, background: 'transparent', color: 'inherit',
          textAlign: 'left', fontFamily: `${fontFamily}, sans-serif`, fontSize, fontWeight: 600,
          lineHeight: 1.2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', cursor: 'copy', userSelect: 'text'
        }}
      >
        {text}
      </button>
    );
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: `${fontFamily}, sans-serif`, fontSize, lineHeight: compact ? 1.38 : 1.7 }}>
        {blocks.map((block, idx) =>
          block.kind === 'code' ? (
            <pre key={idx} className="mc-answer-code">
              <code data-language={block.language}>{block.text}</code>
            </pre>
          ) : (
            <div key={idx} className="mc-answer-prose">{block.text}</div>
          )
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button className="mc-btn mc-btn-sm" type="button" onClick={copy}>
          {copied ? <><IconCheck size={12} /> 已复制</> : <><IconCopy size={12} /> 复制</>}
        </button>
      </div>
    </div>
  );
}

export function ModelAnswers({ results = [], onlyOptions = false }) {
  const [copiedId, setCopiedId] = useState(null);
  const copy = async (id, text) => {
    try {
      await navigator.clipboard.writeText(onlyOptions ? compactWrittenAnswer(text) : cleanAnswerReferences(text));
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1200);
    } catch {}
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {results.map((result) => (
        <div key={result.id || result.name} className="mc-card">
          <div className="mc-card-head" style={{ padding: '8px 12px' }}>
            <strong style={{ fontSize: 12.5 }}>{result.name} · {result.model}</strong>
            {result.status === 'done' && !onlyOptions && (
              <button type="button" className="mc-btn mc-btn-sm" onClick={() => void copy(result.id, result.text)}>
                {copiedId === result.id ? <><IconCheck size={12} /> 已复制</> : <><IconCopy size={12} /> 复制</>}
              </button>
            )}
          </div>
          <div className="mc-card-body" style={{ padding: '10px 12px' }}>
            {result.status === 'pending' ? (
              <span className="mc-field-hint">正在回答…</span>
            ) : result.status === 'done' ? (
              onlyOptions ? (
                <WrittenAnswerContent value={result.text} />
              ) : (
                <div className="mc-answer-prose">{cleanAnswerReferences(result.text)}</div>
              )
            ) : (
              <div className="mc-alert mc-alert-err">{result.error || '已停止'}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function sourceDiagnostics(diagnostics = [], retired = []) {
  const paths = new Set(retired);
  const prefix = '来源已缺失，保留历史身份：';
  let retiredCount = 0;
  const visible = diagnostics.filter(s => {
    if (s.startsWith(prefix) && paths.has(s.slice(prefix.length))) {
      retiredCount++;
      return false;
    }
    return true;
  });
  return { visible, retiredCount };
}

export function EvidencePanel({ attempt, defaultOpen = false, inline = false }) {
  const [error, setError] = useState('');
  const [retired, setRetired] = useState([]);

  useEffect(() => {
    let alive = true;
    window.mc?.getInterviewLibrary?.()
      .then(s => { if (alive) setRetired(s?.retired_sources || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!attempt) return null;
  const evidence = attempt.evidence || [];
  const unknownFacts = attempt.unknownFacts || attempt.unknown_facts || [];
  const privateNotes = attempt.privateNotes || attempt.private_notes || [];
  const invalidRefs = attempt.invalidRefs || attempt.invalid_refs || [];
  const diagnostics = attempt.diagnostics || [];
  const cited = new Set(attempt.evidenceRefs || attempt.evidence_refs || attempt.citations || []);

  if (!evidence.length && !unknownFacts.length && !privateNotes.length && !diagnostics.length) {
    if (inline) {
      return <div className="mc-field-hint" style={{ padding: '12px 0' }}>本条回答暂无本地资料库检索证据。</div>;
    }
    return null;
  }

  const diagView = sourceDiagnostics(diagnostics, retired);
  const sorted = evidence.slice().sort((a, b) => Number(cited.has(b.evidence_id)) - Number(cited.has(a.evidence_id)));

  const body = (
    <div className="mc-evidence-box" style={inline ? { borderTop: 0, paddingTop: 0 } : undefined}>
      <div className="mc-field-hint">
        引用有效仅表示本地来源存在，历史摘录保留回答当时的版本快照。
      </div>
      {unknownFacts.map((s, i) => (
        <div key={`u-${i}`} className="mc-alert mc-alert-warn">待本人确认：{s}</div>
      ))}
      {privateNotes.map((s, i) => (
        <div key={`n-${i}`} className="mc-alert">私下提醒：{s}</div>
      ))}
      {diagView.retiredCount > 0 && (
        <div className="mc-field-hint">已清理的旧资料已归档，当前仅检索有效来源。</div>
      )}
      {diagView.visible.map((s, i) => (
        <div key={`d-${i}`} className="mc-field-hint">{s}</div>
      ))}
      {invalidRefs.length > 0 && (
        <div className="mc-alert mc-alert-err">已拒绝无效引用：{invalidRefs.join('、')}</div>
      )}
      {sorted.map((e) => (
        <div key={e.evidence_id || e.chunk_id} className="mc-evidence-item">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <strong style={{ fontSize: 12.5 }}>{e.document_title || '未命名资料'}</strong>
            <span className={`mc-badge ${cited.has(e.evidence_id) ? 'mc-badge-ok' : ''}`}>
              {cited.has(e.evidence_id) ? '已引用' : '仅检索'}
            </span>
          </div>
          <div className="mc-field-hint">
            {[
              e.heading,
              e.document_type,
              e.version ? `v${e.version}` : '',
              e.source_location?.page_number
                ? `第 ${e.source_location.page_number} 页`
                : e.source_location?.line_range?.length
                  ? `第 ${e.source_location.line_range.join('—')} 行`
                  : ''
            ].filter(Boolean).join(' · ')}
          </div>
          <pre className="mc-evidence-excerpt">{e.excerpt}</pre>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button
              type="button"
              className="mc-btn mc-btn-sm"
              onClick={async () => {
                try {
                  await window.mc.openInterviewEvidence({
                    document_id: e.document_id,
                    chunk_id: e.chunk_id,
                    content_hash: e.content_hash
                  });
                  setError('');
                } catch (err) {
                  setError(err.message);
                }
              }}
            >
              打开原文
            </button>
            {(e.image_refs || []).map((im, i) => (
              <button
                key={im.image_id || i}
                type="button"
                className="mc-btn mc-btn-sm"
                onClick={async () => {
                  try {
                    await window.mc.openInterviewEvidence({
                      document_id: e.document_id,
                      chunk_id: e.chunk_id,
                      content_hash: e.content_hash,
                      image_id: im.image_id
                    });
                    setError('');
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                查看原图 {i + 1}
              </button>
            ))}
          </div>
          {e.document_type === 'technical_reference' && (
            <div className="mc-field-hint">通用技术参考，仅用于技术解释，不可作为本人项目经历。</div>
          )}
        </div>
      ))}
      {error && <div className="mc-alert mc-alert-err">{error}</div>}
    </div>
  );

  if (inline) return body;

  return (
    <details open={defaultOpen} style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
        依据与来源 · {cited.size} 条引用 / {evidence.length} 条检索材料
        {unknownFacts.length > 0 ? ` · ${unknownFacts.length} 项待确认` : ''}
      </summary>
      {body}
    </details>
  );
}

/* Shared serialized auto-save queue (identical semantics to baseline autosave-ui) */
export const settingsAutoFlushers = new Set();

export function createAutoSaveQueue(write, notify = () => {}, delay = 550) {
  let baseline;
  let latest;
  let timer;
  let running = null;
  let failed;
  let disposed = false;
  const key = (v) => JSON.stringify(v);
  function seed(v) { baseline = key(v); latest = v; }
  async function flush() {
    clearTimeout(timer);
    if (running) { await running; return flush(); }
    if (!latest || key(latest) === baseline) return true;
    if (key(latest) === failed) return false;
    const value = latest;
    const signature = key(value);
    notify('saving');
    running = (async () => {
      try {
        await write(value);
        baseline = signature;
        failed = null;
        if (!disposed) notify(key(latest) === baseline ? 'saved' : 'pending');
      } catch (err) {
        failed = signature;
        if (!disposed) notify('error', err.message);
      }
    })();
    await running;
    running = null;
    if (key(latest) !== baseline && key(latest) !== failed) return flush();
    return key(latest) === baseline;
  }
  function update(value) {
    latest = value;
    clearTimeout(timer);
    if (baseline === undefined) { seed(value); return; }
    if (key(value) === baseline) return;
    if (key(value) !== failed) { notify('pending'); timer = setTimeout(flush, delay); }
  }
  return { seed, update, flush, dispose() { disposed = true; clearTimeout(timer); } };
}

export function useAutoSaveValue(value, write, onSaved) {
  const [status, setStatus] = useState('saved');
  const [error, setError] = useState('');
  const latest = useRef({ value, write, onSaved });
  latest.current = { value, write, onSaved };
  const queue = useRef(null);
  if (!queue.current) {
    queue.current = createAutoSaveQueue(
      async (snapshot) => {
        const result = await latest.current.write(snapshot);
        if (JSON.stringify(latest.current.value) === JSON.stringify(snapshot)) {
          latest.current.onSaved?.(result);
        }
      },
      (state, message) => { setStatus(state); setError(message || ''); }
    );
  }
  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (value !== null) queue.current.update(value);
  }, [serialized]);
  useEffect(() => {
    const flush = () => queue.current.flush();
    settingsAutoFlushers.add(flush);
    return () => {
      settingsAutoFlushers.delete(flush);
      void queue.current.flush();
      queue.current.dispose();
    };
  }, []);
  return { status, error, flush: () => queue.current.flush() };
}

export function useKeySlot() {
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const reset = useCallback(() => {
    setValue('');
    setEditing(false);
    setPendingDelete(false);
    setConfirming(false);
  }, []);
  const patchValue = useCallback(() => {
    if (pendingDelete) return '';
    const clean = sanitizeApiKeyInput(value).value;
    return clean || undefined;
  }, [pendingDelete, value]);
  return { value, setValue, editing, setEditing, pendingDelete, setPendingDelete, confirming, setConfirming, reset, patchValue };
}

export function acceleratorFromKeyboardEvent(event) {
  if (event.isComposing || event.repeat || ['Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph'].includes(event.key)) return null;
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Super');
  const names = { ' ': 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', '+': 'Plus', '=': '=', '-': '-', '\\': '\\' };
  const numpad = { NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec' };
  let key = names[event.key] || event.key;
  if (/^Key[A-Z]$/.test(event.code || '')) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code || '')) key = event.code.slice(5);
  else if (/^Numpad[0-9]$/.test(event.code || '')) key = 'num' + event.code.slice(6);
  else if (numpad[event.code]) key = numpad[event.code];
  else if (key?.length === 1) key = key.toUpperCase();
  if (!key || (!modifiers.length && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key))) return null;
  return [...modifiers, key].join('+');
}

export function ShortcutRecorder({ label, description, value, onChange }) {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState('');
  const [manual, setManual] = useState(false);
  const inputRef = useRef(null);
  const sessionRef = useRef(null);
  const readyRef = useRef(false);
  const pendingKeyRef = useRef(false);

  const finish = useCallback(() => {
    const token = sessionRef.current;
    sessionRef.current = null;
    readyRef.current = false;
    pendingKeyRef.current = false;
    setRecording(false);
    if (token) void window.mc.endShortcutRecording(token).catch(() => {});
  }, []);

  const begin = useCallback(async () => {
    if (sessionRef.current) return;
    const token = crypto.randomUUID();
    sessionRef.current = token;
    readyRef.current = false;
    setRecording(true);
    setMessage('正在准备录制…');
    try {
      const ok = await window.mc.beginShortcutRecording(token);
      if (sessionRef.current !== token) return;
      if (!ok) { finish(); return; }
      readyRef.current = true;
      setMessage('请按组合键、F1–F24 或鼠标侧键；Esc 取消，Delete/Backspace 清除。');
    } catch (err) {
      if (sessionRef.current === token) { finish(); setMessage(err.message); }
    }
  }, [finish]);

  useEffect(() => {
    const off = window.mc.onShortcutRecorded((event) => {
      if (event.token !== sessionRef.current) return;
      if (event.ended) { finish(); setMessage(event.error || '录制已结束，点击“录制”重试'); return; }
      onChange(event.accelerator);
      setMessage('已录入，自动保存');
      finish();
    });
    return () => {
      off?.();
      const token = sessionRef.current;
      sessionRef.current = null;
      if (token) void window.mc.endShortcutRecording(token).catch(() => {});
    };
  }, [onChange, finish]);

  return (
    <div className="mc-srow">
      <div>
        <div className="mc-srow-label">{label}</div>
        {description && <div className="mc-srow-desc">{description}</div>}
      </div>
      <div className="mc-srow-control">
        <input
          ref={inputRef}
          className="mc-input"
          value={value || ''}
          readOnly={!manual}
          spellCheck={false}
          placeholder={recording ? '请按键…' : '未设置'}
          aria-label={label}
          onFocus={() => { if (!manual) void begin(); }}
          onClick={() => { if (!manual) void begin(); }}
          onBlur={finish}
          onChange={(e) => { if (manual) onChange(e.target.value); }}
          onKeyDown={(e) => {
            if (manual) { if (e.key === 'Escape') { e.preventDefault(); finish(); } return; }
            e.preventDefault();
            e.stopPropagation();
            if (!sessionRef.current) { void begin(); return; }
            if (!readyRef.current) return;
            if (e.key === 'Escape') { finish(); setMessage('已取消录制'); return; }
            if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && ['Delete', 'Backspace'].includes(e.key)) {
              onChange('');
              setMessage('已清除，自动保存后生效');
              pendingKeyRef.current = true;
              return;
            }
            const acc = acceleratorFromKeyboardEvent(e);
            if (acc) {
              onChange(acc);
              pendingKeyRef.current = true;
              setMessage('已录入，松开按键后自动保存');
            }
          }}
          onKeyUp={(e) => { if (pendingKeyRef.current && !['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) finish(); }}
          onMouseDown={(e) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); e.stopPropagation(); } }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="mc-btn mc-btn-sm" type="button" onClick={() => { setManual(false); inputRef.current?.focus(); void begin(); }}>
            {recording ? '录制中…' : '录制'}
          </button>
          <button className="mc-btn mc-btn-sm" type="button" onClick={() => { finish(); setManual(v => !v); setMessage('可手动填写，如 Control+Shift+S 或 Mouse4'); }}>
            {manual ? '返回录制' : '手动填写'}
          </button>
          <button className="mc-btn mc-btn-sm" type="button" onClick={() => { finish(); onChange(''); setMessage('已清除'); }}>
            清除
          </button>
        </div>
        {message && <div className="mc-field-hint" role="status">{message}</div>}
      </div>
    </div>
  );
}

/* Compute BYOK Service Health (no cloud subscription/quota) */
export function computeServiceHealth(settings, asr, library) {
  const llmReady = Boolean(settings?.llm?.baseUrl && settings?.llm?.model && settings?.llm?.apiKeySet);
  const visionEndpoints = settings?.multimodal?.endpoints || [];
  const visionReady = Boolean(
    settings?.multimodal?.enabled &&
    visionEndpoints.some(e => e.enabled && e.baseUrl && e.model)
  );
  let asrState = 'loading';
  let asrLabel = '启动中';
  if (asr?.phase === 'ready') { asrState = 'ok'; asrLabel = '就绪'; }
  else if (asr?.phase === 'unconfigured') { asrState = 'warn'; asrLabel = '待配置'; }
  else if (asr?.phase === 'error') { asrState = 'err'; asrLabel = '异常'; }

  const kbEnabled = Boolean(library?.enabled);
  const kbFiles = library?.files?.length || 0;
  const kbState = !kbEnabled ? 'idle' : library?.warning ? 'warn' : 'ok';
  const kbLabel = !kbEnabled ? '未启用' : `${kbFiles} 份资料`;

  return {
    llm: { state: llmReady ? 'ok' : 'warn', label: llmReady ? (settings.llm.model || '已配置') : '待配置', ready: llmReady },
    asr: { state: asrState, label: asrLabel, ready: asrState === 'ok', detail: asr?.lastError || '' },
    vision: { state: visionReady ? 'ok' : 'idle', label: visionReady ? '已就绪' : '未启用', ready: visionReady },
    kb: { state: kbState, label: kbLabel, ready: kbEnabled && !library?.warning, enabled: kbEnabled }
  };
}

export function eyeContactStatusText(eye) {
  if (!eye) return 'NVIDIA Maxine 眼神矫正';
  if (eye.phase === 'installing') {
    const msgs = {
      probing: '正在识别 NVIDIA 显卡…',
      checking: '正在检查 SDK 缓存…',
      waiting: '正在等待另一个 SDK 安装任务…',
      downloading: '正在下载 NVIDIA SDK，已完成 ' + Math.round((eye.sdk?.progress || 0) * 100) + '%',
      verifying: '正在校验 NVIDIA 下载包…',
      extracting: '正在解包 NVIDIA SDK…',
      validating: '正在检查运行库和模型…',
      ready: 'SDK 已配置，正在启动摄像头…'
    };
    return msgs[eye.sdk?.stage] || eye.sdk?.message || '正在准备 NVIDIA SDK…';
  }
  if (eye.phase === 'restarting') return '引擎异常，正在尝试恢复…';
  if (eye.error) return eye.error;
  if (!eye.enabled) return 'NVIDIA Maxine 眼神矫正（未开启）';
  if (!eye.connected) return eye.sourceReleased ? '等待视频软件连接；真实摄像头已释放' : '已就绪，等待视频软件连接';
  if (eye.mode === 'idle') return '检测到视频消费者，正在准备画面';
  return eye.mode === 'passthrough' ? '原画直通中' : '眼神矫正运行中';
}

export function EyeContactToggle({ compact = false }) {
  const [eye, setEye] = useState({ enabled: false, phase: 'off' });
  const [busy, setBusy] = useState(false);
  const [infoRect, setInfoRect] = useState(null);
  const btnRef = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    window.mc?.getEyeContactState?.()
      .then(v => { if (alive.current && v) setEye(v); })
      .catch(() => {});
    const off = window.mc?.onEyeContactState?.(v => { if (alive.current && v) setEye(v); });
    return () => { alive.current = false; off?.(); };
  }, []);

  const openInfoAtBtn = () => {
    const r = btnRef.current?.getBoundingClientRect();
    setInfoRect(r || { right: window.innerWidth - 16, bottom: 46 });
  };

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await window.mc.setEyeContactEnabled(!eye.enabled);
      if (alive.current) { setEye(next); if (next.error) openInfoAtBtn(); }
    } catch (err) {
      if (alive.current) { setEye({ enabled: false, phase: 'error', error: err.message }); openInfoAtBtn(); }
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const msg = eyeContactStatusText(eye);
  const popLeft = infoRect ? Math.max(8, Math.min(infoRect.right - 270, window.innerWidth - 278)) : window.innerWidth - 286;
  const popTop = infoRect ? Math.min(infoRect.bottom + 6, window.innerHeight - 160) : 50;

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }} data-interactive="true">
      <button
        ref={btnRef}
        type="button"
        className={`mc-icon-btn${eye.enabled ? ' is-live' : ''}`}
        disabled={busy}
        title={`${msg}\n右键查看状态 · 可在「高级设置 → 摄像头与眼神矫正」配置设备`}
        aria-label="眼神矫正"
        aria-pressed={!!eye.enabled}
        style={eye.error ? { borderColor: 'var(--danger)', color: 'var(--danger)' } : undefined}
        onClick={() => void toggle()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setInfoRect(prev => prev ? null : (btnRef.current?.getBoundingClientRect() || { right: window.innerWidth - 16, bottom: 46 })); }}
      >
        <IconEyeContact size={15} />
      </button>
      {infoRect && (
        <div
          className="mc-dropdown-menu"
          style={{ position: 'fixed', top: popTop, left: popLeft, width: 270, padding: 12, gap: 6 }}
          data-interactive="true"
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 12.5 }}>眼神矫正 · NVIDIA Maxine</strong>
            <button type="button" className="mc-icon-btn" onClick={() => setInfoRect(null)}><IconX size={13} /></button>
          </div>
          <div className={eye.error ? 'mc-alert mc-alert-err' : 'mc-field-hint'}>{msg}</div>
          {eye.enabled && (
            <div className="mc-field-hint">
              虚拟摄像头：<strong>{eye.virtualCamera || 'DirectShow Softcam'}</strong>
              {eye.connected && typeof eye.fps === 'number' ? ` · ${Math.round(eye.fps)} FPS` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ScreenshotBatchPanel({ batch, controller, management = false }) {
  const [keys, setKeys] = useState({});
  const [folderError, setFolderError] = useState('');

  useEffect(() => {
    let active = true;
    const onState = (v) => { if (active) setKeys(v?.bindings || {}); };
    window.mc?.getWindowControls?.().then(onState).catch(() => {});
    const off = window.mc?.onWindowControlsState?.(onState);
    return () => { active = false; off?.(); };
  }, []);

  if (!management) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '3px 0' }}>
        多图{batch.enabled ? '开' : '关'} · {batch.images.length}/12{batch.busy ? ' · 截图中' : ''}　
        开关 {String(keys.toggleBatch || '未设置').replace(/Control/g, 'Ctrl')}　
        发送 {String(keys.sendBatch || '未设置').replace(/Control/g, 'Ctrl')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className={`mc-btn mc-btn-sm${batch.enabled ? ' mc-btn-primary' : ''}`} onClick={controller.toggle} disabled={batch.busy}>
          {batch.enabled ? '多图暂存：已开启' : '多图暂存：已关闭'}
        </button>
        <span className="mc-badge">{batch.images.length} / 12 张{batch.busy ? ' · 截图中' : ''}</span>
        <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={controller.sendBatch} disabled={batch.busy || !batch.images.length}>
          发送全部暂存截图
        </button>
        <button type="button" className="mc-btn mc-btn-sm" onClick={controller.clear} disabled={batch.busy || !batch.images.length}>
          清空暂存
        </button>
        <button
          type="button"
          className="mc-btn mc-btn-sm"
          onClick={async () => {
            try { await window.mc.openScreenshotFolder(); setFolderError(''); }
            catch (e) { setFolderError(e.message); }
          }}
        >
          打开截图目录
        </button>
      </div>
      {(batch.enabled || batch.images.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            className="mc-textarea"
            rows={2}
            placeholder="可选：为本批暂存截图附带统一补充问题"
            value={batch.question}
            onChange={(e) => controller.question(e.target.value)}
            style={{ minHeight: 56 }}
          />
          {batch.images.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {batch.images.map((img, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: '1px solid var(--border)', borderRadius: 8 }}>
                  <img src={img.dataUrl} alt={`截图 ${i + 1}`} style={{ width: 52, height: 34, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-subtle)' }} />
                  <span style={{ fontSize: 12 }}>{i + 1}. {img.name}</span>
                  <button type="button" className="mc-btn mc-btn-sm" disabled={batch.busy} onClick={() => controller.remove(i)}>移除</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mc-field-hint">
        快捷键：开关 {keys.toggleBatch || '未设置'} · 发送 {keys.sendBatch || '未设置'}
      </div>
      {(folderError || batch.message) && (
        <div className={folderError ? 'mc-alert mc-alert-err' : 'mc-alert'}>{folderError || batch.message}</div>
      )}
    </div>
  );
}

export function ServiceHealthModal({ settings, asr, library, onClose, onOpenSettings, onOpenDiagnostics, onSettingsRefreshed }) {
  const [testing, setTesting] = useState(null);
  const [results, setResults] = useState({});
  const [error, setError] = useState('');
  const health = computeServiceHealth(settings, asr, library);

  const slots = [
    {
      id: 'llm',
      title: '文本大模型（实时回答 / 翻译 / 备忘）',
      status: health.llm,
      target: settings?.llm?.baseUrl && settings?.llm?.model ? {
        capability: 'text-llm',
        providerId: settings.llm.providerId || 'custom',
        baseUrl: settings.llm.baseUrl,
        model: settings.llm.model,
        slot: 'llm'
      } : null,
      verification: settings?.llm?.verification
    },
    {
      id: 'asr',
      title: `语音识别（${settings?.asr?.backend || 'cloud-realtime'}）`,
      status: health.asr,
      target: settings?.asr?.backend === 'cloud-realtime' && settings?.asr?.realtime?.baseUrl ? {
        capability: 'asr-realtime',
        providerId: settings.asr.providerId || 'custom',
        baseUrl: settings.asr.realtime.baseUrl,
        model: settings.asr.realtime.model || '',
        slot: 'asr-realtime'
      } : settings?.asr?.backend === 'cloud' && settings?.asr?.cloud?.baseUrl ? {
        capability: 'asr-segment',
        providerId: settings.asr.providerId || 'custom',
        baseUrl: settings.asr.cloud.baseUrl,
        model: settings.asr.cloud.model || '',
        slot: 'asr-cloud'
      } : null,
      verification: settings?.asr?.backend === 'cloud' ? settings?.asr?.cloud?.verification : settings?.asr?.realtime?.verification
    },
    {
      id: 'vision',
      title: '截图多模态模型（可选）',
      status: health.vision,
      target: null
    },
    {
      id: 'kb',
      title: '本地面试资料库 V2（可选）',
      status: health.kb,
      target: null
    }
  ];

  const runTest = async (id, target) => {
    setTesting(id);
    setError('');
    try {
      const res = await window.mc.providerTest(storedKeyTest(target));
      setResults(prev => ({ ...prev, [id]: res }));
      const refreshed = await window.mc.getSettings();
      onSettingsRefreshed?.(refreshed);
    } catch (err) {
      setError(err.message);
    } finally {
      setTesting(null);
    }
  };

  const badgeCls = (state) => state === 'ok' ? 'mc-badge-ok' : state === 'warn' ? 'mc-badge-warn' : state === 'err' ? 'mc-badge-err' : '';

  return (
    <div className="mc-modal-backdrop" onClick={onClose}>
      <div className="mc-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="本地服务健康状态">
        <div className="mc-modal-header">
          <h3 className="mc-modal-title">本地 BYOK 服务状态</h3>
          <button type="button" className="mc-icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="mc-modal-body">
          <div className="mc-field-hint">
            所有 API Key 与本地资料均保存在本机；连接测试仅在点击时发送一次最小化校验请求。
          </div>
          {slots.map(item => (
            <div key={item.id} className="mc-card">
              <div className="mc-card-body" style={{ padding: 12, gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 13 }}>{item.title}</strong>
                    <span className={`mc-badge ${badgeCls(item.status.state)}`}>{item.status.label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {item.target && isTestableTarget(item.target) && (
                      <button type="button" className="mc-btn mc-btn-sm" disabled={testing !== null} onClick={() => void runTest(item.id, item.target)}>
                        {testing === item.id ? '测试中…' : '测试连接'}
                      </button>
                    )}
                    <button type="button" className="mc-btn mc-btn-sm" onClick={() => { onClose(); onOpenSettings(item.id === 'asr' ? 'audio' : item.id === 'kb' ? 'interview' : 'models'); }}>
                      去配置
                    </button>
                  </div>
                </div>
                {item.status.detail && <div className="mc-alert mc-alert-err">{item.status.detail}</div>}
                {results[item.id] && (
                  <div className={`mc-alert ${results[item.id].ok ? 'mc-alert-ok' : 'mc-alert-err'}`}>
                    {results[item.id].messageZh || results[item.id].code}
                    {results[item.id].latencyMs ? ` (${results[item.id].latencyMs}ms)` : ''}
                  </div>
                )}
              </div>
            </div>
          ))}
          {error && <div className="mc-alert mc-alert-err">{error}</div>}
        </div>
        <div className="mc-modal-footer">
          <button type="button" className="mc-btn" onClick={() => { onClose(); onOpenDiagnostics(); }}>诊断报告</button>
          <button type="button" className="mc-btn" onClick={() => void window.mc.rerunOnboarding()}>重新运行配置向导</button>
          <button type="button" className="mc-btn mc-btn-primary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

export function DiagnosticsModal({ onClose }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    setError('');
    setNotice('');
    setReport(null);
    window.mc.getDiagnostics().then(setReport).catch(e => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setNotice('已复制脱敏诊断报告（不含密钥与聊天内容）');
    } catch (e) {
      setNotice('复制失败：' + e.message);
    }
  };

  return (
    <div className="mc-modal-backdrop" onClick={onClose}>
      <div className="mc-modal mc-modal-lg" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="诊断报告">
        <div className="mc-modal-header">
          <h3 className="mc-modal-title">本地诊断报告</h3>
          <button type="button" className="mc-icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="mc-modal-body">
          <div className="mc-field-hint">此报告在本地生成，不包含 API Key、转写文本或知识库内容。</div>
          {error ? (
            <div className="mc-alert mc-alert-err">{error}</div>
          ) : (
            <textarea className="mc-textarea" readOnly rows={14} style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }} value={report ?? '正在收集本地诊断信息…'} />
          )}
          {notice && <div className="mc-alert mc-alert-ok">{notice}</div>}
        </div>
        <div className="mc-modal-footer">
          <button type="button" className="mc-btn" onClick={() => void window.mc.openLogsFolder()}>打开数据目录</button>
          <button type="button" className="mc-btn" onClick={load}>刷新</button>
          <button type="button" className="mc-btn mc-btn-primary" disabled={!report} onClick={() => void copy()}>复制报告</button>
          <button type="button" className="mc-btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

export function HelpModal({ onClose, onOpenSettings, onOpenDiagnostics }) {
  const [info, setInfo] = useState(null);
  useEffect(() => { window.mc?.getAppInfo?.().then(setInfo).catch(() => {}); }, []);
  const providers = ['deepseek', 'aliyun-dashscope-cn', 'mimo', 'gemini'];

  return (
    <div className="mc-modal-backdrop" onClick={onClose}>
      <div className="mc-modal mc-modal-lg" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="帮助与教程">
        <div className="mc-modal-header">
          <h3 className="mc-modal-title">帮助与配置指南</h3>
          <button type="button" className="mc-icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="mc-modal-body">
          <div className="mc-alert">
            <strong>快速上手：</strong>1）在「高级设置 → 模型接口」填入文本模型 API Key；2）在「语音与音频」配置实时语音识别或本地模型；3）在「面试助手」点击模板的「开始」进入实时工作台。
          </div>
          <div className="mc-card">
            <div className="mc-card-head"><h4 className="mc-card-title">常用服务商密钥申请入口</h4></div>
            <div className="mc-card-body">
              {providers.map((id) => {
                const help = PROVIDER_HELP[id];
                if (!help) return null;
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <strong style={{ fontSize: 13 }}>{id}</strong>
                      <div className="mc-field-hint">{help.billingHintZh || help.stepsZh?.[0] || ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {help.keyUrl && <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.openExternal(help.keyUrl)}>获取 Key</button>}
                      {help.docsUrl && <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.openExternal(help.docsUrl)}>官方文档</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mc-card">
            <div className="mc-card-head"><h4 className="mc-card-title">内置快捷键与防截屏说明</h4></div>
            <div className="mc-card-body">
              <div className="mc-field-hint">• <strong>Ctrl + Shift + 8</strong>：快速切换「不抢焦点」（安全模式下自动锁定）</div>
              <div className="mc-field-hint">• <strong>Ctrl + Shift + 9</strong>：快速切换「鼠标穿透」（悬停顶栏按钮、弹层、滚动条边缘仍可点击）</div>
              <div className="mc-field-hint">• <strong>Ctrl + B</strong>：隐藏 / 呼出主窗口；截图热键可在「快捷键与窗口」自定义</div>
            </div>
          </div>
          {info && (
            <div className="mc-field-hint">
              版本 {info.version} · {info.platform} · {info.packaged ? '便携发行版' : '开发模式'}
            </div>
          )}
        </div>
        <div className="mc-modal-footer">
          <button type="button" className="mc-btn" onClick={() => void window.mc.openExternal(docUrl(DOCS.quickStart, 'zh'))}>在线文档</button>
          <button type="button" className="mc-btn" onClick={() => { onClose(); onOpenDiagnostics(); }}>诊断报告</button>
          <button type="button" className="mc-btn" onClick={() => { onClose(); onOpenSettings('models'); }}>打开设置</button>
          <button type="button" className="mc-btn mc-btn-primary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

export function renderProviderConnectionResult(tCopy, state, keyUrl) {
  if (!state) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <ConnectionResult
        copy={tCopy}
        result={state.result ?? null}
        testing={state.testing}
        message={state.result?.messageZh || state.result?.messageEn}
        at={state.at}
      >
        {keyUrl && (
          <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.openExternal(keyUrl)}>
            打开密钥页
          </button>
        )}
      </ConnectionResult>
      {state.error && <div className="mc-alert mc-alert-err" style={{ marginTop: 4 }}>{state.error}</div>}
    </div>
  );
}
