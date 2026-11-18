'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {registerEyeContact} = require('./electron-main.cjs');
const {createEyeContactBridge} = require('./preload.cjs');
const {createWindowsPlatform} = require('./eye-contact.cjs');

function fixture(t, collision = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eye-contact-module-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const app = new EventEmitter();
  app.getPath = () => root;
  const configFile = path.join(root, 'runtime.json');
  fs.writeFileSync(configFile, '{"eyeEngineDirectory":"","eyeSdkDirectory":""}');
  const handlers = new Map(collision ? [[collision, () => 'existing']] : []);
  const window = {isDestroyed: () => false, webContents: {send() {}, mainFrame: {}}};
  const ipcMain = {
    handle(channel, callback) {
      if (handlers.has(channel)) throw Error('Channel already registered');
      handlers.set(channel, callback);
    },
    removeHandler: channel => handlers.delete(channel)
  };
  const options = {app, ipcMain, configFile, getWindow: () => window, dataDirectory: path.join(root, 'data')};
  return {root, app, window, handlers, options, event: {sender: window.webContents, senderFrame: window.webContents.mainFrame}};
}

test('standalone adapter persists settings and checks the calling window and frame', t => {
  const f = fixture(t);
  const module = registerEyeContact(f.options);
  t.after(() => module.dispose());
  assert.equal(f.handlers.get('eye-contact:get')(f.event).enabled, false);
  const settings = f.handlers.get('eye-contact:set-settings')(f.event, {sourceDeviceName: 'Synthetic Camera', eyeSize: 4});
  assert.equal(settings.eyeSize, 4);
  const stored = JSON.parse(fs.readFileSync(path.join(f.root, 'data/eye-contact-settings.json'), 'utf8'));
  assert.equal(stored.sourceDeviceName, 'Synthetic Camera');
  assert.throws(() => f.handlers.get('eye-contact:get')({sender: {}}), /主页面/);
  assert.throws(() => f.handlers.get('eye-contact:get')({...f.event, senderFrame: {}}), /主页面/);
  assert.throws(() => f.handlers.get('eye-contact:set-enabled')(f.event, 'true'), /开关/);
});

test('standalone adapter unregisters its IPC handlers on shutdown and permits reinitialization', t => {
  const f = fixture(t);
  registerEyeContact(f.options);
  assert.equal(f.handlers.size, 7);
  f.app.emit('before-quit');
  assert.equal(f.handlers.size, 0);
  const module = registerEyeContact(f.options);
  module.dispose();
  module.dispose();
  assert.equal(f.handlers.size, 0);
});

test('a channel collision rolls back new handlers and preserves the existing owner', t => {
  const f = fixture(t, 'eye-contact:set-settings');
  assert.throws(() => registerEyeContact(f.options), /already registered/);
  assert.equal(f.handlers.size, 1);
  assert.equal(f.handlers.get('eye-contact:set-settings')(), 'existing');
  assert.equal(f.app.listenerCount('before-quit'), 0);
});

test('preload bridge forwards operations and removes exactly its event subscription', async () => {
  const events = new EventEmitter();
  const calls = [];
  const renderer = {invoke: async (...args) => { calls.push(args); return 'ok'; },
    on: (name, handler) => events.on(name, handler), removeListener: (name, handler) => events.removeListener(name, handler)};
  const bridge = createEyeContactBridge(renderer);
  await bridge.setEyeContactSettings({eyeSize: 3});
  assert.deepEqual(calls[0], ['eye-contact:set-settings', {eyeSize: 3}]);
  const states = [];
  const unsubscribe = bridge.onEyeContactState(state => states.push(state));
  events.emit('eye-contact:state', {}, {phase: 'off'});
  unsubscribe();
  events.emit('eye-contact:state', {}, {phase: 'ready'});
  assert.deepEqual(states, [{phase: 'off'}]);
});

test('explicit engine and SDK paths resolve independently of the original application directory', async t => {
  const f = fixture(t);
  const engineDirectory = path.join(f.root, 'external-engine');
  const sdkDirectory = path.join(f.root, 'external-sdk');
  fs.mkdirSync(engineDirectory);
  fs.mkdirSync(path.join(sdkDirectory, 'models'), {recursive: true});
  for (const file of ['suisi-eye-contact.exe', 'softcam.dll']) fs.writeFileSync(path.join(engineDirectory, file), 'fixture');
  fs.writeFileSync(path.join(sdkDirectory, 'nvARPose.dll'), 'fixture');
  const platform = createWindowsPlatform({userProfile: f.root, appData: f.root, engineDirectory, sdkDirectory});
  const resources = await platform.resources();
  assert.equal(resources.helper, path.join(engineDirectory, 'suisi-eye-contact.exe'));
  assert.equal(resources.softcam, path.join(engineDirectory, 'softcam.dll'));
  assert.equal(resources.sdkDir, sdkDirectory);
  fs.unlinkSync(path.join(sdkDirectory, 'nvARPose.dll'));
  await assert.rejects(platform.resources(), /指定 SDK 目录/);
});
