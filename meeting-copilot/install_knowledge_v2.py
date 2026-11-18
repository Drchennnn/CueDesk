"""V2 incremental integration; original module retained, backup/rollback included."""
import argparse,datetime,hashlib,json,os,pathlib,shutil,subprocess
import install as archive
HERE=pathlib.Path(__file__).resolve().parent
NAMES=['out/main/index.js','out/renderer/assets/index-hyFYaQxP.js','out/preload/index.js']
def once(s,a,b):
 if s.count(a)!=1:raise ValueError('Expected exactly one anchor: '+a[:120]+' count='+str(s.count(a)))
 return s.replace(a,b,1)
def guard(main):
 if 'const work = messages.blockedUnknown ?' in main or 'const work = messages.directAnswer' in main or 'const work = messages.skipGeneration' in main:return main
 main=once(main,'      const work = chatStream(','      const work = messages.blockedUnknown ? Promise.resolve({ text: messages.blockedUnknown }) : chatStream(')
 main=once(main,'        let shotEvidence;','        let shotEvidence, shotBlockedUnknown;')
 main=once(main,'shotEvidence = messages.evidence; return messages;','shotEvidence = messages.evidence; shotBlockedUnknown = messages.blockedUnknown; return messages;')
 return once(main,'.parseAnswer(text, shotEvidence, true)','.parseAnswer(shotBlockedUnknown || text, shotEvidence, true)')
def dialogue_patch(main,ui):
 if 'messages.blockedUnknown && !messages.suggestionOnly' not in main and 'const work = messages.directAnswer || messages.blockedUnknown ?' in main:
  main=once(main,'const work = messages.directAnswer || messages.blockedUnknown ?','const work = messages.directAnswer || (messages.blockedUnknown && !messages.suggestionOnly) ?')
 if 'dialogueQuestions:' not in ui:
  ui=once(ui,'        requestId,\n        mode,\n        question:', '''        requestId,
        sessionId: sid,
        dialogueState: sessionsRef.current.find(s => s.id === sid)?.turns.filter(t => t.status === "done").at(-1)?.dialogue_state,
        dialogueQuestions: sessionsRef.current.find(s => s.id === sid)?.turns.filter(t => t.status === "done" && t.kind !== "translate").slice(-80).map(t => t.label),
        mode,
        question:''')
  ui=once(ui,'invalid_refs: ev.invalid_refs, diagnostics: ev.diagnostics };','invalid_refs: ev.invalid_refs, diagnostics: ev.diagnostics, dialogue_state: ev.dialogue_state };')
 if 'dialogue_state: messages.dialogueState' not in main:
  main=once(main,'diagnostics: messages.diagnostics });','diagnostics: messages.diagnostics, dialogue_state: messages.dialogueState });')
 if 'const work = messages.directAnswer' not in main and 'const work = messages.skipGeneration' not in main:
  main=once(main,'const work = messages.blockedUnknown ? Promise.resolve({ text: messages.blockedUnknown }) : chatStream(','const work = messages.directAnswer || messages.blockedUnknown ? Promise.resolve({ text: messages.directAnswer || messages.blockedUnknown }) : chatStream(')
 if 'const work = messages.directAnswer || messages.blockedUnknown ?' in main:
  main=once(main,'const work = messages.directAnswer || messages.blockedUnknown ?','const work = messages.directAnswer || (messages.blockedUnknown && !messages.suggestionOnly) ?')
 if 'messages.answerPolicy' not in main:
  main=once(main,'dialogue_state: messages.dialogueState }); }) : null;','dialogue_state: messages.dialogueState }); }, messages.answerPolicy) : null;')
 return main,ui
