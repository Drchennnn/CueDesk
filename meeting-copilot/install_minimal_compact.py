"""Remove redundant capture, paging and settings controls from the compact view."""
import pathlib, os, subprocess, shutil, datetime, argparse
import install as archive_tools
from layout_parser import elements

HERE = pathlib.Path(__file__).resolve().parent
MEMBER = 'out/renderer/assets/index-hyFYaQxP.js'

def patch(renderer):
    a=renderer.index('function WrittenCompactView('); b=renderer.index('\nfunction ',a+10)
    view=renderer[a:b]
    # Remove compact popup/controls whether the previous patch or the original build is present.
    if 'const [options, setOptions]' in view:
        view=view.replace('  const [options, setOptions] = reactExports.useState(false);\n','')
        x=view.index('    options && hs('); y=view.index('\n    preferences.clickThrough',x); view=view[:x]+view[y:]
        view=view.replace("button('⋯', '字体与窗口大小', () => setOptions(value => !value)),\n",'')
        view=view.replace("button('全屏', '静默全屏截图问答（快捷键仍有效）', () => { setOptions(false); onCapture('full'); }, !ready),\n      ",'')
        view=view.replace("button('框选', '无全屏蒙层框选截图问答', () => { setOptions(false); onCapture('region'); }, !ready),\n      ",'')
        view=view.replace('setOptions(false); ', '')
    if 'reading, setReading' in view:
        x=view.index('  const [reading, setReading]'); y=view.index('  const control = ',x)
        view=view[:x]+"  reactExports.useLayoutEffect(() => { if (readerRef.current) readerRef.current.scrollTop = 0; }, [turn?.id]);\n"+view[y:]
        view=view.replace(', onScroll: updateReading','')
        view=view.replace("button('↑ 半页', '向上阅读半页，保留上下文', () => readHalfPage(-1), reading.top),\n      button('↓ 半页', '向下阅读半页，保留上下文', () => readHalfPage(1), reading.bottom),\n      ",'')
    renderer=renderer[:a]+view+renderer[b:]
    a=renderer.index('function AnswerPane('); b=renderer.index('\nfunction ',a+10); view=renderer[a:b]
    for phrase in ['📄','📋']:
        pass
    # Strip the two per-session resume/JD action buttons and their conditional remove buttons.
    import re
    view=re.sub(r'\s*/\* @__PURE__ \*/ jsxRuntimeExports\.jsxs\(\s*"button",\s*\{\s*className: resumeChars[\s\S]*?\n\s*\}\s*\)\s*,?', '', view, count=1)
    view=re.sub(r'\s*resumeChars > 0 && /\* @__PURE__ \*/ jsxRuntimeExports\.jsx\("button", \{ className: "btn btn-sm", onClick: \(\) => onClearKb\("resume"\)[\s\S]*?\}\),?', '', view, count=1)
    view=re.sub(r'\s*/\* @__PURE__ \*/ jsxRuntimeExports\.jsxs\(\s*"button",\s*\{\s*className: jdChars[\s\S]*?\n\s*\}\s*\)\s*,?', '', view, count=1)
    view=re.sub(r'\s*jdChars > 0 && /\* @__PURE__ \*/ jsxRuntimeExports\.jsx\("button", \{ className: "btn btn-sm", onClick: \(\) => onClearKb\("jd"\)[\s\S]*?\}\),?', '', view, count=1)
    if 'onPickKb("resume")' in view or 'onPickKb("jd")' in view: raise ValueError('Resume/JD buttons remain')
    renderer=renderer[:a]+view+renderer[b:]
    return renderer

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    app=pathlib.Path(os.environ['LOCALAPPDATA'])/'Programs/meeting-copilot';archive=app/'resources/app.asar'
    original=archive.read_bytes();h,o=archive_tools.read_header(original)
    renderer=patch(archive_tools.read_member(original,h,o,MEMBER).decode('utf8'))
    library_path=app/'resources/tools/interview-library.cjs'
    library=library_path.read_text('utf8')
    import re
    library=re.sub(r'末尾另起“依据：”列出实际使用的相对路径#章节。[^`]*', '回答只输出自然口述内容，不附依据、来源路径或文件章节名。', library, count=1)
    interview_prompt=HERE/'interview-library.cjs'
    prompt=re.sub(r'末尾另起“依据：”列出实际使用的相对路径#章节。[^`]*', '回答只输出自然口述内容，不附依据、来源路径或文件章节名。', interview_prompt.read_text('utf8'), count=1)
    out=HERE.parent/'work/scroll-review/minimal.mjs';out.write_text(renderer,'utf8')
    subprocess.run(['node','--check',str(out)],check=True)
    changed=archive_tools.replace_member(original,MEMBER,renderer.encode('utf8'));h,o=archive_tools.read_header(changed)
    assert archive_tools.read_member(changed,h,o,MEMBER)==renderer.encode('utf8')
    if args.check: print('Compact syntax, archive and attribution rule checks passed');return
    archive_tools.require_closed(app)
    backup=archive.with_name('app.asar.before-minimal-compact-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.bak')
    shutil.copy2(archive,backup);stage=archive.with_suffix('.minimal.tmp');stage.write_bytes(changed);os.replace(stage,archive)
    library_path.write_text(library,'utf8');interview_prompt.write_text(prompt,'utf8')
    print('Installed; backup:',backup)

if __name__=='__main__': main()
