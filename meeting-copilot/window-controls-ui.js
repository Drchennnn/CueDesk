function WindowControlsSettings() {
  const h = jsxRuntimeExports.jsx, hs = jsxRuntimeExports.jsxs;
  const [draft, setDraft] = reactExports.useState(null);
  const [error, setError] = reactExports.useState('');
  const [message, setMessage] = reactExports.useState('');
  const [saving, setSaving] = reactExports.useState(false);
  reactExports.useEffect(() => {
    let active = true;
    window.mc.getWindowControls().then(value => { if (active) setDraft(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  const auto = useAutoSaveValue(draft && { opacity: draft.opacity, moveStep: draft.moveStep, bindings: draft.bindings }, value => window.mc.setWindowControls(value));
  const changeOpacity = value => setDraft({ ...draft, opacity: value });
  const labels = { left: '左移', right: '右移', up: '上移', down: '下移', grow: '放大窗口', shrink: '缩小窗口', toggleBatch: '多图开关', sendBatch: '发送多图' };
  const row = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, margin: '6px 0' };
  return hs('details', { className: 'window-controls-settings', style: { fontSize: 12, margin: '8px 0', WebkitAppRegion: 'no-drag' }, children: [
    h('summary', { style: { cursor: 'pointer' }, children: '窗口移动、缩放与透明度' }),
    draft && hs('div', { children: [
      h('p', { children: '快捷键可在其他窗口处于前台时使用，窗口与文字同步等比例缩放。修改后自动保存。' }),
      hs('label', { style: row, children: [ '窗口不透明度 ', h('input', { type: 'range', min: 20, max: 100, step: 1, value: Math.round(draft.opacity * 100), title: '窗口不透明度', style: { flex: 1, minWidth: 50 }, onChange: e => void changeOpacity(Number(e.target.value) / 100) }), `${Math.round(draft.opacity * 100)}%` ] }),
      h('div', { style: { opacity: 0.75 }, children: '100% 完全不透明；降低数值会同时淡化背景和文字。' }),
      hs('label', { style: row, children: [ '每次移动 ', h('input', { type: 'number', min: 1, max: 200, value: draft.moveStep, style: { width: 65 }, onChange: e => setDraft({ ...draft, moveStep: Number(e.target.value) }) }), '像素（随显示缩放）' ] }),
      ...Object.entries(labels).map(([key, label]) => hs('label', { style: row, children: [h('span', { style: { width: 65 }, children: label }), h('input', { type: 'text', value: draft.bindings[key] || '', spellCheck: false, 'aria-label': label + '快捷键', placeholder: '如 Control+Alt+Left', style: { flex: 1, minWidth: 100 }, onChange: e => setDraft({ ...draft, bindings: { ...draft.bindings, [key]: e.target.value } }) })] }, key)),
      h('p', { children: '按键名称示例：Control+Alt+Left、Control+Alt+PageUp。清空可禁用该项；自动检查冲突。' }),
      h('span', { role: 'status', children: auto.error || (auto.status === 'saved' ? '已自动保存' : auto.status === 'saving' ? '保存中…' : '等待自动保存…') }),
      draft.errors?.length > 0 && h('div', { role: 'alert', className: 'answer-error', children: draft.errors.join('；') })
    ] }),
    error && h('div', { role: 'alert', className: 'answer-error', children: error }),
    message && h('div', { role: 'status', children: message })
  ] });
}
