function ScreenshotBatchPanel({ batch, controller, management = false }) {
  const h = jsxRuntimeExports.jsx, hs = jsxRuntimeExports.jsxs;
  const [keys, setKeys] = reactExports.useState({});
  const [folderError, setFolderError] = reactExports.useState('');
  reactExports.useEffect(() => {
    let active = true;
    const changed = value => { if (active) setKeys(value.bindings || {}); };
    window.mc.getWindowControls().then(changed).catch(() => {});
    const off = window.mc.onWindowControlsState(changed);
    return () => { active = false; off(); };
  }, []);
  const button = (label, action, disabled = false) => h('button', { type: 'button', className: 'btn btn-sm', onClick: action, disabled, children: label });
  if (!management) return h('div', { title: batch.message || '多图操作在设置 → 截图与快捷键中', style: { fontSize: 11, opacity: .75, padding: '3px 0', flexShrink: 0, whiteSpace: 'normal' }, children: `多图${batch.enabled ? '开' : '关'} · ${batch.images.length}/12${batch.busy ? ' 截图中' : ''}　开关 ${String(keys.toggleBatch || '未设置').replace(/Control/g, 'Ctrl')}　发送 ${String(keys.sendBatch || '未设置').replace(/Control/g, 'Ctrl')}` });
  return hs('div', { style: { fontSize: 11, display: 'grid', gap: 4, padding: '4px 0', flexShrink: 0, maxHeight: '40vh', overflowY: 'auto' }, children: [
    hs('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }, children: [
      button(batch.enabled ? '多图：开' : '多图：关', controller.toggle, batch.busy),
      h('span', { children: `${batch.images.length}/12 张${batch.busy ? ' · 截图中' : ''}` }),
      button('发送暂存', controller.sendBatch, batch.busy || !batch.images.length),
      button('截图目录', async () => { try { await window.mc.openScreenshotFolder(); setFolderError(''); } catch (e) { setFolderError(e.message); } })
    ] }),
    (batch.enabled || batch.images.length > 0) && hs('details', { children: [
      h('summary', { children: '补充问题 / 查看暂存截图' }),
      h('textarea', { value: batch.question, rows: 2, placeholder: '可选：补充问题', style: { width: '100%', boxSizing: 'border-box' }, onChange: e => controller.question(e.target.value) }),
      ...batch.images.map((img, index) => hs('div', { style: { display: 'flex', gap: 4, alignItems: 'center' }, children: [h('img', { src: img.dataUrl, alt: `截图 ${index + 1}`, style: { width: 48, height: 32, objectFit: 'contain' } }), h('span', { children: `${index + 1}. ${img.name}` }), button('移除', () => controller.remove(index), batch.busy)] }, index)),
      button('清空暂存', controller.clear, batch.busy || !batch.images.length)
    ] }),
    h('div', { style: { opacity: .7 }, children: `开关 ${keys.toggleBatch || '未设置'} · 发送 ${keys.sendBatch || '未设置'}` }),
    (batch.message || folderError) && h('div', { role: 'status', children: folderError || batch.message })
  ] });
}