def turn_patch(main,ui):
 # Keep renderer filtering and the model-side guard on one pure policy source.
 policy=(HERE/'v2/turn-policy.cjs').read_text('utf-8-sig').split('function classifyTurn',1)[1].split('\nmodule.exports',1)[0]
 policy='function classifyTurn'+policy
 start='// dialogue-policy-v25\n';end='// end-dialogue-policy-v25\n'
 if start in ui:
  a=ui.index(start);b=ui.index(end,a)+len(end);ui=ui[:a]+start+policy+'\n'+end+ui[b:]
 else:ui=ui.replace('function isLikelyQuestion(text) {',start+policy+'\n'+end+'function isLikelyQuestion(text) {',1)
 old='''function isLikelyQuestion(text) {
  const t = text.trim();
  if (t.length < 4) return false;
  if (/[?？]$/.test(t)) return true;
  if (QUESTION_WORDS.test(t)) return true;
  return t.length >= 40;
}'''
 new='''function isLikelyQuestion(text, meta = {}) {
  return classifyTurn(text, meta).action === "answer";
}'''
 if old in ui:ui=once(ui,old,new)
 if new not in ui:raise ValueError('Missing turn policy trigger')
 ui=ui.replace('isLikelyQuestion(lastSeg.text)','isLikelyQuestion(lastSeg.text, lastSeg)')
 ui=ui.replace('({ speaker: s.speaker, text: s.text })','({ id: s.id, speaker: s.speaker, text: s.text, startTs: s.startTs, endTs: s.endTs, isFinal: s.isFinal })')
 old='const work = messages.directAnswer || (messages.blockedUnknown && !messages.suggestionOnly) ? Promise.resolve({ text: messages.directAnswer || messages.blockedUnknown }) : chatStream('
 new='const work = messages.skipGeneration || messages.directAnswer || (messages.blockedUnknown && !messages.suggestionOnly) ? Promise.resolve({ text: messages.directAnswer || messages.blockedUnknown || "" }) : chatStream('
 if old in main:main=once(main,old,new)
 if new not in main:raise ValueError('Missing skip-generation guard')
 return main,ui
