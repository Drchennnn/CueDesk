'use strict';
const fs=require('node:fs'),path=require('node:path');
const {inside,hash}=require('./store.cjs');
function loadPersona(store,selection){
 if(!selection?.enabled)return null;
 const d=store.manifest.documents.find(d=>d.document_id===selection.document_id&&d.status==='active'&&d.document_type==='candidate_profile'&&!d.role_id);
 if(!d)throw Error('指定的固定候选人画像缺失或类型不正确，请重新选择');
 const file=inside(store.root,path.join(store.root,d.file_path)),bytes=fs.readFileSync(file);
 if(hash(bytes)!==d.content_hash)throw Error('候选人画像刚有变化，请刷新后重试');
 const m=/```json\s*\n([\s\S]*?)\n```/.exec(bytes.toString('utf8'));
 if(!m||m[1].length>12000)throw Error('候选人画像格式不正确');
 const p=JSON.parse(m[1]),levels=['conceptual_no_practice','ai_assisted_verified','unfamiliar','independent'];
 if(p.schema!==1||!p.identity||!Array.isArray(p.skills)||p.skills.length>20||p.skills.some(s=>!levels.includes(s.level)||typeof s.area!=='string'||typeof s.scope!=='string'))throw Error('候选人画像字段不正确');
 const text=v=>String(v||'').slice(0,600);
 return {document_id:d.document_id,content_hash:d.content_hash,confirmed_at:text(p.confirmed_at),identity:{name:text(p.identity.name),education:text(p.identity.education),positioning:text(p.identity.positioning),...(p.identity.availability?{availability:text(p.identity.availability)}:{})},skills:p.skills.map(s=>({area:text(s.area),level:s.level,scope:text(s.scope)}))};
}
function supportsAbility(p,q){
 if(!p||/事故|故障|线上|生产|哪次|哪一次|具体参数|准确率|百分|提升多少|多少用户/.test(q))return false;
 if(p.identity?.availability&&/到岗|实习时间|最早|几个月|几天|出勤|办公室|on[\s-]?site|start\s+date|available/i.test(q))return true;
 return p.skills.some(s=>((/Linux|部署/i.test(s.area)&&/Linux|部署|内核|网络排障/i.test(q))||(/后端/.test(s.area)&&/Flask|FastAPI|后端接口/i.test(q))||(/前端/.test(s.area)&&/前端|React|Vue/i.test(q))||(/SQL|MySQL|PostgreSQL|Redis/i.test(s.area)&&/掌握|水平|程度|用过|用到|了解|数据库/i.test(q)&&/SQL|MySQL|PostgreSQL|Postgres|Redis|数据库/i.test(q))||(/Kafka|消息队列/i.test(s.area)&&/Kafka|消息队列/i.test(q)&&/了解|掌握|熟悉|用过|做过/i.test(q))||(/性能测试/i.test(s.area)&&/性能测试|压测/i.test(q)&&/了解|做过|用过|熟悉/i.test(q))||(/异步/.test(s.area)&&/异步|线程|进程|并发/.test(q)&&/熟|掌握|水平|实践/.test(q))));
}
module.exports={loadPersona,supportsAbility};
