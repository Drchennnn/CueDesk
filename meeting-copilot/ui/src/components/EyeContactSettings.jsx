import React, { useEffect, useRef, useState } from 'react';
import { Switch, eyeContactStatusText } from './SharedWidgets.jsx';

function createEyeContactPreview(options = {}) {
  const media = options.mediaDevices || navigator.mediaDevices;
  const delay = options.pollMs ?? 250;
  const enumerationTimeout = options.enumerationTimeout ?? 10000;
  let version = 0;
  let stream = null;
  let video = null;
  let sessionId = null;
  const cancellations = new Set();
  const stopTracks = (val) => val?.getTracks?.().forEach(t => t.stop());
  const abortError = () => Object.assign(new Error('预览已停止。'), { name: 'AbortError' });
  const emit = (report) => {
    options.onState?.(report);
    if (sessionId !== null) Promise.resolve(options.report?.({ ...report, sessionId })).catch(() => {});
  };

  function bounded(promise, ms, message, token, lateCleanup) {
    let finished = false;
    let timeout;
    let cancel;
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        cancellations.delete(cancel);
        error ? reject(error) : resolve(value);
      };
      cancel = () => finish(abortError());
      cancellations.add(cancel);
      timeout = setTimeout(() => finish(new Error(message)), ms);
      Promise.resolve(promise).then(
        (value) => {
          if (finished || token !== version) { lateCleanup?.(value); return; }
          finish(null, value);
        },
        (err) => finish(err)
      );
    });
  }

  function stop() {
    version++;
    for (const cancel of [...cancellations]) cancel();
    cancellations.clear();
    stopTracks(stream);
    stream = null;
    if (video) { try { video.pause(); } catch {} video.srcObject = null; video = null; }
    emit({ status: 'stopped' });
    sessionId = null;
  }

  async function listDevices(requestPermission = false) {
    const token = version;
    let devices = await bounded(media.enumerateDevices(), enumerationTimeout, '读取摄像头列表超时。', token);
    if (requestPermission && !devices.some(item => item.kind === 'videoinput' && item.label)) {
      const temporary = await bounded(
        media.getUserMedia({ video: true, audio: false }),
        options.openTimeout ?? 15000,
        '摄像头权限请求超时，请检查系统权限。',
        token,
        stopTracks
      );
      stopTracks(temporary);
      devices = await bounded(media.enumerateDevices(), enumerationTimeout, '读取摄像头列表超时。', token);
    }
    return devices.filter(item => item.kind === 'videoinput');
  }

  function waitForFrame(element, token) {
    return new Promise((resolve, reject) => {
      let frameId;
      let timeout;
      let poll;
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        clearInterval(poll);
        cancellations.delete(cancel);
        if (frameId !== undefined) element.cancelVideoFrameCallback?.(frameId);
        element.removeEventListener?.('loadeddata', check);
        err ? reject(err) : resolve();
      };
      const cancel = () => finish(abortError());
      const check = () => {
        if (token !== version) finish(abortError());
        else if (element.readyState >= 2 && element.videoWidth > 0 && element.videoHeight > 0) finish();
      };
      cancellations.add(cancel);
      timeout = setTimeout(() => finish(new Error('虚拟摄像头已打开，但没有收到首帧。')), options.frameTimeout ?? 8000);
      if (typeof element.requestVideoFrameCallback === 'function') {
        frameId = element.requestVideoFrameCallback(() => token === version ? finish() : finish(abortError()));
      } else {
        element.addEventListener?.('loadeddata', check);
        poll = setInterval(check, 100);
      }
      try { Promise.resolve(element.play()).catch(err => finish(err)); } catch (err) { finish(err); }
    });
  }

  async function start({ virtualCamera, element, sessionId: id }) {
    stop();
    const token = version;
    sessionId = id;
    video = element;
    emit({ status: 'waiting' });
    try {
      let devices = await listDevices(true);
      let device;
      const deadline = Date.now() + enumerationTimeout;
      while (token === version) {
        device = devices.find(item => item.label === virtualCamera);
        if (device) break;
        if (Date.now() >= deadline) throw new Error('没有发现虚拟摄像头；若刚安装组件，请重启相关视频软件。');
        await bounded(new Promise(r => setTimeout(r, delay)), delay + 1000, '等待设备列表超时。', token);
        devices = await bounded(media.enumerateDevices(), enumerationTimeout, '读取摄像头列表超时。', token);
      }
      if (token !== version) throw abortError();
      const obtained = await bounded(
        media.getUserMedia({ video: { deviceId: { exact: device.deviceId } }, audio: false }),
        options.openTimeout ?? 15000,
        '虚拟摄像头打开超时，请检查其他预览是否已停止。',
        token,
        stopTracks
      );
      if (token !== version) { stopTracks(obtained); throw abortError(); }
      stream = obtained;
      for (const track of stream.getTracks()) track.onended = () => { if (token === version) stop(); };
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await waitForFrame(video, token);
      if (token !== version) throw abortError();
      const report = { status: 'first-frame', width: video.videoWidth, height: video.videoHeight };
      emit(report);
      const timer = setTimeout(() => { if (token === version) stop(); }, options.previewTimeout ?? 300000);
      cancellations.add(() => clearTimeout(timer));
      return report;
    } catch (err) {
      if (token === version) {
        stopTracks(stream);
        stream = null;
        if (video) { try { video.pause(); } catch {} video.srcObject = null; video = null; }
        emit({ status: err.name === 'AbortError' ? 'stopped' : 'error', message: `${err.name || 'Error'}: ${err.message}` });
      }
      throw err;
    }
  }

  return { start, stop, listDevices, isActive: () => sessionId !== null };
}

