function InterviewLibrarySettings() {
  const h = jsxRuntimeExports.jsx, hs = jsxRuntimeExports.jsxs;
  const [state, setState] = reactExports.useState(null), [error, setError] = reactExports.useState(''), [question, setQuestion] = reactExports.useState(''), [preview, setPreview] = reactExports.useState(null);
  reactExports.useEffect(() => { window.mc.getInterviewLibrary().then(setState).catch(e => setError(e.message)); }, []);
  const auto = useAutoSaveValue(state && { enabled: state.enabled, root: state.root, role: state.role }, value => window.mc.setInterviewLibrary(value), result => { setState(current => ({ ...current, roles: result.roles, files: result.files, warning: result.warning })); window.dispatchEvent(new Event('mc-library-updated')); });
  return hs('section', { style: { margin: '14px 0', padding: 12, border: '1px solid #8886', borderRadius: 8 }, children: [
    h('strong', { children: '面试资料库（文件夹）' }),
    h('p', { children: '开启后，面试文本问答和“面试”截图使用此资料库及个人设定；替代下面的文本 Prompt 和会话简历/JD。笔试、翻译保持原流程。修改 Markdown 后下一次提问自动读取；加载失败会提示，不会静默忽略。' }),
    state && hs('div', { children: [
      hs('label', { children: [h('input', { type:'checkbox', checked:state.enabled, onChange:e=>setState({...state,enabled:e.target.checked}) }), '启用面试资料库'] }),
      h('input', { 'aria-label':'面试资料目录', value:state.root, style:{width:'100%'}, onChange:e=>setState({...state,root:e.target.value,role:''}) }),
      h('select', { 'aria-label':'面试岗位', value:state.role, onChange:e=>setState({...state,role:e.target.value}), children:[h('option',{value:'',children:'通用（不指定公司）'}),...(state.roles||[]).map(role=>h('option',{value:role,children:role},role))] }),
      h('span', { role:'status', children:auto.error || (auto.status === 'saved' ? '已自动保存' : '自动保存中…') }),
      h('p', {children:'更换目录后自动刷新岗位列表。当前可读取 '+state.files.length+' 个文件；原始历史报告和完整导出不参与检索。'}),
      state.warning && h('div',{role:'alert',children:state.warning}),
      h('input', { 'aria-label':'资料检索测试问题',placeholder:'输入问题预览资料（向量模式调用纠错、Embedding 和重排 API，不生成回答）',value:question,style:{width:'100%'},onChange:e=>setQuestion(e.target.value) }),
      h('button',{type:'button',className:'btn',children:'本地检索预览',onClick:async()=>{try{setPreview(await window.mc.previewInterviewLibrary(question));setError('');}catch(e){setError(e.message);}}}),
      h('button',{type:'button',className:'btn',children:'查看最近一次选材',onClick:async()=>{try{const next=await window.mc.getInterviewLibrary();setPreview(next.last);}catch(e){setError(e.message);}}}),
      (preview || state.last) && h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:220,overflow:'auto'},children:JSON.stringify(preview || state.last,null,2)})
    ] }), error && h('div',{role:'status',children:error})
  ] });
}
