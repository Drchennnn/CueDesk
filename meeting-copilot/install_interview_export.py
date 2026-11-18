import pathlib,os,datetime,shutil,subprocess,argparse
import install as a
HERE=pathlib.Path(__file__).resolve().parent
NAMES=['out/main/index.js','out/renderer/assets/index-hyFYaQxP.js','out/preload/index.js']
def once(s,old,new):
 if s.count(old)!=1: raise ValueError('Unexpected anchor: '+old)
 return s.replace(old,new,1)
def patch(main,ui,preload):
 if '// interview-export-v2' in main:return main,ui,preload
 if '// interview-export-v1' in main: raise ValueError('Installed v1 needs migration')
 main=once(main,'    electron.ipcMain.handle(IPC.sessionsLoad,', '    require(path.join(process.resourcesPath, "tools", "interview-export.cjs")).registerExport({ ipcMain: electron.ipcMain, dialog: electron.dialog, getWindow: () => win, rewrite: async messages => { const apiKey = settings.getLlmApiKey(); if (!apiKey) throw Error("请在设置中配置文本模型 API Key"); const result = await chatOnce({ baseUrl: settings.data.llm.baseUrl, model: settings.data.llm.model, apiKey }, messages, { temperature: 0.1, maxTokens: 6000, signal: AbortSignal.timeout(120000) }); return result.text; } });\n    electron.ipcMain.handle(IPC.sessionsLoad,')
 ui=once(ui,'  onShotAsk, onCapture, batch, batchController\n}) {','  onShotAsk, onCapture, batch, batchController, exportSession\n}) {')
 ui=once(ui,'    writtenMode && jsxRuntimeExports.jsx(ScreenshotBatchPanel,','    jsxRuntimeExports.jsx(InterviewExportPanel, { session: exportSession }),\n    writtenMode && jsxRuntimeExports.jsx(ScreenshotBatchPanel,')
 ui=once(ui,'          turns: current?.turns ?? [],','          turns: current?.turns ?? [],\n          exportSession: current,')
 ui=(HERE/'interview-export-ui.js').read_text('utf-8-sig')+'\n'+ui
 preload=once(preload,'  getInterviewLibrary:', '  exportInterview: payload => electron.ipcRenderer.invoke("interview-export:save", payload),\n  getInterviewLibrary:')
 return '// interview-export-v2\n'+main,ui,preload
def main():
 p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
 app=pathlib.Path(os.environ['LOCALAPPDATA'])/'Programs/meeting-copilot'; target=app/'resources/app.asar'; original=target.read_bytes();h,o=a.read_header(original)
 out=patch(*[a.read_member(original,h,o,n).decode('utf8') for n in NAMES]);folder=HERE.parent/'work/export-update';folder.mkdir(parents=True,exist_ok=True)
 for n,s in zip(['main.cjs','renderer.mjs','preload.cjs'],out):
  f=folder/n;f.write_text(s,'utf8');subprocess.run(['node','--check',str(f)],check=True)
 b=a.replace_members(original,dict(zip(NAMES,[s.encode() for s in out])));h,o=a.read_header(b)
 for n,s in zip(NAMES,out):assert a.read_member(b,h,o,n)==s.encode()
 assert patch(*out)==tuple(out)
 if args.check:print('Syntax, archive and idempotence checks passed');return
 a.require_closed(app)
 backup=app/'resources'/('before-interview-export-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'));backup.mkdir();shutil.copy2(target,backup/'app.asar')
 shutil.copy2(HERE/'interview-export.cjs',app/'resources/tools/interview-export.cjs')
 stage=target.with_suffix('.export.tmp');stage.write_bytes(b);os.replace(stage,target)
 print('Installed; restart app to load. Backup:',backup)
if __name__=='__main__':main()
