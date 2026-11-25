const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createEyeContact, validateSettings, helperArguments } = require('./eye-contact.cjs');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const vm = require('node:vm');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(extra = {}) {
  const children = [], changes = [], commands = [];
  const controller = createEyeContact({
    platform: { assertAvailable: async () => {}, resources: async () => ({ helper: 'C:/engine/helper.exe', sdkDir: 'C:/SDK' }), ensureCamera: async () => ({ name: 'Test Camera' }), ...extra.platform },
    readyTimeout: 40, stopTimeout: 10, onChange: state => changes.push(state),
    spawn(exe, args, opts) {
      const child = new EventEmitter(); child.exitCode = null;
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.end = (code = 0) => { child.exitCode = code; child.emit('close', code); };
      child.stdin = new Writable({ write(data, encoding, done) { commands.push(data.toString()); if (data.toString() === 'stop\n') setImmediate(() => child.end()); done(); } });
      child.kill = () => { child.killed = true; setImmediate(() => child.end()); return true; };
      child.launch = { exe, args, opts }; children.push(child);
      return child;
    }, ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'platform'))
  });
  return { controller, children, commands, changes };
}

test('SDK preparation reports progress before spawning the camera engine', async () => {
  let finishResources;
  const f = fixture({ platform: { resources: report => {
    report({ stage: 'downloading', progress: 0.5, message: '正在下载 NVIDIA SDK' });
    return new Promise(resolve => { finishResources = resolve; });
  } } });
  const pending = f.controller.start(); await tick();
  assert.equal(f.controller.getState().phase, 'installing');
  assert.equal(f.controller.getState().sdk.progress, 0.5);
  assert.equal(f.children.length, 0);
  finishResources({ helper: 'C:/engine/EyeContactEngine.exe', sdkDir: 'C:/SDK' }); await tick();
  f.children[0].stdout.write('{"type":"ready","device":"Integrated Camera"}\n');
  assert.equal((await pending).enabled, true);
  await f.controller.stop(); f.controller.dispose();
});

test('stopping SDK preparation cancels the job and prevents a late engine launch', async () => {
  let finishResources, cancelled = 0;
  const f = fixture({ platform: {
    resources: () => new Promise(resolve => { finishResources = resolve; }),
    cancelResources: () => { cancelled++; }
  } });
  const pending = f.controller.start(); await tick();
  await f.controller.stop();
  finishResources({ helper: 'C:/engine/EyeContactEngine.exe', sdkDir: 'C:/SDK' });
  await pending;
  assert.ok(cancelled > 0);
  assert.equal(f.children.length, 0);
  assert.equal(f.controller.getState().phase, 'off');
  f.controller.dispose();
});
test('ready chunks, actual stats and graceful off; default full settings', async () => {
  const f = fixture(); const pending = f.controller.start(); await tick();
  const p = f.children[0];
  p.stdout.write('not json\n{"type":"rea'); p.stdout.write('dy","device":"Integrated Camera"}\r\n');
  const state = await pending;
  assert.equal(state.enabled, true); assert.equal(state.engine, 'full');
  assert.equal(state.virtualCamera, 'Test Camera');
  assert.equal(f.commands.includes('mode correct\n'), false, 'ready alone must not occupy the source continuously');
  assert.deepEqual(p.launch.args, ['--sdk-dir', '.', '--look-away', '0', '--eye-size', '3', '--temporal', '0xffffffff', '--idle']);
  assert.equal(p.launch.opts.cwd, 'C:/SDK');
  assert.equal(p.launch.args.includes('--seconds'), false);
  p.stdout.write('{"type":"stats","fps":28.5,"vcamConnected":true,"mode":"correct"}\n');
  assert.equal(f.commands.includes('mode correct\n'), false);
  p.stdout.write('{"type":"stats","fps":28.5,"vcamConnected":true,"mode":"correct"}\n');
  assert.ok(f.commands.includes('mode correct\n'));
  assert.equal(f.controller.getState().connected, true);
  assert.equal(f.controller.getState().fps, 28.5);
  await f.controller.stop(); assert.equal(f.controller.getState().phase, 'off');
  p.stdout.write('{"type":"stats","fps":99,"vcamConnected":true}\n');
  assert.equal(f.controller.getState().connected, false);
  f.controller.dispose();
});
test('startup timeout terminates the helper and reports an actionable failure', async () => {
  const f = fixture(); const result = await f.controller.start();
  assert.equal(result.enabled, false); assert.equal(result.phase, 'error');
  assert.match(result.error, /超时/); assert.ok(f.commands.includes('stop\n'));
  f.controller.dispose();
});
test('cancel during resource preparation never opens camera/helper', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ platform: { resources: async () => { await gate; return {}; } } });
  const pending = f.controller.start(); await tick(); await f.controller.stop(); release();
  await pending; assert.equal(f.children.length, 0); assert.equal(f.controller.getState().phase, 'off');
});
test('existing engine conflict avoids camera registration and launch', async () => {
  let registered = false;
  const f = fixture({ platform: { assertAvailable: async () => { throw new Error('engine busy'); }, ensureCamera: async () => { registered = true; } } });
  const result = await f.controller.start();
  assert.equal(registered, false); assert.equal(f.children.length, 0); assert.equal(result.error, 'engine busy');
});
test('crash clears enabled state and permits an explicit restart', async () => {
  const f = fixture(); f.controller.setSettings({ restartOnFailure: false }); let pending = f.controller.start(); await tick();
  f.children[0].stdout.write('{"type":"ready"}\n'); await pending;
  f.children[0].end(7);
  assert.equal(f.controller.getState().enabled, false); assert.match(f.controller.getState().error, /7/);
  pending = f.controller.start(); await tick(); f.children[1].stdout.write('{"type":"ready"}\n');
  assert.equal((await pending).enabled, true); await f.controller.stop();
});