export function EyeContactSettings({ active = true }) {
  const [eye, setEye] = useState({ phase: 'off', preview: {} });
  const [config, setConfig] = useState(null);
  const [devices, setDevices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState({ status: 'stopped' });
  const videoRef = useRef(null);
  const aliveRef = useRef(true);
  const visibleRef = useRef(active);
  const previewerRef = useRef(null);
  const opRef = useRef(0);

  visibleRef.current = active;
  if (!previewerRef.current) {
    previewerRef.current = createEyeContactPreview({
      report: report => window.mc.reportEyeContactPreview(report),
      onState: val => { if (aliveRef.current) setPreview(val); }
    });
  }

  useEffect(() => {
    aliveRef.current = true;
    Promise.all([window.mc.getEyeContactState(), window.mc.getEyeContactSettings()])
      .then(([st, cfg]) => { if (aliveRef.current) { setEye(st); setConfig(cfg); } })
      .catch(err => { if (aliveRef.current) setError(err.message); });
    previewerRef.current.listDevices().then(list => { if (aliveRef.current) setDevices(list); }).catch(() => {});
    const off = window.mc.onEyeContactState((st) => {
      if (!aliveRef.current) return;
      setEye(st);
      if ((!st.enabled || ['restarting', 'error'].includes(st.phase)) && previewerRef.current.isActive()) {
        previewerRef.current.stop();
      }
    });
    return () => {
      aliveRef.current = false;
      opRef.current++;
      previewerRef.current.stop();
      off?.();
    };
  }, []);

  useEffect(() => {
    if (!active) {
      opRef.current++;
      previewerRef.current.stop();
    }
  }, [active]);

  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNote('');
    try { await action(); }
    catch (err) { if (aliveRef.current && err.name !== 'AbortError') setError(err.message); }
    finally { if (aliveRef.current) setBusy(false); }
  };

  const save = async (patch) => {
    setError('');
    try {
      const value = await window.mc.setEyeContactSettings(patch);
      if (aliveRef.current) { setConfig(value); setNote('已保存；运行中的引擎需点击“应用并重启引擎”生效。'); }
    } catch (err) {
      if (aliveRef.current) setError(err.message);
    }
  };

  const stopPreview = () => { opRef.current++; previewerRef.current.stop(); };

  const beginPreview = async () => {
    const token = ++opRef.current;
    const st = await window.mc.setEyeContactEnabled(true);
    if (!aliveRef.current || !visibleRef.current || token !== opRef.current) return;
    setEye(st);
    if (!st.enabled) throw new Error(st.error || '摄像头引擎未就绪。');
    if (st.pendingSettings) throw new Error('请先应用已保存的摄像头设置。');
    await previewerRef.current.start({ virtualCamera: st.virtualCamera, element: videoRef.current, sessionId: st.sessionId });
  };

  const control = async (restart = false) => {
    stopPreview();
    const st = restart ? await window.mc.restartEyeContact() : await window.mc.setEyeContactEnabled(!eye.enabled);
    if (aliveRef.current) setEye(st);
    if (st.error && st.phase === 'error') throw new Error(st.error);
  };

  const sources = devices.filter(item => item.label && item.label !== eye.virtualCamera && !/DirectShow Softcam|SuiSi Virtual Camera|-ss(?:-uat)?$/i.test(item.label));
  const selected = sources.find(item => item.deviceId === config?.sourceDeviceId || item.label === config?.sourceDeviceName);
  const previewing = ['waiting', 'first-frame'].includes(preview.status);

  return (
    <section className="mc-card">
      <div className="mc-card-head">
        <div>
          <h3 className="mc-card-title">摄像头与眼神矫正（NVIDIA Maxine）</h3>
          <p className="mc-card-desc">输入摄像头采集原始画面，在会议软件中选择虚拟摄像头输出；离开本页自动停止预览。</p>
        </div>
        <span className={`mc-badge ${eye.enabled ? 'mc-badge-ok' : ''}`}>{eye.enabled ? '引擎已开启' : '未开启'}</span>
      </div>

      {config ? (
        <>
          <div className="mc-srow">
            <div>
              <div className="mc-srow-label">输入摄像头</div>
              <div className="mc-srow-desc">选择物理摄像头作为眼神矫正输入源</div>
            </div>
            <div className="mc-srow-control">
              <select
                className="mc-select"
                disabled={busy}
                value={selected?.deviceId || (config.sourceDeviceName ? '__saved__' : '')}
                onChange={e => {
                  const dev = sources.find(item => item.deviceId === e.target.value);
                  void save({ sourceDeviceId: dev?.deviceId || '', sourceDeviceName: dev?.label || '' });
                }}
              >
                <option value="">自动选择</option>
                {!selected && config.sourceDeviceName && <option value="__saved__">{config.sourceDeviceName}（当前未枚举到）</option>}
                {sources.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
              </select>
            </div>
          </div>

          <div className="mc-srow mc-srow-compact">
            <div><div className="mc-srow-label">处理方式</div></div>
            <div className="mc-srow-control">
              <select className="mc-select" disabled={busy} value={config.outputMode} onChange={e => void save({ outputMode: e.target.value })}>
                <option value="correct">眼神矫正</option>
                <option value="passthrough">原画直通（不做矫正）</option>
              </select>
            </div>
          </div>

          <div className="mc-srow mc-srow-compact">
            <div><div className="mc-srow-label">空闲时释放真实摄像头</div></div>
            <div className="mc-srow-control is-inline">
              <Switch checked={!!config.releaseWhenIdle} disabled={busy} onChange={v => void save({ releaseWhenIdle: v })} />
            </div>
          </div>

          <div className="mc-srow mc-srow-compact">
            <div><div className="mc-srow-label">运行故障时尝试恢复一次</div></div>
            <div className="mc-srow-control is-inline">
              <Switch checked={!!config.restartOnFailure} disabled={busy} onChange={v => void save({ restartOnFailure: v })} />
            </div>
          </div>

          <div className="mc-card-body" style={{ borderTop: '1px solid var(--border)' }}>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 500 }}>画面与空闲高级参数</summary>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5 }}>随机移开视线（更自然）</span>
                  <Switch checked={!!config.lookAway} disabled={busy} onChange={v => void save({ lookAway: v })} />
                </div>
                <div className="mc-grid-2">
                  <div className="mc-field">
                    <label className="mc-field-label">时间平滑</label>
                    <select className="mc-select" disabled={busy} value={String(config.temporal)} onChange={e => void save({ temporal: Number(e.target.value) })}>
                      <option value="4294967295">完全平滑（默认）</option>
                      <option value="35">基础平滑</option>
                      <option value="0">关闭</option>
                    </select>
                  </div>
                  <div className="mc-field">
                    <label className="mc-field-label">眼部融合区域</label>
                    <select className="mc-select" disabled={busy} value={config.eyeSize} onChange={e => void save({ eyeSize: Number(e.target.value) })}>
                      {[2, 3, 4, 5, 6].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div className="mc-field">
                    <label className="mc-field-label">断开后等待释放</label>
                    <select className="mc-select" disabled={busy} value={config.idleGraceMs} onChange={e => void save({ idleGraceMs: Number(e.target.value) })}>
                      {[1000, 3000, 5000, 10000].map(v => <option key={v} value={v}>{v / 1000} 秒</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </details>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="mc-btn mc-btn-sm" disabled={busy} onClick={() => void run(async () => setDevices(await previewerRef.current.listDevices(true)))}>
                刷新摄像头 / 申请权限
              </button>
              <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" disabled={busy} onClick={() => void run(() => control(false))}>
                {eye.enabled ? '关闭引擎并释放摄像头' : '开启引擎'}
              </button>
              <button type="button" className="mc-btn mc-btn-sm" disabled={busy || !eye.enabled || !eye.pendingSettings} onClick={() => void run(() => control(true))}>
                应用并重启引擎
              </button>
              <button type="button" className="mc-btn mc-btn-sm" disabled={busy || previewing} onClick={() => void run(beginPreview)}>
                预览并检查首帧
              </button>
              <button type="button" className="mc-btn mc-btn-sm" disabled={!busy && !previewing} onClick={stopPreview}>
                停止预览
              </button>
              <button
                type="button"
                className="mc-btn mc-btn-sm"
                disabled={busy}
                onClick={() => void run(async () => {
                  const diag = await window.mc.getEyeContactDiagnostics();
                  await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
                  setNote('诊断已复制（不含画面）');
                })}
              >
                复制诊断
              </button>
            </div>

            <div className="mc-alert" role="status">
              <div><strong>状态：</strong>{eyeContactStatusText(eye)}</div>
              <div className="mc-field-hint">虚拟摄像头：{eye.virtualCamera || '开启引擎后显示'}</div>
              {eye.device && (
                <div className="mc-field-hint">
                  实际输入：{eye.device}{eye.width ? ` · ${eye.width}×${eye.height}` : ''}{eye.deviceFallback ? ' · 已回退设备' : ''}
                </div>
              )}
              {eye.connected && <div className="mc-field-hint">帧率：{eye.fps ?? '—'} FPS · 推理：{eye.inferMs ?? '—'} ms</div>}
            </div>

            <video ref={videoRef} muted playsInline hidden={!previewing} style={{ width: '100%', maxWidth: 640, borderRadius: 8, background: '#090b10' }} />
            <div className="mc-field-hint">
              {preview.status === 'first-frame' ? `预览已收到首帧 · ${preview.width}×${preview.height}` :
                preview.status === 'waiting' ? '正在打开虚拟摄像头并等待首帧…' :
                  preview.status === 'error' ? preview.message :
                    '预览最长 5 分钟；切换页签或离开设置时自动停止。'}
            </div>
            {note && <div className="mc-alert mc-alert-ok">{note}</div>}
            {error && <div className="mc-alert mc-alert-err">{error}</div>}
          </div>
        </>
      ) : (
        <div className="mc-card-body"><span className="mc-field-hint">正在读取摄像头设置…</span></div>
      )}
    </section>
  );
}
