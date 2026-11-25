import React, { useLayoutEffect, useRef } from 'react';
import { getActiveAttempt } from '../core/sessionModel.js';
import { ScreenshotBatchPanel, WrittenAnswerContent, compactWrittenAnswer } from './SharedWidgets.jsx';

function writtenAnswerRows(question) {
  if (!question) return [];
  const attempt = getActiveAttempt(question);
  if (!attempt) return [];
  if (attempt.modelResults?.length) {
    return [...attempt.modelResults].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }
  const text = String(attempt.text || '');
  const headings = [...text.matchAll(/^【([^\n]+)】\s*$/gm)];
  if (headings.length) {
    return headings.map((heading, index) => ({
      id: `stored-${index}`,
      index,
      name: heading[1],
      model: '',
      status: 'done',
      text: text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim()
    }));
  }
  return [{
    id: attempt.id,
    index: 0,
    name: '答案',
    model: '',
    status: attempt.status === 'streaming' ? 'pending' : attempt.status === 'error' ? 'error' : 'done',
    text,
    error: attempt.error
  }];
}

export function WrittenCompactView({
  preferences,
  latestQuestion,
  ready,
  error,
  onPatch,
  onCancel,
  onRestore,
  batch,
  batchController
}) {
  const attempt = getActiveAttempt(latestQuestion);
  const rows = writtenAnswerRows(latestQuestion);
  const readerRef = useRef(null);

  useLayoutEffect(() => {
    if (readerRef.current) readerRef.current.scrollTop = 0;
  }, [latestQuestion?.id]);

  const ctrlStyle = { WebkitAppRegion: 'no-drag', height: 22, padding: '0 6px', fontSize: 11 };

  return (
    <section
      className="written-compact"
      style={{
        display: 'flex', flexDirection: 'column', width: '100%', height: '100vh',
        minWidth: 0, minHeight: 0, padding: 6,
        border: '1px solid var(--border-strong)', borderRadius: 8,
        background: 'var(--bg-surface)', color: 'var(--text)', overflow: 'hidden'
      }}
    >
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
          paddingBottom: 4, borderBottom: '1px solid var(--border)', WebkitAppRegion: 'drag'
        }}
      >
        <strong style={{ fontSize: 11, flex: 1, minWidth: 28, cursor: 'move' }} title="拖动移动小窗">
          {preferences?.clickThrough ? '穿透' : '笔试'}
        </strong>
        <button type="button" className="mc-btn mc-btn-sm" style={ctrlStyle} disabled={(preferences?.fontSize ?? 28) <= 12} onClick={() => onPatch({ fontDelta: -2 })} title="缩小字号">
          A−
        </button>
        <button type="button" className="mc-btn mc-btn-sm" style={ctrlStyle} disabled={(preferences?.fontSize ?? 28) >= 72} onClick={() => onPatch({ fontDelta: 2 })} title="放大字号">
          A+
        </button>
        <button type="button" className="mc-btn mc-btn-sm" style={ctrlStyle} onClick={onRestore} title="返回完整界面">
          ↗
        </button>
      </header>

      <ScreenshotBatchPanel batch={batch} controller={batchController} />
      {error && <div role="alert" className="mc-alert mc-alert-err" style={{ fontSize: 11, padding: '4px 6px' }}>{error}</div>}
      {preferences?.clickThrough && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', paddingTop: 2 }}>
          鼠标穿透中 · 重新启动程序入口恢复操作
        </div>
      )}

      <div
        ref={readerRef}
        tabIndex={0}
        role="region"
        aria-label="模型回答"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', paddingTop: 4 }}
      >
        {rows.length > 0 ? rows.map((result, index) => (
          <div
            key={result.id || index}
            style={{
              display: 'grid',
              gridTemplateColumns: preferences?.showNames !== false ? 'minmax(60px, 40%) minmax(0, 1fr)' : '16px minmax(0, 1fr)',
              alignItems: 'center',
              gap: 6,
              padding: '4px 1px',
              borderBottom: index + 1 < rows.length ? '1px solid var(--border)' : 'none'
            }}
          >
            <span
              title={[result.name, result.model].filter(Boolean).join(' · ')}
              style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {preferences?.showNames !== false ? `${index + 1} ${result.model || result.name}` : String(index + 1)}
            </span>
            {result.status === 'done' ? (
              <div style={{ minWidth: 0, gridColumn: /^[A-H]+(?:\n[A-H]+)*$/.test(compactWrittenAnswer(result.text)) ? undefined : '1 / -1' }}>
                <WrittenAnswerContent
                  value={result.text}
                  fontSize={preferences?.fontSize || 28}
                  fontFamily={preferences?.fontFamily || 'Microsoft YaHei'}
                  compact
                />
              </div>
            ) : (
              <span style={{ fontSize: result.status === 'pending' ? 15 : 11, color: result.status === 'error' ? 'var(--danger)' : 'var(--text-muted)' }}>
                {result.status === 'pending' ? '…' : result.error || '已停止'}
              </span>
            )}
          </div>
        )) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 2px' }}>
            {ready ? '按截图快捷键开始识题' : '请先在完整界面配置视觉模型'}
          </div>
        )}
      </div>

      <footer style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
        <button
          type="button"
          className="mc-btn mc-btn-sm"
          style={ctrlStyle}
          disabled={!attempt || attempt.status !== 'streaming'}
          onClick={() => attempt && onCancel(attempt.requestId)}
        >
          停止
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>
          {rows.length ? `${rows.filter(r => r.status === 'done').length}/${rows.length}` : ''}
        </span>
      </footer>
    </section>
  );
}
