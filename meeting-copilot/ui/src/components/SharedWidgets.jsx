import React, { Component, useCallback, useEffect, useRef, useState } from 'react';
import {
  DOCS,
  PROVIDER_HELP,
  docUrl,
  isTestableTarget,
  sanitizeApiKeyInput,
  storedKeyTest
} from '@mc/runtime';
import { IconCheck, IconCopy, IconEyeContact, IconX } from './Icons.jsx';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error: error || new Error('未知渲染异常') };
  }

  componentDidCatch(error) {
    // Keep console record for diagnostics without blanking the window
    try { console.error('[UI ErrorBoundary]', error); } catch {}
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error?.message || String(this.state.error);
      if (this.props.inline) {
        return (
          <div className="mc-alert mc-alert-err" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span>{this.props.fallbackLabel || '局部组件渲染异常'}：{msg}</span>
            <button type="button" className="mc-btn mc-btn-sm" onClick={() => this.setState({ error: null })}>
              重试
            </button>
          </div>
        );
      }
      return (
        <div className="mc-shell" style={{ alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div className="mc-card" style={{ maxWidth: 480, width: '100%' }}>
            <div className="mc-card-head">
              <strong className="mc-card-title">界面遇到意外异常（已阻止白屏）</strong>
            </div>
            <div className="mc-card-body">
              <div className="mc-alert mc-alert-err">{msg}</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="mc-btn" onClick={() => this.setState({ error: null })}>
                  恢复界面
                </button>
                <button type="button" className="mc-btn mc-btn-primary" onClick={() => window.location.reload()}>
                  重新加载
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Switch({ checked, onChange, disabled = false, success = false, title, 'aria-label': ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      className={`mc-switch${checked ? ' is-on' : ''}${success ? ' is-success' : ''}${disabled ? ' is-disabled' : ''}`}
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

export function WrittenAnswerContent({
  value,
  fontSize = 14,
  fontFamily = 'Microsoft YaHei',
  compact = false,
  hideFooterCopy = false
}) {
  const [copied, setCopied] = useState(false);
  const [copiedCodeIdx, setCopiedCodeIdx] = useState(null);
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

  const copyCodeBlock = async (idx, codeText) => {
    try {
      await navigator.clipboard.writeText(String(codeText || ''));
      setCopiedCodeIdx(idx);
      setTimeout(() => setCopiedCodeIdx(prev => (prev === idx ? null : prev)), 1300);
    } catch {
      setCopiedCodeIdx(null);
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
            <div key={idx} className="mc-code-block">
              <div className="mc-code-block-head" data-interactive="true">
                <span className="mc-code-block-lang">{block.language || 'code'}</span>
                <button
                  type="button"
                  className="mc-code-copy-btn"
                  title="仅复制纯代码内容"
                  onClick={(e) => {
                    e.stopPropagation();
                    void copyCodeBlock(idx, block.text);
                  }}
                >
                  {copiedCodeIdx === idx ? <><IconCheck size={11} /> 已复制</> : <><IconCopy size={11} /> 复制代码</>}
                </button>
              </div>
              <pre className="mc-answer-code">
                <code data-language={block.language}>{block.text}</code>
              </pre>
            </div>
          ) : (
            <div key={idx} className="mc-answer-prose">{block.text}</div>
          )
        )}
      </div>
      {!hideFooterCopy && (
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button className="mc-btn mc-btn-sm" type="button" onClick={copy}>
            {copied ? <><IconCheck size={12} /> 已复制</> : <><IconCopy size={12} /> 复制</>}
          </button>
        </div>
      )}
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

export function ShortcutRecorder({ label, description, value, onChange, rowId, highlighted = false }) {
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
    <div id={rowId} className={`mc-srow${highlighted ? ' is-highlight-flash' : ''}`}>
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

/* Compute BYOK Service Health + Task-Oriented Summary (M15 / M21) */
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

  const kbRoot = Boolean(library?.root);
  const kbEnabled = Boolean(library?.enabled && kbRoot);
  const kbFiles = library?.files?.length || 0;
  const kbState = !kbEnabled ? 'idle' : library?.warning ? 'warn' : 'ok';
  const kbLabel = !kbRoot ? '未绑定目录' : !library?.enabled ? `已索引 ${kbFiles} 篇（未启用）` : `${kbFiles} 篇已启用`;

  let taskSummary;
  if (llmReady && asrState === 'ok') {
    taskSummary = {
      dot: 'mc-dot-ok',
      label: '语音与问答就绪',
      meta: kbEnabled ? `${kbFiles} 篇库` : '可听可答',
      canManualAsk: true,
      canVoiceAsk: true
    };
  } else if (llmReady) {
    taskSummary = {
      dot: asrState === 'err' ? 'mc-dot-warn' : 'mc-dot-ok',
      label: '手动问答可用',
      meta: asrState === 'err' ? '语音异常' : '语音待配',
      canManualAsk: true,
      canVoiceAsk: false
    };
  } else if (asrState === 'ok') {
    taskSummary = {
      dot: 'mc-dot-warn',
      label: '仅可语音转写',
      meta: '缺回答模型',
      canManualAsk: false,
      canVoiceAsk: false
    };
  } else {
    taskSummary = {
      dot: asrState === 'err' ? 'mc-dot-err' : 'mc-dot-warn',
      label: '待配置回答模型',
      meta: '配置后可提问',
      canManualAsk: false,
      canVoiceAsk: false
    };
  }

  return {
    llm: { state: llmReady ? 'ok' : 'warn', label: llmReady ? (settings.llm.model || '已配置') : '待配置', ready: llmReady },
    asr: { state: asrState, label: asrLabel, ready: asrState === 'ok', detail: asr?.lastError || '' },
    vision: { state: visionReady ? 'ok' : 'idle', label: visionReady ? '已就绪' : '未启用', ready: visionReady },
    kb: { state: kbState, label: kbLabel, ready: kbEnabled && !library?.warning, enabled: kbEnabled, hasRoot: kbRoot, filesCount: kbFiles },
    taskSummary
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
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', padding: '2px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        暂存 {batch.images.length}/12{batch.enabled ? '（多图开）' : ''}{batch.busy ? ' · 截图中' : ''}
        {keys.toggleBatch ? ` · 开关 ${String(keys.toggleBatch).replace(/Control/g, 'Ctrl')}` : ''}
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

/**
 * Task-first Service Readiness & Quick-Start Modal (M15 / M21).
 * Replaces the legacy diagnostics / 2-key setup buttons with clear task-based paths
 * and direct deep-links into each exact setting field or Knowledge Base page.
 */
export function ServiceHealthModal({
  settings,
  asr,
  library,
  activeSession,
  onClose,
  onNavigateCapability,
  onResumeWorkbench,
  onQuickTypeTest,
  onSettingsRefreshed
}) {
  const [testing, setTesting] = useState(null);
  const [results, setResults] = useState({});
  const [error, setError] = useState('');
  const health = computeServiceHealth(settings, asr, library);

  const slots = [
    {
      id: 'llm',
      capability: 'text-llm',
      title: '回答模型（打字与语音提问必需）',
      desc: health.llm.ready
        ? `当前模型：${settings?.llm?.model || '已配置'} · 已可手动输入问题并获得回答`
        : '只需配置这一项，即可回到面试工作台直接打字问完第一道题。',
      actionLabel: health.llm.ready ? '调整回答模型' : '配置回答模型',
      status: health.llm,
      target: settings?.llm?.baseUrl && settings?.llm?.model ? {
        capability: 'text-llm',
        providerId: settings.llm.providerId || 'custom',
        baseUrl: settings.llm.baseUrl,
        model: settings.llm.model,
        slot: 'llm'
      } : null
    },
    {
      id: 'asr',
      capability: 'asr',
      title: `语音识别（听会议自动提问时配置）`,
      desc: health.asr.ready
        ? `当前后端：${settings?.asr?.backend || 'cloud-realtime'} · 实时转写已就绪`
        : '若只打算先打字试问可暂时跳过；需要实时听面试官讲话时再补配。',
      actionLabel: '配置语音识别',
      status: health.asr,
      target: settings?.asr?.backend === 'cloud-realtime' && settings?.asr?.realtime?.baseUrl ? {
        capability: 'asr-realtime',
        provider: settings.asr.realtime.provider || 'dashscope',
        providerId: settings.asr.realtime.provider || settings.asr.providerId || 'custom',
        baseUrl: settings.asr.realtime.baseUrl,
        model: settings.asr.realtime.model || '',
        resourceId: settings.asr.realtime.resourceId || '',
        authMode: settings.asr.realtime.authMode || 'api-key',
        appId: settings.asr.realtime.appId || '',
        appKey: settings.asr.realtime.appKey || '',
        slot: 'asr-realtime'
      } : settings?.asr?.backend === 'cloud' && settings?.asr?.cloud?.baseUrl ? {
        capability: 'asr-segment',
        protocol: settings.asr.cloud.protocol || 'openai-transcriptions',
        providerId: settings.asr.providerId || 'custom',
        baseUrl: settings.asr.cloud.baseUrl,
        model: settings.asr.cloud.model || '',
        slot: 'asr-cloud'
      } : null
    },
    {
      id: 'vision',
      capability: 'vision',
      title: '截图识题模型（截题与笔试时可选）',
      desc: health.vision.ready
        ? '已启用多模态截图识题，支持面试截图与笔试小窗多模型并行作答。'
        : '仅在需要截取算法题/笔试题屏幕时开启，不影响文字和语音问答。',
      actionLabel: '配置截图模型',
      status: health.vision,
      target: null
    },
    {
      id: 'kb',
      capability: 'kb',
      title: '本地面试资料库（用我的简历与项目回答，可选）',
      desc: health.kb.hasRoot
        ? (health.kb.enabled ? `已启用 ${health.kb.filesCount} 篇本地资料，支持防编造原文引用。` : `已索引 ${health.kb.filesCount} 篇本地资料，面试中使用目前为关。`)
        : '选择本地简历/项目文件夹后，回答将严格依据真实资料并标注来源。',
      actionLabel: health.kb.hasRoot ? '管理资料库' : '选择资料文件夹',
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
      <div className="mc-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="快速配置与服务状态">
        <div className="mc-modal-header">
          <div>
            <h3 className="mc-modal-title">快速配置与服务状态</h3>
            <div className="mc-field-hint">
              直连你自备的接口（BYOK），密钥仅加密存于本机，按服务商实际调用计费。
            </div>
          </div>
          <button type="button" className="mc-icon-btn" aria-label="关闭窗口" onClick={onClose}><IconX /></button>
        </div>
        <div className="mc-modal-body">
          {!health.llm.ready ? (
            <div className="mc-alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <strong style={{ color: 'var(--text)' }}>想先打字问第一道题？</strong>
                <div className="mc-field-hint">只需填好「回答模型」一项，无需先配语音或建资料库。</div>
              </div>
              <button
                type="button"
                className="mc-btn mc-btn-sm mc-btn-primary"
                onClick={() => { onClose(); onNavigateCapability?.('text-llm'); }}
              >
                配置回答模型 →
              </button>
            </div>
          ) : (
            <div className="mc-alert mc-alert-ok" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <strong>{health.asr.ready ? '语音听写与手动问答均已可用' : '手动打字问答已可用'}</strong>
                <div style={{ fontSize: 11.5, opacity: 0.9 }}>
                  {health.asr.ready ? '可直接从首页模板开始完整实时面试。' : '现在即可进入工作台打字提问；需要听会议再补配语音识别。'}
                </div>
              </div>
              {activeSession ? (
                <button
                  type="button"
                  className="mc-btn mc-btn-sm mc-btn-success"
                  onClick={() => { onClose(); onResumeWorkbench?.(); }}
                >
                  返回当前面试 →
                </button>
              ) : onQuickTypeTest ? (
                <button
                  type="button"
                  className="mc-btn mc-btn-sm mc-btn-primary"
                  onClick={() => { onClose(); onQuickTypeTest(); }}
                >
                  立即打字试问 →
                </button>
              ) : (
                <button type="button" className="mc-btn mc-btn-sm" onClick={onClose}>
                  返回并试问
                </button>
              )}
            </div>
          )}

          {slots.map(item => (
            <div key={item.id} className="mc-card">
              <div className="mc-card-body" style={{ padding: 12, gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13 }}>{item.title}</strong>
                      <span className={`mc-badge ${badgeCls(item.status.state)}`}>{item.status.label}</span>
                    </div>
                    <div className="mc-field-hint" style={{ marginTop: 2 }}>{item.desc}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {item.target && isTestableTarget(item.target) && (
                      <button
                        type="button"
                        className="mc-btn mc-btn-sm"
                        aria-label={`测试${item.title}`}
                        disabled={testing !== null}
                        onClick={() => void runTest(item.id, item.target)}
                      >
                        {testing === item.id ? '检测中…' : '检测'}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`mc-btn mc-btn-sm${!health.llm.ready && item.id === 'llm' ? ' mc-btn-primary' : ''}`}
                      aria-label={item.actionLabel}
                      onClick={() => { onClose(); onNavigateCapability?.(item.capability); }}
                    >
                      {item.actionLabel}
                    </button>
                  </div>
                </div>
                {item.status.detail && <div className="mc-alert mc-alert-err">{item.status.detail}</div>}
                {results[item.id] && (
                  <div className={`mc-alert ${results[item.id].ok ? 'mc-alert-ok' : 'mc-alert-err'}`} style={{ padding: '6px 10px' }}>
                    {results[item.id].ok ? '连接成功' : (results[item.id].messageZh || results[item.id].code || '连接失败')}
                    {typeof results[item.id].latencyMs === 'number' ? ` · ${results[item.id].latencyMs} ms` : ''}
                  </div>
                )}
              </div>
            </div>
          ))}
          {error && <div className="mc-alert mc-alert-err">{error}</div>}
        </div>
        <div className="mc-modal-footer">
          <button type="button" className="mc-btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Re-playable, skippable task-driven V3 Quick-Start Guide (replaces withdrawn legacy 5-step setup.html).
 * Shares live computeServiceHealth and deep-links directly into Settings / Knowledge Base fields.
 */
export function QuickStartModal({ settings, asr, library, onClose, onNavigateCapability }) {
  const health = computeServiceHealth(settings, asr, library);
  const paths = [
    {
      id: 'typing',
      title: '先打字试问第一道题（最快，仅需 1 个 Key）',
      desc: health.llm.ready
        ? `回答模型已就绪（${settings?.llm?.model}），现在就可以关闭引导并在首页开始一场面试打字提问。`
        : '只需填入回答模型 Base URL、模型名与 API Key，测试通过即可直接提问，不用先配语音或建资料库。',
      badge: health.llm.ready ? { cls: 'mc-badge-ok', text: '已就绪' } : { cls: 'mc-badge-warn', text: '需配回答模型' },
      actionLabel: health.llm.ready ? '去核对回答模型' : '配置回答模型',
      target: 'text-llm'
    },
    {
      id: 'voice',
      title: '听会议语音自动提问',
      desc: health.llm.ready && !health.asr.ready
        ? '你的回答模型已配好，只需补充语音识别即可开启实时听写（无需重填文本模型）。'
        : health.asr.ready
          ? '语音识别已就绪，开启会议时可选择系统音频或本地麦克风采集。'
          : '支持百炼 / 豆包 / 腾讯云 / 科大讯飞 / OpenAI Realtime / Deepgram 实时流式，及硅基流动 / 智谱 / Groq / OpenAI 分段或本地 Whisper 语音识别。',
      badge: health.asr.ready ? { cls: 'mc-badge-ok', text: '已就绪' } : { cls: '', text: '按需配置' },
      actionLabel: '配置语音识别',
      target: 'asr'
    },
    {
      id: 'shot',
      title: '截题与笔试小窗作答',
      desc: '配置至少一个多模态视觉模型后，可在面试中静默截题，或在笔试小窗多模型并行作答。',
      badge: health.vision.ready ? { cls: 'mc-badge-ok', text: '已就绪' } : { cls: '', text: '可选' },
      actionLabel: '配置截图模型',
      target: 'vision'
    },
    {
      id: 'kb',
      title: '结合我的简历与项目资料回答（防编造）',
      desc: '绑定本地面试资料目录，实时问答时只允许基于已索引真源声称个人经历并附原文出处。',
      badge: health.kb.enabled ? { cls: 'mc-badge-ok', text: `${health.kb.filesCount} 篇已启用` } : { cls: '', text: '可选' },
      actionLabel: health.kb.hasRoot ? '打开知识库' : '选择资料文件夹',
      target: 'kb'
    }
  ];

  return (
    <div className="mc-modal-backdrop" onClick={onClose}>
      <div className="mc-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="快速配置引导">
        <div className="mc-modal-header">
          <div>
            <h3 className="mc-modal-title">快速配置引导</h3>
            <div className="mc-field-hint">按你当下想做的事选一条入口即可，随时可跳过或从「通用偏好」重播。</div>
          </div>
          <button type="button" className="mc-icon-btn" aria-label="关闭引导" onClick={onClose}><IconX /></button>
        </div>
        <div className="mc-modal-body">
          <div className="mc-alert" style={{ fontSize: 12 }}>
            <strong>关于密钥与隐私：</strong>MeetingCopilot 为本地运行软件，不经第三方中转服务器；你的 API Key 加密存于本机，费用直接由所选模型服务商按量结算。
          </div>
          {paths.map(p => (
            <div key={p.id} className="mc-card">
              <div className="mc-card-body" style={{ padding: 12, gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13 }}>{p.title}</strong>
                      <span className={`mc-badge ${p.badge.cls}`}>{p.badge.text}</span>
                    </div>
                    <div className="mc-field-hint" style={{ marginTop: 3 }}>{p.desc}</div>
                  </div>
                  <button
                    type="button"
                    className={`mc-btn mc-btn-sm${p.id === 'typing' && !health.llm.ready ? ' mc-btn-primary' : ''}`}
                    style={{ flexShrink: 0 }}
                    onClick={() => { onClose(); onNavigateCapability?.(p.target); }}
                  >
                    {p.actionLabel} →
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mc-modal-footer">
          <button type="button" className="mc-btn" onClick={onClose}>暂时跳过</button>
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
      <div className="mc-modal mc-modal-lg" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="故障排查与诊断信息">
        <div className="mc-modal-header">
          <h3 className="mc-modal-title">故障排查与本地诊断信息</h3>
          <button type="button" className="mc-icon-btn" aria-label="关闭诊断" onClick={onClose}><IconX /></button>
        </div>
        <div className="mc-modal-body">
          <div className="mc-field-hint">此报告在本地生成，不包含 API Key、转写文本或知识库内容，仅用于连接排障。</div>
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
          <button type="button" className="mc-btn mc-btn-primary" disabled={!report} onClick={() => void copy()}>复制诊断信息</button>
          <button type="button" className="mc-btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

export function HelpModal({ onClose, onNavigateCapability, onOpenDiagnostics, onOpenQuickStart }) {
  const [info, setInfo] = useState(null);
  useEffect(() => { window.mc?.getAppInfo?.().then(setInfo).catch(() => {}); }, []);
  const providers = ['deepseek', 'aliyun-dashscope-cn', 'mimo', 'gemini'];

  return (
    <div className="mc-modal-backdrop" onClick={onClose}>
      <div className="mc-modal mc-modal-lg" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="帮助与故障排查">
        <div className="mc-modal-header">
          <h3 className="mc-modal-title">帮助与故障排查</h3>
          <button type="button" className="mc-icon-btn" aria-label="关闭帮助" onClick={onClose}><IconX /></button>
        </div>
        <div className="mc-modal-body">
          <div className="mc-alert">
            <strong>快速上手：</strong>1）先在「高级设置 → 模型接口」填入回答模型即可打字试问；2）需要听会议再补配「语音与录制」；3）需要防编造引用个人经历可在「知识库」绑定目录。
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
              <div className="mc-field-hint">• <strong>Ctrl + B</strong>：隐藏 / 呼出主窗口；截图热键可在「高级设置 → 快捷键」自定义</div>
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
          <button type="button" className="mc-btn" onClick={() => { onClose(); onOpenQuickStart?.(); }}>重播快速引导</button>
          <button type="button" className="mc-btn" onClick={() => { onClose(); onOpenDiagnostics?.(); }}>故障排查诊断</button>
          <button type="button" className="mc-btn" onClick={() => { onClose(); onNavigateCapability?.('text-llm'); }}>配置回答模型</button>
          <button type="button" className="mc-btn mc-btn-primary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Native V3 React Connection Result component (replaces @mc/runtime ConnectionResult — fixes M01 crash).
 * Safely formats both string and function copy.success without external React instance conflicts.
 */
function formatConnTime(at, locale = 'zh-CN') {
  if (!at) return '';
  try {
    const d = at instanceof Date ? at : new Date(at);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale);
  } catch {
    return '';
  }
}

export function ProviderConnectionResult({ copy = {}, state, keyUrl, onOpenDiagnostics }) {
  const [showDetail, setShowDetail] = useState(false);
  if (!state) return null;

  const { testing, result, error, at } = state;
  if (!testing && !result && !error) return null;

  const latency = typeof result?.latencyMs === 'number' ? result.latencyMs : null;
  const successLabel = typeof copy.success === 'function'
    ? copy.success(latency)
    : `${copy.success || '连接成功'}${latency !== null ? ` · ${latency} ms` : ''}`;
  const timeStr = formatConnTime(at, copy.locale || 'zh-CN');

  if (testing) {
    return (
      <div className="mc-conn-result" role="status">
        <span className="mc-badge mc-badge-info">{copy.testing || '正在测试连接…'}</span>
      </div>
    );
  }

  if (result?.ok) {
    return (
      <div className="mc-conn-result" role="status">
        <div className="mc-conn-line">
          <span className="mc-badge mc-badge-ok">
            <IconCheck size={11} /> {successLabel}
          </span>
          {timeStr && <span className="mc-field-hint" style={{ fontSize: 11 }}>{timeStr}</span>}
        </div>
      </div>
    );
  }

  const failMessage = error || result?.messageZh || result?.messageEn || copy.failed || '连接失败';
  const hint = result?.hintZh || result?.hintEn || '';

  return (
    <div className="mc-conn-result" role="alert">
      <div className="mc-alert mc-alert-err" style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div className="mc-conn-line">
          <span className="mc-badge mc-badge-err">{copy.failed || '连接失败'}</span>
          <span style={{ fontSize: 12, fontWeight: 500 }}>{failMessage}</span>
        </div>
        {hint && (
          <div style={{ fontSize: 11.5 }}>
            {copy.hintLabel ? `${copy.hintLabel}：` : ''}{hint}
          </div>
        )}
        {result?.retryable && (
          <div style={{ fontSize: 11.5, opacity: 0.9 }}>{copy.retryableNote || '该错误通常为临时网络或限流，可直接重试'}</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 2 }}>
          {keyUrl && (
            <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.openExternal(keyUrl)}>
              打开密钥页
            </button>
          )}
          {result && (
            <button type="button" className="mc-btn mc-btn-sm mc-btn-ghost" onClick={() => setShowDetail(v => !v)}>
              {showDetail ? (copy.detailHide || '收起详情') : (copy.detailShow || '展开详情')}
            </button>
          )}
          {onOpenDiagnostics && (
            <button type="button" className="mc-btn mc-btn-sm mc-btn-ghost" onClick={onOpenDiagnostics}>
              复制诊断信息
            </button>
          )}
        </div>
        {showDetail && result && (
          <div className="mc-conn-detail">
            {result.code && <div><strong>{copy.detailCode || '状态码'}：</strong>{result.code}</div>}
            {result.providerRequestId && <div><strong>{copy.detailRequestId || '请求 ID'}：</strong>{result.providerRequestId}</div>}
            {timeStr && <div><strong>{copy.detailTime || '时间'}：</strong>{timeStr}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export function renderProviderConnectionResult(tCopy, state, keyUrl, onOpenDiagnostics) {
  if (!state) return null;
  return (
    <ErrorBoundary inline fallbackLabel="连接测试结果显示异常">
      <ProviderConnectionResult copy={tCopy} state={state} keyUrl={keyUrl} onOpenDiagnostics={onOpenDiagnostics} />
    </ErrorBoundary>
  );
}
