'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { promisify } = require('node:util');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const execFile = promisify(childProcess.execFile);
const BASE_URL = 'https://international.download.nvidia.cn/Windows/broadcast/sdk/AR';
// Manifest captured from the shipped SDK service, version 0.8.7.
const MANIFEST = Object.freeze({
  version: '0.8.7',
  minDriverMajor: 570,
  requiredDiskBytes: 3600000000,
  extractionBytes: 2600000000,
  packages: Object.freeze({
    turing: Object.freeze({ arch: 'turing', sm: 75, minDriverMajor: 521, size: 1324834184, md5: '5dbee8c09f09ef9b76ea292f3e3396fc', url: `${BASE_URL}/nvidia_ar_sdk_installer_v0.8.7_turing.exe` }),
    ampere: Object.freeze({ arch: 'ampere', sm: 86, minDriverMajor: 521, size: 1344314200, md5: '732b51ce049639631031312482b44479', url: `${BASE_URL}/nvidia_ar_sdk_installer_v0.8.7_ampere.exe` }),
    ada: Object.freeze({ arch: 'ada', sm: 89, minDriverMajor: 521, size: 1330863768, md5: 'd14abd6c8f4b9246e4082d84f8e1895e', url: `${BASE_URL}/nvidia_ar_sdk_installer_v0.8.7_ada.exe` }),
    blackwell: Object.freeze({ arch: 'blackwell', sm: 100, minDriverMajor: 570, size: 1347983656, md5: '9ac74fe7c787ea98bd9a8b2b50608f0a', url: `${BASE_URL}/nvidia_ar_sdk_installer_v0.8.7_blackwell.exe` }),
  }),
});
// Runtime files present in the verified 0.8.7 SDK distribution. Preserve both
// cuFFT generations because the bundled image/VPI and inference libraries differ.
const REQUIRED_DLLS = Object.freeze([
  'nvARPose.dll', 'NVCVImage.dll', 'cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll',
  'cufft64_10.dll', 'cufft64_11.dll', 'cufftw64_10.dll', 'cufftw64_11.dll', 'libcrypto-3-x64.dll',
  'nppc64_12.dll', 'nppial64_12.dll', 'nppidei64_12.dll', 'nppif64_12.dll', 'nppig64_12.dll', 'nppim64_12.dll',
  'nvinfer_10.dll', 'nvinfer_plugin_10.dll', 'nvonnxparser_10.dll', 'nvrtc-builtins64_121.dll', 'nvrtc64_120_0.dll', 'nvvpi2.dll',
]);
const SM_ARCH = Object.freeze({ 75: 'turing', 86: 'ampere', 89: 'ada', 100: 'blackwell' });
const DOWNLOAD_HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: 'https://www.nvidia.com/',
  'Accept-Encoding': 'identity',
});

function abortError() {
  const error = new Error('SDK installation cancelled');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function checkAbort(signal) {
  if (signal && signal.aborted) throw abortError();
}

function fail(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function delay(milliseconds, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      if (signal) signal.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(abortError());
    }
    if (signal) signal.addEventListener('abort', abort, { once: true });
  });
}

function normalizeDriver(value) {
  const text = String(value || '').trim();
  const parts = text.split('.').map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite)) {
    return `${(parts[2] % 10) * 100 + Math.floor(parts[3] / 100)}.${String(parts[3] % 100).padStart(2, '0')}`;
  }
  return text;
}

function smFromName(name) {
  if (/\bRTX\s*(?:PRO\b.*Blackwell|50\d\d)\b/i.test(name)) return 120;
  if (/\bRTX\s*40\d\d\b|\bRTX\b.*\bAda\b/i.test(name)) return 89;
  if (/\bRTX\s*(?:30\d\d|A(?:2000|3000|4000|4500|5000|5500|6000))\b/i.test(name)) return 86;
  if (/\bRTX\s*(?:20\d\d|(?:Quadro\s*)?(?:3000|4000|5000|6000|8000))\b/i.test(name)) return 75;
  return null;
}

