'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const CLSID = '{AEF3B972-5FA5-4647-9571-358EB472BC9E}';
const CATEGORY = '{860BB310-5D01-11d0-BD3B-00A0C911CE86}';
const psQuote = value => "'" + String(value).replace(/'/g, "''") + "'";
const DEFAULT_SETTINGS = Object.freeze({ sourceDeviceId: '', sourceDeviceName: '', outputMode: 'correct', releaseWhenIdle: true,
  idleGraceMs: 3000, restartOnFailure: true, lookAway: false, eyeSize: 3, temporal: 0xffffffff });

function validateSettings(patch, previous = DEFAULT_SETTINGS) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('摄像头设置格式无效。');
  for (const key of Object.keys(patch)) if (!Object.hasOwn(DEFAULT_SETTINGS, key)) throw new Error('未知摄像头设置：' + key);
  const value = { ...previous, ...patch };
  for (const key of ['sourceDeviceId', 'sourceDeviceName']) {
    if (typeof value[key] !== 'string' || value[key].length > 512 || /[\x00-\x1f]/.test(value[key])) throw new Error('摄像头名称或标识无效。');
    value[key] = value[key].trim();
  }
  if (!['correct', 'passthrough'].includes(value.outputMode)) throw new Error('视频处理方式无效。');
  for (const key of ['releaseWhenIdle', 'restartOnFailure', 'lookAway']) if (typeof value[key] !== 'boolean') throw new Error('摄像头开关设置无效。');
  if (!Number.isInteger(value.idleGraceMs) || value.idleGraceMs < 1000 || value.idleGraceMs > 10000) throw new Error('空闲等待应为 1 至 10 秒。');
  if (!Number.isInteger(value.eyeSize) || value.eyeSize < 2 || value.eyeSize > 6) throw new Error('眼部融合区域应为 2 至 6。');
  if (![0, 35, 0xffffffff].includes(value.temporal)) throw new Error('时间平滑设置无效。');
  return value;
}

function helperArguments(settings, sdkDir) {
  const args = ['--sdk-dir', sdkDir, '--look-away', settings.lookAway ? '1' : '0', '--eye-size', String(settings.eyeSize),
    '--temporal', '0x' + settings.temporal.toString(16), '--idle'];
  if (settings.sourceDeviceName) args.push('--device', settings.sourceDeviceName.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim());
  return args;
}

function runPowerShell(script, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || error.message).trim().slice(-800)));
        else resolve(stdout.trim());
      });
  });
}

