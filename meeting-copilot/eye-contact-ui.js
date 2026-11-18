function eyeContactStatus(eye) {
  if (eye.phase === 'installing') {
    const messages = { probing: '正在识别 NVIDIA 显卡…', checking: '正在检查 SDK 缓存…', waiting: '正在等待另一个 SDK 安装任务…',
      downloading: '正在下载 NVIDIA SDK，已完成 ' + Math.round((eye.sdk?.progress || 0) * 100) + '%',
      verifying: '正在校验 NVIDIA 下载包…', extracting: '正在解包 NVIDIA SDK…', validating: '正在检查运行库和模型…', ready: 'SDK 已配置，正在启动摄像头…' };
    return messages[eye.sdk?.stage] || eye.sdk?.message || '正在准备 NVIDIA SDK…';
  }
  if (eye.phase === 'restarting') return '引擎异常，正在尝试恢复…';
  if (eye.error) return eye.error;
  if (!eye.enabled) return 'NVIDIA Maxine 眼神矫正';
  if (!eye.connected) return eye.sourceReleased ? '等待视频软件连接；真实摄像头已释放' : '已就绪，等待视频软件连接';
  if (eye.mode === 'idle') return '检测到视频消费者，正在准备画面';
  return eye.mode === 'passthrough' ? '检测到视频消费者 · 原画直通' : '检测到视频消费者 · 眼神矫正';
}
function EyeContactToggle() {
  const [eye, setEye] = reactExports.useState({ enabled: false, phase: 'off', engine: 'full' });
  const [busy, setBusy] = reactExports.useState(false);
  const [info, setInfo] = reactExports.useState(false);
  const alive = reactExports.useRef(true);
  reactExports.useEffect(() => {
    alive.current = true;
    window.mc.getEyeContactState().then(value => { if (alive.current) setEye(value); }).catch(error => {
      if (alive.current) setEye({ enabled: false, phase: 'error', error: error.message });
    });
    const off = window.mc.onEyeContactState(value => { if (alive.current) setEye(value); });
    return () => { alive.current = false; off?.(); };
  }, []);
  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const value = await window.mc.setEyeContactEnabled(!eye.enabled);
      if (alive.current) { setEye(value); setInfo(value.enabled || !!value.error); }
    } catch (error) {
      if (alive.current) { setEye({ enabled: false, phase: 'error', error: error.message }); setInfo(true); }
    } finally { if (alive.current) setBusy(false); }
  }
  const waiting = ['checking', 'installing', 'permission', 'starting', 'restarting'].includes(eye.phase);
  const label = eye.phase === 'installing' ? (eye.sdk?.stage === 'downloading' ? '下载 SDK ' + Math.round((eye.sdk.progress || 0) * 100) + '%' : '配置 SDK…') :
    eye.phase === 'permission' ? '等待安装确认' : waiting ? '矫正启动中…' : '眼神矫正';
  const message = eyeContactStatus(eye);
  return jsxRuntimeExports.jsxs('div', {
    style: { position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 2, WebkitAppRegion: 'no-drag', flexShrink: 0 },
    children: [
      jsxRuntimeExports.jsxs('button', {
        type: 'button', className: eye.enabled ? 'btn btn-on' : 'btn', onClick: () => void toggle(), disabled: busy,
        'aria-label': '眼神矫正', 'aria-pressed': !!eye.enabled,
        title: message + '\n设备、处理方式与预览可在设置 → 摄像头与眼神矫正中调整',
        style: eye.error ? { borderColor: '#df7777' } : undefined,
        children: [jsxRuntimeExports.jsx('span', {
          'aria-hidden': true, style: { display: 'inline-block', width: 22, height: 12, borderRadius: 10, background: eye.enabled ? '#44b68c' : '#555', marginRight: 5, verticalAlign: 'middle', position: 'relative' },
          children: jsxRuntimeExports.jsx('span', { style: { position: 'absolute', top: 2, left: eye.enabled ? 12 : 2, width: 8, height: 8, borderRadius: '50%', background: '#fff', transition: 'left .15s' } })
        }), label]
      }),
      eye.phase === 'installing' && jsxRuntimeExports.jsx('button', {
        type: 'button', className: 'btn', children: '取消安装',
        onClick: () => void window.mc.setEyeContactEnabled(false).catch(error => {
          if (alive.current) setEye({ enabled: false, phase: 'error', error: error.message });
        })
      }),
      (eye.enabled || eye.error || waiting) && jsxRuntimeExports.jsx('button', {
        type: 'button', className: 'btn', 'aria-label': '眼神矫正状态', title: '查看眼神矫正状态', onClick: () => setInfo(value => !value),
        style: { paddingLeft: 4, paddingRight: 4 }, children: 'ⓘ'
      }),
      info && jsxRuntimeExports.jsxs('div', {
        role: eye.error ? 'alert' : 'status',
        style: { position: 'absolute', top: 'calc(100% + 9px)', left: 0, width: 290, padding: 12, border: '1px solid #414751', borderRadius: 9, background: '#202329', color: '#e6e9ee', fontSize: 12, lineHeight: 1.7, boxShadow: '0 8px 24px #0008', zIndex: 300, whiteSpace: 'normal' },
        children: [
          jsxRuntimeExports.jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }, children: [
            jsxRuntimeExports.jsx('strong', { children: '眼神矫正 · NVIDIA Maxine' }),
            jsxRuntimeExports.jsx('button', { type: 'button', className: 'btn', 'aria-label': '关闭眼神矫正提示', style: { padding: '0 5px' }, onClick: () => setInfo(false), children: '×' })
          ] }),
          jsxRuntimeExports.jsx('div', { style: { color: eye.error ? '#ffa4a4' : '#bce2d2' }, children: message }),
          eye.enabled && jsxRuntimeExports.jsxs(reactExports.Fragment, { children: [
            jsxRuntimeExports.jsx('div', { style: { marginTop: 5 }, children: '请在会议软件中选择摄像头：' }),
            jsxRuntimeExports.jsx('strong', { style: { overflowWrap: 'anywhere' }, children: eye.virtualCamera || 'DirectShow Softcam' }),
            eye.device && jsxRuntimeExports.jsx('div', { style: { color: '#aeb7c4', marginTop: 4 }, children: '输入：' + eye.device }),
            eye.connected && typeof eye.fps === 'number' && jsxRuntimeExports.jsx('div', { style: { color: '#aeb7c4' }, children: Math.round(eye.fps) + ' FPS' })
          ] }),
          jsxRuntimeExports.jsx('div', { style: { color: '#aeb7c4', marginTop: 4 }, children: '设备与预览：设置 → 摄像头与眼神矫正' }),
          eye.pendingSettings && jsxRuntimeExports.jsx('div', { children: '新设置已保存，应用并重启引擎后生效。' })
        ]
      })
    ]
  });
}
