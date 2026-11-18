"""Install project fallback and material status without replacing other knowledge modules."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import install as archive

HERE = Path(__file__).resolve().parent
MEMBERS = ['out/main/index.js', 'out/renderer/assets/index-hyFYaQxP.js']
MODULES = ['library.cjs', 'dialogue.cjs', 'evidence.cjs', 'material-status.cjs']


def replace_once(source, before, after):
    if source.count(before) != 1:
        raise ValueError('Expected unique patch anchor: ' + before[:90])
    return source.replace(before, after, 1)


def patch(main, renderer):
    start = '// project-material-status-start\n'
    end = '// project-material-status-end\n'
    component = start + (HERE / 'material-status-ui.js').read_text('utf-8-sig') + '\n' + end
    if start in renderer:
        begin = renderer.index(start)
        finish = renderer.index(end, begin) + len(end)
        renderer = renderer[:begin] + component + renderer[finish:]
    else:
        renderer = replace_once(renderer, 'function App() {', component + 'function App() {')
    marker = '    showUpgradeNotice && /* @__PURE__ */'
    insertion = '    settings?.multimodal?.mode !== "written" && jsxRuntimeExports.jsx(InterviewMaterialStatus, { refreshKey: String(capturing) + String(showSettings), onOpenSettings: () => setShowSettings(true) }),\n'
    if insertion not in renderer:
        renderer = replace_once(renderer, marker, insertion + marker)
    before_save = 'result => setState(current => ({ ...current, roles: result.roles, files: result.files, warning: result.warning })))'
    after_save = "result => { setState(current => ({ ...current, roles: result.roles, files: result.files, warning: result.warning })); window.dispatchEvent(new Event('mc-library-updated')); })"
    if before_save in renderer:
        renderer = replace_once(renderer, before_save, after_save)
    if after_save not in renderer:
        raise ValueError('Missing library-save notification')
    before = '(interviewLibrary.enabled && multimodalRouter.getPublic().mode === "interview" ?'
    after = '(multimodalRouter.getPublic().mode === "interview" ?'
    if before in main:
        main = replace_once(main, before, after)
    if after not in main:
        raise ValueError('Missing interview screenshot route')
    # Apply the same conditional-reference policy to screenshot result parsing.
    if 'shotAnswerPolicy' not in main:
        main = replace_once(main, 'let shotEvidence, shotBlockedUnknown;', 'let shotEvidence, shotBlockedUnknown, shotAnswerPolicy;')
        main = replace_once(main, 'shotBlockedUnknown = messages.blockedUnknown;', 'shotBlockedUnknown = messages.suggestionOnly ? null : messages.blockedUnknown; shotAnswerPolicy = messages.answerPolicy;')
        main = replace_once(main, '.parseAnswer(shotBlockedUnknown || text, shotEvidence, true)', '.parseAnswer(shotBlockedUnknown || text, shotEvidence, true, shotAnswerPolicy)')
    return main, renderer


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--rollback', type=Path)
    args = parser.parse_args()
    app = Path(os.environ['LOCALAPPDATA']) / 'Programs/meeting-copilot'
    resources = app / 'resources'
    target = resources / 'app.asar'
    modules = resources / 'tools/knowledge-v2'
    if args.rollback:
        backup = args.rollback.resolve()
        if backup.parent != resources.resolve() or not backup.name.startswith('before-project-fallback-'):
            raise ValueError('Unexpected rollback directory')
        archive.require_closed(app)
        shutil.copy2(backup / 'app.asar', target)
        for name in MODULES:
            original = backup / 'knowledge-v2' / name
            if original.exists():
                shutil.copy2(original, modules / name)
            elif (modules / name).exists():
                (modules / name).unlink()
        print('Rolled back project fallback patch')
        return
    original = target.read_bytes()
    header, offset = archive.read_header(original)
    sources = [archive.read_member(original, header, offset, name).decode('utf-8') for name in MEMBERS]
    result = patch(*sources)
    if patch(*result) != result:
        raise ValueError('Patch is not idempotent')
    stage = HERE.parent / 'work/project-fallback'
    stage.mkdir(parents=True, exist_ok=True)
    for name, source in zip(['main.cjs', 'renderer.mjs'], result):
        file = stage / name
        file.write_text(source, encoding='utf-8')
        subprocess.run(['node', '--check', str(file)], check=True)
    updated = archive.replace_members(original, dict(zip(MEMBERS, [source.encode() for source in result])))
    header, offset = archive.read_header(updated)
    for name, source in zip(MEMBERS, result):
        assert archive.read_member(updated, header, offset, name) == source.encode()
    if args.check:
        print('ASAR syntax, patch anchors, idempotence and readback passed')
        return
    archive.require_closed(app)
    backup = resources / ('before-project-fallback-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    (backup / 'knowledge-v2').mkdir(parents=True)
    shutil.copy2(target, backup / 'app.asar')
    for name in MODULES:
        if (modules / name).exists():
            shutil.copy2(modules / name, backup / 'knowledge-v2' / name)
    try:
        for name in MODULES:
            shutil.copy2(HERE / 'v2' / name, modules / name)
        pending = target.with_suffix('.project-fallback.tmp')
        pending.write_bytes(updated)
        os.replace(pending, target)
    except Exception:
        shutil.copy2(backup / 'app.asar', target)
        for name in MODULES:
            if (backup / 'knowledge-v2' / name).exists():
                shutil.copy2(backup / 'knowledge-v2' / name, modules / name)
            elif (modules / name).exists():
                (modules / name).unlink()
        raise
    manifest = {'backup': str(backup), 'module_hashes': {name: hashlib.sha256((modules / name).read_bytes()).hexdigest() for name in MODULES}, 'archive_sha256': hashlib.sha256(updated).hexdigest()}
    (stage / 'installation.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == '__main__':
    main()
