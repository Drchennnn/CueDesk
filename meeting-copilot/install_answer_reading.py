"""Clean answer references and add persistent, responsive answer typography."""
import argparse, datetime, os, pathlib, shutil, subprocess
import install as archive

HERE = pathlib.Path(__file__).resolve().parent
MEMBER = 'out/renderer/assets/index-hyFYaQxP.js'

def once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('Unexpected source: ' + old[:100])
    return text.replace(old, new, 1)

def patch(text):
    if '// answer-reading-v1' in text:
        return text
    start = text.index('function AnswerSession(')
    end = text.index('\nconst MAX_TURNS', start)
    view = text[start:end]
    # Remove exact JSX elements, including their children, rather than matching nested braces.
    for slot in ['resume', 'jd']:
        anchor = view.index('          className: ' + slot + 'Chars')
        a = view.rfind('/* @__PURE__ */ jsxRuntimeExports.jsxs(', 0, anchor)
        b = view.index('\n      ),', anchor) + len('\n      ),')
        view = view[:a] + view[b:]
        a = view.index('      ' + slot + 'Chars > 0 &&')
        b = view.index('\n', a)
        view = view[:a] + view[b:]
    view = once(view, 'resumeChars === 0 && t.answer.emptyKbHint', 'null')
    view = once(view, 'navigator.clipboard.writeText(turn.text)', 'navigator.clipboard.writeText(writtenMode ? turn.text : cleanAnswerReferences(turn.text))')
    view = once(view, ': turn.text) ||', ': cleanAnswerReferences(turn.text)) ||')
    text = text[:start] + view + text[end:]
    text = once(text, 'const display = value => onlyOptions ? compactWrittenAnswer(value) : value;', 'const display = value => onlyOptions ? compactWrittenAnswer(value) : cleanAnswerReferences(value);')
    start = text.index('/* @__PURE__ */ jsxRuntimeExports.jsxs("select", { value: fontScale,')
    end = text.index('\n      ] })', start) + len('\n      ] })')
    text = text[:start] + 'jsxRuntimeExports.jsx(AnswerReadingSettings, {})' + text[end:]
    return (HERE / 'answer-reading-ui.js').read_text('utf8') + '\n' + text

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--check', action='store_true'); args = parser.parse_args()
    app = pathlib.Path(os.environ['LOCALAPPDATA']) / 'Programs/meeting-copilot'
    target = app / 'resources/app.asar'
    original = target.read_bytes(); header, offset = archive.read_header(original)
    renderer = patch(archive.read_member(original, header, offset, MEMBER).decode('utf8'))
    out = HERE.parent / 'work/reading-update'; out.mkdir(exist_ok=True)
    check = out / 'patched.mjs'; check.write_text(renderer, 'utf8')
    subprocess.run(['node', '--check', str(check)], check=True)
    subprocess.run(['node', '--check', str(HERE / 'interview-library.cjs')], check=True)
    changed = archive.replace_member(original, MEMBER, renderer.encode('utf8'))
    h, o = archive.read_header(changed)
    assert archive.read_member(changed, h, o, MEMBER) == renderer.encode('utf8')
    assert patch(renderer) == renderer
    if args.check:
        print('Syntax, idempotence and archive readback passed'); return
    archive.require_closed(app)
    backup = app / 'resources' / ('before-answer-reading-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(); shutil.copy2(target, backup / 'app.asar')
    library = app / 'resources/tools/interview-library.cjs'
    shutil.copy2(library, backup / library.name)
    stage = target.with_suffix('.reading.tmp'); stage.write_bytes(changed)
    try:
        shutil.copy2(HERE / library.name, library)
        os.replace(stage, target)
    except Exception:
        shutil.copy2(backup / library.name, library)
        raise
    print('Installed; backup:', backup)

if __name__ == '__main__': main()
