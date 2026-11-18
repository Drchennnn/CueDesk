import importlib.util,pathlib,os,subprocess,shutil,datetime
HERE=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('a',HERE/'install.py');a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
def once(t,old,new):
 if t.count(old)!=1:raise ValueError('Unexpected source '+old[:100])
 return t.replace(old,new,1)
def patch(r):
 if '// simplified-ui-v1' in r:raise ValueError('Already installed')
 for func,source in [('ScreenshotBatchPanel','screenshot-batch-ui.js'),('WindowControlsSettings','window-controls-ui.js'),('InterviewLibrarySettings','interview-library-ui.js')]:
  start=r.index('function '+func+'(');end=r.index('\nfunction ',start+1);r=r[:start]+(HERE/source).read_text('utf-8-sig')+r[end:]
 pos=r.index('function SettingsSaveBar(');end=r.index('function MultimodalSettings(',pos)
 r=r[:pos]+'''function SettingsSaveBar({ dirty, saving, message, error, onClose }) {
  const h = jsxRuntimeExports.jsx, hs = jsxRuntimeExports.jsxs;
  return hs('div', { style: { position:'sticky', top:0, zIndex:30, background:'var(--panel, #20242a)', padding:'10px 12px', display:'flex', alignItems:'center', gap:12 }, children:[
    h('strong',{children:'设置'}), h('span',{role:'status',style:{flex:1},children:error || (saving ? '自动保存中…' : dirty ? '等待自动保存…' : '已自动保存')}),
    h('button',{type:'button',className:'btn',onClick:onClose,children:'关闭'})
  ] });
}
''' + r[end:]
 r=once(r,'function SettingsPanel({\n  settings,','function SettingsPanel({\n  batch, batchController,\n  settings,')
 r=once(r,'  const saveState = useSettingsSaveState(draft);','''  const saveState = useSettingsSaveState(draft);
  const latestDraft = reactExports.useRef(draft); latestDraft.current = draft;
  const attemptedSave = reactExports.useRef('');
  const saveRunning = reactExports.useRef(false);
  reactExports.useEffect(() => {
    const signature = JSON.stringify(draft);
    if (!saveState.dirty || saving || attemptedSave.current === signature) return;
    const timer = setTimeout(() => { attemptedSave.current = signature; requestSave(false); }, 600);
    return () => clearTimeout(timer);
  }, [JSON.stringify(draft), saveState.dirty, saving]);''')
 start=r.index('  const requestClose = (action = onClose) => {');end=r.index('  reactExports.useLayoutEffect',start)
 r=r[:start]+'''  const requestClose = async (action = onClose) => {
    pendingCloseAction.current = typeof action === 'function' ? action : onClose;
    const results = await Promise.all([...settingsAutoFlushers].map(flush => flush()));
    if (results.some(ok => !ok)) { setMmSaveError('部分设置无效，修正提示的问题后即可自动保存并关闭'); return; }
    if (saveRunning.current) { closeAfterSave.current = true; return; }
    if (saveState.dirty) requestSave(true);
    else pendingCloseAction.current();
  };
''' +r[end:]
 r=once(r,'    closeAfterSave.current = shouldClose === true;', '    if (shouldClose === true) closeAfterSave.current = true;')
 r=once(r,'  const save = async () => {\n    setConfirmWeak(false);','  const save = async () => {\n    if (saveRunning.current) return false;\n    saveRunning.current = true;\n    const savedSignature = JSON.stringify(draft);\n    setConfirmWeak(false);')
 start=r.index('      llmKey.reset();',r.index('function SettingsPanel'));end=r.index('      setSavedMessage(',start)
 r=r[:start]+'''      const unchanged = JSON.stringify(latestDraft.current) === savedSignature;
      if (unchanged) {
        llmKey.reset(); visionKey.reset(); cloudKey.reset(); rtKey.reset();
        setMmConfig(next.multimodal);
        saveState.commitAll(next.multimodal);
      }
      setMmSaveError('');
      setLive(next);
''' +r[end:]
 r=once(r,'      if (closeAfterSave.current) pendingCloseAction.current();','      if (closeAfterSave.current && unchanged) pendingCloseAction.current();')
 r=once(r,'    } finally {\n      setSaving(false);\n    }\n  };\n  const saveVision', '    } finally {\n      saveRunning.current = false;\n      setSaving(false);\n    }\n  };\n  const saveVision')
 # Group all existing hotkey editors and batch management into one collapsible entry.
 start=r.index('    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "settings-row", children: [\n      /* @__PURE__ */ jsxRuntimeExports.jsx("label", { children: t.settings.hotkeyToggle })')
 end=r.index('    (mmSaveError || settings.capture?.registrationError)',start)
 keys=r[start:end];r=r[:start]+r[end:]
 r=once(r,'    jsxRuntimeExports.jsx(WindowControlsSettings, {}),', '''    jsxRuntimeExports.jsxs("details", { className:"settings-shortcuts", children:[
      jsxRuntimeExports.jsx("summary", { style:{cursor:'pointer',padding:'10px 0',fontWeight:600}, children:"截图与快捷键" }),
'''+keys+'''      jsxRuntimeExports.jsx(WindowControlsSettings, {}),
      jsxRuntimeExports.jsx(ScreenshotBatchPanel, { batch, controller:batchController, management:true })
    ] }),''')
 r=once(r,"      h(WindowControlsSettings, {}),", "      button('截图与快捷键设置', '打开完整设置中的统一入口', onSettings),\n      h(ScreenshotBatchPanel, { batch, controller: batchController, management: true }),")
 r=once(r,'        closeRef: settingsCloseRef,','        closeRef: settingsCloseRef,\n        batch: batchState, batchController,')
 r=once(r,'      h("button", { className: "btn btn-primary btn-sm", type: "button", onClick: onSave, disabled: !!saving, children: saving ? "保存中…" : "保存视觉设置" }),','      h("span", { role:"status", children: saving ? "自动保存中…" : "修改后自动保存" }),')
 r=r.replace('修改后点击本区“保存视觉设置”或顶部“保存设置”','修改后自动保存').replace('修改后点击顶部“保存设置”，下一次提问生效','修改后自动保存，下一次提问生效').replace('点击设置底部保存','自动保存').replace('松开按键后点击保存','松开按键后自动保存').replace('填写后保存','填写后自动保存').replace('修改后保存。','修改后自动保存。').replace('保存后生效','自动保存后生效')
 r=r.replace('title: t.titlebar.hudTitle, children: "HUD"','title: "语音识别延迟：显示话音结束到文字出现的耗时、p50/p95及推理耗时", children: "延迟"')
 r=r.replace('HUD 等待首句…','延迟：等待首句…')
 return '// simplified-ui-v1\n'+(HERE/'autosave-ui.js').read_text('utf-8-sig')+'\n'+r

def run():
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
 app=pathlib.Path(os.environ['LOCALAPPDATA'])/'Programs/meeting-copilot';archive=app/'resources/app.asar';original=archive.read_bytes();h,o=a.read_header(original);member='out/renderer/assets/index-hyFYaQxP.js'
 r=patch(a.read_member(original,h,o,member).decode());folder=HERE.parent/'work/ui-simplify-check';folder.mkdir(exist_ok=True);f=folder/'renderer.mjs';f.write_text(r,'utf8');subprocess.run(['node','--check',str(f)],check=True)
 b=a.replace_member(original,member,r.encode());h,o=a.read_header(b);assert a.read_member(b,h,o,member)==r.encode()
 if args.check:print('Syntax and archive checks passed');return
 a.require_closed(app);backup=archive.with_name('app.asar.before-simple-ui-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.bak');shutil.copy2(archive,backup);tmp=archive.with_suffix('.simple-ui.tmp');tmp.write_bytes(b);os.replace(tmp,archive);print('Installed; backup:',backup)
if __name__=='__main__':run()
