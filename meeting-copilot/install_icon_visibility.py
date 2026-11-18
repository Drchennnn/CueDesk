"""Hide MeetingCopilot taskbar/tray icons, preserving a reversible backup."""
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
MARKER = '// meeting-copilot-hide-shell-icons-v1'


def once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Unexpected source: ' + before[:100])
    return text.replace(before, after, 1)


def patch_sources(main, module):
    main = once(main, '    skipTaskbar: false,', '    skipTaskbar: true,')
    main = once(main, '  create(options) {\n    if (this.tray) return true;',
                '  create(options) {\n    if (process.platform === "win32") return false;\n    if (this.tray) return true;')
    main = once(main, '    win.on("show", () => {',
                '    win.on("show", () => {\n      win.setSkipTaskbar(true);')
    module = once(module, '    win.setFocusable(!locked);',
                  '    win.setFocusable(!locked);\n    win.setSkipTaskbar(true); // Reapply after Windows focusability changes.')
    return MARKER + '\n' + main, module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app_dir', nargs='?', default=str(Path(os.environ['LOCALAPPDATA']) / 'Programs/meeting-copilot'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    app_dir = Path(args.app_dir).resolve()
    target = app_dir / 'resources/app.asar'
    module_path = app_dir / 'resources/tools/written-window.cjs'
    original = target.read_bytes()
    module_original = module_path.read_bytes()
    header, offset = asar.read_header(original)
    source = asar.read_member(original, header, offset, MAIN).decode('utf8')
    if MARKER in source:
        if 'win.setSkipTaskbar(true); // Reapply' not in module_original.decode('utf8'):
            raise RuntimeError('Incomplete installation: module differs')
        print('Icon visibility patch already installed.')
        return
    patched_source, patched_module = patch_sources(source, module_original.decode('utf8'))
    check = HERE.parent / 'work/icon-visibility'
    check.mkdir(parents=True, exist_ok=True)
    for name, content in [('patched-main.cjs', patched_source), ('patched-written-window.cjs', patched_module)]:
        file = check / name
        file.write_text(content, encoding='utf8')
        subprocess.run(['node', '--check', str(file)], check=True)
    patched = asar.replace_member(original, MAIN, patched_source.encode('utf8'))
    h, o = asar.read_header(patched)
    assert asar.read_member(patched, h, o, MAIN) == patched_source.encode('utf8')
    if args.check:
        print('Compatible; syntax and ASAR readback passed. No installed files changed.')
        return
    asar.require_closed(app_dir)
    backups = [(target, original), (module_path, module_original)]
    for file, content in backups:
        backup = file.with_name(file.name + '.before-hide-icons.bak')
        if backup.exists() and backup.read_bytes() != content:
            raise RuntimeError('Different backup already exists: ' + str(backup))
    for file, _ in backups:
        backup = file.with_name(file.name + '.before-hide-icons.bak')
        if not backup.exists():
            shutil.copy2(file, backup)
    stage = target.with_name('app.asar.hide-icons.tmp')
    if stage.exists():
        raise RuntimeError('Existing staging file requires inspection')
    stage.write_bytes(patched)
    try:
        module_path.write_text(patched_module, encoding='utf8', newline='\n')
        os.replace(stage, target)
    except Exception:
        module_path.write_bytes(module_original)
        raise
    print('Installed. Backups: app.asar.before-hide-icons.bak and written-window.cjs.before-hide-icons.bak')


if __name__ == '__main__':
    main()