async function ready(f, fields = {}) {
  const pending = f.controller.start(); await tick();
  f.children.at(-1).stdout.write(JSON.stringify({ type: 'ready', device: 'Integrated Camera', width: 1280, height: 720, ...fields }) + '\n');
  return pending;
}

async function correctPreview(f) {
  await ready(f);
  const proc = f.children.at(-1);
  const stats = '{"type":"stats","vcamConnected":true,"mode":"correct","fps":30}\n';
  proc.stdout.write(stats + stats);
  const sessionId = f.controller.getState().sessionId;
  f.controller.reportPreview({ sessionId, status: 'first-frame', width: 1280, height: 720 });
  return { proc, sessionId };
}

function bitmap(width, height) {
  const data = Buffer.alloc(54 + Math.ceil(width * 3 / 4) * 4 * height);
  data.writeUInt16LE(0x4d42, 0);
  data.writeUInt32LE(data.length, 2);
  data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14);
  data.writeInt32LE(width, 18);
  data.writeInt32LE(height, 22);
  data.writeUInt16LE(1, 26);
  data.writeUInt16LE(24, 28);
  return 'data:image/bmp;base64,' + data.toString('base64');
}

test('same-frame comparison accepts a full-size fragmented BMP pair and ignores a different request', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  const { proc } = await correctPreview(f);
  const pending = f.controller.captureComparison();
  const [, requestId] = f.commands.at(-1).trim().split(' ');
  assert.match(requestId, /^[0-9a-f-]{36}$/);
  await assert.rejects(f.controller.captureComparison(), /正在生成/);
  proc.stdout.write('{"type":"comparison","requestId":"previous"}\n');
  const image = bitmap(960, 720);
  const line = JSON.stringify({ type: 'comparison', mode: 'correct', requestId, original: image, corrected: image }) + '\r\n';
  for (let offset = 0; offset < line.length; offset += 65536) proc.stdout.write(line.slice(offset, offset + 65536));
  const result = await pending;
  assert.deepEqual(result, { original: image, corrected: image, width: 960, height: 720 });
  assert.equal(f.controller.getState().enabled, true);
  assert.equal(JSON.stringify(f.controller.getDiagnostics()).includes('data:image/'), false);
});

test('invalid comparison frames and a stopped preview reject only the current request', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  await assert.rejects(f.controller.captureComparison(), /先用眼神矫正模式/);
  const { proc, sessionId } = await correctPreview(f);
  let pending = f.controller.captureComparison();
  let requestId = f.commands.at(-1).trim().split(' ')[1];
  proc.stdout.write(JSON.stringify({ type: 'comparison', mode: 'correct', requestId, original: bitmap(4, 4), corrected: 'data:text/html,invalid' }) + '\n');
  await assert.rejects(pending, /画面无效/);
  assert.equal(f.controller.getState().enabled, true);
  pending = f.controller.captureComparison();
  requestId = f.commands.at(-1).trim().split(' ')[1];
  const rejected = assert.rejects(pending, /预览已停止/);
  f.controller.reportPreview({ sessionId, status: 'stopped' });
  await rejected;
  proc.stdout.write(JSON.stringify({ type: 'comparison', mode: 'correct', requestId, original: bitmap(4, 4), corrected: bitmap(4, 4) }) + '\n');
  assert.equal(f.controller.getState().phase, 'ready');
  assert.equal(f.controller.getState().preview.status, 'stopped');
});

