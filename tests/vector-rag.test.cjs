'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {Store} = require('../cuedesk/v2/store.cjs');
const {createVectorSource} = require('../cuedesk/v2/vector-source.cjs');
const {createVectorClient} = require('../cuedesk/v2/vector-client.cjs');
const {createInterviewLibrary} = require('../cuedesk/v2/library.cjs');

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-rag-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const root = path.join(directory, 'library');
  const curated = path.join(root, '_backup-curated', 'qa');
  fs.mkdirSync(curated, {recursive: true});
  fs.mkdirSync(path.join(root, '通用技术知识', '资料'), {recursive: true});
  fs.writeFileSync(path.join(root, '通用技术知识', '资料', 'old.md'),
    '---\nknowledge_kind: technical_reference\n---\n# 旧技术资料\n#### 为什么请求会重复\n请求重试需要幂等。');
  fs.writeFileSync(path.join(curated, 'idempotency.md'),
    '---\nknowledge_kind: technical_reference\nquestion_level: 4\n---\n# 幂等性\n#### 幂等性是什么\n幂等保证多次执行产生同样的业务效果。使用业务唯一键约束重复操作。');
  const options = {enabled: true, library_root: root, source_root: curated,
    index_directory: path.join(directory, 'curated-index'), replaced_directory: '通用技术知识/资料',
    snapshot_sha256: 'test-snapshot', auto_start: false};
  const extra = new Store({root: curated, dir: options.index_directory});
  const primary = new Store({root, dir: path.join(directory, 'primary-index')});
  await extra.refresh();
  await primary.refresh();
  const doc = extra.manifest.documents[0], chunk = extra.index[doc.document_id][0];
  const hit = {entry_id: 'idempotency', document_id: doc.document_id, document_hash: doc.content_hash,
    chunk_id: chunk.chunk_id, content_hash: chunk.content_hash, score: 1};
  let responseHits = [hit], snapshot = 'test-snapshot', queries = [], requests = [];
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    let body = '';
    request.on('data', data => { body += data; });
    request.on('end', () => {
      if (request.url === '/search') { requests.push(JSON.parse(body)); queries.push(JSON.parse(body).question); }
      response.end(JSON.stringify({snapshot_sha256: snapshot, model: 'text-embedding-v4', hits: responseHits}));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  options.endpoint = 'http://127.0.0.1:' + server.address().port;
  const file = path.join(directory, 'config.json');
  fs.writeFileSync(file, JSON.stringify({enabled: true, root, role: '', vector_rag: options}));
  return {root, directory, options, primary, extra, doc, chunk, hit, queries, requests,
    library: createInterviewLibrary({file}), setHits(value) { responseHits = value; },
    setSnapshot(value) { snapshot = value; }};
}

test('curated overlay replaces original technical search while both generations of citations resolve', async t => {
  const f = await fixture(t);
  const view = await createVectorSource().view(f.primary, f.options);
  assert.equal(view.manifest.documents.length, 2);
  assert.equal(view.manifest.documents[0].retrieval_excluded, true);
  assert.equal(view.manifest.documents[1].document_id, f.doc.document_id);
  assert.equal(view.locate(f.doc.document_id, f.chunk.chunk_id, f.chunk.content_hash).file, path.join(f.options.source_root, 'idempotency.md'));
  const old = f.primary.manifest.documents[0], chunk = f.primary.index[old.document_id][0];
  assert(view.locate(old.document_id, chunk.chunk_id, chunk.content_hash).file.endsWith('old.md'));
  assert.equal(await createVectorSource().view(f.primary, {...f.options, library_root: f.directory}), f.primary);
});

test('snapshot source mappings preserve relative paths with duplicate nested filenames', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-snapshot-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const root = path.join(directory, 'sources');
  for (const name of ['first', 'second']) {
    fs.mkdirSync(path.join(root, name), {recursive: true});
    fs.writeFileSync(path.join(root, name, 'question.md'),
      '---\nknowledge_kind: technical_reference\n---\n# ' + name + '\n#### 如何检索\n保留来源路径。');
  }
  const index = path.join(directory, 'index');
  const store = new Store({root, dir: index});
  await store.refresh();
  const mapping = path.join(directory, 'mapping.json');
  fs.writeFileSync(mapping, JSON.stringify({entries: store.manifest.documents.map(doc => ({
    entry_id: doc.document_id, file_path: doc.file_path, content_sha256: doc.content_hash,
    question: doc.title, sources: [], source_item_ids: [], verified_urls: []
  }))}));
  const output = path.join(directory, 'snapshot.json');
  const result = await createVectorSource().snapshot({source_root: root, index_directory: index, source_map: mapping}, output);
  assert.equal(result.entries, 2);
  assert.deepEqual(new Set(JSON.parse(fs.readFileSync(output, 'utf8')).entries.map(entry => entry.file_path)),
    new Set(['first/question.md', 'second/question.md']));
});

