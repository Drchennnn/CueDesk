"""Add a full-engine eye contact switch beside Start; preserve existing ASAR members."""
import argparse
from datetime import datetime
import importlib.util
import json
import os
import re
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('asar', HERE / 'install.py')
asar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asar)
MAIN = 'out/main/index.js'
PRELOAD = 'out/preload/index.js'
RENDERER = 'out/renderer/assets/index-hyFYaQxP.js'
MARKER = '// meeting-copilot-eye-contact-v1'
V2_MARKER = '// meeting-copilot-eye-contact-v2'


def once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Unsupported application source anchor: ' + before[:100])
    return text.replace(before, after, 1)


def patch_sources(main, preload, renderer):
    main = once(main, '  let windowControls;', '  let windowControls;\n  let eyeContact;')
    main = once(main, '    const { createWindowControls } = require(', '''    const { createEyeContact } = require(path.join(process.resourcesPath, "tools", "eye-contact.cjs"));
    const eyeLog = path.join(electron.app.getPath("userData"), "eye-contact.log");
    eyeContact = createEyeContact({
      userProfile: electron.app.getPath("home"), appData: electron.app.getPath("appData"),
      onChange: state => { if (win && !win.isDestroyed()) win.webContents.send("eye-contact:state", state); },
      log: message => {
        try {
          const fs = require("node:fs");
          if (fs.existsSync(eyeLog) && fs.statSync(eyeLog).size > 262144) fs.renameSync(eyeLog, eyeLog + ".previous");
          fs.appendFileSync(eyeLog, new Date().toISOString() + " " + message + "\\n");
        } catch {}
      }
    });
    const checkEyeSender = event => {
      if (!win || event.sender !== win.webContents) throw new Error("仅主窗口可控制眼神矫正");
    };
    electron.ipcMain.handle("eye-contact:get", event => { checkEyeSender(event); return eyeContact.getState(); });
    electron.ipcMain.handle("eye-contact:set-enabled", (event, enabled) => {
      checkEyeSender(event);
      if (typeof enabled !== "boolean") throw new Error("眼神矫正开关无效");
      return enabled ? eyeContact.start() : eyeContact.stop();
    });
    const { createWindowControls } = require(''')
    main = once(main, '    windowControls?.dispose();', '    windowControls?.dispose();\n    eyeContact?.dispose();')
    preload = once(preload, '  getSettings: () => electron.ipcRenderer.invoke(IPC.settingsGet),', '''  getSettings: () => electron.ipcRenderer.invoke(IPC.settingsGet),
  getEyeContactState: () => electron.ipcRenderer.invoke("eye-contact:get"),
  setEyeContactEnabled: enabled => electron.ipcRenderer.invoke("eye-contact:set-enabled", enabled),
  onEyeContactState: callback => {
    const handler = (_event, state) => callback(state);
    electron.ipcRenderer.on("eye-contact:state", handler);
    return () => electron.ipcRenderer.removeListener("eye-contact:state", handler);
  },''')
    renderer = once(renderer, 'function App() {', (HERE / 'eye-contact-ui.js').read_text(encoding='utf-8') + '\nfunction App() {')
    renderer = once(renderer, '        captureKindForPlatform(window.mc.platform) === "input" && mics.length > 0 &&', '        jsxRuntimeExports.jsx(EyeContactToggle, {}),\n        captureKindForPlatform(window.mc.platform) === "input" && mics.length > 0 &&')
    return {MAIN: (MARKER + '\n' + main).encode('utf-8'), PRELOAD: preload.encode('utf-8'), RENDERER: renderer.encode('utf-8')}


