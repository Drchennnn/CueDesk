const assert = require('node:assert/strict');
const {renderSession,registerExport}=require('../meeting-copilot/interview-export.cjs');
const s={name:'测试',segments:[{text:'问题\n\n\n原文',speaker:'them',endTs:1234}],turns:[{label:'追问',text:'  回答  ',status:'streaming',kind:'free',modelResults:[{model:'B',text:'第二回答',status:'done'}]}]};
const raw=renderSession(s), organized=renderSession(s,true);
assert(raw.includes('问题\n\n\n原文'));assert(organized.includes('问题\n\n原文'));assert(organized.includes('状态：streaming'));assert(organized.includes('第二回答'));assert(organized.includes('AI 参考回答不代表本人实际发言'));
let handler;const sender={};registerExport({ipcMain:{handle:(name,fn)=>handler=fn},dialog:{showSaveDialog:async()=>({canceled:true})},getWindow:()=>({webContents:sender})});
(async()=>{await assert.rejects(handler({sender:{}},{session:s,mode:'raw'}),/仅主窗口/);assert.deepEqual(await handler({sender},{session:s,mode:'organized'}),{canceled:true});console.log('Export formatting, model results, sender and cancellation checks passed');})();
const {rewriteSegments}=require('../meeting-copilot/interview-export.cjs');
(async()=>{
  const segments=Array.from({length:12},(_,i)=>({id:i,text:'全站开发'+i,speaker:'them'}));
  const before=JSON.stringify(segments);let calls=0;
  const result=await rewriteSegments(segments,async messages=>{calls++;return JSON.stringify(JSON.parse(messages[1].content).items.map(s=>({id:s.id,text:s.text.replace('全站','全栈')})));});
  assert.equal(calls,2);assert.equal(result.length,12);assert.equal(result[11].text,'全栈开发11');assert.equal(JSON.stringify(segments),before);
  await assert.rejects(rewriteSegments(segments,async()=> '不是JSON'),/有效 JSON/);
  await assert.rejects(rewriteSegments(segments,async()=> '[]'),/条数或编号/);
  assert.deepEqual(await rewriteSegments([],null),[]);
  console.log('Rewrite batching, completeness, invalid output and source preservation checks passed');
})();
