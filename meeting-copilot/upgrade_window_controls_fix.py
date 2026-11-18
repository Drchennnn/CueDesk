"""Upgrade the installed window-controls patch for wrapped code and reliable opacity."""
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


def replace_once(text, old, new):
    if old not in text:
        raise ValueError('Installed renderer does not contain expected code')
    return text.replace(old, new, 1)


def main():
    app = Path(os.environ['LOCALAPPDATA']) / 'Programs/meeting-copilot'
    target = app / 'resources/app.asar'
    archive = target.read_bytes()
    header, start = asar.read_header(archive)
    main_source = asar.read_member(archive, header, start, MAIN).decode('utf8')
    renderer = asar.read_member(archive, header, start, RENDERER).decode('utf8')
    if '// meeting-copilot-window-controls-v1' not in main_source:
        raise RuntimeError('Window-controls patch is not installed')
    if "overflowX: 'auto', whiteSpace: 'pre', tabSize: 4" in renderer:
        renderer = replace_once(renderer, "overflowX: 'auto', whiteSpace: 'pre', tabSize: 4", "overflowX: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', tabSize: 4")
    start = renderer.index('function WindowControlsSettings()')
    end = renderer.index('function SettingsPanel(', start)
    renderer = renderer[:start] + (HERE / 'window-controls-ui.js').read_text(encoding='utf8') + '\n' + renderer[end:]
    check = HERE.parent / 'work/window-controls/fix-check'
    check.mkdir(parents=True, exist_ok=True)
    out = check / 'renderer.mjs'; out.write_text(renderer, encoding='utf8')
    subprocess.run(['node', '--check', str(out)], check=True)
    patched = asar.replace_member(archive, RENDERER, renderer.encode('utf8'))
    ph, ps = asar.read_header(patched)
    if asar.read_member(patched, ph, ps, RENDERER) != renderer.encode('utf8'):
        raise RuntimeError('ASAR readback failed')
    asar.require_closed(app)
    backup = target.with_name('app.asar.before-window-controls-fix.bak')
    if not backup.exists(): shutil.copy2(target, backup)
    for name in ['window-controls.cjs', 'written-window.cjs']:
        dst = app / 'resources/tools' / name
        old = dst.with_name(dst.name + '.before-window-controls-fix.bak')
        if not old.exists(): shutil.copy2(dst, old)
        shutil.copy2(HERE / name, dst)
    stage = target.with_name('app.asar.window-controls-fix.tmp')
    stage.write_bytes(patched)
    os.replace(stage, target)
    print('Updated installed code wrapping and opacity behavior.')


if __name__ == '__main__': main()