function createWindowsPlatform({ resourcesPath = process.resourcesPath || path.resolve(__dirname, '..'),
  engineDirectory = process.env.MC_EYE_ENGINE_DIR, sdkDirectory = process.env.MC_EYE_SDK_DIR,
  settingsFile, userDataDirectory, log = () => {} }) {
  const helperDir = engineDirectory || path.join(resourcesPath, 'eye-contact', 'engine');
  const helper = path.join(helperDir, 'EyeContactEngine.exe');
  const softcam = path.join(helperDir, 'softcam.dll');
  const bundledSdkDir = path.join(resourcesPath, 'eye-contact', 'sdk');
  let sdkDir = sdkDirectory || bundledSdkDir;
  let sdkManager;
  let reportSdkProgress = () => {};
  async function resources(onProgress = () => {}) {
    if (!fs.existsSync(helper) || !fs.existsSync(softcam)) throw new Error('眼神矫正引擎缺失，请检查 eye-contact/engine 中的 EyeContactEngine.exe 和 softcam.dll。');
    reportSdkProgress = onProgress;
    if (!sdkDirectory && !fs.existsSync(path.join(bundledSdkDir, 'nvARPose.dll'))) {
      const { createMaxineSdk } = require('./maxine-sdk.cjs');
      const dataDirectory = userDataDirectory || (settingsFile && path.dirname(settingsFile)) ||
        path.join(process.env.LOCALAPPDATA, 'MeetingCopilot');
      if (!sdkManager) sdkManager = createMaxineSdk({ directory: path.join(dataDirectory, 'maxine-sdk'),
        extractor: path.join(resourcesPath, 'tools', 'maxine', '7z.exe'), onProgress: progress => reportSdkProgress(progress) });
      const installed = await sdkManager.ensureInstalled();
      sdkDir = installed.sdkDir;
    }
    const models = path.join(sdkDir, 'models');
    if (!fs.existsSync(path.join(sdkDir, 'nvARPose.dll')) || !fs.existsSync(models) || !fs.statSync(models).isDirectory()) {
      throw new Error('NVIDIA AR SDK 资源缺失，请检查 eye-contact/sdk 中的 nvARPose.dll 和 models 目录。');
    }
    const names = fs.readdirSync(models);
    if (!names.some(name => /^gazeredir_encoder_.*\.engine\.trtpkg$/i.test(name)) ||
        !names.some(name => /^gazeredir_decoder_.*\.engine\.trtpkg$/i.test(name))) {
      throw new Error('NVIDIA AR SDK 缺少眼神矫正模型，请检查 models 中的 gazeredir encoder 和 decoder。');
    }
    return { helper, softcam, sdkDir };
  }
  async function cameraStatus() {
    const script = `$ErrorActionPreference='Stop'; $class='Registry::HKEY_CLASSES_ROOT\\CLSID\\${CLSID}'; $device='Registry::HKEY_CLASSES_ROOT\\CLSID\\${CATEGORY}\\Instance\\DirectShow Softcam'; $dll=$null; $name=$null; if(Test-Path -LiteralPath ($class+'\\InprocServer32')){$dll=(Get-Item -LiteralPath ($class+'\\InprocServer32')).GetValue('')}; if(Test-Path -LiteralPath $device){$name=(Get-ItemProperty -LiteralPath $device).FriendlyName}; @{registered=([bool]$dll -and [bool]$name);dll=$dll;name=$name}|ConvertTo-Json -Compress`;
    return JSON.parse(await runPowerShell(script));
  }
  async function ensureCamera(res, onPermission) {
    let status = await cameraStatus();
    const registeredDll = status.dll && status.dll.replace(/^"|"$/g, '');
    if (registeredDll && path.resolve(registeredDll).toLowerCase() !== path.resolve(res.softcam).toLowerCase()) {
      const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      if (!status.registered || !fs.existsSync(registeredDll) || hash(registeredDll) !== hash(res.softcam)) {
        throw new Error('已注册的虚拟摄像头与当前组件不一致，请先检查摄像头注册。');
      }
      log('沿用已注册且 SHA-256 相同的虚拟摄像头组件：' + registeredDll);
      return status;
    }
    if (status.registered && fs.existsSync(res.softcam)) return status;
    onPermission();
    // Let Windows obtain elevation through its normal UAC dialog. No permission
    // or security settings are altered, and existing camera names are preserved.
    const inner = `$ErrorActionPreference='Stop'; $p=Start-Process -FilePath regsvr32.exe -ArgumentList @('/s',('"{0}"' -f ${psQuote(res.softcam)})) -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode`;
    const encoded = Buffer.from(inner, 'utf16le').toString('base64');
    const script = `$ErrorActionPreference='Stop'; try {$p=Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'); $p.WaitForExit(); if($p.ExitCode -ne 0){throw ('摄像头组件注册失败：'+$p.ExitCode)}} catch {Write-Error $_;exit 1}`;
    try { await runPowerShell(script, 180000); }
    catch (error) { log(error.message); throw new Error('虚拟摄像头安装未完成，请允许 Windows 权限提示后重试。'); }
    status = await cameraStatus();
    if (!status.registered) throw new Error('虚拟摄像头注册后仍不可用，请重启会议软件后重试。');
    return status;
  }
  async function assertAvailable() {
    const rows = JSON.parse(await runPowerShell("@(Get-CimInstance Win32_Process -Filter \"Name='EyeContactEngine.exe' OR Name='suisi-eye-contact.exe' OR Name='suisi-eye-contact-cpu.exe'\" | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress") || '[]');
    if (Array.isArray(rows) ? rows.length : rows) throw new Error('眼神引擎正在被其他窗口使用，请先关闭现有摄像头引擎。');
  }
  return { resources, ensureCamera, assertAvailable, cancelResources: () => sdkManager?.cancel?.() };
}