function selectGpu(gpus, manifest = MANIFEST) {
  const candidates = gpus.map((gpu) => {
    const sm = Number(gpu.sm) || Math.round(Number(gpu.computeCapability) * 10) || null;
    const arch = SM_ARCH[sm] || null;
    const pkg = arch && manifest.packages[arch];
    const driverVersion = normalizeDriver(gpu.driverVersion);
    const driverMajor = parseInt(driverVersion, 10);
    let reason = null;
    if (!pkg) reason = sm === 120 ? 'unverified-model-support-sm120' : 'unsupported-compute-capability';
    else if (!Number.isFinite(driverMajor)) reason = 'driver-version-unavailable';
    else if (driverMajor < pkg.minDriverMajor) reason = 'driver-too-old';
    return { supported: !reason, arch, sm, gpuName: gpu.gpuName || gpu.name || '', driverVersion,
      minDriverMajor: pkg ? pkg.minDriverMajor : null, reason, source: gpu.source || 'nvidia-smi' };
  });
  return candidates.find((gpu) => gpu.supported) || candidates[0] || {
    supported: false, arch: null, sm: null, gpuName: '', driverVersion: '', minDriverMajor: null, reason: 'nvidia-gpu-not-found',
  };
}

async function probeGpu(signal) {
  checkAbort(signal);
  try {
    const { stdout } = await execFile('nvidia-smi', [
      '--query-gpu=name,compute_cap,driver_version', '--format=csv,noheader,nounits',
    ], { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024, signal });
    const gpus = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const fields = line.split(',').map((field) => field.trim());
      return { gpuName: fields.slice(0, -2).join(','), computeCapability: fields[fields.length - 2], driverVersion: fields[fields.length - 1] };
    });
    if (gpus.length && gpus.some((gpu) => Number(gpu.computeCapability))) return gpus;
  } catch (_) { /* WMI supplies a fallback when nvidia-smi is absent. */ }
  checkAbort(signal);
  if (process.platform !== 'win32') return [];
  const command = "Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA' } | Select-Object Name,DriverVersion | ConvertTo-Json -Compress";
  try {
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024, signal,
    });
    const decoded = JSON.parse(stdout.trim() || '[]');
    return (Array.isArray(decoded) ? decoded : [decoded]).map((gpu) => ({
      gpuName: gpu.Name, sm: smFromName(gpu.Name), driverVersion: gpu.DriverVersion, source: 'Win32_VideoController',
    }));
  } catch (_) { checkAbort(signal); return []; }
}

function checkedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw fail('insecure-download-url', 'SDK downloads require HTTPS without URL credentials');
  return url;
}

function httpsRequest(url, options) {
  return new Promise((resolve, reject) => {
    const request = https.get(checkedUrl(url), { headers: options.headers, signal: options.signal }, (response) => {
      clearTimeout(headerTimer);
      response.setTimeout(options.timeoutMs, () => response.destroy(fail('download-timeout')));
      resolve(response);
    });
    const headerTimer = setTimeout(() => request.destroy(fail('download-timeout')), options.timeoutMs);
    request.setTimeout(options.timeoutMs, () => request.destroy(fail('download-timeout')));
    request.on('error', (error) => { clearTimeout(headerTimer); reject(error); });
  });
}

async function hashFile(filename, signal) {
  const md5 = crypto.createHash('md5');
  const sha256 = crypto.createHash('sha256');
  let size = 0;
  const input = fs.createReadStream(filename, { signal });
  for await (const chunk of input) {
    checkAbort(signal);
    md5.update(chunk);
    sha256.update(chunk);
    size += chunk.length;
  }
  checkAbort(signal);
  return { size, md5: md5.digest('hex'), sha256: sha256.digest('hex') };
}

async function exists(filename) {
  return fsp.stat(filename).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

async function freeDiskBytes(directory) {
  if (fsp.statfs) {
    try {
      const info = await fsp.statfs(directory, { bigint: true });
      return Number(info.bavail * info.bsize);
    } catch (error) {
      if (process.platform !== 'win32' || !['ENOSYS', 'ENOTSUP', 'EINVAL'].includes(error.code)) throw error;
    }
  }
  if (process.platform === 'win32') {
    const root = path.parse(directory).root;
    const command = `$d = New-Object System.IO.DriveInfo('${root.replace(/'/g, "''")}'); $d.AvailableFreeSpace`;
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000 });
    return Number(stdout.trim());
  }
  throw fail('disk-space-unavailable');
}

