'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {splitReference}=require('./reference.cjs');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const id=prefix=>prefix+'_'+crypto.randomUUID();
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));if(fs.existsSync(file))fs.copyFileSync(file,file+'.bak');fs.renameSync(tmp,file);}
function load(file,fallback,diagnostics){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(e){if(e.code==='ENOENT')return fallback;diagnostics.push('索引/清单读取失败：'+path.basename(file));try{return JSON.parse(fs.readFileSync(file+'.bak','utf8'));}catch{return fallback;}}}
function inside(root,file){const real=fs.realpathSync(file),base=fs.realpathSync(root);if(real!==base&&!real.toLowerCase().startsWith((base+path.sep).toLowerCase()))throw Error('来源超出资料目录');return real;}
function excludedSource(relative){
 const parts=relative.replace(/\\/g,'/').split('/');
 return parts.some(part=>/^(?:node_modules|\.venv|venv|__pycache__)$/i.test(part))||/^requirements(?:[-.][^/]*)?\.txt$/i.test(parts.at(-1))||parts[0]==='通用技术知识'&&parts[1]==='assets';
}
function classify(rel,body){
 if(/^---\r?\n[\s\S]*?^knowledge_kind:\s*candidate_profile\s*$/m.test(body.slice(0,1000)))return 'candidate_profile';
 if(/^---\r?\n[\s\S]*?^knowledge_kind:\s*technical_reference\s*$/m.test(body.slice(0,1000)))return 'technical_reference';
 if(/面试记录|原始会话|原始转录|校对整理|复盘|backup|历史报告/i.test(rel))return 'archived';
 if(/个人设定|面试要求|资料选择|接入说明|README|JD\.md/i.test(rel))return 'guideline';
 if(/简历/.test(rel))return 'resume';
 if(/^项目资料\//.test(rel))return 'project_fact';
 if(/待确认|待补/.test(rel))return 'pending_fact';
 if(/技术.*笔记|技术原理|知识.*讲义|知识速成|技术笔记|基础讲解|基础知识.*讲解/.test(rel))return 'technical_note';
 if(/本人表达样例/.test(rel)&&/可用于项目事实推断:\s*否/.test(body))return 'guideline';
 if(/AI\s*参考|AI练习稿|自我介绍|问答|练习卡/.test(body.slice(0,600)+' '+rel))return 'draft';
 if(/实验|评测|测评/.test(rel))return 'experiment';
 if(/真实经历/.test(rel))return 'personal_experience';
 if(/方案|建议|规划/.test(rel))return 'design_proposal';
 return 'pending_fact';
}
function split(text,doc,page){
 const lines=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n'),result=[];let headings=[],start=0,block=[],fence=false,front=lines[0]==='---',occ={};
 function flush(){if(!block.join('\n').trim()){block=[];return;}const body=block.join('\n'),h=hash(body),key=h;occ[key]=(occ[key]||0)+1;let type=doc.document_type;
 const heading=headings.filter(Boolean).join(' / ');
 if(['project_fact','personal_experience','experiment'].includes(type)&&/建议|待实现|未来|下一步|设计方案/.test(heading))type='design_proposal';
 if(['project_fact','personal_experience','experiment'].includes(type)&&/改进需要|建议(?:使用|增加|采用)|后续(?:需要|应|可)|下一步|拟(?:采用|实现)/.test(body))type='design_proposal';
 if(/待确认|待补|冲突/.test(heading))type='pending_fact';
 if(/常见追问|参考回答|口述稿/.test(heading))type='draft';
 if(type==='project_fact'&&/参数|实验|指标|评估|结果/.test(heading))type='experiment';
 result.push({chunk_id:doc.document_id+':'+(page||0)+':'+h.slice(0,20)+':'+occ[key],document_id:doc.document_id,heading,document_type:type,content:body,content_hash:h,source_location:page?{page_number:page}:{line_range:[start+1,start+block.length]}});block=[];}
 for(let i=0;i<lines.length;i++){const line=lines[i];if(front){if(i>0&&line==='---')front=false;continue;}
 if(/^\s*```|^\s*~~~/.test(line))fence=!fence;
 const m=!fence&&/^(#{1,6})\s+(.+)/.exec(line);
 if(m){flush();headings.length=m[1].length;headings[m[1].length-1]=m[2];continue;}
 if(!line.trim()&&!fence){flush();continue;}if(!block.length)start=i;block.push(line);
 }flush();return result;
}
class Store{
 constructor({root,dir,parsePdf}){this.root=path.resolve(root);this.dir=dir;this.parsePdf=parsePdf;this.diagnostics=[];this.manifest=load(path.join(dir,'manifest.json'),{schema:2,documents:[],roles:[],policy:{required_document_ids:[]}},this.diagnostics);if(this.manifest.schema!==2||!Array.isArray(this.manifest.documents))throw Error('不支持的清单格式，请恢复备份');this.index=load(path.join(dir,'index.json'),{},this.diagnostics);this.queue=Promise.resolve();}
 refresh(){const job=this.queue.then(()=>this.scan());this.queue=job.catch(()=>{});return job;}
 async scan(){const previous=this.manifest.documents,found=[],diagnostics=this.diagnostics.filter(s=>s.startsWith('索引/清单读取失败'));if(!fs.existsSync(this.root))throw Error('资料目录不存在：'+this.root);
 const retired=load(path.join(this.dir,'retired-sources.json'),{schema:1,sources:[]},diagnostics);
 const retirements=retired.schema===1&&Array.isArray(retired.sources)?retired.sources:[];
 if(retired.schema!==1||!Array.isArray(retired.sources))diagnostics.push('资料归档清单格式错误，未隐藏缺失来源');
 const walk=dir=>{for(const x of fs.readdirSync(dir,{withFileTypes:true})){if(x.name.startsWith('.')||/^_backup/i.test(x.name))continue;const f=path.join(dir,x.name);if(excludedSource(path.relative(this.root,f)))continue;if(x.isSymbolicLink()){diagnostics.push('跳过链接：'+f);continue;}if(x.isDirectory())walk(f);else if(/\.(md|txt|pdf)$/i.test(x.name)){const stat=fs.statSync(f),rel=path.relative(this.root,f).replace(/\\/g,'/');if(stat.size>20*1024*1024){diagnostics.push('文件超过20MiB，未索引：'+rel);continue;}const bytes=fs.readFileSync(f);found.push({file_path:rel,file_type:path.extname(f).slice(1).toLowerCase(),bytes,content_hash:hash(bytes),identity:String(stat.dev)+':'+String(stat.ino),mtime:stat.mtimeMs});}}};walk(this.root);
 const reserved=new Set(),newDocs=[],newIndex={};
 for(const f of found){let doc=previous.find(d=>d.file_path===f.file_path&&!reserved.has(d.document_id));
 if(!doc){for(const field of ['identity','content_hash']){const choices=previous.filter(d=>d[field]===f[field]&&!reserved.has(d.document_id)&&!found.some(n=>n.file_path===d.file_path));if(choices.length===1){doc=choices[0];break;}if(choices.length>1)diagnostics.push('重命名身份匹配有歧义，创建新ID：'+f.file_path);}}
 const isNew=!doc,changed=doc?.content_hash!==f.content_hash;doc={...(doc||{}),document_id:doc?.document_id||id('doc'),file_path:f.file_path,file_type:f.file_type,content_hash:f.content_hash,identity:f.identity,version:(doc?.version||0)+(changed?1:0),updated_at:changed?new Date(f.mtime).toISOString():doc.updated_at};reserved.add(doc.document_id);
 let pages;
 try{
 if(!changed&&doc.parser_version===7&&Array.isArray(this.index[doc.document_id])){newIndex[doc.document_id]=this.index[doc.document_id];}
 else{if(f.file_type==='pdf'){if(!this.parsePdf)throw Error('PDF解析器不可用');pages=await this.parsePdf(f.bytes);if(!Array.isArray(pages)||!pages.some(p=>p.text?.trim()))throw Error('未提取到文字，需要OCR');}else pages=[{text:f.bytes.toString('utf8'),page:undefined}];
 const body=pages.map(p=>p.text).join('\n');doc.title=doc.title||(/^#\s+(.+)/m.exec(body)?.[1])||path.basename(f.file_path,path.extname(f.file_path));
 doc.document_type=doc.metadata_override?.document_type||classify(f.file_path,body);doc.parser_version=7;doc.tags=doc.tags||[];doc.status=doc.status==='archived'?'archived':doc.document_type==='archived'?'archived':'active';
 doc.project_id=doc.project_id||(/^项目资料\//.test(f.file_path)?'project_'+doc.document_id:null);
 newIndex[doc.document_id]=pages.flatMap(p=>doc.document_type==='technical_reference'?splitReference(p.text,doc):split(p.text,doc,p.page));}
 if(doc.status==='missing'||doc.status==='retired'||doc.status==='error')doc.status='active';doc.parse_error=null;
 }catch(e){doc.status='error';doc.parse_error=e.message;diagnostics.push(f.file_path+'：'+e.message);newIndex[doc.document_id]=[];}
 newDocs.push(doc);
 }
 for(const d of previous)if(!reserved.has(d.document_id)){
  if(excludedSource(d.file_path)){newDocs.push({...d,status:'archived',retrieval_excluded:true,exclusion_reason:'dependency_or_local_asset'});continue;}
  const accepted=retirements.find(r=>r.document_id===d.document_id&&r.file_path===d.file_path&&r.content_hash===d.content_hash&&r.reason==='user_requested_cleanup');
  if(accepted)newDocs.push({...d,status:'retired',retirement_reason:accepted.reason});
  else{newDocs.push({...d,status:'missing'});diagnostics.push('来源已缺失，保留历史身份：'+d.file_path);}
 }
 const roles=[];const dirs=[...new Set(newDocs.filter(d=>d.status==='active'&&d.file_path.startsWith('岗位档案/')).map(d=>d.file_path.split('/')[1]))];
 for(const dir of dirs){const members=newDocs.filter(d=>d.status==='active'&&d.file_path.startsWith('岗位档案/'+dir+'/'));const old=this.manifest.roles.find(r=>r.directory===dir)||this.manifest.roles.find(r=>members.some(d=>(r.documents||[]).includes(d.document_id)));const role={role_id:old?.role_id||id('role'),directory:dir,title:dir,documents:members.map(d=>d.document_id)};roles.push(role);for(const d of members)d.role_id=role.role_id;}
 for(const d of newDocs)if(!d.file_path.startsWith('岗位档案/'))d.role_id=null;
 for(const required of this.manifest.policy?.required_document_ids||[])if(!newDocs.some(d=>d.document_id===required&&d.status==='active'))diagnostics.push('缺少必需文档ID：'+required);
 this.manifest={...this.manifest,documents:newDocs,roles};this.index=newIndex;this.diagnostics=diagnostics;
 const mf=path.join(this.dir,'manifest.json'),ix=path.join(this.dir,'index.json');const serialized=JSON.stringify(this.manifest);if(this.savedManifest!==serialized){atomic(mf,this.manifest);this.savedManifest=serialized;}
 const indexed=JSON.stringify(newIndex);if(this.savedIndex!==indexed){atomic(ix,newIndex);this.savedIndex=indexed;}return this;
 }
 locate(documentId,chunkId,contentHash){const d=this.manifest.documents.find(d=>d.document_id===documentId&&d.status==='active');if(!d)throw Error('来源已删除、归档或不可用；历史卡片保留当时摘录');const c=this.index[documentId]?.find(c=>c.chunk_id===chunkId&&c.content_hash===contentHash);if(!c)throw Error('来源内容已更新；请以卡片中的历史摘录为准');const f=inside(this.root,path.join(this.root,d.file_path));if(hash(fs.readFileSync(f))!==d.content_hash)throw Error('原文刚有变化，请刷新来源后重试');return {file:f,document:d,chunk:c};}
}
module.exports={Store,hash,split,classify,atomic,inside};
