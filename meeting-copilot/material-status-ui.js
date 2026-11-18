function InterviewMaterialStatus({ refreshKey, onOpenSettings }) {
  const h = jsxRuntimeExports.jsx;
  const [status, setStatus] = reactExports.useState(null);
  reactExports.useEffect(() => {
    let active = true;
    const refresh = () => window.mc.getInterviewLibrary().then(value => {
      if (active) setStatus(value.material_status || null);
    }).catch(() => {
      if (active) setStatus({ level: 'warning', message: '资料状态读取失败，请打开设置检查。' });
    });
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('mc-library-updated', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); window.removeEventListener('mc-library-updated', refresh); };
  }, [refreshKey]);
  if (!status) return null;
  const warning = status.level === 'warning';
  return jsxRuntimeExports.jsxs('div', {
    role: warning ? 'alert' : 'status',
    'aria-label': '面试资料状态',
    style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', fontSize: 12, color: warning ? '#f6cc79' : '#a8c3b5', background: warning ? '#45351b' : '#17251f', WebkitAppRegion: 'no-drag' },
    children: [
      h('span', { style: { flex: 1 }, children: status.message }),
      h('button', { className: 'btn btn-sm', type: 'button', onClick: () => {
        onOpenSettings();
        requestAnimationFrame(() => document.getElementById('preferences-tab-interview')?.click());
      }, children: '检查资料' })
    ]
  });
}
