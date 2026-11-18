function EyeContactSettings({ active = true }) {
  const h = jsxRuntimeExports.jsx, hs = jsxRuntimeExports.jsxs;
  const [eye, setEye] = reactExports.useState({ phase: 'off', preview: {} });
  const [config, setConfig] = reactExports.useState(null), [devices, setDevices] = reactExports.useState([]);
  const [busy, setBusy] = reactExports.useState(false), [error, setError] = reactExports.useState(''), [note, setNote] = reactExports.useState('');
  const [preview, setPreview] = reactExports.useState({ status: 'stopped' });
  const video = reactExports.useRef(null), alive = reactExports.useRef(true), visible = reactExports.useRef(active);
  const previewer = reactExports.useRef(null), operation = reactExports.useRef(0);
  visible.current = active;
  if (!previewer.current) previewer.current = createEyeContactPreview({
    report: report => window.mc.reportEyeContactPreview(report),
    onState: value => { if (alive.current) setPreview(value); }
  });
  reactExports.useEffect(() => {
    alive.current = true;
    Promise.all([window.mc.getEyeContactState(), window.mc.getEyeContactSettings()]).then(([state, settings]) => {
      if (alive.current) { setEye(state); setConfig(settings); }
    }).catch(failure => { if (alive.current) setError(failure.message); });
    previewer.current.listDevices().then(list => { if (alive.current) setDevices(list); }).catch(() => {});
    const off = window.mc.onEyeContactState(state => {
      if (!alive.current) return;
      setEye(state);
      if ((!state.enabled || ['restarting', 'error'].includes(state.phase)) && previewer.current.isActive()) previewer.current.stop();
    });
    return () => { alive.current = false; operation.current++; previewer.current.stop(); off?.(); };
  }, []);
  reactExports.useEffect(() => { if (!active) { operation.current++; previewer.current.stop(); } }, [active]);
  async function run(action) {
    if (busy) return;
    setBusy(true); setError(''); setNote('');
    try { await action(); } catch (failure) { if (alive.current && failure.name !== 'AbortError') setError(failure.message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function save(patch) {
    setError('');
    try {
      const value = await window.mc.setEyeContactSettings(patch);
      if (alive.current) { setConfig(value); setNote('已保存；运行中的引擎需要点击“应用并重启引擎”。'); }
    } catch (failure) { if (alive.current) setError(failure.message); }
  }
  function stopPreview() { operation.current++; previewer.current.stop(); }
  async function beginPreview() {
    const token = ++operation.current;
    const state = await window.mc.setEyeContactEnabled(true);
    if (!alive.current || !visible.current || token !== operation.current) return;
    setEye(state);
    if (!state.enabled) throw new Error(state.error || '摄像头引擎未就绪。');
    if (state.pendingSettings) throw new Error('请先应用已保存的摄像头设置。');
    await previewer.current.start({ virtualCamera: state.virtualCamera, element: video.current, sessionId: state.sessionId });
  }
  async function control(restart = false) {
    stopPreview();
    const state = restart ? await window.mc.restartEyeContact() : await window.mc.setEyeContactEnabled(!eye.enabled);
    if (alive.current) setEye(state);
    if (state.error && state.phase === 'error') throw new Error(state.error);
  }
  const row = (label, input) => hs('label', { className: 'settings-row', children: [h('span', { children: label }), input] });
  const check = (key, label) => row(label, h('input', { type: 'checkbox', checked: !!config[key], disabled: busy, onChange: event => void save({ [key]: event.target.checked }) }));
  const sources = devices.filter(item => item.label && item.label !== eye.virtualCamera && !/DirectShow Softcam|SuiSi Virtual Camera|\-ss(?:\-uat)?$/i.test(item.label));
  const selected = sources.find(item => item.deviceId === config?.sourceDeviceId || item.label === config?.sourceDeviceName);
  const previewing = ['waiting', 'first-frame'].includes(preview.status);
  return hs('section', { className: 'preferences-card', children: [
    h('h3', { children: '摄像头与眼神矫正' }),
    h('p', { className: 'settings-hint', children: '输入摄像头用于采集原始画面。视频软件中请选择下方的虚拟摄像头。修改自动保存，运行时点击“应用并重启引擎”生效。' }),
    config ? hs(reactExports.Fragment, { children: [
      row('输入摄像头', h('select', { value: selected?.deviceId || (config.sourceDeviceName ? '__saved__' : ''), disabled: busy,
        onChange: event => { const device = sources.find(item => item.deviceId === event.target.value); void save({ sourceDeviceId: device?.deviceId || '', sourceDeviceName: device?.label || '' }); },
        children: [h('option', { value: '', children: '自动选择' }),
          !selected && config.sourceDeviceName && h('option', { value: '__saved__', children: config.sourceDeviceName + '（当前未枚举到）' }),
          ...sources.map(device => h('option', { value: device.deviceId, children: device.label }, device.deviceId))] })),
      row('处理方式', h('select', { value: config.outputMode, disabled: busy, onChange: event => void save({ outputMode: event.target.value }), children: [
        h('option', { value: 'correct', children: '眼神矫正' }), h('option', { value: 'passthrough', children: '原画直通（不做矫正）' })] })),
      check('releaseWhenIdle', '空闲时释放真实摄像头'),
      check('restartOnFailure', '运行故障时尝试恢复一次'),
      hs('details', { children: [h('summary', { children: '画面与空闲设置' }),
        check('lookAway', '随机移开视线'),
        row('时间平滑', h('select', { value: String(config.temporal), disabled: busy, onChange: event => void save({ temporal: Number(event.target.value) }), children: [
          h('option', { value: '4294967295', children: '完全平滑（默认）' }), h('option', { value: '35', children: '基础平滑' }), h('option', { value: '0', children: '关闭' })] })),
        row('眼部融合区域', h('select', { value: config.eyeSize, disabled: busy, onChange: event => void save({ eyeSize: Number(event.target.value) }), children: [2, 3, 4, 5, 6].map(value => h('option', { value, children: String(value) }, value)) })),
        row('断开后等待', h('select', { value: config.idleGraceMs, disabled: busy, onChange: event => void save({ idleGraceMs: Number(event.target.value) }), children: [1000, 3000, 5000, 10000].map(value => h('option', { value, children: value / 1000 + ' 秒' }, value)) }))
      ] }),
      hs('div', { className: 'settings-actions', children: [
        h('button', { className: 'btn', type: 'button', disabled: busy, onClick: () => void run(async () => setDevices(await previewer.current.listDevices(true))), children: '刷新摄像头 / 申请权限' }),
        h('button', { className: 'btn', type: 'button', disabled: busy, onClick: () => void run(() => control()), children: eye.enabled ? '关闭引擎并释放摄像头' : '开启引擎' }),
        h('button', { className: 'btn', type: 'button', disabled: busy || !eye.enabled || !eye.pendingSettings, onClick: () => void run(() => control(true)), children: '应用并重启引擎' })
      ] })
    ] }) : h('p', { children: '正在读取摄像头设置…' }),
    h('p', { role: 'status', children: eyeContactStatus(eye) }),
    h('div', { className: 'settings-hint', children: '虚拟摄像头：' + (eye.virtualCamera || '开启引擎后显示') }),
    eye.device && h('div', { className: 'settings-hint', children: `实际输入：${eye.device}${eye.width ? ` · ${eye.width}×${eye.height}` : ''}${eye.deviceFallback ? ' · 已回退到其他设备' : ''}` }),
    eye.connected && h('div', { className: 'settings-hint', children: `处理帧率：${eye.fps ?? '—'} FPS · 推理耗时：${eye.inferMs ?? '—'} ms` }),
    hs('div', { className: 'settings-actions', children: [
      h('button', { className: 'btn', type: 'button', disabled: busy || previewing, onClick: () => void run(beginPreview), children: '预览并检查首帧' }),
      h('button', { className: 'btn', type: 'button', disabled: !busy && !previewing, onClick: stopPreview, children: '停止预览' }),
      h('button', { className: 'btn', type: 'button', disabled: busy, onClick: () => void run(async () => {
        const value = await window.mc.getEyeContactDiagnostics();
        await navigator.clipboard.writeText(JSON.stringify(value, null, 2)); setNote('诊断已复制，包含状态和时间记录，不包含画面。');
      }), children: '复制诊断' })
    ] }),
    h('video', { ref: video, muted: true, playsInline: true, hidden: !previewing, style: { width: '100%', maxWidth: 640, marginTop: 12, borderRadius: 8, background: '#080c13' } }),
    h('p', { className: 'settings-hint', children: preview.status === 'first-frame' ? `预览已收到首帧 · ${preview.width}×${preview.height}` : preview.status === 'waiting' ? '正在打开虚拟摄像头并等待首帧…' : preview.status === 'error' ? preview.message : '预览最长 5 分钟；切换设置页或关闭设置时停止。预览成功只代表本软件取流成功。' }),
    note && h('p', { role: 'status', className: 'settings-hint', children: note }),
    error && h('div', { role: 'alert', className: 'settings-warn', children: error })
  ] });
}