def upgrade_sources(main, preload, renderer):
    if V2_MARKER not in main:
        main = once(main, '      userProfile: electron.app.getPath("home"), appData: electron.app.getPath("appData"),',
                    '      userProfile: electron.app.getPath("home"), appData: electron.app.getPath("appData"),\n'
                    '      settingsFile: path.join(electron.app.getPath("userData"), "eye-contact-settings.json"),')
        main = once(main, 'const checkEyeSender = event => {\n      if (!win || event.sender !== win.webContents)',
                    'const checkEyeSender = event => {\n      if (!win || event.sender !== win.webContents || (event.senderFrame && event.senderFrame !== win.webContents.mainFrame))')
        main = once(main, '    const { createWindowControls } = require(', '''    // eye-contact-v2-ipc
    electron.ipcMain.handle("eye-contact:get-settings", event => { checkEyeSender(event); return eyeContact.getSettings(); });
    electron.ipcMain.handle("eye-contact:set-settings", (event, value) => { checkEyeSender(event); return eyeContact.setSettings(value); });
    electron.ipcMain.handle("eye-contact:restart", event => { checkEyeSender(event); return eyeContact.restart(); });
    electron.ipcMain.handle("eye-contact:diagnostics", event => { checkEyeSender(event); return eyeContact.getDiagnostics(); });
    electron.ipcMain.handle("eye-contact:preview", (event, value) => { checkEyeSender(event); return eyeContact.reportPreview(value); });
    const { createWindowControls } = require(''')
        main = V2_MARKER + '\n' + main
        preload = once(preload, '  getEyeContactState: () => electron.ipcRenderer.invoke("eye-contact:get"),', '''  getEyeContactState: () => electron.ipcRenderer.invoke("eye-contact:get"),
  getEyeContactSettings: () => electron.ipcRenderer.invoke("eye-contact:get-settings"),
  setEyeContactSettings: value => electron.ipcRenderer.invoke("eye-contact:set-settings", value),
  restartEyeContact: () => electron.ipcRenderer.invoke("eye-contact:restart"),
  getEyeContactDiagnostics: () => electron.ipcRenderer.invoke("eye-contact:diagnostics"),
  reportEyeContactPreview: value => electron.ipcRenderer.invoke("eye-contact:preview", value),''')
    begin, end = '// eye-contact-ui-v2-begin', '// eye-contact-ui-v2-end'
    ui = '\n'.join((HERE / name).read_text('utf-8') for name in ['eye-contact-preview.js', 'eye-contact-ui.js', 'eye-contact-settings-ui.js'])
    replacement = begin + '\n' + ui + '\n' + end
    if begin in renderer:
        start = renderer.index(begin)
        finish = renderer.index(end, start) + len(end)
    else:
        start = renderer.index('function eyeContactStatus(') if 'function eyeContactStatus(' in renderer else renderer.index('function EyeContactToggle() {')
        finish = renderer.index('\nfunction App() {', start)
        old = renderer[start:finish]
        names = re.findall(r'function\s+([A-Za-z_$][\w$]*)\s*\(', old)
        if set(names) - {'eyeContactStatus', 'EyeContactToggle', 'toggle'} or not old.rstrip().endswith('}'):
            raise ValueError('Unexpected code between eye contact toggle and App; refusing to replace')
    renderer = renderer[:start] + replacement + renderer[finish:]
    tab_marker = '// eye-contact-settings-tab-v2'
    if tab_marker not in renderer:
        anchor = "  const root = reactExports.useRef(null);\n  reactExports.useEffect(() => {\n    const previous = document.activeElement;"
        renderer = once(renderer, anchor, "  const root = reactExports.useRef(null);\n"
                        "  // eye-contact-settings-tab-v2\n"
                        "  tabs = [...tabs, {id:'camera',title:'摄像头与眼神矫正',description:'输入设备、画面处理、预览和诊断。',content:[h(EyeContactSettings,{active:active==='camera'})]}];\n"
                        "  reactExports.useEffect(() => {\n    const previous = document.activeElement;")
    return {MAIN: main.encode('utf-8'), PRELOAD: preload.encode('utf-8'), RENDERER: renderer.encode('utf-8')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app_dir', nargs='?', default=str(Path(os.environ['LOCALAPPDATA']) / 'Programs/meeting-copilot'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    app_dir = Path(args.app_dir).resolve()
    archive_path = app_dir / 'resources/app.asar'
    module_path = app_dir / 'resources/tools/eye-contact.cjs'
    archive = archive_path.read_bytes()
    h, o = asar.read_header(archive)
    package = json.loads(asar.read_member(archive, h, o, 'package.json'))
    if package.get('version') != '0.2.0-beta.1':
        raise RuntimeError('This patch supports MeetingCopilot 0.2.0-beta.1 only')
    sources = [asar.read_member(archive, h, o, name).decode('utf-8') for name in [MAIN, PRELOAD, RENDERER]]
    already = MARKER in sources[0]
    initial = dict(zip([MAIN, PRELOAD, RENDERER], [s.encode('utf-8') for s in sources])) if already else patch_sources(*sources)
    replacements = upgrade_sources(*(initial[name].decode('utf-8') for name in [MAIN, PRELOAD, RENDERER]))
    check = HERE / 'analysis/eye-contact-build-check'
    check.mkdir(parents=True, exist_ok=True)
    for member, content in replacements.items():
        filename = check / ('main.cjs' if member == MAIN else 'preload.cjs' if member == PRELOAD else 'renderer.mjs')
        filename.write_bytes(content)
        subprocess.run(['node', '--check', str(filename)], check=True)
    subprocess.run(['node', '--check', str(HERE / 'eye-contact.cjs')], check=True)
    patched = asar.replace_members(archive, replacements)
    nh, no = asar.read_header(patched)
    for name, content in replacements.items():
        if asar.read_member(patched, nh, no, name) != content:
            raise RuntimeError('Patched ASAR readback failed: ' + name)
    # Verify every untouched packed member, not only the newly written sources.
    def walk(tree, prefix=''):
        for name, entry in tree.get('files', {}).items():
            relative = prefix + name
            if 'files' in entry:
                yield from walk(entry, relative + '/')
            elif not entry.get('unpacked') and 'offset' in entry:
                yield relative
    for name in walk(h):
        if name not in replacements and asar.read_member(archive, h, o, name) != asar.read_member(patched, nh, no, name):
            raise RuntimeError('Untouched member changed: ' + name)
    if args.check:
        print('Compatible: syntax, ASAR readback and untouched members verified; installed files unchanged.')
        return
    asar.require_closed(app_dir)
    backup = app_dir / 'resources' / ('eye-contact-backup-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(exist_ok=False)
    shutil.copy2(archive_path, backup / 'app.asar')
    if module_path.exists():
        shutil.copy2(module_path, backup / 'eye-contact.cjs')
    (backup / 'manifest.json').write_text(json.dumps({'archive_sha256': asar.sha256(archive), 'module_existed': module_path.exists()}, indent=2), encoding='utf-8')
    stage = archive_path.with_name('app.asar.eye-contact.tmp')
    if stage.exists():
        raise RuntimeError('Existing staging archive requires review')
    stage.write_bytes(patched)
    original_module = module_path.read_bytes() if module_path.exists() else None
    try:
        module_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(HERE / 'eye-contact.cjs', module_path)
        os.replace(stage, archive_path)
        installed = archive_path.read_bytes()
        ih, io = asar.read_header(installed)
        for name, content in replacements.items():
            if asar.read_member(installed, ih, io, name) != content:
                raise RuntimeError('Installed ASAR verification failed: ' + name)
        if module_path.read_bytes() != (HERE / 'eye-contact.cjs').read_bytes():
            raise RuntimeError('Installed controller verification failed')
    except Exception:
        archive_path.write_bytes(archive)
        if original_module is not None:
            module_path.write_bytes(original_module)
        elif module_path.exists():
            module_path.unlink()
        raise
    (check / 'installed-backup.txt').write_text(str(backup), encoding='utf-8')
    print('Installed camera settings, lifecycle, preview and diagnostics. Backup: ' + str(backup))


if __name__ == '__main__':
    main()
