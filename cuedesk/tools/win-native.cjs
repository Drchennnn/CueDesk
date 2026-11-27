'use strict';
const fs = require('node:fs');
const { execFile, execFileSync } = require('node:child_process');

function readWin32HwndString(win) {
  if (!win || typeof win.getNativeWindowHandle !== 'function') return '';
  try {
    const buf = win.getNativeWindowHandle();
    if (!Buffer.isBuffer(buf) || buf.length < 4) return '';
    if (buf.length >= 8 && typeof buf.readBigUInt64LE === 'function') {
      const v = buf.readBigUInt64LE(0);
      return v > 0n ? v.toString() : '';
    }
    const v = buf.readUInt32LE(0);
    return v > 0 ? String(v) : '';
  } catch {
    return '';
  }
}

function createWinNativeHelper({ helperPath = '', platform = process.platform, execSync = execFileSync, execAsync = execFile } = {}) {
  function isAvailable() {
    return platform === 'win32' && !!helperPath && fs.existsSync(helperPath);
  }

  // Only for kernel-read APIs (GetWindowRect) that NEVER send synchronous WM_* to the Electron UI thread.
  function invokeSync(args) {
    if (!isAvailable()) return null;
    try {
      const out = execSync(helperPath, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1500
      });
      const text = String(out || '').trim();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  // Required for Win32 mutators (ShowWindow / SetWindowPos) so Electron's UI thread keeps pumping
  // WM_SHOWWINDOW / WM_WINDOWPOSCHANGED without cross-process SendMessage deadlock!
  function invokeAsync(args) {
    if (!isAvailable()) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        execAsync(helperPath, args, {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 2000
        }, (err, stdout) => {
          if (err) return resolve(null);
          try {
            const text = String(stdout || '').trim();
            resolve(text ? JSON.parse(text) : null);
          } catch {
            resolve(null);
          }
        });
      } catch {
        resolve(null);
      }
    });
  }

  function ensureRenderVisible(win, { raiseTopmost = false } = {}) {
    const hwnd = readWin32HwndString(win);
    if (!hwnd) return Promise.resolve(null);
    const args = raiseTopmost
      ? ['--win-ensure-render', hwnd, '--topmost']
      : ['--win-ensure-render', hwnd];
    return invokeAsync(args);
  }

  function getPhysicalRect(win) {
    const hwnd = readWin32HwndString(win);
    if (!hwnd) return null;
    const rect = invokeSync(['--win-get-rect', hwnd]);
    if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 120 || rect.height < 80) {
      return null;
    }
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function setPhysicalRect(win, rect) {
    const hwnd = readWin32HwndString(win);
    if (!hwnd || !rect) return Promise.resolve(null);
    const spec = `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`;
    return invokeAsync(['--win-set-rect', hwnd, spec]).then((actual) => {
      if (!actual || !Number.isFinite(actual.width) || !Number.isFinite(actual.height)) return null;
      return {
        x: Math.round(actual.x),
        y: Math.round(actual.y),
        width: Math.round(actual.width),
        height: Math.round(actual.height)
      };
    });
  }

  return {
    isAvailable,
    readWin32HwndString,
    ensureRenderVisible,
    getPhysicalRect,
    setPhysicalRect
  };
}

module.exports = {
  createWinNativeHelper,
  readWin32HwndString
};
