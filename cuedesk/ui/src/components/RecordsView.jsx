import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getActiveAttempt, projectLegacyTurns, summarizeWrittenCounts } from '../core/sessionModel.js';
import {
  IconArrowLeft,
  IconCheck,
  IconChevronRight,
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
import { CustomSelect } from './CustomSelect.jsx';
import { computeLineDiff } from '../core/lineDiff.js';

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
  const [ruleBusy, setRuleBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const runArchive = async () => {
    if (!roleDir) {
      setError('请先选择目标岗位目录（可在「知识库」中一键新建标准岗位）');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
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

  const generateStandardRulebook = async () => {
    setRuleBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await window.mc.memoryInitRulebook?.();
      if (created?.ok) {
        setNotice('已生成标准《复盘与更新规则.md》，并刷新外部 Agent 复盘指令。');
        if (result) {
          await runArchive();
        }
      }
    } catch (e) {
      setError(e.message || '生成规则文件失败');
    } finally {
      setRuleBusy(false);
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

  const prereq = result?.prerequisites;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="mc-card">
        <div className="mc-card-head">
          <div>
            <h3 className="mc-card-title">归档并交由 Agent 复盘</h3>
            <p className="mc-card-desc">落盘原始转录与截图后，复制指令交给 Agent 生成复盘并更新记忆。</p>
          </div>
        </div>
        <div className="mc-card-body" style={{ gap: 12 }}>
          <div className="mc-grid-2">
            <div className="mc-field">
              <label className="mc-field-label">归档目标岗位目录</label>
              <CustomSelect
                className="mc-select"
                ariaLabel="归档目标岗位目录"
                value={roleDir}
                onChange={setRoleDir}
                options={[
                  { value: '', label: '请选择岗位…' },
                  ...roles.map(r => ({ value: r, label: r }))
                ]}
              />
            </div>
            <div className="mc-field">
              <label className="mc-field-label">本场面试轮次 & 更新状态</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="mc-input" style={{ flex: 1 }} value={roundLabel} onChange={e => setRoundLabel(e.target.value)} placeholder="一面 / 二面 / HR面" />
                <CustomSelect
                  className="mc-select"
                  style={{ width: 112 }}
                  ariaLabel="归档后岗位状态"
                  value={nextStatus}
                  onChange={setNextStatus}
                  options={[
                    { value: 'waiting', label: '待结果' },
                    { value: 'interviewing', label: '面试中' },
                    { value: 'offer', label: '已获 Offer' },
                    { value: 'closed', label: '已结束' }
                  ]}
                />
              </div>
            </div>
          </div>

          <div className="mc-field">
            <label className="mc-field-label">
              <span>本次面试主观体验与补充感受（可选）</span>
              <span className="mc-field-hint">留空则提示外部 Agent 仅依据原始转录中的客观特征分析</span>
            </label>
            <textarea
              className="mc-textarea"
              rows={3}
              value={feeling}
              onChange={e => setFeeling(e.target.value)}
              placeholder="例如：今天整体像聊天不太紧张，但被追问某个细节时卡壳了…"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="mc-btn mc-btn-primary" disabled={busy || !library?.root} onClick={() => void runArchive()}>
              <IconSparkles size={14} /> {busy ? '正在归档…' : '归档本场并检查外部复盘依赖'}
            </button>
            {!library?.root && <span className="mc-field-hint">请先在「知识库」选择资料文件夹</span>}
          </div>

          {notice && <div className="mc-alert mc-alert-ok">{notice}</div>}
          {error && <div className="mc-alert mc-alert-err">{error}</div>}
        </div>
      </section>

      {result && (
        <section className="mc-card">
          <div className="mc-card-head">
            <div>
              <h3 className="mc-card-title">
                {result.updated
                  ? `① 已更新原有归档：${result.relArchive}`
                  : result.collisionResolved
                    ? `① 同日同轮次已有其他场次，已独立归档：${result.relArchive}`
                    : `① 已归档至本机：${result.relArchive}`}
              </h3>
              <p className="mc-card-desc">
                {result.updated
                  ? '检测到本场次此前已归档，已原地更新原文件。'
                  : '原始转录与元数据已写入本机目录。'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.memoryOpenPath?.(result.archiveDir)}>
                <IconFolder size={13} /> 打开归档目录
              </button>
              <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.memoryOpenPath?.(result.rawMdPath)}>
                打开转录与参考
              </button>
              <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.memoryOpenPath?.(result.sessionJsonPath)}>
                打开 session.json
              </button>
            </div>
          </div>
          <div className="mc-card-body" style={{ gap: 12 }}>
            {prereq && !prereq.rulebookExists ? (
              <div className="mc-alert mc-alert-warn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <strong>② 依赖检查：目录中暂无《复盘与更新规则.md》</strong>
                  <div style={{ fontSize: 12, marginTop: 2 }}>
                    下方指令已自动改为「自包含指令」（不引用不存在的文件），可直接使用；也可以一键在根目录生成标准规则文件供长期复用。
                  </div>
                </div>
                <button
                  type="button"
                  className="mc-btn mc-btn-sm mc-btn-primary"
                  disabled={ruleBusy}
                  style={{ flexShrink: 0 }}
                  onClick={() => void generateStandardRulebook()}
                >
                  {ruleBusy ? '正在生成…' : '生成标准规则'}
                </button>
              </div>
            ) : (
              <div className="mc-alert mc-alert-ok" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <strong>② 依赖检查通过：全部引用路径均存在于本机</strong>
                  <div style={{ fontSize: 12, marginTop: 2 }}>已包含规则文件《复盘与更新规则.md》与全部归档产物。</div>
                </div>
                {prereq?.rulebookPath && (
                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.memoryOpenPath?.(prereq.rulebookPath)}>
                    打开规则文件
                  </button>
                )}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <strong style={{ fontSize: 13 }}>③ 下一步：在外部 Codex / Antigravity 中运行复盘</strong>
                <div className="mc-field-hint">
                  复制下方指令粘贴到外部 Agent 会话，它会在本场目录产出 <code>转录校对版.md</code>、<code>面试复盘.md</code> 并更新 <code>面试记忆/</code>。
                </div>
              </div>
              <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" style={{ flexShrink: 0 }} onClick={() => void copyPrompt()}>
                {copied ? <><IconCheck size={12} /> 已复制指令</> : <><IconCopy size={12} /> 复制给外部 Agent</>}
              </button>
            </div>
            <pre className="mc-evidence-excerpt" style={{ maxHeight: 260 }}>{result.agentPrompt}</pre>
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
  onOpenMemorySettings,
  onResumeFromRecord,
  onRenameSession,
  onDeleteSession
}) {
  // Clean 2-level nav: 'my-memory' | 'memory-activity' | 'interview-records' | 'written-records' (memory settings moved to Settings → 通用偏好)
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

  // Snapshot diff, fold & tidy-nudge + pending gate state
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [snapDiff, setSnapDiff] = useState(null);
  const [showAllSnapshots, setShowAllSnapshots] = useState(false);
  const [tidyCopied, setTidyCopied] = useState(false);
  const [approveTarget, setApproveTarget] = useState('weakness_pitfall');
  const [pendingDrafts, setPendingDrafts] = useState({});
  const [pendingAgentPrompt, setPendingAgentPrompt] = useState('');
  const [pendingCopied, setPendingCopied] = useState(false);
  const [pendingBatchBusy, setPendingBatchBusy] = useState(false);

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
  const [expandedDateGroups, setExpandedDateGroups] = useState({});

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

  const defaultPendingAction = (text) => (
    /target:\s*(?:候选人画像|项目资料|简历)/i.test(String(text || '')) ? 'agent_truth' : 'memory_pitfall'
  );

  const getPendingDraft = (it) => pendingDrafts[it.lineIndex] || {
    action: defaultPendingAction(it.text),
    note: ''
  };

  const updatePendingDraft = (lineIndex, patch, fallbackText = '') => {
    setPendingDrafts(prev => ({
      ...prev,
      [lineIndex]: {
        action: prev[lineIndex]?.action || defaultPendingAction(fallbackText),
        note: prev[lineIndex]?.note || '',
        ...patch
      }
    }));
  };

  const handleGeneratePendingPrompt = async () => {
    if (!pendingItems.length) return;
    const truthItems = [];
    const memoryItems = [];
    const rejectItems = [];
    for (const it of pendingItems) {
      const d = getPendingDraft(it);
      const entry = { text: it.text, note: (d.note || '').trim() };
      if (d.action === 'agent_truth') truthItems.push(entry);
      else if (d.action === 'memory_pitfall') memoryItems.push(entry);
      else rejectItems.push(entry);
    }
    const rootPath = memState?.root || library?.root || '';
    const lines = [
      '请作为我的面试资料库维护 Agent，按以下本人已确认的审核意见和补充细节，精准更新对应真源文件与面试记忆，并清理 `面试记忆/待审核新事实.md`：',
      '',
      `- 资料库根目录：\`${rootPath}\``,
      `- 待审核队列文件：\`${rootPath}\\面试记忆\\待审核新事实.md\``,
      ''
    ];
    if (truthItems.length) {
      lines.push('### 1. 需要更新 ① 层真源（候选人画像 / 项目资料 / 简历）的条目');
      truthItems.forEach((x, idx) => {
        lines.push(`${idx + 1}. 原待审核条目：${x.text}`);
        lines.push(`   - 本人补充与边界说明：${x.note || '（按原条目事实确认，请保持保守边界，不夸大实战经历）'}`);
      });
      lines.push('');
    }
    if (memoryItems.length) {
      lines.push(`### 2. 仅精炼转入 ② 层面试记忆（${approveTarget === 'speaking_style' ? '表达与偏好.md' : approveTarget === 'company_insight' ? '公司与岗位洞察.md' : '薄弱项与踩坑.md'}）的条目`);
      memoryItems.forEach((x, idx) => {
        lines.push(`${idx + 1}. 原条目：${x.text}${x.note ? ` | 本人补充：${x.note}` : ''}`);
      });
      lines.push('');
    }
    if (rejectItems.length) {
      lines.push('### 3. 驳回/不采用的条目（请从待审核队列移除，保持现有保守口径）');
      rejectItems.forEach((x, idx) => {
        lines.push(`${idx + 1}. ${x.text}${x.note ? `（原因/补充：${x.note}）` : ''}`);
      });
      lines.push('');
    }
    lines.push('### 执行要求');
    lines.push('1. 涉及 `候选人画像.md` 时严格保持 `schema: 1` JSON 格式，不编造未确认的实战或线上经验；');
    lines.push('2. ② 层 `面试记忆/` 总有效字数尽量控制在注入预算内，精炼合并避免重复工单文案；');
    lines.push('3. 完成后把已处理条目在 `待审核新事实.md` 标记 `[x]` 或移除，并给我一份变更摘要。');
    const prompt = lines.join('\n');
    setPendingAgentPrompt(prompt);
    try {
      await navigator.clipboard.writeText(prompt);
      setPendingCopied(true);
      notifyMem('已复制待审核处理指令，可直接粘贴给 Agent 执行');
      setTimeout(() => setPendingCopied(false), 2000);
    } catch {
      notifyMem('已生成待审核处理指令，请在下方复制');
    }
  };

  const handleApplyLocalPendingBatch = async () => {
    const actions = [];
    for (const it of pendingItems) {
      const d = getPendingDraft(it);
      if (d.action === 'memory_pitfall') {
        actions.push({ lineIndex: it.lineIndex, decision: 'approve', targetBucket: approveTarget, note: d.note });
      } else if (d.action === 'reject') {
        actions.push({ lineIndex: it.lineIndex, decision: 'reject', note: d.note });
      }
    }
    if (!actions.length) {
      notifyMem('当前均为「更新①层真源」条目，请点击上方按钮复制指令交由 Agent 处理');
      return;
    }
    setPendingBatchBusy(true);
    try {
      const st = window.mc.memoryResolvePendingBatch
        ? await window.mc.memoryResolvePendingBatch({ actions })
        : await window.mc.memoryResolvePending(actions[0]);
      setMemState(st);
      setPendingDrafts({});
      notifyMem(`已一次合并处理 ${actions.length} 条本机操作 · 快照 v${st.latestVersion}`);
    } catch (err) {
      setMemError(err.message);
    } finally {
      setPendingBatchBusy(false);
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

  const memoryBudgetStats = useMemo(() => {
    const maxChars = Number(workbenchPrefs?.memoryMaxChars) || 1600;
    const buckets = memState?.buckets || [];
    const activeRoleCompany = String(library?.role || '').split('-')[0].trim().toLowerCase();
    const countBucket = (id) => {
      const b = buckets.find(x => x.id === id);
      if (!b) return 0;
      const lines = (b.items || []).map(i => i.text).filter(Boolean);
      const effective = id === 'company_insight' && activeRoleCompany
        ? lines.filter(l => l.toLowerCase().includes(activeRoleCompany))
        : id === 'company_insight'
          ? lines.slice(0, 2)
          : lines;
      return effective.reduce((sum, l) => sum + l.length + 2, 0);
    };
    const styleChars = countBucket('speaking_style');
    const pitfallChars = countBucket('weakness_pitfall');
    const insightChars = countBucket('company_insight');
    const totalChars = styleChars + pitfallChars + insightChars;
    const ratio = maxChars > 0 ? totalChars / maxChars : 0;
    return { maxChars, styleChars, pitfallChars, insightChars, totalChars, ratio };
  }, [memState, workbenchPrefs?.memoryMaxChars, library?.role]);

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
            <button type="button" className="mc-btn mc-btn-sm" disabled={exportBusy} onClick={() => void handleExport(selected, 'raw')}>
              <IconDownload size={12} /> 导出文本
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

  const stripPendingToken = (text) => String(text || '').replace(/^\s*(?:-\s+\[\s\]\s+)?\*\*\[pending\]\*\*\s*/i, '').trim();

  const latestVersion = Number(memState?.latestVersion) || 0;
  const tidyBaseVersion = Number(workbenchPrefs?.memoryTidyBaseVersion) || 0;
  const tidyDismissedVersion = Number(workbenchPrefs?.memoryTidyDismissedVersion) || 0;
  const versionsSinceTidy = Math.max(0, latestVersion - tidyBaseVersion);
  const showTidyNudge = latestVersion >= 10 && versionsSinceTidy >= 10 && latestVersion >= tidyDismissedVersion + 10;

  const handleCopyTidyPrompt = async () => {
    const rootPath = memState?.root || library?.root || '';
    const prompt = [
      '请帮我整理并精炼面试记忆目录，合并重复条目并控制总字数在注入预算内：',
      '',
      `- 资料库根目录：\`${rootPath}\``,
      `- 记忆目录：\`${rootPath}\\面试记忆\``,
      `- 当前注入字数上限：${memoryBudgetStats.maxChars} 字（当前已用 ${memoryBudgetStats.totalChars} 字）`,
      '',
      '整理要求：',
      '1. 合并 `表达与偏好.md`、`薄弱项与踩坑.md`、`公司与岗位洞察.md` 中的重复项，保留高价值可执行要点；',
      '2. 不擅自改动 `待审核新事实.md` 中未确认的条目，不编造个人经历；',
      '3. 完成后给我一份精简前后字数对比与变更摘要。'
    ].join('\n');
    try {
      await navigator.clipboard.writeText(prompt);
      setTidyCopied(true);
      notifyMem('已复制整理指令，交给 Agent 整理完成后可点击重置计数');
    } catch {
      notifyMem('复制失败，请手动打开记忆目录交由 Agent 整理');
    }
  };

  return (
    <div className="mc-settings-root">
      <header className="mc-settings-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 className="mc-page-title" style={{ fontSize: 18 }}>记忆与记录</h1>
          <span className="mc-field-hint" role="status">
            {memToast || (memState ? `快照 v${memState.latestVersion}${memState.pendingCount > 0 ? ` · ${memState.pendingCount} 条待确认` : ''}` : '')}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {library?.root && (
            <>
              <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.memoryOpenDir?.()}>
                <IconFolder size={13} /> 打开记忆目录
              </button>
              <button type="button" className="mc-btn mc-btn-sm" onClick={() => void refreshMemory()}>
                <IconRefresh size={13} /> 同步变更
              </button>
            </>
          )}
        </div>
      </header>

      <div className="mc-settings-body">
        <nav className="mc-settings-nav" aria-label="记忆与记录导航">
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

          <div className="mc-settings-nav-group">
            <div className="mc-settings-nav-label">面试记忆</div>
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
              <span>动态与版本</span>
              {pendingItems.length > 0 && <span className="mc-badge mc-badge-warn">{pendingItems.length}</span>}
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
                    <h2 className="mc-settings-cat-title">我的记忆</h2>
                    <p className="mc-settings-cat-desc">面试复盘沉淀的表达偏好、避坑清单与公司洞察，实时面试按字数上限自动引入。</p>
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
                    {/* Layer 2 Memory Injection Budget Bar — separates remaining chars from truncation state */}
                    <section className="mc-card">
                      <div className="mc-card-body" style={{ padding: '10px 14px', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                            <span>
                              <strong>每次使用的记忆：</strong>
                              <span style={{ color: memoryBudgetStats.ratio > 1 ? 'var(--danger)' : 'var(--text)', fontWeight: 600 }}>
                                {memoryBudgetStats.totalChars} / {memoryBudgetStats.maxChars} 字
                              </span>
                            </span>
                            <span className="mc-field-hint">
                              {memoryBudgetStats.totalChars > memoryBudgetStats.maxChars
                                ? `超出 ${memoryBudgetStats.totalChars - memoryBudgetStats.maxChars} 字`
                                : `剩余 ${memoryBudgetStats.maxChars - memoryBudgetStats.totalChars} 字`}
                              （表达 {memoryBudgetStats.styleChars} + 避坑 {memoryBudgetStats.pitfallChars} + 洞察 {memoryBudgetStats.insightChars}）
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className={`mc-badge ${memoryBudgetStats.ratio > 1 ? 'mc-badge-err' : 'mc-badge-ok'}`}>
                              {memoryBudgetStats.ratio > 1 ? '已超限 · 按相关性裁切' : '未裁切 · 全量生效'}
                            </span>
                            {memoryBudgetStats.maxChars < 1600 && memoryBudgetStats.totalChars > memoryBudgetStats.maxChars && (
                              <button
                                type="button"
                                className="mc-btn mc-btn-sm"
                                style={{ height: 22, padding: '0 8px', fontSize: 11 }}
                                onClick={() => void onUpdateWorkbenchPrefs?.({ memoryMaxChars: 1600 })}
                              >
                                调为推荐 1600 字
                              </button>
                            )}
                            {onOpenMemorySettings && (
                              <button type="button" className="mc-link-subtle" style={{ fontSize: 11.5 }} onClick={onOpenMemorySettings}>
                                调整字数
                              </button>
                            )}
                          </div>
                        </div>
                        <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-subtle)', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.min(100, Math.round(memoryBudgetStats.ratio * 100))}%`,
                              background: memoryBudgetStats.ratio > 1 ? 'var(--danger)' : memoryBudgetStats.ratio > 0.9 ? 'var(--warning)' : 'var(--success)',
                              transition: 'width 200ms ease'
                            }}
                          />
                        </div>
                      </div>
                    </section>

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
                              <IconEdit size={12} /> {editingRaw ? '取消编辑' : '编辑原文'}
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
                                <IconCheck size={12} /> 保存并留存快照
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
                                placeholder={`向「${activeBucket.title}」追加一条记忆…`}
                              />
                              <button type="submit" className="mc-btn mc-btn-sm mc-btn-primary" disabled={!newItemText.trim()}>
                                <IconPlus size={12} /> 追加
                              </button>
                            </form>

                            {activeBucket.items
                              .filter(it => !memSearch.trim() || it.text.toLowerCase().includes(memSearch.trim().toLowerCase()))
                              .map((it, idx) => (
                                <div key={`${it.lineIndex}-${idx}`} className="mc-evidence-item">
                                  <div style={{ fontSize: 13, lineHeight: 1.65, userSelect: 'text' }}>
                                    {renderInlineMd(stripPendingToken(it.text))}
                                  </div>
                                </div>
                              ))}
                            {activeBucket.items.length === 0 && (
                              <div className="mc-field-hint" style={{ padding: '12px 0' }}>
                                暂无内容。可在上方手动补充，或在面试复盘后由 Agent 写入。
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

            {/* SECTION 2: PENDING CONFIRMATIONS & VERSION SNAPSHOTS */}
            {navSection === 'memory-activity' && (
              <>
                <div>
                  <h2 className="mc-settings-cat-title">动态与版本</h2>
                  <p className="mc-settings-cat-desc">确认新增的个人事实，或对比历史更改并一键回滚。</p>
                </div>

                {/* Pending Confirmations */}
                <section className="mc-card">
                  <div className="mc-card-head">
                    <div>
                      <h3 className="mc-card-title">
                        <IconShield size={14} /> 待确认的记忆 ({pendingItems.length})
                      </h3>
                      {pendingItems.length > 0 && (
                        <p className="mc-card-desc">确认后才会用于面试回答；涉及画像或项目资料建议复制指令交由 Agent 更新。</p>
                      )}
                    </div>
                    {pendingItems.length > 0 && (
                      <CustomSelect
                        className="mc-filter-select"
                        style={{ width: 176, height: 28, fontSize: 12 }}
                        value={approveTarget}
                        onChange={setApproveTarget}
                        ariaLabel="收入记忆的目标分类"
                        options={[
                          { value: 'weakness_pitfall', label: '收入：薄弱项与踩坑' },
                          { value: 'speaking_style', label: '收入：表达与偏好' },
                          { value: 'company_insight', label: '收入：公司与岗位洞察' }
                        ]}
                      />
                    )}
                  </div>
                  <div className="mc-card-body" style={{ gap: 10 }}>
                    {pendingItems.length > 0 ? (
                      <>
                        {pendingItems.map((it) => {
                          const draft = getPendingDraft(it);
                          const displayBody = stripPendingToken(it.text);
                          return (
                            <div key={it.lineIndex} className="mc-evidence-item" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div style={{ fontSize: 13, lineHeight: 1.6, userSelect: 'text' }}>{renderInlineMd(displayBody)}</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                <button
                                  type="button"
                                  className={`mc-btn mc-btn-sm ${draft.action === 'agent_truth' ? 'mc-btn-primary' : ''}`}
                                  onClick={() => updatePendingDraft(it.lineIndex, { action: 'agent_truth' }, it.text)}
                                >
                                  更新资料库（交由 Agent）
                                </button>
                                <button
                                  type="button"
                                  className={`mc-btn mc-btn-sm ${draft.action === 'memory_pitfall' ? 'mc-btn-primary' : ''}`}
                                  onClick={() => updatePendingDraft(it.lineIndex, { action: 'memory_pitfall' }, it.text)}
                                >
                                  仅收入记忆
                                </button>
                                <button
                                  type="button"
                                  className={`mc-btn mc-btn-sm ${draft.action === 'reject' ? 'mc-btn-danger' : ''}`}
                                  onClick={() => updatePendingDraft(it.lineIndex, { action: 'reject' }, it.text)}
                                >
                                  <IconX size={11} /> 驳回
                                </button>
                              </div>
                              <input
                                className="mc-input"
                                style={{ fontSize: 12, padding: '6px 9px' }}
                                value={draft.note}
                                onChange={e => updatePendingDraft(it.lineIndex, { note: e.target.value }, it.text)}
                                placeholder="可选补充真实边界（例如：仅课程实践无生产经验、懂原理没搭过集群…）"
                              />
                            </div>
                          );
                        })}

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                          <span className="mc-field-hint">
                            本机批量处理只生成 1 个快照。
                          </span>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="mc-btn mc-btn-sm"
                              disabled={pendingBatchBusy}
                              onClick={() => void handleApplyLocalPendingBatch()}
                            >
                              <IconCheck size={12} /> {pendingBatchBusy ? '处理中…' : '应用本机驳回/收入'}
                            </button>
                            <button
                              type="button"
                              className="mc-btn mc-btn-sm mc-btn-primary"
                              onClick={() => void handleGeneratePendingPrompt()}
                            >
                              {pendingCopied ? <><IconCheck size={12} /> 已复制指令</> : <><IconCopy size={12} /> 复制指令给 Agent</>}
                            </button>
                          </div>
                        </div>

                        {pendingAgentPrompt && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div className="mc-field-hint">已生成的 Agent 处理指令：</div>
                            <textarea
                              className="mc-textarea"
                              readOnly
                              rows={8}
                              style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.55 }}
                              value={pendingAgentPrompt}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="mc-field-hint">没有待确认的记忆</div>
                    )}
                  </div>
                </section>

                {/* Gentle 10-version tidy nudge */}
                {showTidyNudge && (
                  <div className="mc-alert mc-alert-warn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span>近期有 {versionsSinceTidy} 个新版本，要整理面试记忆吗？</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={() => void handleCopyTidyPrompt()}>
                        <IconCopy size={12} /> {tidyCopied ? '已复制整理指令' : '复制整理指令'}
                      </button>
                      {tidyCopied && (
                        <button
                          type="button"
                          className="mc-btn mc-btn-sm"
                          onClick={() => {
                            setTidyCopied(false);
                            void onUpdateWorkbenchPrefs?.({ memoryTidyBaseVersion: latestVersion, memoryTidyDismissedVersion: 0 });
                            notifyMem('已记录本次整理，后续新增 10 个版本时再提醒');
                          }}
                        >
                          <IconCheck size={12} /> 已整理，重新计数
                        </button>
                      )}
                      <button
                        type="button"
                        className="mc-btn mc-btn-sm mc-btn-ghost"
                        onClick={() => {
                          setTidyCopied(false);
                          void onUpdateWorkbenchPrefs?.({ memoryTidyDismissedVersion: latestVersion });
                        }}
                      >
                        稍后
                      </button>
                    </div>
                  </div>
                )}

                {/* Snapshot Timeline & Diff (shows latest 5 by default, expandable) */}
                {(() => {
                  const allSnaps = memState?.snapshots || [];
                  const visibleSnaps = showAllSnapshots ? allSnaps : allSnaps.slice(0, 5);
                  return (
                    <section className="mc-card">
                      <div className="mc-card-head">
                        <div>
                          <h3 className="mc-card-title">版本历史 ({allSnaps.length})</h3>
                          <p className="mc-card-desc">点击任意版本对比更改，支持一键回滚。</p>
                        </div>
                        {allSnaps.length > 5 && (
                          <button type="button" className="mc-btn mc-btn-sm mc-btn-ghost" onClick={() => setShowAllSnapshots(v => !v)}>
                            {showAllSnapshots ? '仅看最近 5 个' : `展开全部 (${allSnaps.length})`}
                          </button>
                        )}
                      </div>
                      <div className="mc-card-body" style={{ gap: 8 }}>
                        {visibleSnaps.map(snap => (
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
                                对比更改
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
                  );
                })()}

                {snapDiff && (
                  <section className="mc-card">
                    <div className="mc-card-head">
                      <div>
                        <h3 className="mc-card-title">对比更改：v{snapDiff.prevVersion} → v{snapDiff.version}</h3>
                        <p className="mc-card-desc">{snapDiff.summary}</p>
                      </div>
                      <button type="button" className="mc-icon-btn" onClick={() => setSnapDiff(null)}><IconX size={14} /></button>
                    </div>
                    <div className="mc-card-body" style={{ gap: 12 }}>
                      {snapDiff.files.filter(f => f.changed).map(f => {
                        const diff = computeLineDiff(f.before, f.after);
                        const changedRows = diff.rows.filter(r => r.kind !== 'same');
                        return (
                          <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <strong style={{ fontSize: 12.5 }}>{f.title}</strong>
                              <span className="mc-badge mc-badge-ok">+{diff.addedCount}</span>
                              <span className="mc-badge mc-badge-err">-{diff.removedCount}</span>
                            </div>
                            <div className="mc-kb-diff-box" style={{ maxHeight: 240 }}>
                              {changedRows.map((row, i) => (
                                <div key={i} className={`mc-kb-diff-line is-${row.kind}`}>
                                  <span className="mc-kb-diff-ln">{row.newLine ?? row.oldLine ?? ''}</span>
                                  <span className="mc-kb-diff-sign">{row.kind === 'add' ? '+' : '-'}</span>
                                  <span>{row.text}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </>
            )}

            {/* SECTION 3 & 4: INTERVIEW / WRITTEN RECORDS LIST */}
            {(navSection === 'interview-records' || navSection === 'written-records') && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <h2 className="mc-settings-cat-title">{navSection === 'written-records' ? '笔试记录' : '面试记录'}</h2>
                    <p className="mc-settings-cat-desc">点开场次回看问答、转写与双轨录音，或归档交给 Agent 复盘。</p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <CustomSelect
                      className="mc-filter-select"
                      value={timeRange}
                      onChange={setTimeRange}
                      ariaLabel="按时间筛选"
                      options={[
                        { value: 'all', label: '全部时间' },
                        { value: 'today', label: '今天' },
                        { value: '7d', label: '近 7 天' },
                        { value: '30d', label: '近 30 天' }
                      ]}
                    />
                    <div className="mc-search-wrap" style={{ width: 200 }}>
                      <span className="mc-search-icon"><IconSearch size={13} /></span>
                      <input className="mc-search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索记录名称、岗位或问题…" />
                    </div>
                  </div>
                </div>

                {filteredSessions.length > 0 ? (() => {
                  const todayKey = new Date().toLocaleDateString('sv-SE');
                  const yesterdayKey = new Date(Date.now() - 86400 * 1000).toLocaleDateString('sv-SE');
                  const grouped = [];
                  const byKey = new Map();
                  for (const s of filteredSessions) {
                    const ts = s.updatedAt || s.createdAt || Date.now();
                    const d = new Date(ts);
                    const key = Number.isNaN(d.getTime()) ? '更早' : d.toLocaleDateString('sv-SE');
                    const label = key === todayKey ? '今天' : key === yesterdayKey ? '昨天' : key;
                    if (!byKey.has(key)) {
                      const entry = { key, label, items: [] };
                      byKey.set(key, entry);
                      grouped.push(entry);
                    }
                    byKey.get(key).items.push(s);
                  }
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {grouped.map((grp, gIdx) => {
                        const groupStateKey = `${navSection}:${grp.key}`;
                        const showAll = Boolean(expandedDateGroups[groupStateKey]);
                        const visibleItems = showAll ? grp.items : grp.items.slice(0, 5);
                        return (
                          <details key={groupStateKey} className="mc-card mc-fold-card" open={gIdx === 0}>
                            <summary className="mc-fold-summary">
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="mc-fold-chevron"><IconChevronRight size={14} /></span>
                                <strong style={{ fontSize: 13 }}>{grp.label}</strong>
                                <span className="mc-badge">{grp.items.length} 条</span>
                              </div>
                              <span className="mc-field-hint">展开 / 收起</span>
                            </summary>
                            <div className="mc-card-body" style={{ gap: 8 }}>
                              {visibleItems.map((s) => {
                                const isLive = s.id === activeSessionId;
                                return (
                                  <div key={s.id} className="mc-record-card" onClick={() => { setSelectedId(s.id); setDetailTab('qa'); }} style={{ cursor: 'pointer' }}>
                                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <strong style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</strong>
                                        {isLive && <span className="mc-badge mc-badge-ok">进行中</span>}
                                        {s.role && <span className="mc-badge mc-badge-info">{s.role}</span>}
                                      </div>
                                      <div className="mc-field-hint">
                                        {formatDateTime(s.updatedAt || s.createdAt)} · {s.scene === 'written' ? summarizeWrittenCounts(s).compactText : `${(s.questions || []).length} 个问题 · ${(s.segments || []).length} 条转写 · ${s.audioSource === 'mic' ? '麦克风' : '系统音频'}`}
                                      </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                      <button type="button" className="mc-btn mc-btn-sm" onClick={() => { setSelectedId(s.id); setDetailTab('qa'); }}>
                                        查看
                                      </button>
                                      <button type="button" className="mc-btn mc-btn-sm" onClick={() => { setSelectedId(s.id); setDetailTab('review'); }}>
                                        <IconSparkles size={11} /> 复盘归档
                                      </button>
                                      <button type="button" className="mc-btn mc-btn-sm mc-btn-ghost" onClick={() => onResumeFromRecord(s.id)}>
                                        <IconPlay size={11} /> {isLive ? '继续' : '续聊'}
                                      </button>
                                      {confirmDeleteId === s.id ? (
                                        <>
                                          <button type="button" className="mc-btn mc-btn-sm mc-btn-danger" onClick={() => { onDeleteSession(s.id); setConfirmDeleteId(null); }}>
                                            确认
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
                              {grp.items.length > 5 && (
                                <button
                                  type="button"
                                  className="mc-btn mc-btn-sm mc-btn-ghost"
                                  style={{ alignSelf: 'center' }}
                                  onClick={() => setExpandedDateGroups(prev => ({ ...prev, [groupStateKey]: !prev[groupStateKey] }))}
                                >
                                  {showAll ? '收起至最近 5 条' : `展开其余 ${grp.items.length - 5} 条（共 ${grp.items.length} 条）`}
                                </button>
                              )}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  );
                })() : (
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
