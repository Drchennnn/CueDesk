import importlib.util, pathlib, os, subprocess, shutil, datetime
HERE=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('a',HERE/'install.py');a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
def once(t,old,new):
 if t.count(old)!=1: raise ValueError('Unexpected source: '+old[:100])
 return t.replace(old,new,1)
def patch(main,renderer,preload):
 if '// interview-library-v1' in main: raise ValueError('Already installed')
 main=once(main,'let interviewPromptStore;', 'let interviewPromptStore;\nlet interviewLibrary;')
 anchor='    interviewPromptStore = createInterviewPrompt('
 pos=main.index(anchor);end=main.index('\n',pos)
 main=main[:end]+'''\n    interviewLibrary = require(path.join(process.resourcesPath, "tools", "interview-library.cjs")).createInterviewLibrary({ file: path.join(electron.app.getPath("userData"), "interview-library.json") });
    const assertLibrarySender = event => { if (!win || event.sender !== win.webContents) throw new Error("仅主窗口可管理资料库"); };
    electron.ipcMain.handle("interview-library:get", event => { assertLibrarySender(event); return interviewLibrary.getPublic(); });
    electron.ipcMain.handle("interview-library:set", (event, patch) => { assertLibrarySender(event); return interviewLibrary.save(patch); });
    electron.ipcMain.handle("interview-library:preview", (event, question) => {
      assertLibrarySender(event);
      if (!interviewLibrary.enabled) throw new Error("请先启用并保存资料库");
      interviewLibrary.build({ question: String(question || "请介绍自己") }, []);
      return interviewLibrary.getPublic().last;
    });
'''+main[end:]
 main=once(main,'    async function doPrewarm(prefix, reason) {','    async function doPrewarm(prefix, reason) {\n      if (interviewLibrary?.enabled) return;')
 main=once(main,'      const messages = buildAnswerMessages({','      let messages = buildAnswerMessages({')
 main=once(main,'      if (!isTranslate && payload.mode !== "free") {','''      try {
        messages = interviewLibrary.build({ ...payload, scene: multimodalRouter.getPublic().mode, answerLang: payload.answerLang ?? settings.data.llm.answerLang }, messages);
      } catch (error) {
        llmControllers.delete(payload.requestId);
        sendEv({ requestId: payload.requestId, kind: "error", message: "面试资料加载失败：" + error.message });
        return;
      }
      if (!isTranslate && payload.mode !== "free") {''')
 main=once(main,'            multimodalRouter.buildMessages({\n              ...payload, imageDataUrls:', '            (interviewLibrary.enabled && multimodalRouter.getPublic().mode === "interview" ? interviewLibrary.build({ ...payload, images: dataUrls, answerLang: settings.data.llm.answerLang }, []) : multimodalRouter.buildMessages({\n              ...payload, imageDataUrls:')
 main=once(main,'            }, "shot"),','            }, "shot")),')
 preload=once(preload,'  getWindowControls:', '''  getInterviewLibrary: () => electron.ipcRenderer.invoke("interview-library:get"),
  setInterviewLibrary: patch => electron.ipcRenderer.invoke("interview-library:set", patch),
  previewInterviewLibrary: question => electron.ipcRenderer.invoke("interview-library:preview", question),
  getWindowControls:''')
 renderer=once(renderer,'function InterviewPromptSettings(', (HERE/'interview-library-ui.js').read_text('utf-8-sig')+'\nfunction InterviewPromptSettings(')
 renderer=once(renderer,'    jsxRuntimeExports.jsx(InterviewPromptSettings,', '    jsxRuntimeExports.jsx(InterviewLibrarySettings, {}),\n    jsxRuntimeExports.jsx(InterviewPromptSettings,')
 return ['// interview-library-v1\n'+main,renderer,preload]
def run():
 import argparse,json
 p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
 app=pathlib.Path(os.environ['LOCALAPPDATA'])/'Programs/meeting-copilot';archive=app/'resources/app.asar';original=archive.read_bytes();h,o=a.read_header(original)
 names=['out/main/index.js','out/renderer/assets/index-hyFYaQxP.js','out/preload/index.js'];out=patch(*[a.read_member(original,h,o,n).decode() for n in names]);replacement=dict(zip(names,[x.encode() for x in out]))
 check=HERE.parent/'work/interview-library-check';check.mkdir(exist_ok=True)
 for fname,content in zip(['main.cjs','renderer.mjs','preload.cjs'],out):
  f=check/fname;f.write_text(content,'utf8');subprocess.run(['node','--check',str(f)],check=True)
 b=a.replace_members(original,replacement);h,o=a.read_header(b)
 for n,c in replacement.items(): assert a.read_member(b,h,o,n)==c
 if args.check: print('Syntax and archive checks passed');return
 a.require_closed(app)
 backup=app/'resources'/('before-interview-library-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'));backup.mkdir();shutil.copy2(archive,backup/'app.asar')
 config=pathlib.Path(os.environ['APPDATA'])/'MeetingCopilot/interview-library.json'
 if config.exists():shutil.copy2(config,backup/config.name)
 else:config.write_text(json.dumps({'enabled':False,'root':'','role':''},ensure_ascii=False,indent=2),'utf8')
 shutil.copy2(HERE/'interview-library.cjs',app/'resources/tools/interview-library.cjs')
 tmp=archive.with_suffix('.library.tmp');tmp.write_bytes(b);os.replace(tmp,archive)
 print('Installed. Backup:',backup)
if __name__=='__main__':run()

