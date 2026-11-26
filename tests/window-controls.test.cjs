'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWindowControls, DEFAULT_BINDINGS } = require('../cuedesk/window-controls.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-window-controls-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = new Map(), refused = new Set();
  const shortcuts = { isRegistered: key => calls.has(key), register: (key, cb) => { if (calls.has(key) || refused.has(key)) return false; calls.set(key, cb); return true; }, unregister: key => calls.delete(key) };
  const left = { workArea: { x: -1000, y: 0, width: 1000, height: 800 } }, right = { workArea: { x: 0, y: 0, width: 1200, height: 800 } };
  const screen = { getDisplayMatching: b => b.x + b.width / 2 < 0 ? left : right, getDisplayNearestPoint: p => p.x < 0 ? left : right };
  const win = { webContents: { zoom: 1, scripts: [], setZoomFactor(value) { this.zoom = value; }, executeJavaScript(script) { this.scripts.push(script); return Promise.resolve(); } }, bounds: { x: 100, y: 100, width: 400, height: 200 }, opacity: 1, visible: true, minimized: false, maximized: false, minimum: [190, 96], isDestroyed: () => false, isVisible() { return this.visible; }, isMinimized() { return this.minimized; }, isMaximized() { return this.maximized; }, getBounds() { return { ...this.bounds }; }, getMinimumSize() { return this.minimum; }, setBounds(b) { this.bounds = b; }, setOpacity(value) { this.opacity = value; }, focus() { throw new Error('Must never focus'); }, show() { throw new Error('Must never show'); }, unmaximize() { throw new Error('Must never restore'); } };
  let reserved = [];
  const options = { file: path.join(directory, 'controls.json'), screen, shortcuts, getWindow: () => win, getReservedShortcuts: () => reserved };
  const host = createWindowControls(options); host.attach(win); host.register();
  t.after(() => host.dispose());
  return { host, win, calls, refused, options, reserve: keys => { reserved = keys; }, fire: action => calls.get(host.getPublic().bindings[action])() };
}
test('all six shortcuts manipulate visible windows without focus, preserve minimum size, and cross monitors', t => {
  const { win, host, fire } = fixture(t);
  fire('left'); assert.equal(win.bounds.x, 80); fire('right'); assert.equal(win.bounds.x, 100);
  fire('up'); assert.equal(win.bounds.y, 80); fire('down'); assert.equal(win.bounds.y, 100);
  fire('grow'); assert.equal(win.bounds.width, 440); fire('shrink'); assert.equal(win.bounds.width, 400);
  for (let i = 0; i < 30; i++) fire('shrink');
  assert.deepEqual([win.bounds.width, win.bounds.height], [200, 100]);
  assert.equal(win.webContents.zoom, 0.5);
  win.bounds = { x: 0, y: 100, width: 400, height: 200 }; fire('left'); assert.equal(win.bounds.x, -400);
  win.bounds.x = -400; fire('right'); assert.equal(win.bounds.x, 0);
  host.applyPatch({ moveStep: 50 }); fire('down'); assert.equal(win.bounds.y, 150);
});
test('hidden, minimized and maximized windows do not move or become visible', t => {
  const { win, fire, host } = fixture(t);
  const original = { ...win.bounds };
  for (const key of ['visible', 'minimized', 'maximized']) {
    win[key] = key !== 'visible'; fire('right'); fire('grow');
    assert.deepEqual(win.bounds, original); assert.match(host.getPublic().status, /不移动/);
    win[key] = key === 'visible';
  }
});
test('opacity and bindings persist, reject invalid values, and survive attach/reload', t => {
  const { host, win, options, calls } = fixture(t);
  host.applyPatch({ opacity: 0.45, bindings: { left: 'Shift+Ctrl+J' } });
  assert.equal(win.opacity, 1); assert.ok(win.webContents.scripts.some(script => script.includes('0.45'))); assert.equal(host.getPublic().bindings.left, 'Control+Shift+J');
  assert.equal(calls.has(DEFAULT_BINDINGS.left), false);
  const next = createWindowControls(options); next.attach(win);
  assert.equal(next.getPublic().opacity, 0.45); assert.equal(win.opacity, 1); assert.ok(win.webContents.scripts.some(script => script.includes('0.45')));
  for (const patch of [{ opacity: 0 }, { opacity: NaN }, { moveStep: 0 }, { moveStep: 1.5 }, { bindings: { down: 'A' } }, { bindings: { left: 'Ctrl+Alt+Right' } }]) assert.throws(() => host.applyPatch(patch));
  assert.equal(win.opacity, 1); assert.ok(win.webContents.scripts.at(-1).includes('0.45')); assert.equal(JSON.parse(fs.readFileSync(options.file)).opacity, 0.45);
});
test('failed registrations roll back only staged keys and keep all working original bindings', t => {
  const { host, win, refused, calls, fire, reserve } = fixture(t);
  calls.set('Control+Alt+Q', () => {});
  assert.throws(() => host.applyPatch({ bindings: { left: 'Ctrl+Alt+Q' } }), /占用/);
  refused.add('Control+Alt+J');
  assert.throws(() => host.applyPatch({ bindings: { left: 'Ctrl+Alt+K', right: 'Ctrl+Alt+J' }, opacity: 0.3 }), /无法注册/);
  assert.equal(calls.has('Control+Alt+K'), false);
  for (const key of Object.values(DEFAULT_BINDINGS)) assert.ok(calls.has(key));
  assert.equal(win.opacity, 1); fire('left'); assert.equal(win.bounds.x, 80);
  reserve(['Control+Shift+U']); assert.throws(() => host.applyPatch({ bindings: { up: 'Ctrl+Shift+U' } }), /冲突/);
  host.dispose(); assert.ok(calls.has('Control+Alt+Q')); assert.equal(calls.size, 1);
});
test('swap or disable shortcuts without collision; recover after an external unregisterAll', t => {
  const { host, calls, win } = fixture(t);
  host.applyPatch({ bindings: { left: DEFAULT_BINDINGS.right, right: DEFAULT_BINDINGS.left, grow: '' } });
  calls.get(DEFAULT_BINDINGS.right)(); assert.equal(win.bounds.x, 80);
  assert.equal(calls.has(DEFAULT_BINDINGS.grow), false);
  calls.clear(); host.register(); assert.equal(calls.size, Object.keys(DEFAULT_BINDINGS).length - 1);
  calls.get(DEFAULT_BINDINGS.left)(); assert.equal(win.bounds.x, 100);
});
test('settings write failure restores opacity and removes staged keys without losing previous settings', t => {
  const { host, options, calls, win } = fixture(t);
  host.applyPatch({ opacity: 0.8 });
  fs.mkdirSync(options.file + '.tmp');
  assert.throws(() => host.applyPatch({ opacity: 0.3, bindings: { left: 'Ctrl+Alt+J' } }));
  assert.equal(win.opacity, 1); assert.ok(win.webContents.scripts.at(-1).includes('0.8'));
  assert.equal(host.getPublic().opacity, 0.8);
  assert.equal(JSON.parse(fs.readFileSync(options.file)).opacity, 0.8);
  assert.equal(calls.has('Control+Alt+J'), false);
  assert.equal(calls.has(DEFAULT_BINDINGS.left), true);
});
test('grow and shrink scale native bounds and all web content together, and restore zoom after restart', t => {
  const { host, win, fire, options } = fixture(t);
  fire('grow');
  assert.deepEqual([win.bounds.width, win.bounds.height], [440, 220]);
  assert.equal(win.webContents.zoom, 1.1);
  assert.equal(host.getPublic().zoomFactor, 1.1);
  const reopened = createWindowControls(options); win.webContents.zoom = 1; reopened.attach(win);
  assert.equal(win.webContents.zoom, 1.1);
  fire('shrink');
  assert.deepEqual([win.bounds.width, win.bounds.height], [400, 200]);
  assert.equal(win.webContents.zoom, 1);
  assert.equal(JSON.parse(fs.readFileSync(options.file)).zoomFactor, 1);
});
test('one clamped scale preserves aspect and stops content zoom when bounds or zoom reach a limit', t => {
  const { win, fire, host } = fixture(t);
  win.minimum = [380, 96]; fire('shrink');
  assert.deepEqual([win.bounds.width, win.bounds.height], [380, 190]);
  assert.equal(win.webContents.zoom, 0.95);
  fire('shrink'); assert.equal(win.webContents.zoom, 0.95);
  win.minimum = [190, 96];
  win.bounds = { x: 0, y: 0, width: 1000, height: 500 };
  host.applyPatch({ zoomFactor: 1 });
  fire('grow'); fire('grow');
  assert.deepEqual([win.bounds.width, win.bounds.height], [1200, 600]);
  assert.ok(Math.abs(win.webContents.zoom - 1.2) < 1e-12);
  fire('grow'); assert.ok(Math.abs(win.webContents.zoom - 1.2) < 1e-12);
  win.bounds = { x: 100, y: 100, width: 400, height: 200 }; host.applyPatch({ zoomFactor: 1.95 });
  fire('grow'); assert.equal(win.webContents.zoom, 2);
  const atLimit = { ...win.bounds }; fire('grow'); assert.deepEqual(win.bounds, atLimit);
});
test('failed zoom preference persistence restores both native bounds and content size', t => {
  const { options, win, fire, host } = fixture(t);
  const oldBounds = { ...win.bounds };
  fs.mkdirSync(options.file + '.tmp'); fire('grow');
  assert.deepEqual(win.bounds, oldBounds);
  assert.equal(win.webContents.zoom, 1);
  assert.equal(host.getPublic().zoomFactor, 1);
  assert.ok(host.getPublic().status);
});

test('batch shortcuts dispatch independently of window visibility and persist custom bindings', t => {
  const { host, options, calls, win } = fixture(t); host.dispose();
  const actions = [];
  const batch = createWindowControls({ ...options, onAction: action => actions.push(action) });
  t.after(() => batch.dispose()); batch.register(); win.visible = false;
  calls.get(DEFAULT_BINDINGS.toggleBatch)(); calls.get(DEFAULT_BINDINGS.sendBatch)();
  assert.deepEqual(actions, ['toggleBatch', 'sendBatch']);
  batch.applyPatch({ bindings: { sendBatch: 'Ctrl+Shift+Y' } });
  assert.equal(calls.has(DEFAULT_BINDINGS.sendBatch), false);
  calls.get('Control+Shift+Y')(); assert.equal(actions.at(-1), 'sendBatch');
  assert.equal(createWindowControls(options).getPublic().bindings.sendBatch, 'Control+Shift+Y');
});
