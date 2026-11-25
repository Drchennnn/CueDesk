import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getActiveAttempt, projectLegacyTurns } from '../core/sessionModel.js';
import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconDownload,
  IconEdit,
  IconFolder,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconShield,
  IconSparkles,
  IconSpeaker,
  IconTrash,
  IconX
} from './Icons.jsx';
import { EvidencePanel, ModelAnswers, Switch, cleanAnswerReferences } from './SharedWidgets.jsx';

function renderInlineMd(text) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, idx) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={idx}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={idx} className="mc-inline-code">{p.slice(1, -1)}</code>;
    return <React.Fragment key={idx}>{p}</React.Fragment>;
  });
}

function formatDateTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return '—';
  }
}

function formatBytes(n) {
  if (!n) return '0 KB';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function computeLineDiff(beforeText, afterText) {
  const a = String(beforeText || '').split(/\r?\n/);
  const b = String(afterText || '').split(/\r?\n/);
  const rows = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const la = a[i];
    const lb = b[i];
    if (la === lb) rows.push({ kind: 'same', line: i + 1, text: la ?? '' });
    else {
      if (la !== undefined) rows.push({ kind: 'del', line: i + 1, text: la });
      if (lb !== undefined) rows.push({ kind: 'add', line: i + 1, text: lb });
    }
  }
  return rows;
}

const SOURCE_LABELS = {
  'external-agent': '外部 Agent / 文件变更',
  'app-edit': '应用内编辑',
  approval: '审核门禁通过',
  rollback: '版本回滚'
};

