import React, { useEffect, useRef, useState } from 'react';
import { Switch, eyeContactStatusText } from './SharedWidgets.jsx';
import { CustomSelect } from './CustomSelect.jsx';

function normalizeCamLabel(label) {
  return String(label || '').trim().replace(/\s+/g, ' ');
}

function stripUsbSuffix(label) {
  return normalizeCamLabel(label).replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
}

export function matchVirtualCameraDevice(devices, virtualCamera) {
  const videoInputs = (Array.isArray(devices) ? devices : []).filter(
    item => item && (!item.kind || item.kind === 'videoinput')
  );
  const target = normalizeCamLabel(virtualCamera || 'DirectShow Softcam');
  const targetLower = target.toLowerCase();
  const targetBase = stripUsbSuffix(target).toLowerCase();

  // 1. Exact label match
  let found = videoInputs.find(item => item.label === target);
  if (found) return found;
  // 2. Normalized case-insensitive match
  found = videoInputs.find(item => normalizeCamLabel(item.label).toLowerCase() === targetLower);
  if (found) return found;
  // 3. Stripped USB-ID suffix match (Chromium sometimes appends (xxxx:xxxx))
  found = videoInputs.find(item => stripUsbSuffix(item.label).toLowerCase() === targetBase);
  if (found) return found;
  // 4. Substring match or DirectShow Softcam fallback
  found = videoInputs.find(item => {
    const norm = normalizeCamLabel(item.label).toLowerCase();
    return (targetBase && norm.includes(targetBase)) || /directshow\s*softcam/i.test(norm);
  });
  return found || null;
}

