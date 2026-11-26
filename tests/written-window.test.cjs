'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createWrittenWindow, MINIMUM } = require('../cuedesk/written-window.cjs');
class FakeWindow extends EventEmitter {
  constructor() { super(); this.bounds = { x: 200, y: 100, width: 940, height: 560 }; this.minimum = [640, 380]; this.maximized = false; }
  isDestroyed() { return false; }
  isVisible() { return this.visible !== false; }
  isMinimized() { return this.minimized === true; }
  isMaximized() { return this.maximized; }
  maximize() { this.maximized = true; }
  unmaximize() { this.maximized = false; }
  getBounds() { return { ...this.bounds }; }
  getNormalBounds() { return { ...this.bounds }; }
  getMinimumSize() { return [...this.minimum]; }
  setMinimumSize(w, h) { this.minimum = [w, h]; }
  setBounds(bounds) { this.bounds = { ...bounds }; this.emit('resize'); this.emit('move'); }
  setIgnoreMouseEvents(ignore) { this.ignoresMouse = ignore; }
  setFocusable(focusable) { this.focusable = focusable; }
  setSkipTaskbar(skip) { this.skipTaskbar = skip; }
  setAlwaysOnTop(flag, level) { this.alwaysOnTop = { flag, level }; }
  moveTop() { this.topMoves = (this.topMoves || 0) + 1; }
  showInactive() { this.visible = true; this.inactiveShows = (this.inactiveShows || 0) + 1; }
}
function fixture(t, count = 4) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'written-window-test-'));
  const file = path.join(folder, 'written-window.json');
  const screen = { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) };
  const host = createWrittenWindow({ file, screen, getModelCount: () => count });
  const win = new FakeWindow();
  host.attach(win);
  t.after(() => { win.emit('close'); win.emit('closed'); host.flush(); fs.rmSync(folder, { recursive: true, force: true }); });
  return { folder, file, host, win, screen };
}
test('compact mode lowers the minimum size, fits four answer rows and restores the original window', t => {
  const { host, win } = fixture(t);
  const original = win.getBounds();
  host.applyPatch({ enabled: true });
  assert.deepEqual(win.minimum, MINIMUM);
  assert.equal(win.bounds.width, 320);
  assert.equal(win.bounds.height, 236);
  assert.equal(host.getPublic().enabled, true);
  host.applyPatch({ enabled: false });
  assert.deepEqual(win.getBounds(), original);
  assert.deepEqual(win.minimum, [640, 380]);
});
test('a single model starts in a smaller answer-sized window', t => {
  const { host, win } = fixture(t, 1);
  host.applyPatch({ enabled: true });
  assert.equal(win.bounds.height, 116);
  assert.equal(win.bounds.width, 320);
});
test('dragged bounds, font and label preferences survive restart and initial startup stays compact', t => {
  const { host, win, file, screen } = fixture(t);
  host.applyPatch({ enabled: true, fontFamily: 'Consolas', fontSize: 34, showNames: false });
  win.setBounds({ x: 420, y: 180, width: 280, height: 180 });
  host.flush();
  const next = createWrittenWindow({ file, screen, getModelCount: () => 4 });
  assert.equal(next.getPublic().fontSize, 34);
  assert.equal(next.getPublic().fontFamily, 'Consolas');
  assert.equal(next.getPublic().showNames, false);
  assert.equal(next.initialOptions().width, 280);
  assert.equal(next.initialOptions().minWidth, 190);
  const reopened = new FakeWindow();
  next.attach(reopened);
  assert.deepEqual(reopened.getBounds(), { x: 420, y: 180, width: 280, height: 180 });
  next.applyPatch({ enabled: false });
  assert.deepEqual(reopened.getBounds(), { x: 200, y: 100, width: 940, height: 560 });
});
test('font controls and window scale remain independent and invalid values do not persist', t => {
  const { host, win, file } = fixture(t);
  host.applyPatch({ enabled: true });
  const before = win.getBounds();
  host.applyPatch({ fontDelta: 2 });
  assert.equal(host.getPublic().fontSize, 30);
  assert.deepEqual(win.getBounds(), before);
  host.applyPatch({ scale: 1.15 });
  assert.equal(win.bounds.width, 368);
  assert.equal(host.getPublic().fontSize, 30);
  const saved = fs.readFileSync(file, 'utf8');
  for (const patch of [{ fontSize: 200 }, { fontFamily: 'unknown' }, { fontDelta: 5 }, { scale: 0 }]) {
    assert.throws(() => host.applyPatch(patch));
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
  }
  host.applyPatch({ resetBounds: true });
  assert.equal(win.bounds.height, 76 + 4 * 42);
});
test('compact bounds stay visible after a display is disconnected', t => {
  const { host, win } = fixture(t);
  host.applyPatch({ enabled: true });
  win.setBounds({ x: -1800, y: -900, width: 400, height: 250 });
  host.flush();
  host.applyPatch({ enabled: false });
  host.applyPatch({ enabled: true });
  assert.ok(win.bounds.x >= 0 && win.bounds.y >= 0);
});

