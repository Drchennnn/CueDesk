const test = require('node:test');
const assert = require('node:assert/strict');
const { createScreenshotBatch } = require('../meeting-copilot/screenshot-batch.js');
function fixture(overrides = {}) {
  const sent = [], captures = [];
  let written = true, session = 'session';
  const controller = createScreenshotBatch({ capture: async mode => { captures.push(mode); return 'data:image/png;base64,' + mode; }, send: (...args) => sent.push(args), isWritten: () => written, getSession: () => session, onChange: () => {}, ...overrides });
  return { controller, sent, captures, scene: value => { written = value; }, session: value => { session = value; } };
}
test('single captures send immediately; batch hotkeys capture both modes and send once in order with question', async () => {
  const { controller: c, sent, captures } = fixture();
  await c.take('full'); assert.equal(sent.length, 1);
  c.toggle(); await c.take('region'); await c.take('full');
  assert.equal(sent.length, 1); assert.equal(c.snapshot().images.length, 2);
  c.question('two parts'); c.sendBatch(); c.sendBatch();
  assert.equal(sent.length, 2); assert.deepEqual(sent[1], ['two parts', undefined, ['data:image/png;base64,region', 'data:image/png;base64,full']]);
  assert.deepEqual(captures, ['full', 'region', 'full']); assert.equal(c.snapshot().images.length, 0); assert.equal(c.snapshot().enabled, true);
});
test('disabling preserves queue without sending; off mode sends new singles; wrong scene cannot send batch', async () => {
  const { controller: c, sent, scene } = fixture();
  c.toggle(); await c.take(); c.toggle(); assert.equal(sent.length, 0); assert.equal(c.snapshot().images.length, 1);
  await c.take('region'); assert.equal(sent.length, 1);
  scene(false); c.sendBatch(); assert.equal(sent.length, 1); assert.equal(c.snapshot().images.length, 1);
  scene(true); c.sendBatch(); assert.equal(sent.length, 2);
});
test('in-flight selection blocks duplicate capture, send, clear and mode changes; cancellation never sends', async () => {
  let finish; const { controller: c, sent } = fixture({ capture: () => new Promise(resolve => { finish = resolve; }) });
  c.toggle(); const pending = c.take('region');
  assert.equal(await c.take(), false); c.toggle(); c.sendBatch(); c.clear();
  assert.equal(c.snapshot().enabled, true); assert.equal(sent.length, 0);
  finish(null); await pending; assert.equal(c.snapshot().images.length, 0); assert.equal(c.snapshot().busy, false);
});
test('limits, removals, errors and unavailable sessions preserve queue and prevent spurious sends', async () => {
  const { controller: c, captures, session } = fixture({ send: () => { throw Error('offline'); } });
  c.toggle(); for (let i = 0; i < 13; i++) await c.take();
  assert.equal(captures.length, 12); c.remove(1); assert.equal(c.snapshot().images.length, 11);
  session(null); c.sendBatch(); assert.equal(c.snapshot().images.length, 11);
  session('s'); c.sendBatch(); assert.equal(c.snapshot().images.length, 11); assert.match(c.snapshot().message, /offline/);
  c.clear(); assert.equal(c.snapshot().images.length, 0);
});