def patch(main,ui,preload):
 ui=ui.replace('这项经历需要你本人确认，请展开依据与来源查看。','个人经历暂未确认。')
 old='(writtenMode && turn.text ? jsxRuntimeExports.jsx(WrittenAnswerContent, { value: turn.text }) : cleanAnswerReferences(turn.text)) || (turn.kind === "vision" ? t.answer.visionWaiting : t.answer.genWaiting)'
 new='(writtenMode && turn.text ? jsxRuntimeExports.jsx(WrittenAnswerContent, { value: turn.text }) : cleanAnswerReferences(turn.text)) || (turn.unknown_facts?.length ? "个人经历暂未确认。" : turn.kind === "vision" ? t.answer.visionWaiting : t.answer.genWaiting)'
 if old in ui:ui=once(ui,old,new)
 if '// knowledge-v2' in main:
  boundary='\nfunction InterviewExportPanel('
  if not ui.startswith('function EvidencePanel(') or boundary not in ui:raise ValueError('Missing V2 UI boundary')
  ui=(HERE/'v2/evidence-ui.js').read_text('utf-8-sig')+'\n'+ui[ui.index(boundary):].lstrip('\n')
  main,ui=dialogue_patch(guard(main),ui)
  main,ui=turn_patch(main,ui)
  return main,ui,preload
 main=once(main,'require(path.join(process.resourcesPath, "tools", "interview-library.cjs")).createInterviewLibrary({ file: path.join(electron.app.getPath("userData"), "interview-library.json") })','''require(path.join(process.resourcesPath, "tools", "knowledge-v2", "library.cjs")).createInterviewLibrary({ file: path.join(electron.app.getPath("userData"), "interview-library.json"), parsePdf: async bytes => { const mod = await import("pdf-parse"); const PDFParse = mod.PDFParse ?? mod.default?.PDFParse; const parser = new PDFParse({ data: new Uint8Array(bytes) }); try { const r = await parser.getText(); return r.pages.map(p => ({ page: p.num, text: p.text })); } finally { await parser.destroy(); } } })''')
 main=once(main,'electron.ipcMain.handle("interview-library:preview", (event, question) => {','electron.ipcMain.handle("interview-library:preview", async (event, question) => {')
 main=once(main,'      interviewLibrary.build({ question:', '      await interviewLibrary.build({ question:')
 main=once(main,'return interviewLibrary.getPublic().last;', 'return (await interviewLibrary.getPublic()).last;')
 main=once(main,'    electron.ipcMain.handle("interview-library:get",', '''    electron.ipcMain.handle("interview-library:open-evidence", async (event, ref) => { assertLibrarySender(event); const located = await interviewLibrary.locate(ref); const error = await electron.shell.openPath(located.file); if (error) throw Error(error); return { opened: true, location: located.chunk.source_location }; });
    electron.ipcMain.handle("interview-library:get",''')
 main=once(main,'electron.ipcMain.on(IPC.llmAsk, (_e, payload) => {','electron.ipcMain.on(IPC.llmAsk, async (_e, payload) => {')
 main=once(main,'messages = interviewLibrary.build({ ...payload,', 'messages = await interviewLibrary.build({ ...payload,')
 main=once(main,'      const work = chatStream(','''      if (ac.signal.aborted) return;
      const evidence = messages.evidence;
      const stream = evidence ? require(path.join(process.resourcesPath, "tools", "knowledge-v2", "evidence.cjs")).createAnswerStream(evidence, result => { if (!ac.signal.aborted) sendEv({ requestId: payload.requestId, kind: "oral", ...result, diagnostics: messages.diagnostics }); }) : null;
      const work = chatStream(''')
 main=once(main,'{ onDelta: (text) => { if (!ac.signal.aborted) sendEv({ requestId: payload.requestId, kind: "delta", text }); } },','{ onDelta: (text) => { if (!ac.signal.aborted) { if (stream) stream.push(text); else sendEv({ requestId: payload.requestId, kind: "delta", text }); } } },')
 main=once(main,'sendEv({ requestId: payload.requestId, kind: "done", text: r.text });','sendEv({ requestId: payload.requestId, kind: "done", text: stream ? stream.finish(r.text).oral_answer : r.text });')
 # Snapshot context by session; retain speaker labels for new requests.
 ui=once(ui,'recentTranscript: segs.slice(-30).map((s) => s.text),','recentTranscript: segs.slice(-30).map((s) => ({ speaker: s.speaker, text: s.text })),')
 # Old prompt builder expects strings; feed it a compatibility projection. V2 receives original payload.
 main=once(main,'        recentTranscript: payload.recentTranscript,','        recentTranscript: (payload.recentTranscript || []).map(s => typeof s === "string" ? s : s.text),')
 ui=once(ui,'            if (ev.kind === "model") return mergeModelAnswer(t2, ev.result);','''            if (ev.kind === "oral") return { ...t2, text: ev.oral_answer, evidence: ev.evidence, evidence_refs: ev.evidence_refs, claim_evidence: ev.claim_evidence, unknown_facts: ev.unknown_facts, private_notes: ev.private_notes, invalid_refs: ev.invalid_refs, diagnostics: ev.diagnostics };
            if (ev.kind === "model") return mergeModelAnswer(t2, ev.result);''')
 ui=once(ui,'      ] }) })\n    ] }, turn.id)) }),','      ] }) }),\n      jsxRuntimeExports.jsx(EvidencePanel, { turn })\n    ] }, turn.id)) }),')
 ui=(HERE/'v2/evidence-ui.js').read_text('utf-8-sig')+'\n'+ui
 preload=once(preload,'  getInterviewLibrary:', '  openInterviewEvidence: ref => electron.ipcRenderer.invoke("interview-library:open-evidence", ref),\n  getInterviewLibrary:')
 # Screenshot route remains in the existing model router. Capture the same evidence snapshot and sanitize its final output.
 main=once(main,'        imgP.then(\n          (dataUrls) => multimodalRouter.chat(', '        let shotEvidence;\n        imgP.then(\n          async (dataUrls) => multimodalRouter.chat(')
 main=once(main,'? interviewLibrary.build({ ...payload, images: dataUrls, answerLang: settings.data.llm.answerLang }, []) :', '? await (async () => { const messages = await interviewLibrary.build({ ...payload, images: dataUrls, answerLang: settings.data.llm.answerLang }, []); shotEvidence = messages.evidence; return messages; })() :')
 main=once(main,'          sendEv({ requestId: payload.requestId, kind: "delta", text });\n          sendEv({ requestId: payload.requestId, kind: "done", text });','''          if (shotEvidence) { const result = require(path.join(process.resourcesPath, "tools", "knowledge-v2", "evidence.cjs")).parseAnswer(text, shotEvidence, true); sendEv({ requestId: payload.requestId, kind: "oral", ...result }); text = result.oral_answer; }
          sendEv({ requestId: payload.requestId, kind: "done", text });''')
 # Model-by-model previews contain raw markers in screenshot route; use final sanitized result for interview knowledge mode.
 main=once(main,'ac.signal, unifiedProgress(sendEv, payload.requestId), unifiedResults(sendEv, payload.requestId)','ac.signal, unifiedProgress(sendEv, payload.requestId), shotEvidence ? (() => {}) : unifiedResults(sendEv, payload.requestId)')
 main,ui=dialogue_patch(guard(main),ui)
 main,ui=turn_patch(main,ui)
 return '// knowledge-v2\n'+main,ui,preload