test('normal library entry uses semantic hit without a shared literal question and retains citation identity', async t => {
  const f = await fixture(t);
  const messages = await f.library.build({question: '网络抖动时怎样避免付款被扣两遍？'}, []);
  assert.equal(messages.evidence[0].document_id, f.doc.document_id);
  assert.equal(messages.evidence[0].content_hash, f.chunk.content_hash);
  assert.equal(messages.evidence[0].may_support_personal_action, false);
  assert.equal((await f.library.getPublic()).last.vector_retrieval.active, true);
  assert.equal(f.queries[0], messages.dialogueState.effective_question);
  assert((await f.library.locate(messages.evidence[0])).file.endsWith('idempotency.md'));
});

test('changed hashes and wrong snapshots cannot be used as current evidence', async t => {
  const f = await fixture(t);
  const view = await createVectorSource().view(f.primary, f.options);
  f.setHits([{...f.hit, content_hash: 'outdated'}]);
  const client = createVectorClient();
  const stale = await client.search(f.options, '重复操作', view);
  assert.equal(stale.active, false);
  assert.equal(stale.hits.length, 0);
  assert.match(stale.diagnostic, /同步索引/);
  f.setSnapshot('other');
  const wrong = await client.search(f.options, '重复操作', view);
  assert.equal(wrong.active, false);
  assert.match(wrong.diagnostic, /快照/);
});

test('followup retrieval receives bounded draft context and changed sessions discard it', async t => {
  const f=await fixture(t);
  const first=await f.library.build({question:'工具调用失败如何处理？',sessionId:'one'},[]);
  const history=[{role:'user',content:'工具调用失败如何处理？'},{role:'assistant',content:'先检查请求是否执行成功。'}];
  const next=await f.library.build({question:'然后呢？',sessionId:'one',dialogueState:first.dialogueState,history},[]);
  assert.equal(f.requests.at(-1).previous_assistant_draft,history[1].content);
  assert(JSON.stringify(next).includes('仅用历史确定指代'));
  await f.library.build({question:'工具调用如何实现？',sessionId:'two',dialogueState:first.dialogueState,history},[]);
  assert.equal(f.requests.at(-1).previous_assistant_draft,'');
});

test('a scenario correction drops the disputed AI draft before query rewriting', async t => {
 const f=await fixture(t);
 const first=await f.library.build({question:'假设一个工具给一万人使用，你会怎么做？',sessionId:'one'},[]);
 await f.library.build({question:'为什么一定要用后端？可以做成前端插件。',sessionId:'one',dialogueState:first.dialogueState,
  history:[{role:'assistant',content:'我会采用统一后端管理所有数据。'}]},[]);
 assert.equal(f.requests.at(-1).previous_assistant_draft,'');
});

test('service failure falls back to curated keyword retrieval and preserves unknown personal experience', async t => {
  const f = await fixture(t);
  f.setSnapshot('unavailable');
  const messages = await f.library.build({question: '幂等性是什么'}, []);
  assert(messages.evidence.some(e => e.document_id === f.doc.document_id));
  assert(messages.diagnostics.some(value => value.includes('关键词检索')));
  const personal = await f.library.build({question: '你之前处理过支付重复扣款线上事故吗？讲一次真实经历。'}, []);
  assert(personal.blockedUnknown);
  assert(personal.evidence.every(e => !e.may_support_personal_action));
});

test('generic RAG methods do not acquire a personal project merely by naming RAG', () => {
  const {resolve} = require('../cuedesk/v2/dialogue.cjs');
  const documents = [{project_id: 'project-rag', file_path: '项目资料/SRAG.md', title: 'SRAG项目'}];
  const state = resolve({question: 'RAG的切快一般有什么方法？'}, documents, 'test');
  assert.deepEqual(state.project_ids, []);
  const own = resolve({question: '你的RAG项目切块用了什么策略？'}, documents, 'test');
  assert.deepEqual(own.project_ids, ['project-rag']);
});

 test('parent block linkage remains understandable in oral answers', () => {
  const {parseAnswer}=require('../cuedesk/v2/evidence.cjs');
  assert.equal(parseAnswer('按 parent_id 取出父块正文。',[],true).oral_answer,'按 父块 ID 取出父块正文。');
 });