function createEyeContact(options) {
  const platform = options.platform || createWindowsPlatform(options);
  const launch = options.spawn || spawn;
  const readyTimeout = options.readyTimeout ?? 60000, stopTimeout = options.stopTimeout ?? 3000;
  const retryDelay = options.retryDelay ?? 1200, now = options.now || Date.now;
  const events = [];
  let settings = { ...DEFAULT_SETTINGS }, activeSettings = null;
  let child = null, generation = 0, starting = null, stopping = null, disposed = false, desired = false;
  let startupReject = null, retryTimer = null, idleTimer = null, disconnectAt = null, retries = 0, appliedMode = 'idle', connectedStreak = 0;
  let state = { engine: 'full', enabled: false, phase: 'off', mode: 'idle', requestedMode: 'idle', device: '',
    virtualCamera: '', width: null, height: null, fps: null, connected: false, deviceFallback: false, sdk: null,
    sourceReleased: null, inferMs: null, frames: null, warmupMs: null, lastStatsAt: null, lastStatus: null,
    pendingSettings: false, restartCount: 0, sessionId: 0, preview: { status: 'stopped' }, error: '' };
  function getState() { return { ...state, sdk: state.sdk && { ...state.sdk }, preview: { ...state.preview }, lastStatus: state.lastStatus && { ...state.lastStatus } }; }
  function update(patch) { state = { ...state, ...patch }; options.onChange?.(getState()); }
  function diagnostic(event, detail = {}) {
    const entry = { at: new Date(now()).toISOString(), sessionId: state.sessionId, event, ...detail };
    events.push(entry); if (events.length > 120) events.shift();
    options.log?.(JSON.stringify(entry));
  }
  if (options.settingsFile && fs.existsSync(options.settingsFile)) {
    try { settings = validateSettings(JSON.parse(fs.readFileSync(options.settingsFile, 'utf8').replace(/^\uFEFF/, ''))); }
    catch (error) { diagnostic('settings-load-error', { message: error.message }); }
  }
  function getSettings() { return { ...settings }; }
  function setSettings(patch) {
    const value = validateSettings(patch, settings);
    if (options.settingsFile) {
      const temporary = options.settingsFile + '.tmp-' + process.pid;
      fs.mkdirSync(path.dirname(options.settingsFile), { recursive: true });
      try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8'); fs.renameSync(temporary, options.settingsFile); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    settings = value;
    update({ pendingSettings: !!activeSettings && JSON.stringify(settings) !== JSON.stringify(activeSettings) });
    diagnostic('settings-saved', { pendingSettings: state.pendingSettings });
    return getSettings();
  }
  function clearTimers() {
    clearTimeout(retryTimer); retryTimer = null; clearTimeout(idleTimer); idleTimer = null; disconnectAt = null; connectedStreak = 0;
  }
  function write(command) {
    if (!child || child.exitCode !== null || child.stdin.destroyed) throw new Error('眼神引擎已停止。');
    child.stdin.write(command + '\n');
  }
  function applyMode(mode) {
    if (appliedMode === mode || !child) return;
    write('mode ' + mode); appliedMode = mode;
    if (mode === 'idle') connectedStreak = 0;
    update({ requestedMode: mode }); diagnostic('mode-request', { mode });
  }
  function reconcileMode() {
    if (!child || !state.enabled || !activeSettings) return;
    const confirmedConnection = state.connected && (appliedMode !== 'idle' || connectedStreak >= 2);
    if (confirmedConnection || !activeSettings.releaseWhenIdle) {
      clearTimeout(idleTimer); idleTimer = null; disconnectAt = null;
      applyMode(activeSettings.outputMode); return;
    }
    if (appliedMode === 'idle') return;
    if (disconnectAt === null) disconnectAt = now();
    if (idleTimer) return;
    const current = generation;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (current !== generation || !child || state.connected) return;
      try { applyMode('idle'); } catch (error) { failRuntime(child, error, current); }
    }, Math.max(0, activeSettings.idleGraceMs - (now() - disconnectAt)));
    idleTimer.unref?.();
  }
  function terminate(proc) {
    if (!proc || proc.exitCode !== null) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let done = false, hard;
      const finish = error => {
        if (done) return; done = true; clearTimeout(timer); clearTimeout(hard); proc.removeListener('close', onClose);
        error ? reject(error) : resolve();
      };
      const onClose = () => finish();
      proc.once('close', onClose);
      const timer = setTimeout(() => {
        try { proc.kill(); } catch {}
        hard = setTimeout(() => finish(new Error('无法确认旧摄像头引擎退出，未启动新实例。')), options.killTimeout ?? 1500);
      }, stopTimeout);
      try { proc.stdin.write('stop\n'); } catch { try { proc.kill(); } catch {} }
    });
  }
  function failRuntime(proc, error, current) {
    if (child !== proc || current !== generation || proc.fault) return;
    proc.fault = error.message; diagnostic('runtime-error', { message: error.message });
    update({ error: error.message });
    void terminate(proc).catch(failure => {
      if (child === proc && current === generation) {
        desired = false; update({ enabled: false, phase: 'error', error: failure.message });
        diagnostic('stop-error', { message: failure.message });
      }
    });
  }
  async function stop() {
    desired = false; generation++; clearTimers();
    platform.cancelResources?.();
    startupReject?.(new Error('启动已取消。'));
    const proc = child;
    update({ enabled: false, phase: 'off', mode: 'idle', requestedMode: 'idle', fps: null, connected: false,
      sourceReleased: null, preview: { status: 'stopped' }, error: '' });
    const work = stopping || terminate(proc).then(() => {
      if (child === proc) child = null;
      activeSettings = null; appliedMode = 'idle'; update({ pendingSettings: false });
      diagnostic('stopped');
    }).catch(error => { update({ phase: 'error', error: error.message }); throw error; });
    stopping = work;
    try { await work; return getState(); } finally { if (stopping === work) stopping = null; }
  }
  async function start(recovering = false) {
    if (disposed) throw new Error('应用已退出。');
    if (stopping) await stopping;
    if (child && state.enabled) return getState();
    if (starting) return starting;
    if (child && child.exitCode === null) throw new Error('旧摄像头引擎尚未退出。');
    clearTimers(); desired = true;
    if (!recovering) retries = 0;
    const current = ++generation;
    const valid = () => { if (disposed || current !== generation || !desired) throw new Error('启动已取消。'); };
    const task = (async () => {
      update({ enabled: false, phase: recovering ? 'restarting' : 'checking', error: '', connected: false, fps: null,
        inferMs: null, frames: null, warmupMs: null, width: null, height: null, sourceReleased: null,
        deviceFallback: false, lastStatsAt: null, lastStatus: null, preview: { status: 'stopped' },
        sessionId: current, restartCount: retries, mode: 'idle', requestedMode: 'idle' });
      try {
        await platform.assertAvailable(); valid();
        const res = await platform.resources(progress => {
          if (current !== generation || !desired || disposed) return;
          update({ phase: 'installing', sdk: { ...progress } });
        }); valid();
        const camera = await platform.ensureCamera(res, () => { if (current === generation) update({ phase: 'permission' }); }); valid();
        activeSettings = getSettings(); appliedMode = 'idle';
        update({ phase: 'starting', virtualCamera: camera.name || 'DirectShow Softcam', pendingSettings: false });
        const args = helperArguments(activeSettings, '.');
        diagnostic('launch', { args, helper: res.helper, sdkDir: res.sdkDir });
        const proc = launch(res.helper, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: res.sdkDir,
          env: { ...process.env, PATH: [res.sdkDir, path.dirname(res.helper), process.env.PATH || ''].join(path.delimiter) } });
        child = proc;
        let ready = false, lastStatsLog = 0;
        await new Promise((resolve, reject) => {
          let settled = false, output = '';
          const settle = error => {
            if (settled) return; settled = true; clearTimeout(timer);
            if (startupReject === cancel) startupReject = null;
            error ? reject(error) : resolve();
          };
          const cancel = error => settle(error); startupReject = cancel;
          const timer = setTimeout(() => settle(new Error('完全版引擎启动超时，请检查摄像头占用及 NVIDIA 驱动。')), readyTimeout);
          proc.stdin.on('error', error => {
            if (current !== generation || child !== proc) return;
            settled ? failRuntime(proc, error, current) : settle(error);
          });
          proc.stdout.setEncoding('utf8');
          proc.stdout.on('data', chunk => {
            if (current !== generation || child !== proc) return;
            output += chunk;
            if (output.length > 1024 * 1024) {
              const error = new Error('眼神引擎返回了过大的状态数据。');
              settled ? failRuntime(proc, error, current) : settle(error); return;
            }
            let index;
            while ((index = output.indexOf('\n')) >= 0) {
              const line = output.slice(0, index).trim(); output = output.slice(index + 1);
              if (!line.startsWith('{')) continue;
              let event; try { event = JSON.parse(line); } catch { continue; }
              if (event.type === 'ready') {
                if (ready) continue;
                ready = true;
                update({ enabled: true, phase: 'ready', device: String(event.device || ''), width: event.width ?? null,
                  height: event.height ?? null, deviceFallback: event.deviceFallback === true, error: '',
                  pendingSettings: JSON.stringify(settings) !== JSON.stringify(activeSettings) });
                diagnostic('ready', { device: state.device, width: state.width, height: state.height, deviceFallback: state.deviceFallback });
                try { reconcileMode(); settle(); } catch (error) { settle(error); }
              } else if (event.type === 'stats') {
                if (!ready) continue;
                connectedStreak = event.vcamConnected === true ? Math.min(connectedStreak + 1, 2) : 0;
                const changed = state.connected !== (event.vcamConnected === true);
                const mode = ['idle', 'correct', 'passthrough'].includes(event.mode) ? event.mode : state.mode;
                update({ fps: Number.isFinite(event.fps) ? event.fps : null, connected: event.vcamConnected === true, mode,
                  inferMs: Number.isFinite(event.inferMs) ? event.inferMs : null,
                  frames: Number.isFinite(event.frames) ? event.frames : null,
                  warmupMs: Number.isFinite(event.warmupMs) ? event.warmupMs : null,
                  lastStatsAt: new Date(now()).toISOString(),
                  ...(mode !== 'idle' && event.fps > 0 ? { sourceReleased: false } : {}) });
                if (changed || now() - lastStatsLog >= 5000) {
                  diagnostic('stats', { connected: state.connected, mode, fps: state.fps, inferMs: state.inferMs, frames: state.frames });
                  lastStatsLog = now();
                }
                try { reconcileMode(); } catch (error) { failRuntime(proc, error, current); }
              } else if (event.type === 'status') {
                const detail = { event: String(event.event || '').slice(0, 100), message: String(event.message ?? event.detail ?? event.reason ?? '').slice(0, 1000),
                  code: String(event.code ?? event.hr ?? '').slice(0, 100) };
                update({ lastStatus: { ...detail, at: new Date(now()).toISOString() },
                  ...(detail.event === 'cameraReleased' ? { sourceReleased: true } : {}) });
                diagnostic('helper-status', { status: event.event, detail });
              } else if (event.type === 'error') {
                const error = new Error(String(event.message || '眼神引擎发生错误。').slice(0, 1000));
                diagnostic('helper-error', { message: error.message });
                settled ? failRuntime(proc, error, current) : settle(error);
              }
            }
          });
          proc.stderr.setEncoding('utf8');
          proc.stderr.on('data', message => {
            if (current === generation && child === proc) diagnostic('stderr', { message: String(message).slice(-2000) });
          });
          proc.once('error', error => {
            if (current !== generation || child !== proc) return;
            settled ? failRuntime(proc, error, current) : settle(new Error('无法启动眼神引擎：' + error.message));
          });
          proc.once('close', code => {
            if (current !== generation || child !== proc) return;
            child = null; clearTimeout(idleTimer); idleTimer = null;
            const message = proc.fault || `眼神引擎已退出（${code ?? '未知'}）。`;
            diagnostic('exit', { code, message, ready });
            if (!ready || !settled) { settle(new Error(message)); return; }
            if (desired && activeSettings.restartOnFailure && retries < 1) {
              retries++;
              update({ phase: 'restarting', enabled: true, connected: false, fps: null, restartCount: retries, error: message, preview: { status: 'stopped' } });
              const token = generation;
              retryTimer = setTimeout(() => {
                retryTimer = null;
                if (token === generation && desired && !disposed) void start(true).catch(error => diagnostic('restart-error', { message: error.message }));
              }, retryDelay);
              retryTimer.unref?.();
            } else {
              desired = false;
              update({ enabled: false, phase: 'error', connected: false, fps: null, error: message, preview: { status: 'stopped' } });
            }
          });
        });
        valid(); return getState();
      } catch (error) {
        if (current === generation) {
          diagnostic('startup-error', { message: error.message });
          try { await stop(); } catch {}
          update({ phase: 'error', error: error.message });
        }
        return getState();
      }
    })();
    starting = task;
    try { return await task; } finally { if (starting === task) starting = null; }
  }
  async function restart() {
    const previous = starting;
    const token = generation + 1;
    await stop();
    if (previous) await previous;
    if (generation !== token || disposed) return getState();
    return start();
  }
  function reportPreview(report) {
    if (!report || !['waiting', 'first-frame', 'stopped', 'error'].includes(report.status)) throw new Error('预览状态无效。');
    if (report.sessionId !== state.sessionId || !state.enabled) return getState();
    if (report.status === state.preview.status && String(report.message || '') === String(state.preview.message || '') &&
        (Number(report.width) || null) === (state.preview.width || null) && (Number(report.height) || null) === (state.preview.height || null)) return getState();
    const preview = { status: report.status, at: new Date(now()).toISOString(),
      message: String(report.message || '').slice(0, 600), width: Number(report.width) || null, height: Number(report.height) || null };
    update({ preview }); diagnostic('preview', preview); return getState();
  }
  function getDiagnostics() { return { at: new Date(now()).toISOString(), state: getState(), settings: getSettings(), events: events.map(item => ({ ...item })) }; }
  function dispose() {
    disposed = true; desired = false; generation++; clearTimers(); startupReject?.(new Error('应用已退出。'));
    platform.cancelResources?.();
    const proc = child; child = null;
    if (proc) { try { proc.stdin.write('stop\n'); } catch {} try { proc.kill(); } catch {} }
  }
  return { getState, start, stop, restart, dispose, getSettings, setSettings, reportPreview, getDiagnostics };
}
module.exports = { createEyeContact, createWindowsPlatform, DEFAULT_SETTINGS, validateSettings, helperArguments };