function createEyeContactPreview(options = {}) {
  const media = options.mediaDevices || navigator.mediaDevices;
  const delay = options.pollMs ?? 250;
  const enumerationTimeout = options.enumerationTimeout ?? 6000;
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
      try {
        const temporary = await bounded(
          media.getUserMedia({ video: true, audio: false }),
          options.openTimeout ?? 15000,
          '摄像头权限请求超时，请检查系统权限。',
          token,
          stopTracks
        );
        stopTracks(temporary);
        devices = await bounded(media.enumerateDevices(), enumerationTimeout, '读取摄像头列表超时。', token);
      } catch (err) {
        // If another process/engine temporarily occupies default physical cam, still return enumerated list
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') throw err;
      }
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
        element.removeEventListener?.('playing', check);
        err ? reject(err) : resolve();
      };
      const cancel = () => finish(abortError());
      const check = () => {
        if (token !== version) finish(abortError());
        else if (element.readyState >= 2 && element.videoWidth > 0 && element.videoHeight > 0) finish();
      };
      cancellations.add(cancel);
      timeout = setTimeout(() => {
        const err = new Error('虚拟摄像头已打开，但没有收到首帧。请确认物理摄像头未被遮挡或被其他程序独占。');
        err.previewCode = 'NO_FIRST_FRAME';
        finish(err);
      }, options.frameTimeout ?? 10000);
      if (typeof element.requestVideoFrameCallback === 'function') {
        frameId = element.requestVideoFrameCallback(() => {
          if (token !== version) finish(abortError());
          else if (element.videoWidth > 0 && element.videoHeight > 0) finish();
        });
      }
      element.addEventListener?.('loadeddata', check);
      element.addEventListener?.('playing', check);
      poll = setInterval(check, 120);
      try { Promise.resolve(element.play()).catch(err => finish(err)); } catch (err) { finish(err); }
    });
  }

  async function start({ virtualCamera, element, sessionId: id, cameraRegistered = false, justRegistered = false }) {
    stop();
    const token = version;
    sessionId = id;
    video = element;
    emit({ status: 'waiting' });
    try {
      let devices = await listDevices(true);
      let device = null;
      const deadline = Date.now() + enumerationTimeout;
      while (token === version) {
        device = matchVirtualCameraDevice(devices, virtualCamera);
        if (device) break;
        if (Date.now() >= deadline) {
          const labels = devices.map(d => d.label || '(未命名)').filter(Boolean);
          const err = new Error(
            cameraRegistered
              ? `系统已注册虚拟摄像头（${virtualCamera || 'DirectShow Softcam'}），其他会议软件可直接识别，但当前应用内预览列表尚未刷新${justRegistered ? '（本轮刚完成注册）' : ''}。请点击「重启应用刷新设备列表」。`
              : '未在系统与浏览器中发现虚拟摄像头；请先点击「开启引擎」完成注册，如刚安装请重启本应用与会议软件。'
          );
          err.previewCode = cameraRegistered ? 'NOT_ENUMERATED_REGISTERED' : 'NOT_REGISTERED';
          err.enumeratedLabels = labels;
          throw err;
        }
        await bounded(new Promise(r => setTimeout(r, delay)), delay + 1000, '等待设备列表超时。', token);
        const rawDevs = await bounded(media.enumerateDevices(), enumerationTimeout, '读取摄像头列表超时。', token);
        devices = rawDevs.filter(item => item.kind === 'videoinput');
      }
      if (token !== version) throw abortError();
      const obtained = await bounded(
        media.getUserMedia({ video: { deviceId: { exact: device.deviceId } }, audio: false }),
        options.openTimeout ?? 15000,
        '虚拟摄像头打开超时，请检查其他预览或会议软件是否正在占用。',
        token,
        stopTracks
      );
      if (token !== version) { stopTracks(obtained); throw abortError(); }
      stream = obtained;
      for (const track of stream.getTracks()) track.onended = () => { if (token === version) stop(); };
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      // Allow React to remove display:none before starting frame callbacks
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (token !== version) throw abortError();
      await waitForFrame(video, token);
      if (token !== version) throw abortError();
      const report = {
        status: 'first-frame',
        width: video.videoWidth,
        height: video.videoHeight,
        matchedLabel: device.label || virtualCamera
      };
      emit(report);
      const timer = setTimeout(() => { if (token === version) stop(); }, options.previewTimeout ?? 300000);
      cancellations.add(() => clearTimeout(timer));
      return report;
    } catch (err) {
      if (token === version) {
        stopTracks(stream);
        stream = null;
        if (video) { try { video.pause(); } catch {} video.srcObject = null; video = null; }
        let code = err.previewCode || '';
        let msg = err.message || '预览失败';
        if (!code && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          code = 'PERMISSION_DENIED';
          msg = '摄像头访问权限被拒绝，请在 Windows 隐私设置中允许桌面应用访问摄像头。';
        } else if (!code && (err.name === 'NotReadableError' || err.name === 'TrackStartError')) {
          code = 'BUSY_OR_OCCUPIED';
          msg = '虚拟摄像头或物理摄像头正被其他软件占用，请先关闭其他视频预览后重试。';
        }
        emit({
          status: err.name === 'AbortError' ? 'stopped' : 'error',
          code,
          message: err.name === 'AbortError' ? '' : msg,
          enumeratedLabels: err.enumeratedLabels
        });
      }
      throw err;
    }
  }

  return { start, stop, listDevices, isActive: () => sessionId !== null };
}