test('comparison timeout allows a retry and engine shutdown rejects the retry', async t => {
  const f = fixture({ comparisonTimeout: 20 }); t.after(() => f.controller.dispose());
  await correctPreview(f);
  await assert.rejects(f.controller.captureComparison(), /超时/);
  const rejected = assert.rejects(f.controller.captureComparison(), /引擎已停止/);
  await f.controller.stop();
  await rejected;
});

test('oversized output is rejected while ordinary status lines keep their lower size cap', async t => {
  for (const [prefix, size] of [['{"type":"comparison",', 6 * 1024 * 1024], ['{"type":"stats",', 2 * 1024 * 1024]]) {
    const f = fixture(); t.after(() => f.controller.dispose());
    const { proc } = await correctPreview(f);
    const rejected = assert.rejects(f.controller.captureComparison(), /过大的数据/);
    proc.stdout.write(prefix + 'x'.repeat(size));
    await rejected;
    await f.controller.stop();
  }
});

test('explicit source and picture settings reach the helper as separate argv', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  f.controller.setSettings({ sourceDeviceId: 'browser-id', sourceDeviceName: 'USB Camera "2"', lookAway: true, temporal: 35, eyeSize: 4 });
  await ready(f);
  const args = f.children[0].launch.args;
  assert.deepEqual(args.slice(-2), ['--device', 'USB Camera "2"']);
  assert.equal(args[args.indexOf('--look-away') + 1], '1');
  assert.equal(args[args.indexOf('--temporal') + 1], '0x23');
  assert.equal(args.includes('browser-id'), false);
});

test('consumer absence releases after grace, reconnect cancels the pending release', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  f.controller.setSettings({ idleGraceMs: 1000 }); await ready(f);
  const stats = connected => f.children[0].stdout.write(JSON.stringify({ type: 'stats', vcamConnected: connected, mode: 'correct', fps: 20 }) + '\n');
  stats(true); stats(true); stats(false); await wait(520); stats(true); await wait(540);
  assert.equal(f.commands.filter(x => x === 'mode idle\n').length, 0);
  stats(false); await wait(1040);
  assert.equal(f.commands.filter(x => x === 'mode idle\n').length, 1);
  f.children[0].stdout.write('{"type":"status","event":"cameraReleased","reason":"idle"}\n');
  assert.equal(f.controller.getState().sourceReleased, true);
  stats(true); assert.equal(f.commands.filter(x => x === 'mode correct\n').length, 1);
  stats(true); assert.equal(f.commands.filter(x => x === 'mode correct\n').length, 2);
});

test('one stale connected status cannot engage an idle camera and a false status resets confirmation', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  await ready(f);
  const stats = value => f.children[0].stdout.write(JSON.stringify({type: 'stats', vcamConnected: value, mode: 'idle', fps: 0}) + '\n');
  stats(true);
  assert.equal(f.commands.includes('mode correct\n'), false);
  stats(false);
  stats(true);
  assert.equal(f.commands.includes('mode correct\n'), false);
  stats(true);
  assert.equal(f.commands.filter(command => command === 'mode correct\n').length, 1);
});

test('a Unicode SDK location is the native working directory and argv retains an ASCII relative model root', async t => {
  const sdkDir = 'C:/独立资源/NVIDIA SDK';
  const f = fixture({platform: {resources: async () => ({helper: 'C:/程序/engine/EyeContactEngine.exe', sdkDir})}});
  t.after(() => f.controller.dispose());
  await ready(f);
  assert.equal(f.children[0].launch.opts.cwd, sdkDir);
  assert.equal(f.children[0].launch.args[1], '.');
  assert.ok(f.children[0].launch.opts.env.PATH.includes(sdkDir));
  assert.equal(f.children[0].launch.args.includes('--seconds'), false);
});