test('reading lock passes clicks through, cannot focus and unlocks without losing window preferences', t => {
  const { host, win, file, screen } = fixture(t);
  assert.throws(() => host.applyPatch({ clickThrough: true }));
  host.applyPatch({ enabled: true, clickThrough: true });
  assert.equal(win.ignoresMouse, true);
  assert.equal(win.focusable, false);
  const bounds = win.getBounds();
  host.showInactive();
  assert.equal(win.inactiveShows, 1);
  host.unlock();
  assert.equal(win.ignoresMouse, false);
  assert.equal(win.focusable, true);
  assert.deepEqual(win.getBounds(), bounds);
  host.applyPatch({ clickThrough: true });
  const next = createWrittenWindow({ file, screen });
  assert.equal(next.getPublic().clickThrough, false, 'restart must never trap the user in a mouse lock');
  host.applyPatch({ enabled: false });
  assert.equal(host.getPublic().clickThrough, false);
  assert.equal(win.focusable, true);
});

test('showing the overlay restores its topmost order while preserving reading lock', t => {
  const { host, win } = fixture(t);
  host.applyPatch({ enabled: true, clickThrough: true });
  win.focus = () => assert.fail('overlay display must preserve the foreground application');
  win.show = () => assert.fail('overlay display must use showInactive');
  win.visible = false;
  const before = win.topMoves;
  host.showInactive();
  assert.equal(win.isVisible(), true);
  assert.equal(win.topMoves, before + 1);
  assert.deepEqual(win.alwaysOnTop, { flag: true, level: 'screen-saver' });
  assert.equal(win.focusable, false);
  assert.equal(win.ignoresMouse, true);
  win.emit('blur');
  assert.equal(win.topMoves, before + 2);
});

test('compact overlay refreshes its order only while visible and stops after closing', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { host, win } = fixture(t);
  host.applyPatch({ enabled: true });
  const before = win.topMoves;
  t.mock.timers.tick(250);
  assert.equal(win.topMoves, before + 1);
  win.visible = false;
  t.mock.timers.tick(500);
  assert.equal(win.topMoves, before + 1);
  win.visible = true;
  win.minimized = true;
  t.mock.timers.tick(500);
  assert.equal(win.topMoves, before + 1);
  win.minimized = false;
  host.applyPatch({ enabled: false });
  const normalMoves = win.topMoves;
  t.mock.timers.tick(500);
  assert.equal(win.topMoves, normalMoves);
  host.applyPatch({ enabled: true });
  const closingMoves = win.topMoves;
  win.emit('close');
  win.emit('closed');
  t.mock.timers.tick(1000);
  assert.equal(win.topMoves, closingMoves);
});
