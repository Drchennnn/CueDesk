'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Readable, PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { createMaxineSdk, MANIFEST, selectGpu } = require('../meeting-copilot/maxine-sdk.cjs');

const CONTENT = Buffer.from('fixture official SDK installer bytes for Range and integrity tests');
const MD5 = crypto.createHash('md5').update(CONTENT).digest('hex');
const SHA256 = crypto.createHash('sha256').update(CONTENT).digest('hex');
const GPU = [{ gpuName: 'NVIDIA GeForce RTX 3060 Laptop GPU', computeCapability: '8.6', driverVersion: '572.61' }];
const FIXTURE_MANIFEST = { version: '0.8.7', requiredDiskBytes: 100, extractionBytes: 32, requiredDlls: ['nvARPose.dll', 'NVCVImage.dll', 'cudart64_12.dll'],
  packages: { ampere: { arch: 'ampere', sm: 86, minDriverMajor: 521, size: CONTENT.length, md5: MD5, url: 'https://fixture.test/sdk.exe' } } };

function response(status, body, headers = {}) {
  const stream = Readable.from(body === undefined ? [] : [body]);
  stream.statusCode = status;
  stream.headers = headers;
  return stream;
}

async function writeSdk(directory, includeDecoder = true) {
  await fs.mkdir(path.join(directory, 'models'), { recursive: true });
  for (const name of ['nvARPose.dll', 'NVCVImage.dll', 'cudart64_12.dll', 'models/gazeredir_encoder_fp16_86.engine.trtpkg',
    ...(includeDecoder ? ['models/gazeredir_decoder_fp16_86.engine.trtpkg'] : []),
    'models/face_detection_86.engine.trtpkg', 'models/faceland_fp16_rcn_mode0_86.engine.trtpkg',
    'models/faceland_fp16_rcn_mode1_86.engine.trtpkg',
    'models/faceland_126_maxbatch1_mode0_86.engine.trtpkg', 'models/faceland_126_maxbatch1_mode1_86.engine.trtpkg']) {
    await fs.writeFile(path.join(directory, name), 'valid fixture');
  }
}

function extractorFactory(action) {
  return (executable, args, options) => {
    assert.equal(path.isAbsolute(executable), true);
    assert.equal(options.windowsHide, true);
    assert.equal(args[0], 'x');
    const processHandle = new EventEmitter();
    processHandle.stdout = new PassThrough();
    processHandle.stderr = new PassThrough();
    let closed = false;
    processHandle.kill = () => {
      if (!closed) { closed = true; setImmediate(() => processHandle.emit('close', null)); }
      return true;
    };
    setImmediate(async () => {
      try {
        const result = action ? await action(args[2].slice(2), processHandle) : await writeSdk(args[2].slice(2));
        if (result === 'wait' || closed) return;
        closed = true;
        processHandle.emit('close', typeof result === 'number' ? result : 0);
      } catch (error) { processHandle.emit('error', error); }
    });
    return processHandle;
  };
}

async function fixture(t, changes = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meetingcopilot-maxine-test-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const progress = [];
  const calls = [];
  const defaults = {
    directory: root, extractor: path.join(root, '7z.exe'), manifest: FIXTURE_MANIFEST,
    probeGpu: async () => GPU, getFreeDiskBytes: async () => 100000,
    retryDelaysMs: [1, 1], lockPollMs: 5, lockTimeoutMs: 500,
    onProgress: (state) => progress.push(state), spawn: extractorFactory(),
    request: async (url, options) => {
      calls.push({ url, ...options });
      return response(200, CONTENT, { 'content-length': String(CONTENT.length) });
    }, ...changes,
  };
  return { root, progress, calls, defaults, manager: createMaxineSdk(defaults),
    archive: path.join(root, 'downloads', `${MD5}.exe`), partial: path.join(root, 'downloads', `${MD5}.exe.part`),
    sdkDir: path.join(root, MD5) };
}