function localPlatform(t, registration = {registered: false, dll: '', name: ''}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-maxine-platform-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const resources = path.join(root, 'resources');
  const engine = path.join(resources, 'eye-contact/engine');
  const sdk = path.join(resources, 'eye-contact/sdk');
  fs.mkdirSync(engine, {recursive: true});
  fs.mkdirSync(path.join(sdk, 'models'), {recursive: true});
  for (const name of ['EyeContactEngine.exe', 'softcam.dll']) fs.writeFileSync(path.join(engine, name), 'synthetic fixture');
  fs.writeFileSync(path.join(sdk, 'nvARPose.dll'), 'synthetic SDK fixture');
  for (const name of ['gazeredir_encoder_fp16_86.engine.trtpkg', 'gazeredir_decoder_fp16_86.engine.trtpkg']) {
    fs.writeFileSync(path.join(sdk, 'models', name), 'synthetic model fixture');
  }
  const scripts = [];
  const context = {module: {exports: {}}, __dirname,
    process: {resourcesPath: resources, env: {}}, Buffer, console, setTimeout, clearTimeout,
    require(name) {
      if (name === 'node:child_process') return {
        spawn() { throw Error('Unexpected process launch during platform test'); },
        execFile(exe, args, options, callback) {
          const script = Buffer.from(args[3], 'base64').toString('utf16le');
          scripts.push(script);
          assert.equal(options.encoding, 'utf8');
          if (script.includes('$class=')) callback(null, JSON.stringify(registration), '');
          else if (script.includes('Get-CimInstance')) callback(null, '[]', '');
          else callback(Error('Unexpected camera registration attempt'), '', '');
        }
      };
      return require(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'eye-contact.cjs'), 'utf8'), context);
  return {root, resources, engine, sdk, scripts, create: context.module.exports.createWindowsPlatform};
}

test('default platform resolves the application-owned engine and SDK from resources', async t => {
  const f = localPlatform(t);
  const actual = await f.create({}).resources();
  assert.equal(actual.helper, path.join(f.engine, 'EyeContactEngine.exe'));
  assert.equal(actual.softcam, path.join(f.engine, 'softcam.dll'));
  assert.equal(actual.sdkDir, f.sdk);
  assert.equal(f.scripts.length, 0);
  fs.unlinkSync(path.join(f.sdk, 'models/gazeredir_decoder_fp16_86.engine.trtpkg'));
  await assert.rejects(f.create({}).resources(), /缺少眼神矫正模型/);
});

test('explicit resource overrides select their own engine and reject a missing SDK model directory', async t => {
  const f = localPlatform(t);
  const platform = f.create({resourcesPath: 'C:/unused', engineDirectory: f.engine, sdkDirectory: f.sdk});
  assert.equal((await platform.resources()).sdkDir, f.sdk);
  fs.unlinkSync(path.join(f.sdk, 'nvARPose.dll'));
  await assert.rejects(platform.resources(), /NVIDIA AR SDK 资源缺失/);
});

test('an identical registered virtual camera DLL at another path is accepted with its existing name', async t => {
  const registration = {registered: true, dll: '', name: 'Existing Camera'};
  const f = localPlatform(t, registration);
  registration.dll = path.join(f.root, 'previous-softcam.dll');
  fs.copyFileSync(path.join(f.engine, 'softcam.dll'), registration.dll);
  let permissions = 0;
  const platform = f.create({});
  const actual = await platform.ensureCamera(await platform.resources(), () => permissions++);
  assert.equal(actual.name, 'Existing Camera');
  assert.equal(permissions, 0);
  assert.equal(f.scripts.length, 1);
});

test('camera status reads UTF-8 names and both COM entries from the merged HKCR view', async t => {
  const registration = {registered: true, dll: '', name: '当前用户虚拟摄像头'};
  const f = localPlatform(t, registration);
  registration.dll = path.join(f.engine, 'softcam.dll');
  const platform = f.create({});
  const actual = await platform.ensureCamera(await platform.resources(), () => { throw Error('Unexpected registration request'); });
  assert.equal(actual.name, '当前用户虚拟摄像头');
  assert.equal(f.scripts.length, 1);
  assert.match(f.scripts[0], /^\[Console\]::OutputEncoding = \[System\.Text\.UTF8Encoding\]::new\(\$false\)\n/);
  assert.equal(f.scripts[0].split('Registry::HKEY_CLASSES_ROOT\\CLSID\\').length - 1, 2);
  assert.equal(f.scripts[0].includes('HKEY_LOCAL_MACHINE'), false);
  assert.ok(f.scripts[0].includes('$class=') && f.scripts[0].includes('$device='));
});

test('a different registered virtual camera DLL is reported before requesting registration permissions', async t => {
  const registration = {registered: true, dll: '', name: 'Other Camera'};
  const f = localPlatform(t, registration);
  registration.dll = path.join(f.root, 'other-softcam.dll');
  fs.writeFileSync(registration.dll, 'different synthetic DLL');
  let permissions = 0;
  const platform = f.create({});
  await assert.rejects(platform.ensureCamera(await platform.resources(), () => permissions++), /当前组件不一致/);
  assert.equal(permissions, 0);
});