export function EyeContactSettings({ active = true }) {
  const [eye, setEye] = useState({ phase: 'off', preview: {} });
  const [camReg, setCamReg] = useState(null);
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

  const refreshRegistrationAndDevices = async (requestPermission = false) => {
    const [reg, list] = await Promise.all([
      window.mc.checkEyeContactCamera?.().catch(() => null),
      previewerRef.current.listDevices(requestPermission).catch(() => [])
    ]);
    if (!aliveRef.current) return { reg, list };
    if (reg) setCamReg(reg);
    setDevices(list);
    return { reg, list };
  };

  useEffect(() => {
    aliveRef.current = true;
    Promise.all([
      window.mc.getEyeContactState(),
      window.mc.getEyeContactSettings(),
      window.mc.checkEyeContactCamera?.().catch(() => null)
    ])
      .then(([st, cfg, reg]) => {
        if (!aliveRef.current) return;
        setEye(st);
        setConfig(cfg);
        if (reg || st?.cameraRegistration) setCamReg(reg || st.cameraRegistration);
      })
      .catch(err => { if (aliveRef.current) setError(err.message); });
    previewerRef.current.listDevices().then(list => { if (aliveRef.current) setDevices(list); }).catch(() => {});
    const off = window.mc.onEyeContactState((st) => {
      if (!aliveRef.current) return;
      setEye(st);
      if (st?.cameraRegistration) setCamReg(st.cameraRegistration);
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
    const effectiveReg = st.cameraRegistration || camReg || await window.mc.checkEyeContactCamera?.().catch(() => null);
    if (effectiveReg && aliveRef.current) setCamReg(effectiveReg);
    if (!st.enabled) throw new Error(st.error || '摄像头引擎未就绪。');
    if (st.pendingSettings) throw new Error('请先应用已保存的摄像头设置。');
    const latestDevs = await previewerRef.current.listDevices(true).catch(() => devices);
    if (aliveRef.current && latestDevs.length) setDevices(latestDevs);
    await previewerRef.current.start({
      virtualCamera: st.virtualCamera || effectiveReg?.name || 'DirectShow Softcam',
      element: videoRef.current,
      sessionId: st.sessionId,
      cameraRegistered: Boolean(effectiveReg?.registered ?? st.enabled),
      justRegistered: Boolean(effectiveReg?.justRegistered)
    });
  };

  const control = async (restart = false) => {
    stopPreview();
    const st = restart ? await window.mc.restartEyeContact() : await window.mc.setEyeContactEnabled(!eye.enabled);
    if (aliveRef.current) {
      setEye(st);
      if (st?.cameraRegistration) setCamReg(st.cameraRegistration);
    }
    void refreshRegistrationAndDevices(false);
    if (st.error && st.phase === 'error') throw new Error(st.error);
  };

  const targetVcamName = eye.virtualCamera || camReg?.name || 'DirectShow Softcam';
  const matchedVcam = matchVirtualCameraDevice(devices, targetVcamName);
  const effectiveReg = eye.cameraRegistration || camReg;
  const sources = devices.filter(item => item.label && item.label !== targetVcamName && !/DirectShow Softcam|SuiSi Virtual Camera|-ss(?:-uat)?$/i.test(item.label));
  const selected = sources.find(item => item.deviceId === config?.sourceDeviceId || item.label === config?.sourceDeviceName);
  const previewing = ['waiting', 'first-frame'].includes(preview.status);
  const needsAppRelaunchForPreview = Boolean(effectiveReg?.registered && !matchedVcam);

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
              <CustomSelect
                className="mc-select"
                ariaLabel="输入摄像头"
                disabled={busy}
                value={selected?.deviceId || (config.sourceDeviceName ? '__saved__' : '')}
                onChange={val => {
                  const dev = sources.find(item => item.deviceId === val);
                  void save({ sourceDeviceId: dev?.deviceId || '', sourceDeviceName: dev?.label || '' });
                }}
                options={[
                  { value: '', label: '自动选择' },
                  ...(!selected && config.sourceDeviceName ? [{ value: '__saved__', label: `${config.sourceDeviceName}（当前未枚举到）` }] : []),
                  ...sources.map(d => ({ value: d.deviceId, label: d.label }))
                ]}
              />
            </div>
          </div>

          <div className="mc-srow mc-srow-compact">
            <div><div className="mc-srow-label">处理方式</div></div>
            <div className="mc-srow-control">
              <CustomSelect
                className="mc-select"
                ariaLabel="处理方式"
                disabled={busy}
                value={config.outputMode}
                onChange={val => void save({ outputMode: val })}
                options={[
                  { value: 'correct', label: '眼神矫正' },
                  { value: 'passthrough', label: '原画直通（不做矫正）' }
                ]}
              />
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
                    <CustomSelect
                      className="mc-select"
                      ariaLabel="时间平滑"
                      disabled={busy}
                      value={String(config.temporal)}
                      onChange={val => void save({ temporal: Number(val) })}
                      options={[
                        { value: '4294967295', label: '完全平滑（默认）' },
                        { value: '35', label: '基础平滑' },
                        { value: '0', label: '关闭' }
                      ]}
                    />
                  </div>
                  <div className="mc-field">
                    <label className="mc-field-label">眼部融合区域</label>
                    <CustomSelect
                      className="mc-select"
                      ariaLabel="眼部融合区域"
                      disabled={busy}
                      value={String(config.eyeSize)}
                      onChange={val => void save({ eyeSize: Number(val) })}
                      options={[2, 3, 4, 5, 6].map(v => ({ value: String(v), label: String(v) }))}
                    />
                  </div>
                  <div className="mc-field">
                    <label className="mc-field-label">断开后等待释放</label>
                    <CustomSelect
                      className="mc-select"
                      ariaLabel="断开后等待释放"
                      disabled={busy}
                      value={String(config.idleGraceMs)}
                      onChange={val => void save({ idleGraceMs: Number(val) })}
                      options={[1000, 3000, 5000, 10000].map(v => ({ value: String(v), label: `${v / 1000} 秒` }))}
                    />
                  </div>
                </div>
              </div>
            </details>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="mc-btn mc-btn-sm" disabled={busy} onClick={() => void run(async () => { await refreshRegistrationAndDevices(true); })}>
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
                  const payload = {
                    ...diag,
                    rendererDevices: devices.map(d => ({ label: d.label, kind: d.kind })),
                    matchedVirtualCamera: matchedVcam?.label || null,
                    previewState: preview
                  };
                  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                  setNote('诊断已复制（不含画面）');
                })}
              >
                复制诊断
              </button>
            </div>

            {/* 4-Layer Diagnostic Status */}
            <div className="mc-alert" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>
                <strong>1. 虚拟设备注册：</strong>
                {effectiveReg
                  ? (effectiveReg.registered
                    ? `已注册（${effectiveReg.name || targetVcamName}${effectiveReg.justRegistered ? ' · 本次会话刚注册' : ''}）`
                    : '尚未注册（首次点击「开启引擎」时自动引导注册）')
                  : '检测中…'}
              </div>
              <div>
                <strong>2. 引擎推理状态：</strong>{eyeContactStatusText(eye)}
                {eye.device && ` · 输入 ${eye.device}${eye.width ? ` (${eye.width}×${eye.height})` : ''}${eye.deviceFallback ? ' · 已回退' : ''}`}
                {eye.connected && ` · ${typeof eye.fps === 'number' ? eye.fps.toFixed(1) : '—'} FPS · 推理 ${typeof eye.inferMs === 'number' ? eye.inferMs.toFixed(1) : '—'} ms`}
              </div>
              <div>
                <strong>3. 应用内设备枚举：</strong>
                {matchedVcam
                  ? `已发现虚拟摄像头「${matchedVcam.label}」（共 ${devices.length} 个视频设备）`
                  : devices.length > 0
                    ? `未命中「${targetVcamName}」（当前枚举：${devices.map(d => d.label || '未命名').join('、')}）`
                    : '尚未枚举到视频设备（可点击「刷新摄像头 / 申请权限」）'}
              </div>
              <div>
                <strong>4. 首帧画面检查：</strong>
                {preview.status === 'first-frame'
                  ? `已收到首帧 · ${preview.width}×${preview.height}（${preview.matchedLabel || targetVcamName}）`
                  : preview.status === 'waiting'
                    ? '正在打开虚拟摄像头并等待首帧…'
                    : preview.status === 'error'
                      ? (preview.message || '预览失败')
                      : '未开启预览（预览最长 5 分钟，离开本页自动停止）'}
              </div>
            </div>

            {(needsAppRelaunchForPreview || preview.code === 'NOT_ENUMERATED_REGISTERED') && (
              <div className="mc-alert mc-alert-warn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 12 }}>
                  <strong>虚拟摄像头已在系统注册（外部会议软件可直接识别）</strong>，但本应用启动后尚未刷新 Chromium 视频设备列表。重启本应用即可恢复应用内首帧预览，无需重装组件。
                </div>
                {window.mc?.relaunchApp && (
                  <button
                    type="button"
                    className="mc-btn mc-btn-sm mc-btn-primary"
                    style={{ flexShrink: 0 }}
                    onClick={() => void window.mc.relaunchApp()}
                  >
                    重启应用刷新列表
                  </button>
                )}
              </div>
            )}

            <video
              ref={videoRef}
              muted
              playsInline
              style={{
                display: previewing ? 'block' : 'none',
                width: '100%',
                maxWidth: 640,
                borderRadius: 8,
                background: '#090b10'
              }}
            />
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
