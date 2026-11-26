import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getActiveAttempt } from '../core/sessionModel.js';
import {
  IconArrowLeft,
  IconBookOpen,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconGlobe,
  IconMic,
  IconPin,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX
} from './Icons.jsx';
import { EvidencePanel, cleanAnswerReferences, parseAnswerBlocks } from './SharedWidgets.jsx';
import { CustomSelect } from './CustomSelect.jsx';

const TOOL_CATALOG = [
  { id: 'knowledge', label: '打开知识库', desc: '浏览并阅读本地资料库文档，免切换窗口', icon: IconBookOpen },
  { id: 'translate', label: '答案翻译', desc: '将当前回答翻译为目标语言并一键复制', icon: IconGlobe },
  { id: 'evidence', label: '引用依据', desc: '查看知识库 V2 原文摘录、行号与配图', icon: IconFileText },
  { id: 'transcript', label: '实时转写', desc: '查看对方与本人实时转写，支持划选提问', icon: IconMic }
];

const TARGET_LANGS = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' }
];

function tabMeta(id) {
  if (id === 'launcher') return { label: '新标签页', icon: IconPlus };
  return TOOL_CATALOG.find(t => t.id === id) || { label: '依据', icon: IconFileText };
}

function KnowledgeBrowserPanel({ library, preventFocus, onOpenSettings }) {
  const [search, setSearch] = useState('');
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [docContent, setDocContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const docs = useMemo(() => {
    const raw = (library?.documents || []).filter(d => d.status === 'active');
    const q = search.trim().toLowerCase();
    if (!q) return raw;
    return raw.filter(d =>
      (d.title || '').toLowerCase().includes(q) ||
      (d.file_path || '').toLowerCase().includes(q) ||
      (d.document_type || '').toLowerCase().includes(q)
    );
  }, [library?.documents, search]);

  const openDoc = async (doc) => {
    setSelectedDocId(doc.document_id);
    setLoading(true);
    setError('');
    try {
      const loaded = await window.mc.readInterviewDocument({ document_id: doc.document_id });
      setDocContent(loaded);
    } catch (e) {
      setError(e.message || '读取文档失败');
      setDocContent(null);
    } finally {
      setLoading(false);
    }
  };

  if (!library?.root) {
    return (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="mc-alert">
          尚未配置本地资料库目录。配置后可在面试中直接搜索并查阅全部本地简历、项目文档与笔记。
        </div>
        {onOpenSettings && (
          <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={onOpenSettings}>
            <IconFolder size={13} /> 前往配置资料库
          </button>
        )}
      </div>
    );
  }

  if (selectedDocId && (docContent || loading || error)) {
    const blocks = docContent?.content ? parseAnswerBlocks(docContent.content, false) : [];
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            padding: '6px 10px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6
          }}
          data-interactive="true"
        >
          <button
            type="button"
            className="mc-btn mc-btn-sm mc-btn-ghost"
            style={{ height: 24, padding: '0 6px', fontSize: 11.5 }}
            onClick={() => { setSelectedDocId(null); setDocContent(null); setError(''); }}
          >
            <IconArrowLeft size={12} /> 文档列表
          </button>
          <span
            style={{ fontSize: 11.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
            title={docContent?.file_path || ''}
          >
            {docContent?.title || '加载中…'}
          </span>
          {docContent && (
            <button
              type="button"
              className="mc-icon-btn"
              style={{ width: 24, height: 24 }}
              title="使用系统默认应用打开原文件"
              onClick={() => void window.mc.openInterviewDocument({ document_id: docContent.document_id }).catch(e => setError(e.message))}
            >
              <IconExternalLink size={12} />
            </button>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }} data-scrollable="true">
          {loading && <div className="mc-field-hint">正在读取文档…</div>}
          {error && <div className="mc-alert mc-alert-err">{error}</div>}
          {!loading && !error && docContent && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="mc-field-hint" style={{ fontSize: 11, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                {docContent.file_path} · {docContent.document_type} · v{docContent.version}
              </div>
              {blocks.map((block, idx) =>
                block.kind === 'code' ? (
                  <pre key={idx} className="mc-answer-code"><code>{block.text}</code></pre>
                ) : (
                  <div key={idx} className="mc-answer-prose" style={{ fontSize: 12.5, lineHeight: 1.65 }}>{block.text}</div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }} data-interactive="true">
        <div className="mc-search-wrap" style={{ width: '100%' }}>
          <span className="mc-search-icon"><IconSearch size={13} /></span>
          <input
            className="mc-search-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onMouseDown={() => { if (preventFocus) void window.mc?.requestTempFocus?.(true); }}
            onBlur={() => { if (preventFocus) void window.mc?.requestTempFocus?.(false); }}
            placeholder={`搜索本地资料 (${docs.length} 份)…`}
            aria-label="搜索本地知识库文档"
          />
          {search && (
            <button type="button" className="mc-search-clear" onClick={() => setSearch('')} aria-label="清空">
              <IconX size={11} />
            </button>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }} data-scrollable="true">
        {docs.length === 0 ? (
          <div className="mc-field-hint" style={{ textAlign: 'center', marginTop: 24 }}>
            {search ? '没有匹配该关键词的文档' : '当前资料库目录下暂无可阅读文档'}
          </div>
        ) : (
          docs.map(doc => (
            <button
              key={doc.document_id}
              type="button"
              data-interactive="true"
              onClick={() => void openDoc(doc)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                padding: '7px 9px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.title}
                </span>
                <span className="mc-badge" style={{ fontSize: 10 }}>{doc.file_type || 'md'}</span>
              </div>
              <span className="mc-field-hint" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {doc.file_path}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function ThirdPane({
  tab,
  tabs = ['evidence'],
  onSelectTab,
  onOpenTab,
  onCloseTab,
  onClose,
  session,
  library,
  selectedQuestion,
  partials,
  answersReady,
  preventFocus,
  targetLang = 'zh-CN',
  onChangeTargetLang,
  onAskText,
  onTranslateSegment,
  onTranslateAnswer,
  onClearTranscript,
  onOpenKnowledgeSettings
}) {
  const [lockedQuestionId, setLockedQuestionId] = useState(null);
  const [translatingAnswer, setTranslatingAnswer] = useState(false);
  const [copiedTrans, setCopiedTrans] = useState(false);
  const [selectionPopup, setSelectionPopup] = useState(null);
  const transcriptBoxRef = useRef(null);
  const stickRef = useRef(true);

  const openTabs = tabs?.length ? tabs : [tab || 'evidence'];
  const activeTab = openTabs.includes(tab) ? tab : openTabs[0];

  const targetQuestion = lockedQuestionId
    ? (session?.questions || []).find(q => q.id === lockedQuestionId) || selectedQuestion
    : selectedQuestion;
  const targetAttempt = getActiveAttempt(targetQuestion);

  useEffect(() => {
    if (activeTab === 'transcript' && stickRef.current && transcriptBoxRef.current) {
      transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
    }
  }, [activeTab, session?.segments?.length, partials?.them, partials?.me]);

  const handleMouseUpTranscript = (e) => {
    const text = window.getSelection()?.toString().trim();
    if (!text || text.length < 2) { setSelectionPopup(null); return; }
    setSelectionPopup({
      text,
      x: Math.max(12, Math.min(e.clientX, window.innerWidth - 130)),
      y: Math.max(48, e.clientY - 36)
    });
  };

  const triggerAnswerTranslation = async () => {
    if (!targetQuestion || !targetAttempt || !targetAttempt.text?.trim() || translatingAnswer) return;
    setTranslatingAnswer(true);
    try {
      await onTranslateAnswer(targetQuestion.id, targetAttempt.id, cleanAnswerReferences(targetAttempt.text), targetLang);
    } finally {
      setTranslatingAnswer(false);
    }
  };

  const targetLangLabel = TARGET_LANGS.find(l => l.id === targetLang)?.label || '简体中文';

  return (
    <aside className="mc-wb-pane" style={{ background: 'rgba(var(--wb-bg-rgb), 0.94)' }} aria-label="辅助工具栏">
      {/* SuiSi Multi-Tab Header with + New Tab Launcher */}
      <div className="mc-wb-pane-header" style={{ padding: '0 6px', gap: 4 }} data-interactive="true">
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0, flex: 1, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {openTabs.map((tid) => {
            const meta = tabMeta(tid);
            const Icon = meta.icon;
            const isAct = activeTab === tid;
            return (
              <div
                key={tid}
                className={`mc-side-tab${isAct ? ' is-active' : ''}`}
                role="tab"
                aria-selected={isAct}
                onClick={() => onSelectTab(tid)}
                title={meta.label}
              >
                <Icon size={12} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tid === 'transcript' ? `转写 (${session?.segments?.length || 0})` : meta.label}
                </span>
                <button
                  type="button"
                  className="mc-side-tab-close"
                  title="关闭标签页"
                  aria-label={`关闭${meta.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (openTabs.length <= 1) onClose();
                    else onCloseTab(tid);
                  }}
                >
                  <IconX size={10} />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className={`mc-icon-btn${activeTab === 'launcher' ? ' is-active' : ''}`}
            style={{ width: 24, height: 24 }}
            title="打开新辅助工具标签（知识库 / 答案翻译 / 引用依据 / 实时转写）"
            aria-label="新建辅助标签"
            onClick={() => onOpenTab('launcher')}
          >
            <IconPlus size={13} />
          </button>
        </div>
        <button type="button" className="mc-icon-btn" style={{ width: 24, height: 24 }} title="收起右侧工具栏" onClick={onClose}>
          <IconX size={13} />
        </button>
      </div>

      {/* NEW TAB TOOL LAUNCHER (SuiSi style) */}
      {activeTab === 'launcher' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }} data-scrollable="true">
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>选择要打开的辅助工具</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            {TOOL_CATALOG.map(({ id, label, desc, icon: Icon }) => (
              <button
                key={id}
                type="button"
                data-interactive="true"
                onClick={() => onOpenTab(id, true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-surface)',
                  textAlign: 'left',
                  transition: 'background 120ms ease, border-color 120ms ease'
                }}
              >
                <span style={{
                  width: 30, height: 30, borderRadius: 8, background: 'var(--bg-subtle)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                  <Icon size={15} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
                  <div className="mc-field-hint" style={{ fontSize: 11.5 }}>{desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* KNOWLEDGE V2 DOCUMENT BROWSER & READER */}
      {activeTab === 'knowledge' && (
        <KnowledgeBrowserPanel
          library={library}
          preventFocus={preventFocus}
          onOpenSettings={onOpenKnowledgeSettings}
        />
      )}

      {/* EVIDENCE TAB */}
      {activeTab === 'evidence' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }} data-interactive="true">
            <span className="mc-field-hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {targetQuestion ? `#${targetQuestion.ordinal} ${targetQuestion.prompt}` : '暂无选中问题'}
            </span>
            {targetQuestion && (
              <button
                type="button"
                className={`mc-btn mc-btn-sm ${lockedQuestionId ? 'mc-btn-primary' : ''}`}
                style={{ height: 22, padding: '0 6px', fontSize: 11 }}
                title={lockedQuestionId ? '已锁定此题证据，点击恢复跟随当前选中题' : '锁定当前题目的依据面板'}
                onClick={() => setLockedQuestionId(prev => prev ? null : targetQuestion.id)}
              >
                <IconPin size={11} filled={!!lockedQuestionId} /> {lockedQuestionId ? '已锁定' : '跟随'}
              </button>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10 }} data-scrollable="true">
            {targetAttempt ? (
              <EvidencePanel attempt={targetAttempt} inline />
            ) : (
              <div className="mc-field-hint">选择左侧问题以查看本地资料库引用依据与原文定位。</div>
            )}
          </div>
        </div>
      )}

      {/* LIVE TRANSCRIPT TAB */}
      {activeTab === 'transcript' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} data-interactive="true">
            <span className="mc-field-hint">划选任意片段可快速提问</span>
            <button type="button" className="mc-btn mc-btn-ghost mc-btn-sm" style={{ height: 22 }} onClick={onClearTranscript} title="清空转写">
              <IconTrash size={12} /> 清空
            </button>
          </div>
          <div
            ref={transcriptBoxRef}
            data-scrollable="true"
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
            onScroll={() => {
              const el = transcriptBoxRef.current;
              if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
            }}
            onMouseUp={handleMouseUpTranscript}
          >
            {(session?.segments || []).length === 0 && !partials?.them && !partials?.me ? (
              <div className="mc-field-hint" style={{ textAlign: 'center', marginTop: 24 }}>开启音频采集后，实时语音转写将显示在此处。</div>
            ) : (
              <>
                {(session?.segments || []).map((seg) => {
                  const isMe = seg.speaker === 'me';
                  return (
                    <div
                      key={seg.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: isMe ? 'var(--info-bg)' : 'var(--bg-subtle)',
                        border: '1px solid var(--border)',
                        fontSize: 12.5,
                        lineHeight: 1.55
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
                        <strong>{isMe ? '我' : '对方'}</strong>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} data-interactive="true">
                          <span>{new Date(seg.endTs).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                          <button type="button" className="mc-btn mc-btn-sm" style={{ height: 20, padding: '0 5px', fontSize: 10.5 }} onClick={() => onTranslateSegment(seg)}>
                            译
                          </button>
                          {!isMe && (
                            <button
                              type="button"
                              className="mc-btn mc-btn-sm"
                              disabled={!answersReady}
                              style={{ height: 20, padding: '0 5px', fontSize: 10.5 }}
                              onClick={() => onAskText(seg.text, [seg.id])}
                            >
                              ⚡答
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ userSelect: 'text', overflowWrap: 'anywhere' }}>{seg.text}</div>
                      {seg.translation && (
                        <div className="mc-field-hint" style={{ marginTop: 4, borderTop: '1px dashed var(--border)', paddingTop: 4 }}>
                          {seg.translation}
                        </div>
                      )}
                      {seg.translationError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3 }}>{seg.translationError}</div>}
                    </div>
                  );
                })}
                {partials?.them && (
                  <div style={{ padding: '7px 10px', borderRadius: 8, border: '1px dashed var(--border-strong)', fontSize: 12, color: 'var(--text-muted)' }}>
                    <strong>对方 · 识别中</strong>
                    <div>{partials.them}</div>
                  </div>
                )}
                {partials?.me && (
                  <div style={{ padding: '7px 10px', borderRadius: 8, border: '1px dashed var(--info)', fontSize: 12, color: 'var(--text-muted)' }}>
                    <strong>我 · 识别中</strong>
                    <div>{partials.me}</div>
                  </div>
                )}
              </>
            )}
          </div>
          {selectionPopup && (
            <div style={{ position: 'fixed', left: selectionPopup.x, top: selectionPopup.y, zIndex: 9700 }} data-interactive="true">
              <button
                type="button"
                className="mc-btn mc-btn-sm mc-btn-primary"
                disabled={!answersReady}
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  onAskText(selectionPopup.text, []);
                  window.getSelection()?.removeAllRanges();
                  setSelectionPopup(null);
                }}
              >
                ⚡ 回答选中
              </button>
            </div>
          )}
        </div>
      )}

      {/* ANSWER TRANSLATION TAB */}
      {activeTab === 'translate' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 10, gap: 10, overflowY: 'auto' }} data-scrollable="true">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }} data-interactive="true">
            <CustomSelect
              className="mc-filter-select"
              style={{ height: 26, fontSize: 11.5, minWidth: 96 }}
              value={targetLang}
              onChange={val => onChangeTargetLang?.(val)}
              ariaLabel="翻译目标语言"
              options={TARGET_LANGS.map(l => ({ value: l.id, label: l.label }))}
            />
            <button
              type="button"
              className="mc-btn mc-btn-sm mc-btn-primary"
              disabled={!targetAttempt?.text?.trim() || translatingAnswer || !answersReady}
              onClick={() => void triggerAnswerTranslation()}
            >
              <IconGlobe size={12} /> {translatingAnswer ? '翻译中…' : targetAttempt?.translation ? '重新翻译' : '翻译当前回答'}
            </button>
          </div>
          {targetAttempt?.translationError && (
            <div className="mc-alert mc-alert-err">{targetAttempt.translationError}</div>
          )}
          {targetAttempt?.translation ? (
            <div className="mc-card">
              <div className="mc-card-head" style={{ padding: '8px 10px' }} data-interactive="true">
                <strong style={{ fontSize: 12 }}>{targetLangLabel}译文</strong>
                <button
                  type="button"
                  className="mc-btn mc-btn-sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(targetAttempt.translation);
                      setCopiedTrans(true);
                      setTimeout(() => setCopiedTrans(false), 1200);
                    } catch {}
                  }}
                >
                  {copiedTrans ? <><IconCheck size={11} /> 已复制</> : <><IconCopy size={11} /> 复制</>}
                </button>
              </div>
              <div className="mc-card-body" style={{ padding: 10 }}>
                <div className="mc-answer-prose" style={{ fontSize: 13, lineHeight: 1.7 }}>{targetAttempt.translation}</div>
              </div>
            </div>
          ) : (
            <div className="mc-field-hint">
              {targetQuestion ? `当前问题 #${targetQuestion.ordinal}。` : '等待生成回答后，'}
              选择目标语言并点击「翻译当前回答」，使用已配置的文本大模型翻译并缓存。
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
