import importlib.util,pathlib,os,subprocess,shutil,datetime,json
from layout_parser import elements
HERE=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('a',HERE/'install.py');a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
def card(title,items,description=''):
 return 'jsxRuntimeExports.jsx(SettingsCard,{title:'+json.dumps(title,ensure_ascii=False)+',description:'+json.dumps(description,ensure_ascii=False)+',children:jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment,{children:['+','.join(items)+']})})'
def wrap(cls,child):return 'jsxRuntimeExports.jsx("div",{className:"'+cls+'",children:'+child+'})'
def details(title,children):return 'jsxRuntimeExports.jsxs("details",{children:[jsxRuntimeExports.jsx("summary",{children:'+json.dumps(title,ensure_ascii=False)+'}),'+','.join(children)+']})'
def patch(r):
 if '// settings-workspace-v1' in r:raise ValueError('Already installed')
 p=r.index('function SettingsPanel(');start=r.index('  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "settings", children: [',p);arr=r.index('children: [',start)+len('children: [');items,end=elements(r,arr)
 assert len(items)==31 and 'confirmWeak' in items[29]
 advanced,_=elements(items[28],items[28].index('children: [')+len('children: ['));assert len(advanced)==13
 shortcut,_=elements(items[2],items[2].index('children:[')+len('children:['));assert len(shortcut)==7
 shortcut[5]=shortcut[5].replace('WindowControlsSettings, {}','WindowControlsSettings, { expanded: true }')
 panels=[
 ('models','模型接口','文本回答与截图模型，各自配置。',[
  card('文本回答',[items[12],advanced[4],advanced[5],items[13],items[16]],'用于转录问答、手动提问、翻译和备忘。'),
  card('',[advanced[6]])]),
 ('audio','语音与音频','选择识别方式和输入设备。',[
  card('语音识别',[items[i] for i in [7,8,9,10]]+['asrBackend.startsWith("local") && '+items[11]]+['asrBackend === "cloud-realtime" && '+advanced[i] for i in [9,10]]+['asrBackend === "cloud" && '+advanced[i] for i in [11,12]]),
  card('音频设备',[items[23],items[24],items[6]])]),
 ('interview','面试资料','管理资料来源、岗位和回答规则。',[
  card('个人资料与岗位',[wrap('preferences-library',items[14])]),
  card('备用面试规则',[details('编辑备用 Prompt',[wrap('preferences-prompt',items[15])])],'资料库关闭时使用。启用资料库时，优先使用个人设定和岗位要求。')]),
 ('shortcuts','快捷键与窗口','统一管理按键、窗口和多图暂存。',[
  card('截图与呼出',shortcut[1:4]),
  card('窗口与多图快捷键',[shortcut[5]]),
  card('多图暂存',[shortcut[6],items[1].replace('打开笔试专用小窗（文字 / 代码 / 字体可调整）','打开笔试小窗')])]),
 ('general','通用设置','界面偏好与维护工具。',[
  card('界面与启动',[items[i] for i in [17,18,19,21]]),
  card('帮助与诊断',[items[26],advanced[2],details('重新配置',[items[27]])])])]
 tabs='['+','.join('{id:'+json.dumps(id)+',title:'+json.dumps(title,ensure_ascii=False)+',description:'+json.dumps(desc,ensure_ascii=False)+',content:['+','.join(content)+']}' for id,title,desc,content in panels)+']'
 replacement='  return jsxRuntimeExports.jsx(SettingsWorkspace,{saveBar:'+items[0]+',alerts:jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment,{children:['+items[20]+','+items[29]+']}),tabs:'+tabs+'});'
 end=r.index('\n}',end);r=r[:start]+replacement+r[end:]
 # Shorter, accurate hints and one add-interface action.
 r=r.replace('function WindowControlsSettings()','function WindowControlsSettings({ expanded = false } = {})')
 r=r.replace("return hs('details', { className: 'window-controls-settings',", "return hs('details', { open: expanded, className: 'window-controls-settings',")
 r=r.replace('当前方案','当前配置')
 replacements={
 '自定义（在高级设置中填写）':'自定义',
 'Custom (fill in under advanced settings)':'Custom',
 '模型（DeepSeek 用 deepseek-chat；MiMo 用 mimo-v2.5-pro）':'模型名称',
 'Model (DeepSeek: deepseek-chat; MiMo: mimo-v2.5-pro)':'Model name',
 '云端 ASR Base URL（MiMo: https://api.xiaomimimo.com/v1）':'接口地址',
 '云端 ASR 模型（mimo-v2.5-asr）':'识别模型',
 '云端流式 WebSocket 地址（wss://…/api-ws/v1/inference）':'WebSocket 地址',
 '云端流式模型（fun-asr-realtime / paraformer-realtime-v2）':'识别模型',
 '转录语言（本地后端用；云端一般自动识别）':'转录语言（本地）',
 '答案字号（只影响右栏答案正文）':'答案字号',
 '仅对安装版生效；开发模式下只记录选择，不会真正注册开机启动。':'',
 '点击 ＋ 添加一个备用 API 接口。按从上到下的顺序请求，超时或失败时自动切换。接口使用 OpenAI 兼容协议，模型需要支持图片输入。':'支持 OpenAI 兼容的图片接口；按顺序回退，笔试可开启同时作答。',
 '转录问答、持续答、手动提问、翻译和备忘固定使用文本模型。只有截图才调用这里的接口。面试及自动场景的截图按主接口→备用接口顺序作答，只返回一份答案。':'面试截图只返回一份答案；语音与手动提问使用文本模型。',
 '空白接口和未填写 API Key 的接口也可以先保存。修改后自动保存；未填写完整的接口不会用于问答。':'未配置完整的接口不会用于问答。',
 '笔试模式：所有接口共用 written.md，选择题和简单题直接给答案。面试模式：采用原版面试 / 截图提示词。':'',
 '控制文本模型的面试回答，也供“普通面试”场景的多模态接口共用。笔试和截图面试各自使用独立 Prompt。修改后自动保存，下一次提问生效。':'用于未启用资料库时的文本面试回答。',
 '开启后，面试文本问答和“面试”截图使用此资料库及个人设定；替代下面的文本 Prompt 和会话简历/JD。笔试、翻译保持原流程。修改 Markdown 后下一次提问自动读取；加载失败会提示，不会静默忽略。':'启用后使用目录中的个人设定与岗位资料。Markdown 修改后，下次提问自动读取。',
 '快捷键可在其他窗口处于前台时使用，窗口与文字同步等比例缩放。修改后自动保存。':'窗口与文字同步缩放；清空快捷键可禁用。',
 '按键名称示例：Control+Alt+Left、Control+Alt+PageUp。清空可禁用该项；自动检查冲突。':'示例：Control+Alt+Left。冲突会在下方提示。',
 '恢复原版（自动保存后生效）':'恢复默认',
 '定位笔试 Prompt（written.md）':'编辑笔试提示词',
 '面试文本模型 Prompt':'备用面试 Prompt'
 }
 for old,new in replacements.items():r=r.replace(old,new)
 r=r.replace('    h("button", { className: "btn", type: "button", onClick: addEndpoint, children: "＋ 添加备用接口" }),','')
 r=r.replace('children: "＋" })','children: "＋ 添加接口" })',1)
 r=r.replace('      h("span", { role:"status", children: saving ? "自动保存中…" : "修改后自动保存" }),','')
 return '// settings-workspace-v1\n'+(HERE/'settings-workspace-ui.js').read_text('utf-8-sig')+'\n'+r

def run():
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
 app=pathlib.Path(os.environ['LOCALAPPDATA'])/'Programs/meeting-copilot';archive=app/'resources/app.asar';original=archive.read_bytes();h,o=a.read_header(original);member='out/renderer/assets/index-hyFYaQxP.js'
 r=patch(a.read_member(original,h,o,member).decode());d=HERE.parent/'work/settings-layout-check';d.mkdir(exist_ok=True);f=d/'renderer.mjs';f.write_text(r,'utf8');subprocess.run(['node','--check',str(f)],check=True)
 b=a.replace_member(original,member,r.encode());h,o=a.read_header(b);assert a.read_member(b,h,o,member)==r.encode()
 if args.check:print('Settings layout syntax and archive verified');return
 a.require_closed(app);backup=archive.with_name('app.asar.before-settings-layout-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.bak');shutil.copy2(archive,backup);tmp=archive.with_suffix('.layout.tmp');tmp.write_bytes(b);os.replace(tmp,archive);print('Installed; backup:',backup)
if __name__=='__main__':run()
