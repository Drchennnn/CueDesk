const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createInterviewLibrary}=require('../meeting-copilot/interview-library.cjs');
function setup(t) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-library-test-'));
 t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
 const files = {
  '个人设定.md': '按事实回答。', '简历.md': '测试候选人的简历。', '待确认与补充.md': '项目数字待核实。',
  '项目资料/SRAG课程检索问答.md': '# SRAG\n检索课程资料，评估结果待确认。',
  '项目资料/九寨沟客流预测系统.md': '# 九寨沟\n通过验证集选择模型权重。',
  '项目资料/IOD多源感知校企合作.md': '# IOD\n指标需核对测试集。',
  '通用问答/技术问答.md': '# 技术\n解释思路。',
  '岗位档案/CBCX Trading-全栈开发实习生/JD.md': '全栈开发。',
  '岗位档案/CBCX Trading-全栈开发实习生/面试要求.md': '简明回答。',
  '岗位档案/CBCX Trading-全栈开发实习生/资料选择.md':
    '[课程](../../项目资料/SRAG课程检索问答.md)\n[预测](../../项目资料/九寨沟客流预测系统.md)\n[感知](../../项目资料/IOD多源感知校企合作.md)',
  '岗位档案/CBCX Trading-全栈开发实习生/自我介绍.md': '# 自我介绍\n测试用岗位介绍。',
  '岗位档案/其他岗位/JD.md': '其他岗位。',
  '岗位档案/其他岗位/面试问答.md': '其他公司的问答。',
  '历史报告/完整内容.md': '历史导出。'
 };
 for (const [name, content] of Object.entries(files)) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
 }
 const lib = createInterviewLibrary({file: path.join(dir, 'config.json')});
 lib.save({enabled: true, root: dir, role: 'CBCX Trading-全栈开发实习生'});
 return lib;
}
test('loads selected role and excludes historical report, snapshot and other roles',t=>{const l=setup(t),s=l.getPublic();assert.equal(s.warning,'');assert(s.files.includes('项目资料/SRAG课程检索问答.md'));assert(!s.files.some(f=>f.includes('完整内容')||f.includes('面试准备')));assert(s.files.every(f=>!f.startsWith('岗位档案/')||f.includes('CBCX Trading-全栈开发实习生/')));});
test('project questions include facts, limitations, and provenance; questions preserve images',t=>{const l=setup(t);for(const [q,file] of [['SRAG评估结果是不是全部通过？','SRAG课程检索问答'],['九寨沟模型权重怎么确定？','九寨沟客流预测系统'],['IOD的97.06%说明什么？','IOD多源感知校企合作']]){const m=l.build({question:q,images:['data:image/png;base64,test']},[]);assert(l.getPublic().last.sources.some(s=>s.includes(file)));assert(m[1].content.includes('待确认与补充.md'));assert(m[1].content.includes('面试要求.md'));assert.equal(m.at(-1).content[0].image_url.url,'data:image/png;base64,test');assert(l.getPublic().last.characters<47000);}});
test('intro favors selected employer; generic profile never imports company answers',t=>{const l=setup(t);l.build({question:'请做一分钟自我介绍'},[]);assert(l.getPublic().last.sources.some(f=>f.startsWith('岗位档案/')&&f.includes('自我介绍')));l.save({...l.getPublic(),role:''});const m=l.build({question:'为什么选择这家公司'},[]);assert(!m[1].content.includes('【岗位档案/'));});
test('translation and written modes bypass library; disabled and invalid roots preserve behavior',t=>{const l=setup(t),original=[{role:'system',content:'original'}];assert.equal(l.build({mode:'translate'},original),original);assert.equal(l.build({scene:'written'},original),original);assert.throws(()=>l.save({...l.getPublic(),role:'../other'}));l.save({...l.getPublic(),enabled:false});assert.equal(l.build({question:'hello'},original),original);});
test('followup uses recent project context',t=>{const l=setup(t);l.build({question:'为什么这么选？',recentTranscript:['请介绍九寨沟客流预测系统']},[]);assert(l.getPublic().last.sources.some(s=>s.includes('九寨沟')));});

test('loads edited Markdown on the next request and allows disabling after a missing file',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'library-edit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const name of ['个人设定.md','简历.md','待确认与补充.md'])fs.writeFileSync(path.join(dir,name),'version-one');
 const l=createInterviewLibrary({file:path.join(dir,'config.json')});l.save({enabled:true,root:dir,role:''});
 assert(l.build({question:'hello'},[])[1].content.includes('version-one'));
 fs.writeFileSync(path.join(dir,'简历.md'),'version-two');assert(l.build({question:'hello'},[])[1].content.includes('version-two'));
 fs.unlinkSync(path.join(dir,'简历.md'));assert.throws(()=>l.build({question:'hello'},[]));
 l.save({enabled:false,root:dir,role:''});assert.equal(l.enabled,false);
});
test('local HTTP request carries one assembled interview context and image without contacting external API',async t=>{
 const http=require('node:http'), l=setup(t);let received;
 const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{received=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'local response'}}]}));});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const messages=l.build({question:'SRAG如何评估？'},[]);
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'local-test',messages})});
 assert.equal((await response.json()).choices[0].message.content,'local response');assert.equal(received.messages.at(-1).role,'user');assert(received.messages[1].content.includes('SRAG课程检索问答'));assert.equal(received.messages.filter(m=>m.role==='system').length,1);
});
