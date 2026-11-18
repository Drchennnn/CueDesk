'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createEyeContact} = require('./eye-contact.cjs');

function registerEyeContact({app, ipcMain, getWindow, configFile = path.join(__dirname, 'config/runtime.json'),
  dataDirectory = path.join(app.getPath('userData'), 'eye-contact')}) {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
  for (const key of ['eyeEngineDirectory', 'eyeSdkDirectory']) {
    if (config[key] !== undefined && typeof config[key] !== 'string') throw Error('路径配置无效：' + key);
  }
  const resolveDirectory = value => value ? path.resolve(path.dirname(configFile), value) : undefined;
  const logFile = path.join(dataDirectory, 'eye-contact.log');
  function log(message) {
    try {
      fs.mkdirSync(dataDirectory, {recursive: true});
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 262144) {
        fs.copyFileSync(logFile, logFile + '.previous');
        fs.writeFileSync(logFile, '');
      }
      fs.appendFileSync(logFile, new Date().toISOString() + ' ' + message + '\n');
    } catch { /* Diagnostics must not interrupt camera shutdown. */ }
  }
  const controller = createEyeContact({
    userProfile: app.getPath('home'), appData: app.getPath('appData'),
    engineDirectory: resolveDirectory(config.eyeEngineDirectory), sdkDirectory: resolveDirectory(config.eyeSdkDirectory),
    settingsFile: path.join(dataDirectory, 'eye-contact-settings.json'), log,
    onChange(state) {
      const window = getWindow();
      if (window && !window.isDestroyed()) {
        try { window.webContents.send('eye-contact:state', state); }
        catch (error) { log(error.message); }
      }
    }
  });
  const handlers = {
    'eye-contact:get': () => controller.getState(),
    'eye-contact:get-settings': () => controller.getSettings(),
    'eye-contact:set-settings': value => controller.setSettings(value),
    'eye-contact:set-enabled': enabled => {
      if (typeof enabled !== 'boolean') throw Error('眼神矫正开关无效');
      return enabled ? controller.start() : controller.stop();
    },
    'eye-contact:restart': () => controller.restart(),
    'eye-contact:diagnostics': () => controller.getDiagnostics(),
    'eye-contact:preview': value => controller.reportPreview(value)
  };
  const registered = [];
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const channel of registered) ipcMain.removeHandler(channel);
    app.removeListener('before-quit', dispose);
    controller.dispose();
  }
  try {
    for (const [channel, handle] of Object.entries(handlers)) {
      ipcMain.handle(channel, (event, value) => {
        const window = getWindow();
        if (!window || window.isDestroyed() || event.sender !== window.webContents ||
            (event.senderFrame && event.senderFrame !== window.webContents.mainFrame)) {
          throw Error('仅指定窗口的主页面可控制眼神矫正');
        }
        return handle(value);
      });
      registered.push(channel);
    }
    app.once('before-quit', dispose);
  } catch (error) {
    dispose();
    throw error;
  }
  return {controller, dispose, dataDirectory};
}

module.exports = {registerEyeContact};
