'use strict';
const fs = require('node:fs');
const path = require('node:path');

function prepare(app, resourcesPath) {
  const root = path.resolve(resourcesPath, '..', '..');
  const data = process.env.MC_USERDATA || path.join(root, 'data');
  const defaults = path.join(root, 'config', 'defaults');
  fs.mkdirSync(data, {recursive: true});
  // Keep files created during earlier runs, including intentionally empty values.
  function seedMissing(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) seedMissing(path.join(directory, entry.name), name);
      else if (!fs.existsSync(path.join(data, name))) {
        fs.mkdirSync(path.dirname(path.join(data, name)), {recursive: true});
        try {
          fs.copyFileSync(path.join(directory, entry.name), path.join(data, name), fs.constants.COPYFILE_EXCL);
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
    }
  }
  seedMissing(defaults);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'runtime.json'), 'utf8').replace(/^\uFEFF/, ''));
  for (const [field, variable] of Object.entries({
    funasrPython: 'MC_FUNASR_PYTHON', mossPython: 'MC_MOSS_PYTHON',
    eyeEngineDirectory: 'MC_EYE_ENGINE_DIR', eyeSdkDirectory: 'MC_EYE_SDK_DIR'
  })) {
    if (config[field]) process.env[variable] = path.resolve(root, config[field]);
  }
  if (config.dashscopeApiKey) process.env.DASHSCOPE_API_KEY = config.dashscopeApiKey;
  app.setPath('userData', path.resolve(data));
  return {root, data};
}

module.exports = {prepare};
