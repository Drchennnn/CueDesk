"""Unify scrollbars, remove nested answer scrollers, and add precise reading controls."""
import pathlib, os, subprocess, shutil, datetime, argparse
import install as archive_tools

HERE = pathlib.Path(__file__).resolve().parent
MEMBER = 'out/renderer/assets/index-hyFYaQxP.js'

def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Unexpected source shape: ' + before[:110])
    return text.replace(before, after, 1)

def patch(renderer):
    if '// reading-scroll-v1' in renderer:
        raise ValueError('Reading scroll patch already installed')
    start = renderer.index('function WrittenAnswerContent(')
    end = renderer.index('\nfunction ', start + 10)
    answer = renderer[start:end]
    answer = replace_once(answer, "  const [expanded, setExpanded] = reactExports.useState(false);\n", '')
    answer = replace_once(answer, "  const long = text.length > 400 || text.split('\\n').length > 12;\n", '')
    answer = replace_once(answer, "h('div', { style: { maxHeight: expanded ? 'none' : compact ? 180 : 280, overflow: 'auto',", "h('div', { className: 'written-answer-body', style: {")
    answer = replace_once(answer, ",\n      long && h('button', { className: 'btn btn-sm', type: 'button', style: { fontSize: 10, padding: '0 4px' }, onClick: () => setExpanded(v => !v), children: expanded ? '收起' : '展开完整内容' })", '')
    renderer = renderer[:start] + answer + renderer[end:]
    start = renderer.index('function WrittenCompactView(')
    end = renderer.index('\nfunction ', start + 10)
    compact = renderer[start:end]
    compact = replace_once(compact, '  const rows = writtenAnswerRows(turn);', '''  const rows = writtenAnswerRows(turn);
  const readerRef = reactExports.useRef(null);
  const [reading, setReading] = reactExports.useState({ top: true, bottom: true });
  const updateReading = () => {
    const el = readerRef.current;
    if (!el) return;
    const top = el.scrollTop < 2, bottom = el.scrollHeight - el.clientHeight - el.scrollTop < 2;
    setReading(old => old.top === top && old.bottom === bottom ? old : { top, bottom });
  };
  reactExports.useLayoutEffect(() => { if (readerRef.current) readerRef.current.scrollTop = 0; }, [turn?.id]);
  reactExports.useLayoutEffect(updateReading, [turn, preferences.fontSize, preferences.fontFamily]);
  reactExports.useEffect(() => {
    const el = readerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateReading);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const readHalfPage = direction => {
    const el = readerRef.current;
    if (el) { el.scrollBy({ top: direction * Math.max(1, Math.floor(el.clientHeight / 2)), behavior: 'instant' }); updateReading(); }
  };''')
    compact = replace_once(compact, "h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto',", "h('div', { className: 'written-reader', ref: readerRef, tabIndex: 0, role: 'region', 'aria-label': '模型回答', onScroll: updateReading, style: { flex: 1, minHeight: 0, overflowY: 'auto',")
    compact = replace_once(compact, "      h('span', { style: { marginLeft: 'auto',", "      button('↑ 半页', '向上阅读半页，保留上下文', () => readHalfPage(-1), reading.top),\n      button('↓ 半页', '向下阅读半页，保留上下文', () => readHalfPage(1), reading.bottom),\n      h('span', { style: { marginLeft: 'auto',")
    renderer = renderer[:start] + compact + renderer[end:]
    # User scrolling away from the bottom pauses follow even for a small step.
    before = 'el.scrollHeight - el.scrollTop - el.clientHeight < 48'
    if renderer.count(before) != 2: raise ValueError('Expected two follow thresholds')
    renderer = renderer.replace(before, 'el.scrollHeight - el.scrollTop - el.clientHeight < 4')
    return (HERE/'reading-scroll.js').read_text('utf8') + '\n' + renderer

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--check', action='store_true'); args = parser.parse_args()
    app = pathlib.Path(os.environ['LOCALAPPDATA'])/'Programs/meeting-copilot'
    archive = app/'resources/app.asar'; original = archive.read_bytes(); header, offset = archive_tools.read_header(original)
    renderer = patch(archive_tools.read_member(original, header, offset, MEMBER).decode('utf8'))
    output = HERE.parent/'work/scroll-review'; output.mkdir(exist_ok=True)
    target = output/'patched.mjs'; target.write_text(renderer, 'utf8')
    subprocess.run(['node', '--check', str(target)], check=True)
    updates = {MEMBER: renderer.encode('utf8')}
    css = (HERE/'reading-scroll.css').read_bytes()
    for name in ['out/renderer/assets/index-BJg-OUFD.css', 'out/renderer/assets/setup-J3U5CdEX.css']:
        updates[name] = archive_tools.read_member(original, header, offset, name) + b'\n' + css
    # Setup uses the same wheel behavior as the main window.
    setup = 'out/renderer/assets/setup-BRp0L4vC.js'
    updates[setup] = (HERE/'reading-scroll.js').read_bytes() + b'\n' + archive_tools.read_member(original, header, offset, setup)
    changed = archive_tools.replace_members(original, updates)
    h, off = archive_tools.read_header(changed)
    for name, content in updates.items(): assert archive_tools.read_member(changed, h, off, name) == content
    if args.check: print('Syntax and archive readback passed'); return
    archive_tools.require_closed(app)
    backup = archive.with_name('app.asar.before-reading-scroll-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '.bak')
    shutil.copy2(archive, backup)
    stage = archive.with_suffix('.reading.tmp'); stage.write_bytes(changed); os.replace(stage, archive)
    print('Installed; backup:', backup)

if __name__ == '__main__': main()
