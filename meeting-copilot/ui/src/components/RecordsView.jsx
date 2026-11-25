import React, { useMemo, useState } from 'react';
import { getActiveAttempt, projectLegacyTurns } from '../core/sessionModel.js';
import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconDownload,
  IconEdit,
  IconPlay,
  IconSearch,
  IconTrash
} from './Icons.jsx';
import { EvidencePanel, ModelAnswers, cleanAnswerReferences } from './SharedWidgets.jsx';

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

export function RecordsView({
  sessions,
  activeSessionId,
  onResumeFromRecord,
  onRenameSession,
  onDeleteSession
}) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detailTab, setDetailTab] = useState('qa');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...(sessions || [])]
      .filter(s => !q || (s.name || '').toLowerCase().includes(q) || (s.questions || []).some(item => item.prompt.toLowerCase().includes(q)))
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }, [sessions, search]);

  const selected = useMemo(
    () => (selectedId ? (sessions || []).find(s => s.id === selectedId) || null : null),
    [sessions, selectedId]
  );

  const handleExport = async (session, mode) => {
    setExportBusy(true);
    setExportMsg('');
    try {
      const exportPayload = {
        ...session,
        turns: projectLegacyTurns(session)
      };
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
              <IconDownload size={12} /> 导出原始文本
            </button>
            <button type="button" className="mc-btn mc-btn-sm" disabled={exportBusy} onClick={() => void handleExport(selected, 'organized')}>
              AI 校对导出
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
          <span className="mc-field-hint" style={{ marginLeft: 'auto' }}>
            创建于 {formatDateTime(selected.createdAt)} · {selected.audioSource === 'mic' ? '麦克风' : '系统音频'}
            {selected.role ? ` · 岗位：${selected.role}` : ''}
          </span>
        </div>

        <div className="mc-page-scroll">
          <div className="mc-page-inner">
            {(exportBusy || exportMsg) && (
              <div className={`mc-alert ${exportMsg.startsWith('导出失败') ? 'mc-alert-err' : 'mc-alert-ok'}`}>
                {exportBusy ? '正在导出（AI 校对可能需要数十秒）…' : exportMsg}
              </div>
            )}

            {detailTab === 'qa' ? (
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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <header className="mc-page-header" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="mc-page-title">面试记录</h1>
        <div className="mc-search-wrap" style={{ width: 220 }}>
          <span className="mc-search-icon"><IconSearch size={14} /></span>
          <input className="mc-search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索记录名称或问题…" />
        </div>
      </header>

      <div className="mc-page-scroll">
        <div className="mc-page-inner">
          {sorted.length > 0 ? (
            <div className="mc-record-list">
              {sorted.map((s) => {
                const isLive = s.id === activeSessionId;
                return (
                  <div key={s.id} className="mc-record-card" onClick={() => setSelectedId(s.id)} style={{ cursor: 'pointer' }}>
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
                        <button type="button" className="mc-icon-btn is-danger" title="删除记录" disabled={isLive} onClick={() => setConfirmDeleteId(s.id)}>
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
              {search ? '没有匹配的面试记录' : '暂无本地面试记录。从首页启动一场面试后，问答与转写将自动保存在这里。'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