test('official manifest preserves shipped URLs, sizes, checksums and model SM', () => {
  assert.equal(MANIFEST.version, '0.8.7');
  assert.equal(MANIFEST.packages.ampere.size, 1344314200);
  assert.equal(MANIFEST.packages.ampere.md5, '732b51ce049639631031312482b44479');
  assert.equal(MANIFEST.packages.blackwell.sm, 100);
  assert.match(MANIFEST.packages.turing.url, /^https:\/\//);
  assert.equal(Object.isFrozen(MANIFEST.packages.ampere), true);
});

test('GPU selection uses exact SM and driver, supports multi-GPU, refuses unverified SM120', () => {
  for (const [capability, arch] of [['7.5', 'turing'], ['8.6', 'ampere'], ['8.9', 'ada'], ['10.0', 'blackwell']]) {
    assert.equal(selectGpu([{ computeCapability: capability, driverVersion: '572.61' }]).arch, arch);
  }
  assert.equal(selectGpu([{ computeCapability: '8.0', driverVersion: '572.61' }]).supported, false);
  assert.equal(selectGpu([{ computeCapability: '12.0', driverVersion: '580.00' }]).reason, 'unverified-model-support-sm120');
  assert.equal(selectGpu([{ computeCapability: '8.6', driverVersion: '520.99' }]).reason, 'driver-too-old');
  assert.equal(selectGpu([{ computeCapability: '8.6', driverVersion: '32.0.15.7261' }]).driverVersion, '572.61');
  assert.equal(selectGpu([{ computeCapability: '8.0', driverVersion: '580.0' }, ...GPU]).supported, true);
});

test('installs, hashes, validates and atomically publishes, then reuses without download', async (t) => {
  const f = await fixture(t);
  const result = await f.manager.ensureInstalled();
  assert.equal(result.sdkDir, f.sdkDir);
  assert.equal(result.packageSha256, SHA256);
  assert.equal(result.reused, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers.Referer, 'https://www.nvidia.com/');
  assert.match(f.calls[0].headers['User-Agent'], /Chrome/);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, 'ready.json'))).packageSha256, SHA256);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.sdkDir, 'installation.json'))).packageMd5, MD5);
  assert.equal(f.manager.getState().stage, 'ready');
  assert.equal(f.progress.every((state) => state.progress >= 0 && state.progress <= 1), true);
  assert.equal((await f.manager.ensureInstalled()).reused, true);
  assert.equal(f.calls.length, 1);
  assert.equal((await fs.readdir(f.root)).some((name) => name === 'install.lock' || name.startsWith('.stage-')), false);
});

test('coalesces same-manager calls and serializes independent managers', async (t) => {
  let downloads = 0;
  const f = await fixture(t, { request: async () => {
    downloads++;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return response(200, CONTENT);
  } });
  const first = f.manager.ensureInstalled();
  assert.equal(first, f.manager.ensureInstalled());
  const other = createMaxineSdk(f.defaults);
  const results = await Promise.all([first, other.ensureInstalled()]);
  assert.equal(downloads, 1);
  assert.deepEqual(results.map((value) => value.reused).sort(), [false, true]);
});

test('resumes verified HTTP Range from existing partial file', async (t) => {
  const f = await fixture(t, { request: async (url, options) => {
    assert.equal(options.headers.Range, 'bytes=13-');
    // NVIDIA's CDN ETag includes a timestamp in addition to the MD5.
    assert.equal(options.headers['If-Range'], undefined);
    return response(206, CONTENT.subarray(13), { 'content-range': `bytes 13-${CONTENT.length - 1}/${CONTENT.length}`, 'content-length': String(CONTENT.length - 13) });
  } });
  await fs.mkdir(path.dirname(f.partial));
  await fs.writeFile(f.partial, CONTENT.subarray(0, 13));
  assert.equal((await f.manager.ensureInstalled()).packageSha256, SHA256);
});

test('server ignoring Range safely truncates partial and uses complete response', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.partial));
  await fs.writeFile(f.partial, 'old bytes');
  await f.manager.ensureInstalled();
  assert.equal(f.calls[0].headers.Range, 'bytes=9-');
  assert.deepEqual(await fs.readFile(f.archive), CONTENT);
});

test('invalid Range and 416 reset partial before retry', async (t) => {
  for (const status of [206, 416]) {
    let attempts = 0;
    const f = await fixture(t, { request: async (url, options) => {
      attempts++;
      if (attempts === 1) return response(status, Buffer.from('wrong'), { 'content-range': `bytes 0-4/${CONTENT.length}` });
      assert.equal(options.headers.Range, undefined);
      return response(200, CONTENT);
    } });
    await fs.mkdir(path.dirname(f.partial));
    await fs.writeFile(f.partial, CONTENT.subarray(0, 10));
    await f.manager.ensureInstalled();
    assert.equal(attempts, 2);
  }
});

