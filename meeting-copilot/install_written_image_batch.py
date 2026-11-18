"""Add optional multi-image written questions to the installed MeetingCopilot."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
spec = importlib.util.spec_from_file_location('asar', HERE / 'install.py')
asar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asar)
MAIN = 'out/main/index.js'
RENDERER = 'out/renderer/assets/index-hyFYaQxP.js'
PRELOAD = 'out/preload/index.js'
MARKER = '// meeting-copilot-written-image-batch-v1'


def once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('Unexpected installed source: ' + old[:100])
    return text.replace(old, new, 1)


def patch(main, renderer, preload):
    if MARKER in main:
        raise ValueError('Multi-image mode is already installed')
    if '// meeting-copilot-window-controls-v1' not in main:
        raise ValueError('Expected installed window-controls build')
    main = once(main, '    electron.ipcMain.handle("window-controls:get", (event) => {', '''    electron.ipcMain.handle("written-images:pick", async (event) => {
      if (!win || event.sender !== win.webContents) throw new Error("仅主窗口可选择截图");
      const result = await electron.dialog.showOpenDialog(win, {
        title: "选择笔试截图（最多 12 张）",
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
        properties: ["openFile", "multiSelections"]
      });
      if (result.canceled) return [];
      const files = result.filePaths.slice(0, 12);
      let total = 0;
      return files.map((file) => {
        const ext = path.extname(file).toLowerCase();
        const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" })[ext];
        if (!mime) throw new Error("仅支持 PNG、JPEG、WebP 图片");
        const bytes = fs.readFileSync(file);
        total += bytes.length;
        if (bytes.length > 12 * 1024 * 1024 || total > 48 * 1024 * 1024) throw new Error("截图总大小超过限制（单张 12 MiB，总计 48 MiB）");
        return { name: path.basename(file), dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
      });
    });
    electron.ipcMain.handle("window-controls:get", (event) => {''')
    old = 'const imgP = (payload.imageDataUrl ? Promise.resolve(payload.imageDataUrl) : captureQuietScreenshot()).then((dataUrl) => {'
    new = 'const imgP = (Array.isArray(payload.imageDataUrls) && payload.imageDataUrls.length ? Promise.resolve(payload.imageDataUrls) : payload.imageDataUrl ? Promise.resolve([payload.imageDataUrl]) : captureQuietScreenshot().then(dataUrl => dataUrl ? [dataUrl] : null)).then((dataUrls) => {'
    main = once(main, old, new)
    main = once(main, '''          if (!dataUrl) throw Object.assign(new Error("已取消截图"), { captureCancelled: true });
          return dataUrl;
        });''', '''          if (!dataUrls?.length) throw Object.assign(new Error("已取消截图"), { captureCancelled: true });
          if (dataUrls.length > 12 || dataUrls.some(url => typeof url !== "string" || !/^data:image\\/(?:png|jpeg|webp);base64,/.test(url))) throw new Error("截图数据无效或数量超限");
          return dataUrls;
        });''')
    main = once(main, '''          (dataUrl) => multimodalRouter.chat(
            multimodalRouter.buildMessages({
              ...payload, imageDataUrl: dataUrl, answerLang: settings.data.llm.answerLang, background: payload.background || knowledge.text,
              originalMessages: buildVisionMessages(payload.question || "", dataUrl, payload.background || knowledge.text),
              originalPersona: buildVisionMessages("", dataUrl, "")[0].content
            }, "shot"),''', '''          (dataUrls) => multimodalRouter.chat(
            multimodalRouter.buildMessages({
              ...payload, imageDataUrls: dataUrls, imageDataUrl: dataUrls[0], answerLang: settings.data.llm.answerLang, background: payload.background || knowledge.text,
              originalMessages: buildVisionMessages(payload.question || "", dataUrls[0], payload.background || knowledge.text),
              originalPersona: buildVisionMessages("", dataUrls[0], "")[0].content
            }, "shot"),''')
    main = MARKER + '\n' + main
    preload = once(preload, '  pickRegion: (mode = "full") => electron.ipcRenderer.invoke(IPC.regionPick, mode === "region" ? "region" : "full"),', '  pickRegion: (mode = "full") => electron.ipcRenderer.invoke(IPC.regionPick, mode === "region" ? "region" : "full"),\n  pickWrittenImages: () => electron.ipcRenderer.invoke("written-images:pick"),')
    renderer = once(renderer, '  const askShot = reactExports.useCallback(\n    (question, imageDataUrl) => {', '  const askShot = reactExports.useCallback(\n    (question, imageDataUrl, imageDataUrls) => {')
    renderer = once(renderer, 'window.mc.shotAsk({ requestId, question, background, imageDataUrl });', 'window.mc.shotAsk({ requestId, question, background, imageDataUrl, imageDataUrls });')
    renderer = once(renderer, '  const doRegionShot = reactExports.useCallback(async (mode = "full") => {', '''  const writtenBatchRef = reactExports.useRef({ enabled: false, images: [], question: "" });
  const doWrittenBatch = reactExports.useCallback(() => {
    const batch = writtenBatchRef.current;
    if (!batch.enabled || settingsRef.current?.multimodal?.mode !== "written") return false;
    if (!batch.images.length) { setWrittenError("请先添加截图，再按截图快捷键发送"); return true; }
    if (!currentIdRef.current) return true;
    askShot(batch.question || "", void 0, batch.images.map(image => image.dataUrl));
    batch.clear?.();
    setWrittenError("");
    writtenBatchRef.current = { enabled: true, images: [], question: batch.question };
    return true;
  }, [askShot]);
  const doRegionShot = reactExports.useCallback(async (mode = "full") => {''')
    renderer = once(renderer, 'const offShot = window.mc.onShotHotkey((mode) => void doRegionShot(mode));', 'const offShot = window.mc.onShotHotkey((mode) => { if (!doWrittenBatch()) void doRegionShot(mode); });')
    start = renderer.index('function WrittenCompactView(')
    end = renderer.index('function App()', start)
    compact = (HERE / 'written-window-ui.js').read_text(encoding='utf8')
    compact = compact[compact.index('function WrittenCompactView('):]
    compact = once(compact, "      hs('label', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }, children: ['字号 '", "      h(WindowControlsSettings, {}),\n      hs('label', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }, children: ['字号 '")
    renderer = renderer[:start] + compact + '\n' + renderer[end:]
    renderer = once(renderer, '      onSettings: async () => { if (await patchWrittenWindow({ enabled: false })) setShowSettings(true); }', '      onSettings: async () => { if (await patchWrittenWindow({ enabled: false })) setShowSettings(true); },\n      batchRef: writtenBatchRef, onUploadImages: () => window.mc.pickWrittenImages()')
    return {MAIN: main.encode(), RENDERER: renderer.encode(), PRELOAD: preload.encode()}


def main_cli():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    app = Path(os.environ['LOCALAPPDATA']) / 'Programs/meeting-copilot'
    archive_path = app / 'resources/app.asar'
    archive = archive_path.read_bytes()
    header, offset = asar.read_header(archive)
    members = [MAIN, RENDERER, PRELOAD]
    sources = [asar.read_member(archive, header, offset, member).decode('utf8') for member in members]
    replacements = patch(*sources)
    check = ROOT / 'work/written-image-batch-check'; check.mkdir(parents=True, exist_ok=True)
    for member, content in replacements.items():
        file = check / ('main.cjs' if member == MAIN else 'renderer.mjs' if member == RENDERER else 'preload.cjs')
        file.write_bytes(content); subprocess.run(['node', '--check', str(file)], check=True)
    patched = asar.replace_members(archive, replacements)
    h, o = asar.read_header(patched)
    for member, content in replacements.items():
        if asar.read_member(patched, h, o, member) != content: raise RuntimeError('ASAR readback failed')
    if args.check: print('Compatible: syntax and ASAR checks passed.'); return
    asar.require_closed(app)
    backup = archive_path.with_name('app.asar.before-written-image-batch.bak')
    if backup.exists() and backup.read_bytes() != archive: raise RuntimeError('Different backup already exists')
    if not backup.exists(): shutil.copy2(archive_path, backup)
    for name, content in [('window-controls.cjs', (HERE / 'window-controls.cjs').read_bytes()), ('multimodal-router.cjs', (HERE / 'multimodal-router.cjs').read_bytes())]:
        dest = app / 'resources/tools' / name if name == 'window-controls.cjs' else app / 'resources/multimodal' / name
        old = dest.with_name(dest.name + '.before-written-image-batch.bak')
        if not old.exists(): shutil.copy2(dest, old)
        shutil.copy2(HERE / name, dest)
    stage = archive_path.with_name('app.asar.written-image-batch.tmp')
    if stage.exists(): raise RuntimeError('Existing staging file requires inspection')
    stage.write_bytes(patched); os.replace(stage, archive_path)
    print('Installed multi-image written-question mode.')


if __name__ == '__main__': main_cli()
