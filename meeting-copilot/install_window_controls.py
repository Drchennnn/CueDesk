"""Install global window movement/scaling and persistent opacity controls."""
import argparse
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('asar', HERE / 'install.py')
asar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asar)
MAIN = 'out/main/index.js'
RENDERER = 'out/renderer/assets/index-hyFYaQxP.js'
PRELOAD = 'out/preload/index.js'
MARKER = '// meeting-copilot-window-controls-v1'


def once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Unexpected source: ' + before[:120])
    return text.replace(before, after, 1)


def patch_sources(main, renderer, preload):
    if '// meeting-copilot-hide-shell-icons-v1' not in main:
        raise ValueError('Install icon visibility patch first')
    main = once(main, '  let writtenWindow;', '  let writtenWindow;\n  let windowControls;')
    main = once(main, '    writtenWindow.attach(win);', '    writtenWindow.attach(win);\n    windowControls.attach(win);')
    main = once(main, '    const { createShortcutRuntime } = require(', '''    const { createWindowControls } = require(path.join(process.resourcesPath, "tools", "window-controls.cjs"));
    windowControls = createWindowControls({
      file: path.join(electron.app.getPath("userData"), "window-controls.json"),
      screen: electron.screen, shortcuts: electron.globalShortcut, getWindow: () => win,
      getReservedShortcuts: () => [settings.data.ui.hotkeyToggle, settings.data.ui.hotkeyShot, captureSettings.getPublic().hotkeyRegion],
      onChange: (preferences) => win?.webContents.send("window-controls:state", preferences)
    });
    electron.ipcMain.handle("window-controls:get", (event) => {
      if (!win || event.sender !== win.webContents) throw new Error("仅主窗口可读取窗口设置");
      return windowControls.getPublic();
    });
    electron.ipcMain.handle("window-controls:set", (event, patch) => {
      if (!win || event.sender !== win.webContents) throw new Error("仅主窗口可修改窗口设置");
      return windowControls.applyPatch(patch);
    });
    const { createShortcutRuntime } = require(''')
    main = once(main, '      onToggle: () => toggleWindow(),', '      onRegistered: () => windowControls.register(),\n      onToggle: () => toggleWindow(),')
    main = once(main, '    writtenWindow?.flush();', '    writtenWindow?.flush();\n    windowControls?.dispose();')
    main = once(main, '    if (target?.isMinimized()) target.restore();', '    writtenWindow?.unlock();\n    if (target?.isMinimized()) target.restore();')
    preload = once(preload, '  getSettings: () => electron.ipcRenderer.invoke(IPC.settingsGet),', '''  getSettings: () => electron.ipcRenderer.invoke(IPC.settingsGet),
  getWindowControls: () => electron.ipcRenderer.invoke("window-controls:get"),
  setWindowControls: (patch) => electron.ipcRenderer.invoke("window-controls:set", patch),''')
    renderer = once(renderer, 'function SettingsPanel({', (HERE / 'window-controls-ui.js').read_text(encoding='utf8') + '\nfunction SettingsPanel({')
    renderer = once(renderer, '    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "settings-section", children: t.settings.commonSection }),', '    jsxRuntimeExports.jsx(WindowControlsSettings, {}),\n    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "settings-section", children: t.settings.commonSection }),')
    start = renderer.index('function WrittenCompactView(')
    end = renderer.index('function App()', start)
    compact = (HERE / 'written-window-ui.js').read_text(encoding='utf8')
    compact = compact[compact.index('function WrittenCompactView('):]
    compact = once(compact, "      hs('label', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }, children: ['字号 '", "      h(WindowControlsSettings, {}),\n      hs('label', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }, children: ['字号 '")
    renderer = renderer[:start] + compact + '\n' + renderer[end:]
    return {MAIN: (MARKER + '\n' + main).encode('utf8'), RENDERER: renderer.encode('utf8'), PRELOAD: preload.encode('utf8')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app_dir', nargs='?', default=str(Path(os.environ['LOCALAPPDATA']) / 'Programs/meeting-copilot'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    app_dir = Path(args.app_dir).resolve()
    target = app_dir / 'resources/app.asar'
    archive = target.read_bytes()
    h, o = asar.read_header(archive)
    sources = [asar.read_member(archive, h, o, name).decode('utf8') for name in [MAIN, RENDERER, PRELOAD]]
    if MARKER in sources[0]:
        print('Window controls already installed.')
        return
    replacements = patch_sources(*sources)
    check = HERE.parent / 'work/window-controls/check'
    check.mkdir(parents=True, exist_ok=True)
    for member, content in replacements.items():
        file = check / ('main.cjs' if member == MAIN else 'preload.cjs' if member == PRELOAD else 'renderer.mjs')
        file.write_bytes(content)
        subprocess.run(['node', '--check', str(file)], check=True)
    modules = ['window-controls.cjs', 'shortcut-runtime.cjs', 'written-window.cjs']
    for name in modules:
        subprocess.run(['node', '--check', str(HERE / name)], check=True)
    patched = asar.replace_members(archive, replacements)
    h, o = asar.read_header(patched)
    for name, content in replacements.items():
        if asar.read_member(patched, h, o, name) != content:
            raise RuntimeError('ASAR readback failed')
    if args.check:
        print('Compatible: syntax and ASAR checks passed. No installed files changed.')
        return
    asar.require_closed(app_dir)
    targets = [target] + [app_dir / 'resources/tools' / name for name in modules]
    originals = {file: file.read_bytes() if file.exists() else None for file in targets}
    for file, content in originals.items():
        backup = file.with_name(file.name + '.before-window-controls.bak')
        if content is not None and backup.exists() and backup.read_bytes() != content:
            raise RuntimeError('Different backup exists: ' + str(backup))
    for file, content in originals.items():
        backup = file.with_name(file.name + '.before-window-controls.bak')
        if content is not None and not backup.exists():
            shutil.copy2(file, backup)
    stage = target.with_name('app.asar.window-controls.tmp')
    if stage.exists():
        raise RuntimeError('Existing staging file requires review')
    stage.write_bytes(patched)
    try:
        for name in modules:
            shutil.copy2(HERE / name, app_dir / 'resources/tools' / name)
        os.replace(stage, target)
    except Exception:
        for file, content in originals.items():
            if content is not None:
                file.write_bytes(content)
        raise
    print('Installed global movement, proportional scaling and opacity controls; backups saved.')


if __name__ == '__main__':
    main()
