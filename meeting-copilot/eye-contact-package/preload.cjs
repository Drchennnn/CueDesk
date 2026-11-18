'use strict';

function createEyeContactBridge(ipcRenderer) {
  return {
    getEyeContactState: () => ipcRenderer.invoke('eye-contact:get'),
    getEyeContactSettings: () => ipcRenderer.invoke('eye-contact:get-settings'),
    setEyeContactSettings: value => ipcRenderer.invoke('eye-contact:set-settings', value),
    setEyeContactEnabled: enabled => ipcRenderer.invoke('eye-contact:set-enabled', enabled),
    restartEyeContact: () => ipcRenderer.invoke('eye-contact:restart'),
    getEyeContactDiagnostics: () => ipcRenderer.invoke('eye-contact:diagnostics'),
    reportEyeContactPreview: value => ipcRenderer.invoke('eye-contact:preview', value),
    onEyeContactState(callback) {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on('eye-contact:state', handler);
      return () => ipcRenderer.removeListener('eye-contact:state', handler);
    }
  };
}

module.exports = {createEyeContactBridge};
