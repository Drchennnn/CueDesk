function InterviewExportPanel({ session }) {
  const h = jsxRuntimeExports.jsx, hs = jsxRuntimeExports.jsxs;
  const [open, setOpen] = reactExports.useState(false), [busy, setBusy] = reactExports.useState(false), [message, setMessage] = reactExports.useState('');
  async function save(mode) {
    setBusy(true); setMessage('');
    try { const result = await window.mc.exportInterview({ session, mode }); setMessage(result.canceled ? '已取消导出' : '已保存：' + result.path); }
    catch (error) { setMessage('导出失败：' + error.message); }
    finally { setBusy(false); }
  }
  return hs('div', { style:{padding:'4px 10px',borderBottom:'1px solid #8884'}, children:[
    h('button',{className:'btn btn-sm',onClick:()=>setOpen(!open),children:open?'收起导出':'导出'}),
    open && hs('span',{children:[
      h('button',{className:'btn btn-sm',disabled:busy || !session,onClick:()=>save('raw'),children:'原始文本'}),
      h('button',{className:'btn btn-sm',disabled:busy || !session,onClick:()=>save('organized'),children:'AI 校对后导出'}),
      h('button',{className:'btn btn-sm',disabled:busy || !session,onClick:()=>save('json'),children:'JSON 数据'}),
      h('small',{children:'整理版使用已配置的文本模型校正转录，会发送转录文本并产生 API 用量；保留原文供核对。'})
    ]}),
    (busy || message) && h('div',{role:'status',style:{overflowWrap:'anywhere'},children:busy?'正在导出（AI 校对可能需要数分钟）…':message})
  ]});
}