function createMaxineSdk(options = {}) {
  if (!options.directory || !path.isAbsolute(options.directory)) throw new TypeError('directory must be an absolute path');
  const directory = path.resolve(options.directory);
  const manifest = options.manifest || MANIFEST;
  const request = options.request || httpsRequest;
  const spawn = options.spawn || childProcess.spawn;
  const getFreeDiskBytes = options.getFreeDiskBytes || freeDiskBytes;
  const retryDelaysMs = options.retryDelaysMs || [2000, 5000, 10000];
  let state = { stage: 'idle', progress: 0, receivedBytes: 0, totalBytes: 0, arch: null, sdkDir: null, error: null };
  let pending = null;
  let controller = null;
  let lastProgressAt = 0;

  function report(stage, changes = {}) {
    const previousStage = state.stage;
    state = { ...state, stage, ...changes };
    state.progress = Math.max(0, Math.min(1, state.progress || 0));
    if (stage === 'downloading' && previousStage === stage && state.progress < 1 && Date.now() - lastProgressAt < 250) return;
    lastProgressAt = Date.now();
    try { if (options.onProgress) options.onProgress({ ...state }); } catch (_) { /* UI observers do not own installation. */ }
  }

  async function probe(signal) {
    const detected = await (options.probeGpu || probeGpu)(signal);
    checkAbort(signal);
    if (detected && !Array.isArray(detected) && typeof detected.supported === 'boolean') return { ...detected };
    return selectGpu(Array.isArray(detected) ? detected : [detected], manifest);
  }

  function owned(filename) {
    const relative = path.relative(directory, path.resolve(filename));
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw fail('unsafe-cleanup-path');
    return filename;
  }

  async function removeOwned(filename) {
    await fsp.rm(owned(filename), { recursive: true, force: true });
  }

  async function validateDirectory(sdkDir, arch, signal) {
    checkAbort(signal);
    const pkg = manifest.packages[arch];
    if (!pkg) throw fail('unsupported-architecture');
    const sm = pkg.sm || Number(Object.keys(SM_ARCH).find((key) => SM_ARCH[key] === arch));
    const root = await fsp.realpath(sdkDir);
    const files = [...(manifest.requiredDlls || REQUIRED_DLLS),
      `models/gazeredir_encoder_fp16_${sm}.engine.trtpkg`, `models/gazeredir_decoder_fp16_${sm}.engine.trtpkg`,
      `models/face_detection_${sm}.engine.trtpkg`, `models/faceland_fp16_rcn_mode0_${sm}.engine.trtpkg`,
      `models/faceland_fp16_rcn_mode1_${sm}.engine.trtpkg`,
      `models/faceland_126_maxbatch1_mode0_${sm}.engine.trtpkg`, `models/faceland_126_maxbatch1_mode1_${sm}.engine.trtpkg`];
    for (const file of files) {
      checkAbort(signal);
      const filename = path.join(root, file);
      let info;
      try {
        const real = await fsp.realpath(filename);
        const relative = path.relative(root, real);
        if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw fail('sdk-file-outside-directory');
        info = await fsp.stat(real);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw fail('sdk-missing-dependency', `SDK is missing ${file}`);
        throw error;
      }
      if (!info.isFile() || info.size === 0) throw fail('sdk-invalid-dependency', `SDK dependency is empty or invalid: ${file}`);
    }
    checkAbort(signal);
    return { sdkDir: path.resolve(sdkDir), arch, sm, files };
  }

  async function acquireLock(signal) {
    const filename = path.join(directory, 'install.lock');
    const token = crypto.randomUUID();
    const started = Date.now();
    for (;;) {
      checkAbort(signal);
      try {
        const handle = await fsp.open(filename, 'wx');
        try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() })); }
        finally { await handle.close(); }
        return async () => {
          const owner = await fsp.readFile(filename, 'utf8').then(JSON.parse).catch(() => null);
          if (owner && owner.token === token) await fsp.unlink(filename).catch(() => {});
        };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const owner = await fsp.readFile(filename, 'utf8').then(JSON.parse).catch(() => null);
      let alive = true;
      if (owner && Number.isInteger(owner.pid)) {
        try { process.kill(owner.pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
      }
      const info = await exists(filename);
      if (!alive || (!owner && info && Date.now() - info.mtimeMs > 60000)) {
        // A separate recovery lock serializes stale-owner checks among contenders.
        const recovery = `${filename}.recovery`;
        let recoveryHandle;
        try {
          recoveryHandle = await fsp.open(recovery, 'wx');
          const currentText = await fsp.readFile(filename, 'utf8').catch(() => '');
          if (currentText === (owner ? JSON.stringify(owner) : currentText)) {
            const current = JSON.parse(currentText || 'null');
            let currentAlive = false;
            if (current && Number.isInteger(current.pid)) {
              try { process.kill(current.pid, 0); currentAlive = true; } catch (error) { currentAlive = error.code !== 'ESRCH'; }
            }
            const currentInfo = await exists(filename);
            if ((!current && currentInfo && Date.now() - currentInfo.mtimeMs > 60000) || (current && !currentAlive)) await fsp.unlink(filename).catch(() => {});
          }
        } catch (error) { if (error.code !== 'EEXIST' && !(error instanceof SyntaxError)) throw error; }
        finally {
          if (recoveryHandle) { await recoveryHandle.close(); await fsp.unlink(recovery).catch(() => {}); }
        }
        if (recoveryHandle) continue;
      }
      if (Date.now() - started > (options.lockTimeoutMs || 900000)) throw fail('install-lock-timeout');
      report('waiting', { message: 'Waiting for another SDK installation' });
      await delay(options.lockPollMs || 250, signal);
    }
  }

  async function checkDisk(requiredBytes) {
    const available = await getFreeDiskBytes(directory);
    if (!Number.isFinite(available) || available < requiredBytes) throw fail('low-disk-space', `SDK needs ${requiredBytes} free bytes, available ${available}`);
  }

  async function responseFor(url, headers, signal) {
    let current = url;
    for (let count = 0; count <= 5; count++) {
      checkAbort(signal);
      checkedUrl(current);
      const response = await request(current, { headers, signal, timeoutMs: options.requestTimeoutMs || 60000 });
      const status = response.statusCode;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.destroy();
        if (!location) throw fail('invalid-redirect');
        current = checkedUrl(new URL(location, current).href).href;
        continue;
      }
      return response;
    }
    throw fail('too-many-redirects');
  }

  async function downloadOnce(pkg, partial, signal) {
    const info = await exists(partial);
    let offset = info ? info.size : 0;
    if (offset > pkg.size) { await removeOwned(partial); offset = 0; }
    if (offset === pkg.size) return;
    const headers = { ...DOWNLOAD_HEADERS };
    if (offset) headers.Range = `bytes=${offset}-`;
    report('downloading', { progress: offset / pkg.size, receivedBytes: offset, totalBytes: pkg.size, error: null });
    const response = await responseFor(pkg.url, headers, signal);
    const status = response.statusCode;
    function invalidRange() {
      response.destroy();
      return removeOwned(partial).then(() => { throw fail('invalid-content-range'); });
    }
    if (status === 416) return invalidRange();
    if (status !== 200 && status !== 206) {
      response.destroy();
      throw fail(`download-http-${status}`);
    }
    let responseBytes = pkg.size;
    if (status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '');
      if (!match || Number(match[1]) !== offset || Number(match[2]) < offset || Number(match[2]) >= pkg.size || Number(match[3]) !== pkg.size) return invalidRange();
      responseBytes = Number(match[2]) - offset + 1;
    } else offset = 0;
    const contentLength = response.headers['content-length'];
    if (contentLength !== undefined && (!/^\d+$/.test(String(contentLength)) || Number(contentLength) !== responseBytes)) {
      response.destroy();
      throw fail('invalid-content-length');
    }
    if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
      response.destroy();
      throw fail('unexpected-content-encoding');
    }
    let received = 0;
    const counter = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > responseBytes || offset + received > pkg.size) return callback(fail('download-too-large'));
        report('downloading', { progress: (offset + received) / pkg.size, receivedBytes: offset + received, totalBytes: pkg.size });
        callback(null, chunk);
      },
    });
    try {
      await pipeline(response, counter, fs.createWriteStream(partial, { flags: status === 206 ? 'a' : 'w' }), { signal });
    } catch (error) {
      if (error.code === 'download-too-large') await removeOwned(partial);
      throw error;
    }
    checkAbort(signal);
    if (received !== responseBytes || offset + received !== pkg.size) throw fail('incomplete-download');
  }

  async function getInstaller(pkg, signal) {
    const downloads = path.join(directory, 'downloads');
    await fsp.mkdir(downloads, { recursive: true });
    const archive = path.join(downloads, `${pkg.md5}.exe`);
    const partial = `${archive}.part`;
    if (await exists(archive)) {
      report('verifying');
      const digest = await hashFile(archive, signal);
      if (digest.size === pkg.size && digest.md5 === pkg.md5) return { archive, ...digest };
      await removeOwned(archive);
    }
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      checkAbort(signal);
      if (attempt) await delay(retryDelaysMs[attempt - 1], signal);
      try {
        const partInfo = await exists(partial);
        const remaining = pkg.size - Math.min(pkg.size, partInfo ? partInfo.size : 0);
        await checkDisk(Math.max(manifest.requiredDiskBytes || 0, remaining + (manifest.extractionBytes || 0)));
        await downloadOnce(pkg, partial, signal);
        report('verifying');
        const digest = await hashFile(partial, signal);
        if (digest.size !== pkg.size || digest.md5 !== pkg.md5) {
          await removeOwned(partial);
          throw fail('package-checksum-mismatch');
        }
        checkAbort(signal);
        await fsp.rename(partial, archive);
        return { archive, ...digest };
      } catch (error) {
        checkAbort(signal);
        if (error.code === 'low-disk-space' || error.code === 'insecure-download-url' || error.code === 'ENOSPC' || attempt === retryDelaysMs.length) throw error;
        report('downloading', { message: `Retrying download (${attempt + 1})`, error: null });
      }
    }
  }

  async function extract(archive, stage, signal) {
    if (!options.extractor || !path.isAbsolute(options.extractor)) throw fail('extractor-unavailable', 'An absolute path to 7z.exe is required');
    checkAbort(signal);
    report('extracting', { progress: 0 });
    await new Promise((resolve, reject) => {
      let processHandle;
      let timedOut = false;
      let output = '';
      let settled = false;
      let timer;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const abort = () => { if (processHandle) processHandle.kill(); };
      try {
        processHandle = spawn(options.extractor, ['x', '-y', `-o${stage}`, archive], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) { finish(error); return; }
      for (const stream of [processHandle.stdout, processHandle.stderr]) {
        if (stream) stream.on('data', (chunk) => { output = (output + chunk.toString()).slice(-8192); });
      }
      processHandle.once('error', finish);
      processHandle.once('close', (code) => {
        if (signal.aborted) finish(abortError());
        else if (timedOut) finish(fail('extraction-timeout'));
        else if (code !== 0) finish(fail('extraction-failed', `7z exited with code ${code}: ${output}`));
        else finish();
      });
      timer = setTimeout(() => { timedOut = true; abort(); }, options.extractTimeoutMs || 600000);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    checkAbort(signal);
  }

  async function atomicJson(filename, value) {
    const temp = `${filename}.${crypto.randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temp, JSON.stringify(value, null, 2) + '\n');
      await fsp.rename(temp, filename);
    } finally { await fsp.unlink(temp).catch(() => {}); }
  }

  async function install(input, signal) {
    let releaseLock;
    let stage;
    try {
      report('probing', { error: null, progress: 0, message: null });
      const gpu = await probe(signal);
      checkAbort(signal);
      if (!gpu.supported) throw fail(gpu.reason, `GPU ${gpu.gpuName || '(unknown)'} / SM ${gpu.sm || '?'}: ${gpu.reason}`);
      const pkg = manifest.packages[gpu.arch];
      report('checking', { arch: gpu.arch, gpu, totalBytes: pkg.size });
      if (input.sdkDirectory) {
        if (!path.isAbsolute(input.sdkDirectory)) throw fail('sdk-directory-must-be-absolute');
        const validated = await validateDirectory(input.sdkDirectory, gpu.arch, signal);
        const result = { ...validated, version: manifest.version, packageMd5: null, packageSha256: null, reused: true, custom: true };
        report('ready', { sdkDir: result.sdkDir, progress: 1 });
        return result;
      }
      await fsp.mkdir(directory, { recursive: true });
      releaseLock = await acquireLock(signal);
      const sdkDir = path.join(directory, pkg.md5);
      try {
        await validateDirectory(sdkDir, gpu.arch, signal);
        const receipt = await fsp.readFile(path.join(sdkDir, 'installation.json'), 'utf8').then(JSON.parse).catch(() => ({}));
        checkAbort(signal);
        const result = { sdkDir, arch: gpu.arch, sm: pkg.sm, version: manifest.version, packageMd5: pkg.md5, packageSha256: receipt.packageSha256 || null, reused: true };
        report('ready', { sdkDir, progress: 1 });
        return result;
      } catch (error) {
        checkAbort(signal);
        if (!['ENOENT', 'ENOTDIR', 'sdk-missing-dependency', 'sdk-invalid-dependency', 'sdk-file-outside-directory'].includes(error.code)) throw error;
      }
      const installer = await getInstaller(pkg, signal);
      await checkDisk(manifest.extractionBytes || 0);
      stage = path.join(directory, `.stage-${pkg.arch}-${crypto.randomUUID()}`);
      await fsp.mkdir(stage);
      await extract(installer.archive, stage, signal);
      report('validating');
      await validateDirectory(stage, gpu.arch, signal);
      const receipt = { version: manifest.version, arch: gpu.arch, sm: pkg.sm, packageMd5: pkg.md5,
        packageSha256: installer.sha256, packageSize: pkg.size, packageUrl: pkg.url, completedAt: new Date().toISOString() };
      await atomicJson(path.join(stage, 'installation.json'), receipt);
      checkAbort(signal);
      // An invalid previous directory remains recoverable until the complete stage is published.
      let backup = null;
      if (await exists(sdkDir)) {
        backup = path.join(directory, `.previous-${crypto.randomUUID()}`);
        await fsp.rename(sdkDir, backup);
      }
      try {
        checkAbort(signal);
        await fsp.rename(stage, sdkDir);
        stage = null;
      } catch (error) {
        if (backup) await fsp.rename(backup, sdkDir);
        throw error;
      }
      if (backup) await removeOwned(backup);
      await atomicJson(path.join(directory, 'ready.json'), { ...receipt, sdkDir });
      const result = { sdkDir, arch: gpu.arch, sm: pkg.sm, version: manifest.version,
        packageMd5: pkg.md5, packageSha256: installer.sha256, reused: false };
      report('ready', { sdkDir, progress: 1, receivedBytes: pkg.size, totalBytes: pkg.size });
      return result;
    } catch (error) {
      if (signal.aborted || error.name === 'AbortError') {
        report('cancelled', { error: null, message: 'SDK installation cancelled' });
        throw abortError();
      }
      report('error', { error: error.message, errorCode: error.code || null });
      throw error;
    } finally {
      if (stage) await removeOwned(stage).catch(() => {});
      if (releaseLock) await releaseLock();
    }
  }

  function ensureInstalled(input = {}) {
    if (pending) return pending;
    controller = new AbortController();
    const activeController = controller;
    const forwardAbort = () => activeController.abort();
    if (input.signal) {
      input.signal.addEventListener('abort', forwardAbort, { once: true });
      if (input.signal.aborted) forwardAbort();
    }
    pending = install(input, activeController.signal).finally(() => {
      if (input.signal) input.signal.removeEventListener('abort', forwardAbort);
      pending = null;
      controller = null;
    });
    return pending;
  }

  return { ensureInstalled, probe, validateDirectory, getState: () => ({ ...state }), cancel: () => { if (controller) controller.abort(); } };
}

module.exports = { createMaxineSdk, MANIFEST, selectGpu, probeGpu };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const values = {};
    for (let index = 0; index < args.length; index++) {
      const key = args[index];
      if (key === '--probe') values.probe = true;
      else if (['--directory', '--extractor', '--sdk-directory'].includes(key) && args[index + 1]) values[key.slice(2)] = args[++index];
      else throw fail('invalid-argument', `Unknown or incomplete argument ${key}`);
    }
    const manager = createMaxineSdk({ directory: values.directory, extractor: values.extractor,
      onProgress: (progress) => process.stdout.write(JSON.stringify({ type: 'progress', ...progress }) + '\n') });
    process.once('SIGINT', () => manager.cancel());
    process.once('SIGTERM', () => manager.cancel());
    if (values.probe) process.stdout.write(JSON.stringify({ type: 'probe', ...(await manager.probe()) }) + '\n');
    else process.stdout.write(JSON.stringify({ type: 'ready', ...(await manager.ensureInstalled({ sdkDirectory: values['sdk-directory'] })) }) + '\n');
  })().catch((error) => {
    process.stderr.write(JSON.stringify({ type: 'error', name: error.name, code: error.code || null, message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
