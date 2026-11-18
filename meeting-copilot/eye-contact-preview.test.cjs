const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const create = vm.runInNewContext(fs.readFileSync(__dirname + '/eye-contact-preview.js', 'utf8') + ';createEyeContactPreview;',
  { setTimeout, clearTimeout, setInterval, clearInterval, Date, Promise, Error });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(options = {}) {
  let stopped = 0, opened = [];
  const states = [], reports = [];
  const stream = { getTracks: () => [track] }, track = { stop() { stopped++; } };
  const video = { muted: false, srcObject: null, videoWidth: 1280, videoHeight: 720,
    play: async () => {}, pause() {}, requestVideoFrameCallback(fn) { this.callback = fn; return 1; }, cancelVideoFrameCallback() { this.callback = null; } };
  const controller = create({ mediaDevices: {
    enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'virtual-id', label: 'Virtual Camera' }],
    getUserMedia: async request => { opened.push(request); return stream; }, ...options.mediaDevices
  }, onState: value => states.push(value), report: value => reports.push(value),
    pollMs: 2, enumerationTimeout: 20, openTimeout: 20, frameTimeout: 30, ...Object.fromEntries(Object.entries(options).filter(([k]) => k !== 'mediaDevices')) });
  return { controller, video, track, stream, states, reports, opened, stopped: () => stopped };
}
const start = f => f.controller.start({ virtualCamera: 'Virtual Camera', element: f.video, sessionId: 4 });

test('preview uses the exact virtual device, waits for a frame and stops its tracks', async t => {
  const f = fixture(); t.after(() => f.controller.stop());
  const pending = start(f); await wait(2);
  assert.equal(f.states.at(-1).status, 'waiting');
  assert.equal(f.opened[0].video.deviceId.exact, 'virtual-id');
  f.video.callback(); const result = await pending;
  assert.equal(result.status, 'first-frame'); assert.equal(f.reports.at(-1).sessionId, 4);
  f.controller.stop(); assert.equal(f.stopped(), 1); assert.equal(f.video.srcObject, null);
});

test('permission-only stream is immediately released before virtual preview', async t => {
  let unlocked = false;
  const f = fixture({ mediaDevices: { enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'virtual-id', label: unlocked ? 'Virtual Camera' : '' }],
    getUserMedia: async request => { unlocked = true; return request.video === true ? { getTracks: () => [{ stop() { permissionStopped++; } }] } : f.stream; } } });
  let permissionStopped = 0; t.after(() => f.controller.stop());
  const pending = start(f); await wait(2); assert.equal(permissionStopped, 1);
  f.video.callback(); await pending;
});

test('a stream resolving after timeout is released rather than leaked', async t => {
  let resolve;
  const f = fixture({ mediaDevices: { getUserMedia: () => new Promise(done => { resolve = done; }) } }); t.after(() => f.controller.stop());
  await assert.rejects(start(f), /打开超时/); resolve(f.stream); await wait(2);
  assert.equal(f.stopped(), 1); assert.equal(f.video.srcObject, null);
});

test('stop cancels an outstanding request and releases its late stream', async t => {
  let resolve;
  const f = fixture({ mediaDevices: { getUserMedia: () => new Promise(done => { resolve = done; }) } }); t.after(() => f.controller.stop());
  const pending = start(f); await wait(2); f.controller.stop();
  await assert.rejects(pending, /预览已停止/); resolve(f.stream); await wait(2);
  assert.equal(f.stopped(), 1); assert.equal(f.states.at(-1).status, 'stopped');
});

test('missing first frame produces a specific error and releases capture', async t => {
  const f = fixture(); t.after(() => f.controller.stop());
  await assert.rejects(start(f), /没有收到首帧/);
  assert.equal(f.stopped(), 1); assert.equal(f.states.at(-1).status, 'error');
});

test('a missing virtual device is not silently replaced with a physical camera', async t => {
  const f = fixture({ mediaDevices: { enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'physical', label: 'Integrated Camera' }] } });
  t.after(() => f.controller.stop());
  await assert.rejects(start(f), /没有发现虚拟摄像头/); assert.equal(f.opened.length, 0);
});

test('preview timeout releases the track after successful playback', async t => {
  const f = fixture({ previewTimeout: 10 }); t.after(() => f.controller.stop());
  const pending = start(f); await wait(2); f.video.callback(); await pending; await wait(15);
  assert.equal(f.stopped(), 1); assert.equal(f.states.at(-1).status, 'stopped');
});

test('fallback frame detection works without requestVideoFrameCallback', async t => {
  const f = fixture({ frameTimeout: 200 }); t.after(() => f.controller.stop());
  delete f.video.requestVideoFrameCallback; f.video.readyState = 2;
  assert.equal((await start(f)).status, 'first-frame');
});
