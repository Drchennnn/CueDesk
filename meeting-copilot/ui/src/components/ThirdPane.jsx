import React, { useEffect, useRef, useState } from 'react';
import { getActiveAttempt } from '../core/sessionModel.js';
import { IconCheck, IconCopy, IconGlobe, IconPin, IconTrash, IconX } from './Icons.jsx';
import { EvidencePanel, cleanAnswerReferences } from './SharedWidgets.jsx';

export function ThirdPane({
  tab,
  onSelectTab,
  onClose,
  session,
  selectedQuestion,
  partials,
  answersReady,
  onAskText,
  onTranslateSegment,
  onTranslateAnswer,
  onClearTranscript
}) {
  const [lockedQuestionId, setLockedQuestionId] = useState(null);
  const [translatingAnswer, setTranslatingAnswer] = useState(false);
  const [copiedTrans, setCopiedTrans] = useState(false);
  const [selectionPopup, setSelectionPopup] = useState(null);
  const transcriptBoxRef = useRef(null);
  const stickRef = useRef(true);

  const targetQuestion = lockedQuestionId
    ? (session?.questions || []).find(q => q.id === lockedQuestionId) || selectedQuestion
    : selectedQuestion;
  const targetAttempt = getActiveAttempt(targetQuestion);

  useEffect(() => {
    if (tab === 'transcript' && stickRef.current && transcriptBoxRef.current) {
      transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
    }
  }, [tab, session?.segments?.length, partials?.them, partials?.me]);

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
      await onTranslateAnswer(targetQuestion.id, targetAttempt.id, cleanAnswerReferences(targetAttempt.text));
    } finally {
      setTranslatingAnswer(false);
    }
  };

  return (
    <aside className="mc-wb-pane" style={{ background: 'rgba(var(--wb-bg-rgb), 0.94)' }} aria-label="辅助面板">
      <div className="mc-wb-pane-header" style={{ padding: '0 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, overflowX: 'auto' }}>
          {[
            ['evidence', '依据'],
            ['transcript', `转写 (${session?.segments?.length || 0})`],
            ['translate', '翻译']
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`mc-btn mc-btn-sm ${tab === id ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
              style={{ height: 24, padding: '0 8px', fontSize: 11.5 }}
              onClick={() => onSelectTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="mc-icon-btn" title="收起辅助栏" onClick={onClose}>
          <IconX size={13} />
        </button>
      </div>

      {tab === 'evidence' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
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

      {tab === 'transcript' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
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

      {tab === 'translate' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 10, gap: 10, overflowY: 'auto' }} data-scrollable="true">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span className="mc-field-hint">{targetQuestion ? `当前问题 #${targetQuestion.ordinal}` : '暂无选中问题'}</span>
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
              <div className="mc-card-head" style={{ padding: '8px 10px' }}>
                <strong style={{ fontSize: 12 }}>简体中文译文</strong>
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
              点击上方「翻译当前回答」，使用已配置的文本模型将当前选中回答翻译为简体中文并缓存。
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