def run():
 p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');p.add_argument('--rollback',type=pathlib.Path);p.add_argument('--intro-script',type=pathlib.Path);args=p.parse_args()
 app=pathlib.Path(os.environ['LOCALAPPDATA'])/'Programs/meeting-copilot';target=app/'resources/app.asar';user=pathlib.Path(os.environ['APPDATA'])/'MeetingCopilot'
 if args.rollback:
  backup=args.rollback.resolve();assert backup.parent==app/'resources' and backup.name.startswith('before-knowledge-v2-');archive.require_closed(app)
  shutil.copy2(backup/'app.asar',target)
  if (backup/'interview-library.json').exists():shutil.copy2(backup/'interview-library.json',user/'interview-library.json')
  if (backup/'knowledge-v2').exists():shutil.copytree(backup/'knowledge-v2',app/'resources/tools/knowledge-v2',dirs_exist_ok=True)
  print('Rolled back archive and library config; original documents and derived index kept.');return
 config_patch=None
 if args.intro_script:
  config_patch=json.loads((user/'interview-library.json').read_text('utf-8-sig'));root=pathlib.Path(config_patch['root']).resolve();selected=args.intro_script.resolve();relative=selected.relative_to(root).as_posix()
  index=user/'knowledge-v2'/hashlib.sha256(str(root).lower().encode()).hexdigest()[:16]/'manifest.json';manifest=json.loads(index.read_text('utf-8-sig'))
  doc=next((d for d in manifest['documents'] if d['file_path'].casefold()==relative.casefold() and d['status']=='active'),None)
  if not doc:raise ValueError('Intro script is not indexed: '+relative)
  if '## 约2分钟' not in selected.read_text('utf-8-sig'):raise ValueError('Missing explicit two-minute section')
  config_patch['intro_script']={'enabled':True,'document_id':doc['document_id'],'heading':'约2分钟'}
 original=target.read_bytes();h,o=archive.read_header(original);out=patch(*[archive.read_member(original,h,o,n).decode('utf8') for n in NAMES]);folder=HERE.parent/'work/kb-v2';folder.mkdir(exist_ok=True)
 for f,t in zip(['main.cjs','renderer.mjs','preload.cjs'],out):
  dest=folder/f;dest.write_text(t,'utf8');subprocess.run(['node','--check',str(dest)],check=True)
 assert patch(*out)==tuple(out)
 b=archive.replace_members(original,dict(zip(NAMES,[s.encode() for s in out])));h,o=archive.read_header(b)
 for n,s in zip(NAMES,out):assert archive.read_member(b,h,o,n)==s.encode()
 if args.check:print('Patch syntax, exact anchors, idempotence and ASAR readback passed');return
 archive.require_closed(app);backup=app/'resources'/('before-knowledge-v2-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'));backup.mkdir();shutil.copy2(target,backup/'app.asar')
 if (user/'interview-library.json').exists():shutil.copy2(user/'interview-library.json',backup/'interview-library.json')
 dest=app/'resources/tools/knowledge-v2';dest.mkdir(exist_ok=True)
 if list(dest.iterdir()):shutil.copytree(dest,backup/'knowledge-v2')
 try:
  for f in (HERE/'v2').glob('*.cjs'):shutil.copy2(f,dest/f.name)
  stage=target.with_suffix('.kb-v2.tmp');stage.write_bytes(b);os.replace(stage,target)
  if config_patch:
   config_file=user/'interview-library.json';config_stage=config_file.with_suffix('.v21.tmp');config_stage.write_text(json.dumps(config_patch,ensure_ascii=False,indent=2),'utf8');os.replace(config_stage,config_file)
 except Exception:
  shutil.copy2(backup/'app.asar',target)
  if (backup/'knowledge-v2').exists():shutil.copytree(backup/'knowledge-v2',dest,dirs_exist_ok=True)
  if (backup/'interview-library.json').exists():shutil.copy2(backup/'interview-library.json',user/'interview-library.json')
  raise
 (folder/'installed-backup.txt').write_text(str(backup),'utf8');print('Installed; backup:',backup)
if __name__=='__main__':run()