test('passthrough and optional continuous capture use the selected mode', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  f.controller.setSettings({ outputMode: 'passthrough', releaseWhenIdle: false });
  await ready(f);
  assert.equal(f.commands.at(-1), 'mode passthrough\n');
  assert.equal(f.controller.getState().connected, false);
});

test('saving while running waits for explicit apply and restart uses new config', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await ready(f);
  f.controller.setSettings({ sourceDeviceName: 'USB Camera', outputMode: 'passthrough' });
  assert.equal(f.controller.getState().pendingSettings, true);
  assert.equal(f.children.length, 1);
  const restart = f.controller.restart(); await tick(); await tick();
  assert.equal(f.children.length, 2);
  f.children[1].stdout.write('{"type":"ready","device":"USB Camera"}\n');
  await restart;
  assert.equal(f.controller.getState().pendingSettings, false);
  assert.deepEqual(f.children[1].launch.args.slice(-2), ['--device', 'USB Camera']);
});

test('runtime failures recover once; a second failure remains visible', async t => {
  const f = fixture({ retryDelay: 5, readyTimeout: 200 }); t.after(() => f.controller.dispose());
  await ready(f); f.children[0].end(7);
  assert.equal(f.controller.getState().phase, 'restarting');
  await wait(15); assert.equal(f.children.length, 2);
  f.children[1].stdout.write('{"type":"ready"}\n'); await tick();
  assert.equal(f.controller.getState().restartCount, 1);
  f.children[1].end(8); await wait(15);
  assert.equal(f.children.length, 2); assert.equal(f.controller.getState().phase, 'error');
});

test('manual stop cancels scheduled recovery and stale helper output', async t => {
  const f = fixture({ retryDelay: 10 }); t.after(() => f.controller.dispose());
  await ready(f); const old = f.children[0]; old.end(7); await f.controller.stop();
  old.stdout.write('{"type":"ready"}\n'); await wait(20);
  assert.equal(f.children.length, 1); assert.equal(f.controller.getState().enabled, false);
});

test('source fallback, statuses and inference metrics are retained without claiming a browser identity', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  await ready(f, { deviceFallback: true });
  f.children[0].stdout.write('{"type":"status","event":"cameraBusy","message":"retry hr=0x80070005"}\n');
  f.children[0].stdout.write('{"type":"stats","fps":21,"inferMs":12.3,"frames":8,"warmupMs":900,"mode":"idle","vcamConnected":false}\n');
  const value = f.controller.getDiagnostics();
  assert.equal(value.state.deviceFallback, true); assert.equal(value.state.width, 1280);
  assert.equal(value.state.inferMs, 12.3); assert.equal(value.state.frames, 8);
  assert.match(value.state.lastStatus.message, /80070005/);
  assert.ok(value.events.some(x => x.event === 'helper-status'));
  assert.equal(value.state.preview.status, 'stopped');
});

test('late preview reports from an earlier session cannot change current state', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  await ready(f); const first = f.controller.getState().sessionId;
  await f.controller.stop(); await ready(f);
  f.controller.reportPreview({ status: 'first-frame', sessionId: first, width: 1280 });
  assert.equal(f.controller.getState().preview.status, 'stopped');
  f.controller.reportPreview({ status: 'first-frame', sessionId: f.controller.getState().sessionId, width: 1280 });
  assert.equal(f.controller.getState().preview.width, 1280);
});

test('settings persist atomically and invalid values never replace saved settings', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-eye-test-'));
  const file = path.join(directory, 'settings.json');
  t.after(() => { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(directory); });
  const one = fixture({ settingsFile: file }); t.after(() => one.controller.dispose());
  one.controller.setSettings({ sourceDeviceName: 'USB Camera' }); const saved = fs.readFileSync(file, 'utf8');
  assert.throws(() => one.controller.setSettings({ eyeSize: 99 }));
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
  const two = fixture({ settingsFile: file }); t.after(() => two.controller.dispose());
  assert.equal(two.controller.getSettings().sourceDeviceName, 'USB Camera');
  assert.throws(() => validateSettings({ helper: 'other.exe' }));
  assert.throws(() => validateSettings({ sourceDeviceName: 'cam\nstop' }));
});
test('application shutdown terminates its own process and blocks restart', async () => {
  const f = fixture(); const pending = f.controller.start(); await tick();
  f.children[0].stdout.write('{"type":"ready"}\n'); await pending;
  f.controller.dispose(); assert.equal(f.children[0].killed, true);
  await assert.rejects(f.controller.start(), /退出/);
});
