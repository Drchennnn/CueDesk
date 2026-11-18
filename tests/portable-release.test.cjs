'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {prepare} = require('../meeting-copilot/release/portable-bootstrap.cjs');

test('portable initialization seeds an independent profile and preserves saved settings across restarts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-portable-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const prior = process.env.MC_USERDATA;
  delete process.env.MC_USERDATA;
  t.after(() => { if (prior === undefined) delete process.env.MC_USERDATA; else process.env.MC_USERDATA = prior; });
  fs.mkdirSync(path.join(root, 'config/defaults/multimodal'), {recursive: true});
  fs.writeFileSync(path.join(root, 'config/defaults/settings.json'), '{"llm":{"baseUrl":"","model":""}}');
  fs.writeFileSync(path.join(root, 'config/defaults/multimodal/interfaces.json'), '{"enabled":false}');
  fs.writeFileSync(path.join(root, 'config/runtime.json'), '{}');
  let configuredPath;
  const app = {setPath(name, value) { assert.equal(name, 'userData'); configuredPath = value; }};
  prepare(app, path.join(root, 'app/resources'));
  assert.equal(configuredPath, path.join(root, 'data'));
  const file = path.join(configuredPath, 'settings.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).llm.baseUrl, '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(configuredPath, 'multimodal/interfaces.json'), 'utf8')).enabled, false);
  fs.writeFileSync(file, '{"saved":true}');
  prepare(app, path.join(root, 'app/resources'));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).saved, true);
});

test('portable initialization supports an explicit test profile without writing the release data directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-portable-isolation-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const prior = process.env.MC_USERDATA;
  process.env.MC_USERDATA = path.join(root, 'test-profile');
  t.after(() => { if (prior === undefined) delete process.env.MC_USERDATA; else process.env.MC_USERDATA = prior; });
  fs.mkdirSync(path.join(root, 'config/defaults'), {recursive: true});
  fs.writeFileSync(path.join(root, 'config/defaults/settings.json'), '{}');
  fs.writeFileSync(path.join(root, 'config/runtime.json'), '{}');
  prepare({setPath() {}}, path.join(root, 'app/resources'));
  assert.equal(fs.existsSync(path.join(root, 'data')), false);
  assert.equal(fs.existsSync(path.join(root, 'test-profile/settings.json')), true);
});

test('portable resource overrides resolve from the bundle root and blank values preserve explicit environment configuration', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-portable-maxine-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const names = ['MC_USERDATA', 'MC_EYE_ENGINE_DIR', 'MC_EYE_SDK_DIR'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  delete process.env.MC_USERDATA;
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
  fs.mkdirSync(path.join(root, 'config/defaults'), {recursive: true});
  fs.writeFileSync(path.join(root, 'config/defaults/settings.json'), '{}');
  const config = path.join(root, 'config/runtime.json');
  fs.writeFileSync(config, JSON.stringify({eyeEngineDirectory: 'app/resources/eye-contact/engine', eyeSdkDirectory: 'app/resources/eye-contact/sdk'}));
  prepare({setPath() {}}, path.join(root, 'app/resources'));
  assert.equal(process.env.MC_EYE_ENGINE_DIR, path.join(root, 'app/resources/eye-contact/engine'));
  assert.equal(process.env.MC_EYE_SDK_DIR, path.join(root, 'app/resources/eye-contact/sdk'));
  fs.writeFileSync(config, JSON.stringify({eyeEngineDirectory: '', eyeSdkDirectory: ''}));
  prepare({setPath() {}}, path.join(root, 'app/resources'));
  assert.equal(process.env.MC_EYE_ENGINE_DIR, path.join(root, 'app/resources/eye-contact/engine'));
  assert.equal(process.env.MC_EYE_SDK_DIR, path.join(root, 'app/resources/eye-contact/sdk'));
});
