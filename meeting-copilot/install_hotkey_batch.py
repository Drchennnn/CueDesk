"""Replace file-upload batch mode with capture hotkeys and persistent screenshots."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
from datetime import datetime

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('base', HERE / 'install_written_image_batch.py')
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
once = base.once

def patch(main, renderer, preload):
    if '// meeting-copilot-hotkey-batch-v2' in main:
        raise ValueError('Hotkey batch v2 is already installed')
    main = once(main, 'captureModule.createCaptureService({ helperPath:', 'captureModule.createCaptureService({ saveDirectory: () => path.join(electron.app.getPath("pictures"), "MeetingCopilot"), helperPath:')
    main = once(main, '      onChange: (preferences) => win?.webContents.send("window-controls:state", preferences)', '      onAction: (action) => win?.webContents.send("screenshot-batch:action", action),\n      onChange: (preferences) => win?.webContents.send("window-controls:state", preferences)')
    a = main.index('    electron.ipcMain.handle("written-images:pick"')
    b = main.index('    electron.ipcMain.handle("window-controls:get"', a)
    main = main[:a] + '''    electron.ipcMain.handle("screenshots:open-folder", async (event) => {
      if (!win || event.sender !== win.webContents) throw new Error("仅主窗口可打开截图目录");
      const directory = path.join(electron.app.getPath("pictures"), "MeetingCopilot");
      await fs.promises.mkdir(directory, { recursive: true });
      const error = await electron.shell.openPath(directory);
      if (error) throw new Error(error);
      return directory;
    });
''' + main[b:]
    main = '// meeting-copilot-hotkey-batch-v2\n' + main
    preload = once(preload, '  pickWrittenImages: () => electron.ipcRenderer.invoke("written-images:pick"),', '''  openScreenshotFolder: () => electron.ipcRenderer.invoke("screenshots:open-folder"),
  onScreenshotBatchAction: (cb) => {
    const listener = (_e, action) => cb(action);
    electron.ipcRenderer.on("screenshot-batch:action", listener);
    return () => electron.ipcRenderer.removeListener("screenshot-batch:action", listener);
  },
  onWindowControlsState: (cb) => {
    const listener = (_e, value) => cb(value);
    electron.ipcRenderer.on("window-controls:state", listener);
    return () => electron.ipcRenderer.removeListener("window-controls:state", listener);
  },''')
    a = renderer.index('function WindowControlsSettings(')
    b = renderer.index('\nfunction ', a + 1)
    renderer = renderer[:a] + (HERE / 'window-controls-ui.js').read_text('utf8') + renderer[b:]
    a = renderer.index('function WrittenCompactView('); b = renderer.index('function App()', a)
    view = (HERE / 'written-window-ui.js').read_text('utf8')
    renderer = renderer[:a] + (HERE / 'screenshot-batch.js').read_text('utf8') + '\n' + (HERE / 'screenshot-batch-ui.js').read_text('utf8') + '\n' + view[view.index('function WrittenCompactView('):] + '\n' + renderer[b:]
    a = renderer.index('  const writtenBatchRef ='); b = renderer.index('  reactExports.useEffect(', a)
    renderer = renderer[:a] + '''  const [batchState, setBatchState] = reactExports.useState({ enabled: false, images: [], question: "", busy: false, message: "" });
  const batchControllerRef = reactExports.useRef(null);
  const sendShotRef = reactExports.useRef(askShot);
  sendShotRef.current = askShot;
  if (!batchControllerRef.current) batchControllerRef.current = createScreenshotBatch({
    capture: mode => window.mc.pickRegion(mode),
    send: (...args) => sendShotRef.current(...args),
    isWritten: () => settingsRef.current?.multimodal?.mode === "written",
    getSession: () => currentIdRef.current,
    onChange: setBatchState
  });
  const batchController = batchControllerRef.current;
  const doRegionShot = (mode = "full", question = "") => batchController.take(mode, question);
''' + renderer[b:]
    renderer = once(renderer, 'const offShot = window.mc.onShotHotkey((mode) => { if (!doWrittenBatch()) void doRegionShot(mode); });', '''const offShot = window.mc.onShotHotkey((mode) => void batchController.take(mode));
    const offBatch = window.mc.onScreenshotBatchAction(action => {
      if (action === "toggleBatch") batchController.toggle();
      if (action === "sendBatch") batchController.sendBatch();
    });''')
    renderer = once(renderer, '      offShot();', '      offShot();\n      offBatch();')
    renderer = once(renderer, '      batchRef: writtenBatchRef, onUploadImages: () => window.mc.pickWrittenImages()', '      batch: batchState, batchController')
    renderer = once(renderer, '  onShotAsk\n})', '  onShotAsk, onCapture, batch, batchController\n})')
    renderer = once(renderer, '''      const img = await window.mc.pickRegion(mode);
      if (!img) return;
      if (inputRef.current) inputRef.current.value = "";
      onShotAsk(q, img);''', '''      if (await onCapture(mode, q)) {
        if (inputRef.current) inputRef.current.value = "";
      }''')
    renderer = once(renderer, 'className: "pane pane-answer", children: [', 'className: "pane pane-answer", children: [\n    writtenMode && jsxRuntimeExports.jsx(ScreenshotBatchPanel, { batch, controller: batchController }),')
    renderer = once(renderer, '          onShotAsk: askShot', '          onShotAsk: askShot, onCapture: doRegionShot, batch: batchState, batchController')
    return dict(zip([base.MAIN, base.RENDERER, base.PRELOAD], [main.encode(), renderer.encode(), preload.encode()]))

def main_cli():
    import argparse
    parser = argparse.ArgumentParser(); parser.add_argument('--check', action='store_true'); args = parser.parse_args()
    app = Path(os.environ['LOCALAPPDATA']) / 'Programs/meeting-copilot'
    archive = app / 'resources/app.asar'; original = archive.read_bytes()
    h, o = base.asar.read_header(original)
    replacements = patch(*(base.asar.read_member(original, h, o, n).decode() for n in [base.MAIN, base.RENDERER, base.PRELOAD]))
    stage_dir = HERE.parent / 'work/hotkey-batch-check'; stage_dir.mkdir(exist_ok=True)
    for n, content in replacements.items():
        file = stage_dir / ('renderer.mjs' if n == base.RENDERER else 'main.cjs' if n == base.MAIN else 'preload.cjs')
        file.write_bytes(content); subprocess.run(['node', '--check', str(file)], check=True)
    patched = base.asar.replace_members(original, replacements)
    h, o = base.asar.read_header(patched)
    for n, content in replacements.items():
        if base.asar.read_member(patched, h, o, n) != content: raise RuntimeError('ASAR readback mismatch')
    if args.check: print('Hotkey batch: syntax and ASAR validation passed'); return
    base.asar.require_closed(app)
    backup = app / 'resources' / ('before-hotkey-batch-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(); shutil.copy2(archive, backup / 'app.asar')
    modules = ['quiet-capture.cjs', 'window-controls.cjs']
    for name in modules: shutil.copy2(app / 'resources/tools' / name, backup / name)
    try:
        for name in modules: shutil.copy2(HERE / name, app / 'resources/tools' / name)
        staged = archive.with_suffix('.hotkey-batch.tmp'); staged.write_bytes(patched); os.replace(staged, archive)
    except Exception:
        for name in modules: shutil.copy2(backup / name, app / 'resources/tools' / name)
        shutil.copy2(backup / 'app.asar', archive)
        raise
    print('Installed hotkey batch v2. Backup:', backup)

if __name__ == '__main__': main_cli()