function DualTrackAudioPlayer({ sessionId }) {
  const [takes, setTakes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeKey, setActiveKey] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [speed, setSpeed] = useState(1);
  const audioElRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void window.mc.listRecordings?.(sessionId)
      .then((res) => { if (alive) setTakes(res?.takes || []); })
      .catch((e) => { if (alive) setError(e.message || '读取录音失败'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sessionId]);

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  useEffect(() => {
    if (audioElRef.current) audioElRef.current.playbackRate = speed;
  }, [speed, audioUrl]);

  const loadTrack = async (takeId, channel) => {
    const key = `${takeId}:${channel}`;
    setError('');
    try {
      const res = await window.mc.readRecordingTrack({ sessionId, takeId, channel });
      const blob = new Blob([res.data], { type: res.mime || 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
      setActiveKey(key);
    } catch (e) {
      setError(`加载音轨失败：${e.message}`);
    }
  };

  if (loading) return <div className="mc-alert">正在扫描本场录音文件…</div>;
  if (!takes.length) {
    return (
      <div className="mc-card">
        <div className="mc-card-body">
          <div className="mc-field-hint">
            本场面试暂无 WAV 录音文件。在工作台顶栏点击「录制」按钮即可随时手动启停双轨整场录音（对方轨 + 本人轨）。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="mc-field-hint">共 {takes.length} 段 WAV 录音（独立存于应用录音目录，不占知识库 Git）</span>
        <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.openRecordingFolder?.(sessionId)}>
          <IconFolder size={13} /> 打开本场录音目录
        </button>
      </div>
      {error && <div className="mc-alert mc-alert-err">{error}</div>}
      {audioUrl && (
        <div className="mc-card">
          <div className="mc-card-body" style={{ gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 12.5 }}>正在播放：{activeKey.endsWith(':me') ? '本人声道 (me.wav)' : '对方声道 (them.wav)'}</strong>
              <div style={{ display: 'flex', gap: 4 }}>
                {[0.75, 1, 1.25, 1.5, 2].map(r => (
                  <button
                    key={r}
                    type="button"
                    className={`mc-btn mc-btn-sm ${speed === r ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
                    style={{ height: 22, padding: '0 7px', fontSize: 11 }}
                    onClick={() => setSpeed(r)}
                  >
                    {r}x
                  </button>
                ))}
              </div>
            </div>
            <audio ref={audioElRef} controls autoPlay src={audioUrl} style={{ width: '100%', height: 36 }} />
          </div>
        </div>
      )}
      {takes.map((take, idx) => (
        <div key={take.takeId} className="mc-card">
          <div className="mc-card-head">
            <strong style={{ fontSize: 13 }}>录音分段 #{idx + 1} · 时长 {formatDuration(take.durationSec)}</strong>
            <span className="mc-field-hint">{formatDateTime(take.startedAt)}</span>
          </div>
          <div className="mc-card-body" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {take.tracks.map(tr => {
              const key = `${take.takeId}:${tr.channel}`;
              const isPlaying = activeKey === key;
              return (
                <button
                  key={tr.channel}
                  type="button"
                  className={`mc-btn mc-btn-sm ${isPlaying ? 'mc-btn-primary' : ''}`}
                  onClick={() => void loadTrack(take.takeId, tr.channel)}
                >
                  <IconSpeaker size={12} />
                  {tr.channel === 'me' ? '播放本人轨 (me.wav)' : '播放对方轨 (them.wav)'}
                  <span style={{ opacity: 0.75 }}>· {formatDuration(tr.durationSec)} · {formatBytes(tr.bytes)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentArchiveReviewTab({ session, library }) {
  const roles = library?.roles || [];
  const [roleDir, setRoleDir] = useState(session.role || library?.role || roles[0] || '');
  const [roundLabel, setRoundLabel] = useState('一面');
  const [nextStatus, setNextStatus] = useState('waiting');
  const [feeling, setFeeling] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const runArchive = async () => {
    if (!roleDir) {
      setError('请先选择目标岗位目录（可在「知识库」中一键新建标准岗位）');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await window.mc.memoryArchiveSession({
        session,
        roleDirectory: roleDir,
        roundLabel: roundLabel.trim() || '一面',
        nextStatus,
        userFeeling: feeling
      });
      setResult(res);
    } catch (e) {
      setError(e.message || '归档失败');
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    if (!result?.agentPrompt) return;
    try {
      await navigator.clipboard.writeText(result.agentPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="mc-card">
        <div className="mc-card-head">
          <div>
            <h3 className="mc-card-title">一键归档并交由 Codex / Antigravity 深度复盘</h3>
            <p className="mc-card-desc">
              按《复盘与更新规则》将原始转录、AI 对照草稿与双轨 WAV 路径指针落盘到对应岗位档案（不复制大音频进 Git），并生成即贴即用的 Agent 复盘指令。
            </p>
          </div>
        </div>
        <div className="mc-card-body" style={{ gap: 12 }}>
          <div className="mc-grid-2">
            <div className="mc-field">
              <label className="mc-field-label">归档目标岗位目录</label>
              <select className="mc-select" value={roleDir} onChange={e => setRoleDir(e.target.value)}>
                <option value="">请选择岗位…</option>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="mc-field">
              <label className="mc-field-label">本场面试轮次 & 更新状态</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="mc-input" style={{ flex: 1 }} value={roundLabel} onChange={e => setRoundLabel(e.target.value)} placeholder="一面 / 二面 / HR面" />
                <select className="mc-select" style={{ width: 112 }} value={nextStatus} onChange={e => setNextStatus(e.target.value)}>
                  <option value="waiting">待结果</option>
                  <option value="interviewing">面试中</option>
                  <option value="offer">已获 Offer</option>
                  <option value="closed">已结束</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mc-field">
            <label className="mc-field-label">
              <span>本次面试主观体验与补充感受（可选）</span>
              <span className="mc-field-hint">留空则由 Agent 按规则「模式 B」分析原始转录中的卡壳/绕圈特征</span>
            </label>
            <textarea
              className="mc-textarea"
              rows={3}
              value={feeling}
              onChange={e => setFeeling(e.target.value)}
              placeholder="例如：今天整体像聊天不太紧张，但被追问 LangChain 底层工具调用参数时卡壳了…"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="mc-btn mc-btn-primary" disabled={busy || !library?.root} onClick={() => void runArchive()}>
              <IconSparkles size={14} /> {busy ? '正在归档…' : '归档本场并生成 Agent 复盘指令'}
            </button>
            {!library?.root && <span className="mc-field-hint">请先在「知识库」配置资料根目录</span>}
          </div>

          {error && <div className="mc-alert mc-alert-err">{error}</div>}
        </div>
      </section>

      {result && (
        <section className="mc-card">
          <div className="mc-card-head">
            <div>
              <h3 className="mc-card-title">已归档至：{result.relArchive}</h3>
              <p className="mc-card-desc">直接复制下方指令发送给 Codex 或 Antigravity；Agent 更新 `面试记忆/` 后，回到本页「记忆动态」即可审查 Diff 与一键回滚。</p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.memoryOpenPath?.(result.archiveDir)}>
                <IconFolder size={13} /> 打开归档目录
              </button>
              <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={() => void copyPrompt()}>
                {copied ? <><IconCheck size={12} /> 已复制指令</> : <><IconCopy size={12} /> 一键复制给 Agent</>}
              </button>
            </div>
          </div>
          <div className="mc-card-body">
            <pre className="mc-evidence-excerpt" style={{ maxHeight: 280 }}>{result.agentPrompt}</pre>
          </div>
        </section>
      )}
    </div>
  );
}

export function RecordsView({
  sessions,
  activeSessionId,
  library,
  workbenchPrefs,
  onUpdateWorkbenchPrefs,
  onResumeFromRecord,
  onRenameSession,
  onDeleteSession
}) {
  // Unified 2-level nav: 'my-memory' | 'memory-activity' | 'memory-settings' | 'interview-records' | 'written-records'
  const [navSection, setNavSection] = useState('interview-records');
  const [memState, setMemState] = useState(null);
  const [memLoading, setMemLoading] = useState(false);
  const [memError, setMemError] = useState('');
  const [memToast, setMemToast] = useState('');
  const [memSearch, setMemSearch] = useState('');
  const [activeBucketId, setActiveBucketId] = useState('weakness_pitfall');
  const [newItemText, setNewItemText] = useState('');
  const [editingRaw, setEditingRaw] = useState(false);
  const [rawDraft, setRawDraft] = useState('');

  // Snapshot diff state
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [snapDiff, setSnapDiff] = useState(null);
  const [approveTarget, setApproveTarget] = useState('weakness_pitfall');

  // Records state
  const [search, setSearch] = useState('');
  const [timeRange, setTimeRange] = useState('all'); // 'all' | 'today' | '7d' | '30d'
  const [selectedId, setSelectedId] = useState(null);
  const [detailTab, setDetailTab] = useState('qa'); // 'qa' | 'transcript' | 'audio' | 'review'
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const notifyMem = useCallback((msg) => {
    setMemToast(msg);
    setTimeout(() => setMemToast(prev => (prev === msg ? '' : prev)), 2600);
  }, []);

  const refreshMemory = useCallback(async () => {
    if (!library?.root) {
      setMemState(null);
      return;
    }
    setMemLoading(true);
    setMemError('');
    try {
      const st = await window.mc.memoryGet?.();
      setMemState(st || null);
    } catch (e) {
      setMemError(e.message || '加载记忆库失败');
    } finally {
      setMemLoading(false);
    }
  }, [library?.root]);

  useEffect(() => {
    void refreshMemory();
  }, [refreshMemory, navSection]);

  const activeBucket = useMemo(
    () => (memState?.buckets || []).find(b => b.id === activeBucketId) || memState?.buckets?.[0] || null,
    [memState, activeBucketId]
  );

  useEffect(() => {
    if (activeBucket && !editingRaw) setRawDraft(activeBucket.content || '');
  }, [activeBucket, editingRaw]);

  const inspectSnapshot = async (version) => {
    setSelectedVersion(version);
    try {
      const d = await window.mc.memoryDiff(version);
      setSnapDiff(d);
    } catch (e) {
      setMemError(e.message);
    }
  };

  const handleAppendItem = async (e) => {
    e.preventDefault();
    if (!newItemText.trim() || !activeBucket) return;
    try {
      const st = await window.mc.memoryAppendItem({ bucket: activeBucket.id, text: newItemText.trim() });
      setMemState(st);
      setNewItemText('');
      notifyMem(`已追加至「${activeBucket.title}」并生成快照 v${st.latestVersion}`);
    } catch (err) {
      setMemError(err.message);
    }
  };

  const handleSaveRawBucket = async () => {
    if (!activeBucket) return;
    try {
      const st = await window.mc.memorySaveBucket({ bucket: activeBucket.id, content: rawDraft });
      setMemState(st);
      setEditingRaw(false);
      notifyMem(`已保存「${activeBucket.title}」· 快照 v${st.latestVersion}`);
    } catch (err) {
      setMemError(err.message);
    }
  };

  const handleResolvePending = async (lineIndex, decision) => {
    try {
      const st = await window.mc.memoryResolvePending({
        lineIndex,
        decision,
        targetBucket: approveTarget
      });
      setMemState(st);
      notifyMem(decision === 'approve' ? '已审核通过并并入记忆' : '已驳回待审核事实');
    } catch (err) {
      setMemError(err.message);
    }
  };

  const handleRollback = async (version) => {
    try {
      const st = await window.mc.memoryRollback(version);
      setMemState(st);
      setSnapDiff(null);
      notifyMem(`已安全回滚至 v${version}（已留存新快照 v${st.latestVersion}）`);
    } catch (err) {
      setMemError(err.message);
    }
  };

  // Records filtering
  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const cutoff = timeRange === 'today'
      ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
      : timeRange === '7d'
        ? now - 7 * 86400 * 1000
        : timeRange === '30d'
          ? now - 30 * 86400 * 1000
          : 0;
    const wantWritten = navSection === 'written-records';
    return [...(sessions || [])]
      .filter(s => (wantWritten ? s.scene === 'written' : s.scene !== 'written'))
      .filter(s => !cutoff || (s.updatedAt || s.createdAt || 0) >= cutoff)
      .filter(s => !q || (s.name || '').toLowerCase().includes(q) || (s.role || '').toLowerCase().includes(q) || (s.questions || []).some(item => item.prompt.toLowerCase().includes(q)))
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }, [sessions, search, timeRange, navSection]);

  const selected = useMemo(
    () => (selectedId ? (sessions || []).find(s => s.id === selectedId) || null : null),
    [sessions, selectedId]
  );

  const handleExport = async (session, mode) => {
    setExportBusy(true);
    setExportMsg('');
    try {
      const exportPayload = { ...session, turns: projectLegacyTurns(session) };
      const res = await window.mc.exportInterview({ session: exportPayload, mode });
      setExportMsg(res?.canceled ? '已取消导出' : `已导出至：${res?.path}`);
    } catch (e) {
      setExportMsg('导出失败：' + e.message);
    } finally {
      setExportBusy(false);
    }
  };

  const copyAnswer = async (id, text) => {
    try {
      await navigator.clipboard.writeText(cleanAnswerReferences(text));
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1200);
    } catch {}
  };

  const pendingItems = useMemo(() => {
    const pb = (memState?.buckets || []).find(b => b.id === 'pending_fact');
    return (pb?.items || []).filter(i => i.pending);
  }, [memState]);

  // If inspecting a specific session detail, render full-width 4-tab detail view
  if (selected) {
    const questions = selected.questions || [];
    const segments = selected.segments || [];
    const isLive = selected.id === activeSessionId;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <header className="mc-page-header" style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <button type="button" className="mc-icon-btn" onClick={() => { setSelectedId(null); setExportMsg(''); setEditingName(false); }} title="返回记录列表">
              <IconArrowLeft size={16} />
            </button>
            {editingName ? (
              <input
                className="mc-input"
                style={{ width: 260, height: 28, padding: '2px 8px' }}
                value={nameDraft}
                autoFocus
                onChange={e => setNameDraft(e.target.value)}
                onBlur={() => { if (nameDraft.trim()) onRenameSession(selected.id, nameDraft.trim()); setEditingName(false); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { if (nameDraft.trim()) onRenameSession(selected.id, nameDraft.trim()); setEditingName(false); }
                  else if (e.key === 'Escape') setEditingName(false);
                }}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <h1 className="mc-page-title" style={{ fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selected.name}
                </h1>
                <button type="button" className="mc-icon-btn" title="重命名记录" onClick={() => { setNameDraft(selected.name); setEditingName(true); }}>
                  <IconEdit size={13} />
                </button>
                {isLive && <span className="mc-badge mc-badge-ok">当前进行中</span>}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={() => onResumeFromRecord(selected.id)}>
              <IconPlay size={11} /> {isLive ? '回到工作台' : '从记录继续'}
            </button>
            <button type="button" className="mc-btn mc-btn-sm" onClick={() => setDetailTab('review')}>
              <IconSparkles size={12} /> 归档 & Agent 复盘
            </button>
            <button type="button" className="mc-btn mc-btn-sm" disabled={exportBusy} onClick={() => void handleExport(selected, 'raw')}>
              <IconDownload size={12} /> 原始文本
            </button>
            <button type="button" className="mc-btn mc-btn-sm" disabled={exportBusy} onClick={() => void handleExport(selected, 'json')}>
              JSON
            </button>
          </div>
        </header>

        <div className="mc-tabs-row">
          <button type="button" className={`mc-tab-btn${detailTab === 'qa' ? ' is-active' : ''}`} onClick={() => setDetailTab('qa')}>
            问答记录 ({questions.length})
          </button>
          <button type="button" className={`mc-tab-btn${detailTab === 'transcript' ? ' is-active' : ''}`} onClick={() => setDetailTab('transcript')}>
            实时转写 ({segments.length})
          </button>
          <button type="button" className={`mc-tab-btn${detailTab === 'audio' ? ' is-active' : ''}`} onClick={() => setDetailTab('audio')}>
            双轨录音
          </button>
          <button type="button" className={`mc-tab-btn${detailTab === 'review' ? ' is-active' : ''}`} onClick={() => setDetailTab('review')}>
            归档与 Agent 复盘
          </button>
          <span className="mc-field-hint" style={{ marginLeft: 'auto' }}>
            {formatDateTime(selected.createdAt)} · {selected.audioSource === 'mic' ? '麦克风' : '系统音频'}
            {selected.role ? ` · ${selected.role}` : ''}
          </span>
        </div>

        <div className="mc-page-scroll">
          <div className="mc-page-inner">
            {(exportBusy || exportMsg) && (
              <div className={`mc-alert ${exportMsg.startsWith('导出失败') ? 'mc-alert-err' : 'mc-alert-ok'}`}>
                {exportBusy ? '正在导出…' : exportMsg}
              </div>
            )}

            {detailTab === 'review' ? (
              <AgentArchiveReviewTab session={selected} library={library} />
            ) : detailTab === 'audio' ? (
              <DualTrackAudioPlayer sessionId={selected.id} />
            ) : detailTab === 'qa' ? (
              questions.length > 0 ? (
                questions.map((q) => {
                  const attempt = getActiveAttempt(q);
                  return (
                    <article key={q.id} className="mc-card">
                      <div className="mc-card-head">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span className="mc-badge">#{q.ordinal}</span>
                          <strong style={{ fontSize: 13.5, overflowWrap: 'anywhere' }}>{q.prompt}</strong>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          {q.attempts.length > 1 && <span className="mc-badge">{q.attempts.length} 个版本</span>}
                          {attempt?.status === 'cancelled' && <span className="mc-badge mc-badge-warn">已取消</span>}
                          {attempt?.status === 'error' && <span className="mc-badge mc-badge-err">错误</span>}
                          {attempt?.text && (
                            <button type="button" className="mc-btn mc-btn-sm" onClick={() => void copyAnswer(q.id, attempt.text)}>
                              {copiedId === q.id ? <><IconCheck size={12} /> 已复制</> : <><IconCopy size={12} /> 复制</>}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="mc-card-body">
                        {attempt?.modelResults?.length > 0 ? (
                          <ModelAnswers results={attempt.modelResults} />
                        ) : attempt?.status === 'error' ? (
                          <div className="mc-alert mc-alert-err">{attempt.error || '生成失败'}</div>
                        ) : (
                          <div className="mc-answer-prose" style={{ fontSize: 13.5, lineHeight: 1.75 }}>
                            {cleanAnswerReferences(attempt?.text || '') || '（无回答内容）'}
                          </div>
                        )}
                        <EvidencePanel attempt={attempt} />
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="mc-alert">本场记录暂无问答条目。</div>
              )
            ) : (
              segments.length > 0 ? (
                <div className="mc-card">
                  <div className="mc-card-body">
                    {segments.map((seg) => (
                      <div key={seg.id} style={{ padding: '8px 10px', borderRadius: 8, background: seg.speaker === 'me' ? 'var(--info-bg)' : 'var(--bg-subtle)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                          <strong>{seg.speaker === 'me' ? '我' : '对方'}</strong>
                          <span>{formatDateTime(seg.endTs)}</span>
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.6 }}>{seg.text}</div>
                        {seg.translation && <div className="mc-field-hint" style={{ marginTop: 4 }}>译：{seg.translation}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mc-alert">本场记录暂无语音转写片段。</div>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mc-settings-root">
      <header className="mc-settings-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 className="mc-page-title" style={{ fontSize: 18 }}>记忆与记录</h1>
          <span className="mc-field-hint" role="status">
            {memToast || (memState ? `记忆快照 v${memState.latestVersion}${memState.pendingCount > 0 ? ` · ${memState.pendingCount} 条待审核` : ''}` : '面试进化闭环')}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {library?.root && (
            <>
              <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.memoryOpenDir?.()}>
                <IconFolder size={13} /> 打开记忆目录
              </button>
              <button type="button" className="mc-btn mc-btn-sm" onClick={() => void refreshMemory()}>
                <IconRefresh size={13} /> 同步外部变更
              </button>
            </>
          )}
        </div>
      </header>

      <div className="mc-settings-body">
        {/* SuiSi-style 2-level vertical navigation */}
        <nav className="mc-settings-nav" aria-label="记忆与记录导航">
          <div className="mc-settings-nav-group">
            <div className="mc-settings-nav-label">面试记忆库</div>
            <button
              type="button"
              className="mc-settings-tab"
              aria-selected={navSection === 'my-memory'}
              onClick={() => setNavSection('my-memory')}
            >
              我的记忆
            </button>
            <button
              type="button"
              className="mc-settings-tab"
              aria-selected={navSection === 'memory-activity'}
              onClick={() => setNavSection('memory-activity')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span>记忆动态与版本</span>
              {pendingItems.length > 0 && <span className="mc-badge mc-badge-warn">{pendingItems.length}</span>}
            </button>
            <button
              type="button"
              className="mc-settings-tab"
              aria-selected={navSection === 'memory-settings'}
              onClick={() => setNavSection('memory-settings')}
            >
              记忆设置
            </button>
          </div>

          <div className="mc-settings-nav-group">
            <div className="mc-settings-nav-label">最近记录</div>
            <button
              type="button"
              className="mc-settings-tab"
              aria-selected={navSection === 'interview-records'}
              onClick={() => setNavSection('interview-records')}
            >
              面试记录 ({(sessions || []).filter(s => s.scene !== 'written').length})
            </button>
            <button
              type="button"
              className="mc-settings-tab"
              aria-selected={navSection === 'written-records'}
              onClick={() => setNavSection('written-records')}
            >
              笔试记录 ({(sessions || []).filter(s => s.scene === 'written').length})
            </button>
          </div>
        </nav>

        <div className="mc-settings-scroll">
          <div className="mc-settings-container" style={{ maxWidth: 860 }}>
            {memError && <div className="mc-alert mc-alert-err">{memError}</div>}

            {/* SECTION 1: MY MEMORY */}
            {navSection === 'my-memory' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
                  <div>
                    <h2 className="mc-settings-cat-title">我的面试记忆（文件协议 · Agent 协同）</h2>
                    <p className="mc-settings-cat-desc">
                      直连 <code>面试记忆/</code> 目录，Codex / Antigravity 复盘写入后自动检测变更并打版本快照，实时面试按字数预算轻量注入。
                    </p>
                  </div>
                  <div className="mc-search-wrap" style={{ width: 200 }}>
                    <span className="mc-search-icon"><IconSearch size={13} /></span>
                    <input className="mc-search-input" value={memSearch} onChange={e => setMemSearch(e.target.value)} placeholder="搜索记忆条目…" />
                  </div>
                </div>

                {!library?.root ? (
                  <div className="mc-alert mc-alert-warn">尚未配置本地资料库目录，请先在「知识库」中绑定目录。</div>
                ) : memLoading && !memState ? (
                  <div className="mc-field-hint">正在读取面试记忆库…</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(memState?.buckets || []).map(b => (
                        <button
                          key={b.id}
                          type="button"
                          className={`mc-btn mc-btn-sm ${activeBucket?.id === b.id ? 'mc-btn-primary' : ''}`}
                          onClick={() => { setActiveBucketId(b.id); setEditingRaw(false); }}
                        >
                          {b.title} ({b.items.length})
                        </button>
                      ))}
                    </div>

                    {activeBucket && (
                      <section className="mc-card">
                        <div className="mc-card-head">
                          <div>
                            <h3 className="mc-card-title">{activeBucket.title}</h3>
                            <p className="mc-card-desc">{activeBucket.desc}</p>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className={`mc-btn mc-btn-sm ${editingRaw ? 'mc-btn-primary' : ''}`}
                              onClick={() => { setRawDraft(activeBucket.content); setEditingRaw(v => !v); }}
                            >
                              <IconEdit size={12} /> {editingRaw ? '取消源码编辑' : '编辑 Markdown'}
                            </button>
                          </div>
                        </div>

                        {editingRaw ? (
                          <div className="mc-card-body" style={{ gap: 8 }}>
                            <textarea
                              className="mc-textarea"
                              rows={14}
                              style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6 }}
                              value={rawDraft}
                              onChange={e => setRawDraft(e.target.value)}
                              spellCheck={false}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                              <button type="button" className="mc-btn mc-btn-sm" onClick={() => setEditingRaw(false)}>取消</button>
                              <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={() => void handleSaveRawBucket()}>
                                <IconCheck size={12} /> 保存并生成快照
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mc-card-body" style={{ gap: 10 }}>
                            <form onSubmit={handleAppendItem} style={{ display: 'flex', gap: 6 }}>
                              <input
                                className="mc-input"
                                value={newItemText}
                                onChange={e => setNewItemText(e.target.value)}
                                placeholder={`向「${activeBucket.title}」手动追加 1 条记忆…`}
                              />
                              <button type="submit" className="mc-btn mc-btn-sm mc-btn-primary" disabled={!newItemText.trim()}>
                                <IconPlus size={12} /> 追加
                              </button>
                            </form>

                            {activeBucket.items
                              .filter(it => !memSearch.trim() || it.text.toLowerCase().includes(memSearch.trim().toLowerCase()))
                              .map((it, idx) => (
                                <div key={`${it.lineIndex}-${idx}`} className="mc-evidence-item">
                                  <div style={{ fontSize: 13, lineHeight: 1.65, userSelect: 'text' }}>{renderInlineMd(it.text)}</div>
                                </div>
                              ))}
                            {activeBucket.items.length === 0 && (
                              <div className="mc-field-hint" style={{ padding: '12px 0' }}>
                                当前分区暂无条目。可在上方手动追加，或在复盘时让 Codex / Antigravity 按《复盘与更新规则》写入。
                              </div>
                            )}
                          </div>
                        )}
                      </section>
                    )}
                  </>
                )}
              </>
            )}

            {/* SECTION 2: MEMORY ACTIVITY, PENDING FACT GATE & VERSION SNAPSHOTS */}
            {navSection === 'memory-activity' && (
              <>
                <div>
                  <h2 className="mc-settings-cat-title">记忆动态、事实审核门禁与版本回滚</h2>
                  <p className="mc-settings-cat-desc">
                    每次你或外部 Agent 修改 <code>面试记忆/</code> 时，应用自动留存版本快照；个人新事实必须经下方门禁确认才进入正式记忆。
                  </p>
                </div>

                {/* Pending Fact Approval Gate */}
                <section className="mc-card">
                  <div className="mc-card-head">
                    <div>
                      <h3 className="mc-card-title">
                        <IconShield size={14} /> 待审核新事实门禁 ({pendingItems.length})
                      </h3>
                      <p className="mc-card-desc">确认前严格不进入实时面试提示，彻底防止外部复盘误写引发事实幻觉。</p>
                    </div>
                    <select
                      className="mc-select"
                      style={{ width: 170, height: 28, fontSize: 12 }}
                      value={approveTarget}
                      onChange={e => setApproveTarget(e.target.value)}
                      aria-label="审核通过目标分区"
                    >
                      <option value="weakness_pitfall">通过后并入：薄弱项与踩坑</option>
                      <option value="speaking_style">通过后并入：表达与偏好</option>
                      <option value="company_insight">通过后并入：公司与岗位洞察</option>
                    </select>
                  </div>
                  <div className="mc-card-body" style={{ gap: 8 }}>
                    {pendingItems.length > 0 ? pendingItems.map((it) => (
                      <div key={it.lineIndex} className="mc-evidence-item">
                        <div style={{ fontSize: 13, lineHeight: 1.6 }}>{it.text}</div>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button type="button" className="mc-btn mc-btn-sm mc-btn-danger" onClick={() => void handleResolvePending(it.lineIndex, 'reject')}>
                            <IconX size={12} /> 驳回
                          </button>
                          <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={() => void handleResolvePending(it.lineIndex, 'approve')}>
                            <IconCheck size={12} /> 确认真实并并入
                          </button>
                        </div>
                      </div>
                    )) : (
                      <div className="mc-field-hint">当前无待审核新事实。当 Codex / Antigravity 在复盘中提出新项目细节时会自动出现在这里。</div>
                    )}
                  </div>
                </section>

                {/* Snapshot Timeline & Diff */}
                <section className="mc-card">
                  <div className="mc-card-head">
                    <div>
                      <h3 className="mc-card-title">版本快照历史 ({(memState?.snapshots || []).length})</h3>
                      <p className="mc-card-desc">点击任意版本查看前后 Diff 对比，支持一键无损回滚。</p>
                    </div>
                  </div>
                  <div className="mc-card-body" style={{ gap: 8 }}>
                    {(memState?.snapshots || []).map(snap => (
                      <div
                        key={snap.version}
                        className="mc-record-card"
                        style={{
                          padding: '10px 12px',
                          cursor: 'pointer',
                          borderColor: selectedVersion === snap.version ? 'var(--primary)' : undefined
                        }}
                        onClick={() => void inspectSnapshot(snap.version)}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <strong style={{ fontSize: 13 }}>v{snap.version}</strong>
                            <span className="mc-badge">{SOURCE_LABELS[snap.source] || snap.source}</span>
                            <span style={{ fontSize: 12.5 }}>{snap.summary}</span>
                          </div>
                          <div className="mc-field-hint">{formatDateTime(snap.createdAt)}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                          <button type="button" className="mc-btn mc-btn-sm" onClick={() => void inspectSnapshot(snap.version)}>
                            查看 Diff
                          </button>
                          {snap.version !== memState?.latestVersion && (
                            <button type="button" className="mc-btn mc-btn-sm" onClick={() => void handleRollback(snap.version)}>
                              回滚到此版
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {snapDiff && (
                  <section className="mc-card">
                    <div className="mc-card-head">
                      <div>
                        <h3 className="mc-card-title">快照 Diff：v{snapDiff.prevVersion} → v{snapDiff.version}</h3>
                        <p className="mc-card-desc">{snapDiff.summary}</p>
                      </div>
                      <button type="button" className="mc-icon-btn" onClick={() => setSnapDiff(null)}><IconX size={14} /></button>
                    </div>
                    <div className="mc-card-body" style={{ gap: 12 }}>
                      {snapDiff.files.filter(f => f.changed).map(f => (
                        <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <strong style={{ fontSize: 12.5 }}>{f.title}</strong>
                          <div className="mc-kb-diff-box" style={{ maxHeight: 240 }}>
                            {computeLineDiff(f.before, f.after).filter(r => r.kind !== 'same').map((row, i) => (
                              <div key={i} className={`mc-kb-diff-line is-${row.kind}`}>
                                <span className="mc-kb-diff-ln">{row.line}</span>
                                <span className="mc-kb-diff-sign">{row.kind === 'add' ? '+' : '-'}</span>
                                <span>{row.text}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {/* SECTION 3: MEMORY SETTINGS */}
            {navSection === 'memory-settings' && (
              <>
                <div>
                  <h2 className="mc-settings-cat-title">记忆注入与复盘协同设置</h2>
                  <p className="mc-settings-cat-desc">控制实时面试时是否注入 ② 层记忆，以及单次注入的字符预算上限。</p>
                </div>

                <section className="mc-card">
                  <div className="mc-srow mc-srow-compact">
                    <div>
                      <div className="mc-srow-label">实时面试自动召回 ② 层面试记忆</div>
                      <div className="mc-srow-desc">将「表达偏好 / 薄弱避坑 / 当前公司洞察」注入系统提示，强制排除「待审核新事实」</div>
                    </div>
                    <div className="mc-srow-control is-inline">
                      <Switch
                        checked={workbenchPrefs?.memoryRecallEnabled !== false}
                        onChange={(v) => void onUpdateWorkbenchPrefs?.({ memoryRecallEnabled: v })}
                        aria-label="开启实时面试记忆召回"
                      />
                    </div>
                  </div>
                  <div className="mc-srow mc-srow-compact">
                    <div>
                      <div className="mc-srow-label">单次注入字符预算上限 ({workbenchPrefs?.memoryMaxChars ?? 900} 字)</div>
                      <div className="mc-srow-desc">严格限额以保证低首字延迟，同时防止挤占核心项目证据上下文</div>
                    </div>
                    <div className="mc-srow-control is-inline">
                      <input
                        type="range"
                        min={200}
                        max={2000}
                        step={100}
                        value={workbenchPrefs?.memoryMaxChars ?? 900}
                        onChange={e => void onUpdateWorkbenchPrefs?.({ memoryMaxChars: Number(e.target.value) })}
                      />
                      <span style={{ minWidth: 52, textAlign: 'right', fontSize: 12 }}>{workbenchPrefs?.memoryMaxChars ?? 900} 字</span>
                    </div>
                  </div>
                  <div className="mc-srow mc-srow-compact">
                    <div>
                      <div className="mc-srow-label">外部复盘变更自动提醒同步候选人画像</div>
                      <div className="mc-srow-desc">当检测到外部 Agent 写入新的待审核事实时，在导航栏显示角标提醒核对</div>
                    </div>
                    <div className="mc-srow-control is-inline">
                      <Switch
                        checked={workbenchPrefs?.memoryAutoRemind !== false}
                        onChange={(v) => void onUpdateWorkbenchPrefs?.({ memoryAutoRemind: v })}
                      />
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* SECTION 4 & 5: INTERVIEW / WRITTEN RECORDS LIST */}
            {(navSection === 'interview-records' || navSection === 'written-records') && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <h2 className="mc-settings-cat-title">{navSection === 'written-records' ? '笔试记录' : '面试记录'}</h2>
                    <p className="mc-settings-cat-desc">点开任意场次即可回看问答、实时转写、双轨 WAV 录音，并一键归档发送给 Codex / 反重力复盘。</p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select className="mc-filter-select" value={timeRange} onChange={e => setTimeRange(e.target.value)} aria-label="按时间筛选">
                      <option value="all">全部时间</option>
                      <option value="today">今天</option>
                      <option value="7d">近 7 天</option>
                      <option value="30d">近 30 天</option>
                    </select>
                    <div className="mc-search-wrap" style={{ width: 200 }}>
                      <span className="mc-search-icon"><IconSearch size={13} /></span>
                      <input className="mc-search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索记录名称、岗位或问题…" />
                    </div>
                  </div>
                </div>

                {filteredSessions.length > 0 ? (
                  <div className="mc-record-list">
                    {filteredSessions.map((s) => {
                      const isLive = s.id === activeSessionId;
                      return (
                        <div key={s.id} className="mc-record-card" onClick={() => { setSelectedId(s.id); setDetailTab('qa'); }} style={{ cursor: 'pointer' }}>
                          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <strong style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</strong>
                              {isLive && <span className="mc-badge mc-badge-ok">进行中</span>}
                              {s.role && <span className="mc-badge mc-badge-info">{s.role}</span>}
                            </div>
                            <div className="mc-field-hint">
                              {formatDateTime(s.updatedAt || s.createdAt)} · {(s.questions || []).length} 个问题 · {(s.segments || []).length} 条转写 · {s.audioSource === 'mic' ? '麦克风' : '系统音频'}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                            <button type="button" className="mc-btn mc-btn-sm" onClick={() => { setSelectedId(s.id); setDetailTab('review'); }}>
                              <IconSparkles size={11} /> 复盘归档
                            </button>
                            <button type="button" className="mc-btn mc-btn-sm" onClick={() => onResumeFromRecord(s.id)}>
                              <IconPlay size={11} /> {isLive ? '继续' : '打开'}
                            </button>
                            {confirmDeleteId === s.id ? (
                              <>
                                <button type="button" className="mc-btn mc-btn-sm mc-btn-danger" onClick={() => { onDeleteSession(s.id); setConfirmDeleteId(null); }}>
                                  确认删除
                                </button>
                                <button type="button" className="mc-btn mc-btn-sm" onClick={() => setConfirmDeleteId(null)}>取消</button>
                              </>
                            ) : (
                              <button type="button" className="mc-icon-btn is-danger" title="删除记录及对应录音" disabled={isLive} onClick={() => setConfirmDeleteId(s.id)}>
                                <IconTrash size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '48px 16px', textAlign: 'center' }} className="mc-field-hint">
                    {search ? '没有匹配的记录' : '暂无本地记录。从首页启动一场面试后，问答、转写与双轨录音会自动保存在这里。'}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