test('corrupt completed cache and full partial are rejected and downloaded again', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.archive));
  await fs.writeFile(f.archive, Buffer.alloc(CONTENT.length));
  await fs.writeFile(f.partial, Buffer.alloc(CONTENT.length));
  await f.manager.ensureInstalled();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(await fs.readFile(f.archive), CONTENT);
});

test('checksum mismatch retries from zero and cannot publish', async (t) => {
  let attempts = 0;
  const f = await fixture(t, { request: async () => {
    attempts++;
    return response(200, Buffer.alloc(CONTENT.length));
  } });
  await assert.rejects(f.manager.ensureInstalled(), { code: 'package-checksum-mismatch' });
  assert.equal(attempts, 3);
  await assert.rejects(fs.access(f.sdkDir));
  await assert.rejects(fs.access(path.join(f.root, 'install.lock')));
  await assert.rejects(fs.access(f.partial));
});

test('redirects require HTTPS and have a bounded count', async (t) => {
  let requests = 0;
  const f = await fixture(t, { request: async (url) => {
    requests++;
    return requests === 1 ? response(302, undefined, { location: '/mirror.exe' }) : response(200, CONTENT);
  } });
  await f.manager.ensureInstalled();
  assert.equal(requests, 2);
  const bad = await fixture(t, { request: async () => response(302, undefined, { location: 'http://insecure.test/sdk.exe' }) });
  await assert.rejects(bad.manager.ensureInstalled(), { code: 'insecure-download-url' });
  const loop = await fixture(t, { retryDelaysMs: [], request: async () => response(302, undefined, { location: '/loop' }) });
  await assert.rejects(loop.manager.ensureInstalled(), { code: 'too-many-redirects' });
});

test('content-length, encoding and oversized response failures cannot publish', async (t) => {
  for (const reply of [
    () => response(200, CONTENT, { 'content-length': '999' }),
    () => response(200, CONTENT, { 'content-encoding': 'gzip' }),
    () => response(200, Buffer.concat([CONTENT, Buffer.from('extra')])),
  ]) {
    const f = await fixture(t, { retryDelaysMs: [], request: async () => reply() });
    await assert.rejects(f.manager.ensureInstalled());
    await assert.rejects(fs.access(f.sdkDir));
    await assert.rejects(fs.access(path.join(f.root, 'install.lock')));
  }
});

test('low disk aborts before network or extraction', async (t) => {
  const f = await fixture(t, { getFreeDiskBytes: async () => 1 });
  await assert.rejects(f.manager.ensureInstalled(), { code: 'low-disk-space' });
  assert.equal(f.calls.length, 0);
  await assert.rejects(fs.access(path.join(f.root, 'install.lock')));
});

test('nonzero 7z exit cleans stage, preserves archive, and next invocation can recover', async (t) => {
  const f = await fixture(t, { spawn: extractorFactory(async (stage) => { await writeSdk(stage); return 2; }) });
  await assert.rejects(f.manager.ensureInstalled(), { code: 'extraction-failed' });
  await assert.rejects(fs.access(f.sdkDir));
  assert.equal((await fs.readdir(f.root)).some((name) => name.startsWith('.stage-')), false);
  const recovered = createMaxineSdk({ ...f.defaults, spawn: extractorFactory() });
  await recovered.ensureInstalled();
  assert.equal(f.calls.length, 1);
});

test('missing decoder fails stage validation and leaves prior SDK recoverable', async (t) => {
  const f = await fixture(t, { spawn: extractorFactory((stage) => writeSdk(stage, false)) });
  await fs.mkdir(f.sdkDir);
  await fs.writeFile(path.join(f.sdkDir, 'old-content.txt'), 'previous incomplete installation');
  await assert.rejects(f.manager.ensureInstalled(), { code: 'sdk-missing-dependency' });
  assert.equal(await fs.readFile(path.join(f.sdkDir, 'old-content.txt'), 'utf8'), 'previous incomplete installation');
  await assert.rejects(fs.access(path.join(f.root, 'ready.json')));
});

test('custom SDK validation does not create cache files', async (t) => {
  const f = await fixture(t);
  const sdk = path.join(f.root, 'custom');
  await writeSdk(sdk);
  const result = await f.manager.ensureInstalled({ sdkDirectory: sdk });
  assert.equal(result.custom, true);
  assert.equal(result.packageMd5, null);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await fs.readdir(f.root), ['custom']);
});

test('missing runtime DLL or face model in published cache is repaired from verified installer', async (t) => {
  const f = await fixture(t);
  await f.manager.ensureInstalled();
  for (const dependency of ['cudart64_12.dll', 'models/face_detection_86.engine.trtpkg', 'models/faceland_fp16_rcn_mode1_86.engine.trtpkg']) {
    await fs.unlink(path.join(f.sdkDir, dependency));
    const result = await f.manager.ensureInstalled();
    assert.equal(result.reused, false);
    assert.equal((await fs.stat(path.join(f.sdkDir, dependency))).size > 0, true);
  }
  assert.equal(f.calls.length, 1);
});

test('cancel at stage validation cannot publish complete-looking extracted files', async (t) => {
  let manager;
  const f = await fixture(t, { onProgress: (state) => { if (state.stage === 'validating') manager.cancel(); } });
  manager = f.manager;
  await assert.rejects(manager.ensureInstalled(), { name: 'AbortError' });
  await assert.rejects(fs.access(f.sdkDir));
  await assert.rejects(fs.access(path.join(f.root, 'ready.json')));
  await assert.rejects(fs.access(path.join(f.root, 'install.lock')));
});

test('progress updates state every chunk while throttling observer calls', async (t) => {
  let stream;
  const f = await fixture(t, { request: async () => {
    stream = new PassThrough();
    stream.statusCode = 200;
    stream.headers = {};
    setImmediate(() => {
      for (const byte of CONTENT) stream.write(Buffer.from([byte]));
      stream.end();
    });
    return stream;
  } });
  await f.manager.ensureInstalled();
  const downloading = f.progress.filter((entry) => entry.stage === 'downloading');
  assert.equal(downloading.length <= 3, true);
  assert.equal(downloading.at(-1).progress, 1);
});

test('cancel during streaming preserves resumable partial and releases lock', async (t) => {
  let emitted;
  const started = new Promise((resolve) => { emitted = resolve; });
  let current;
  const f = await fixture(t, { request: async () => {
    current = new PassThrough();
    current.statusCode = 200;
    current.headers = {};
    setImmediate(() => { current.write(CONTENT.subarray(0, 15)); emitted(); });
    return current;
  } });
  const pending = f.manager.ensureInstalled();
  await started;
  await new Promise((resolve) => setTimeout(resolve, 15));
  f.manager.cancel();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal((await fs.stat(f.partial)).size, 15);
  assert.equal(f.manager.getState().stage, 'cancelled');
  await assert.rejects(fs.access(path.join(f.root, 'install.lock')));
  assert.equal(current.destroyed, true);
});

test('signal abort during extraction kills only owned process and cannot publish', async (t) => {
  let started;
  let killed = false;
  const start = new Promise((resolve) => { started = resolve; });
  const f = await fixture(t, { spawn: extractorFactory(async (stage, processHandle) => {
    await writeSdk(stage);
    const originalKill = processHandle.kill;
    processHandle.kill = () => { killed = true; return originalKill(); };
    started();
    return 'wait';
  }) });
  const controller = new AbortController();
  const pending = f.manager.ensureInstalled({ signal: controller.signal });
  await start;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(killed, true);
  await assert.rejects(fs.access(f.sdkDir));
  await assert.rejects(fs.access(path.join(f.root, 'install.lock')));
  assert.equal((await fs.readdir(f.root)).some((name) => name.startsWith('.stage-')), false);
});

test('extractor timeout fails without publishing and cleans lock', async (t) => {
  const f = await fixture(t, { extractTimeoutMs: 10, spawn: extractorFactory(async () => 'wait') });
  await assert.rejects(f.manager.ensureInstalled(), { code: 'extraction-timeout' });
  await assert.rejects(fs.access(f.sdkDir));
  await assert.rejects(fs.access(path.join(f.root, 'install.lock')));
});

test('dead install owner can be recovered, live owner times out or cancels', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'install.lock'), JSON.stringify({ pid: 2147483647, token: 'dead', createdAt: 1 }));
  await f.manager.ensureInstalled();
  const locked = await fixture(t, { lockTimeoutMs: 20 });
  await fs.writeFile(path.join(locked.root, 'install.lock'), JSON.stringify({ pid: process.pid, token: 'live' }));
  await assert.rejects(locked.manager.ensureInstalled(), { code: 'install-lock-timeout' });
  assert.equal(JSON.parse(await fs.readFile(path.join(locked.root, 'install.lock'))).token, 'live');
});

test('already-aborted signal makes no filesystem or network changes', async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.manager.ensureInstalled({ signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(await fs.readdir(f.root), []);
  assert.equal(f.calls.length, 0);
});
