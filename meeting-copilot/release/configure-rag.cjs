'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const {Store, atomic} = require('../app/resources/tools/knowledge-v2/store.cjs');
const {createVectorSource} = require('../app/resources/tools/knowledge-v2/vector-source.cjs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

async function configure() {
  const input = read(path.join(root, 'config', 'vector-rag.json'));
  const runtime = read(path.join(root, 'config', 'runtime.json'));
  for (const field of ['libraryRoot', 'sourceRoot', 'baseAddress', 'embeddingModel']) {
    if (!String(input[field] || '').trim()) throw Error('请先填写 config/vector-rag.json 中的 ' + field);
  }
  if (!Number.isInteger(input.dimensions) || input.dimensions < 1) throw Error('dimensions 应为正整数');
  if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) throw Error('port 应为 1024–65535');
  const data = process.env.MC_USERDATA ? path.resolve(process.env.MC_USERDATA) : path.join(root, 'data');
  const libraryFile = path.join(data, 'interview-library.json');
  if (!fs.existsSync(libraryFile)) {
    fs.mkdirSync(data, {recursive: true});
    fs.copyFileSync(path.join(root, 'config/defaults/interview-library.json'), libraryFile);
  }
  const libraryRoot = fs.realpathSync(path.resolve(root, input.libraryRoot));
  const sourceRoot = fs.realpathSync(path.resolve(root, input.sourceRoot));
  const ragRoot = path.join(data, 'vector-rag');
  const indexDirectory = path.join(ragRoot, 'native-index');
  const source = new Store({root: sourceRoot, dir: indexDirectory});
  await source.refresh();
  const documents = source.manifest.documents.filter(doc => doc.status === 'active');
  if (!documents.length || documents.some(doc => doc.document_type !== 'technical_reference')) {
    throw Error('sourceRoot 应只包含 technical_reference 类型的 Markdown 技术问答，请参照配置指南');
  }
  const build = path.join(ragRoot, 'build-' + Date.now());
  fs.mkdirSync(build, {recursive: true});
  let sourceMap;
  if (input.sourceMap) sourceMap = path.resolve(root, input.sourceMap);
  else {
    sourceMap = path.join(build, 'source-map.json');
    atomic(sourceMap, {entries: documents.map(doc => ({
      entry_id: doc.document_id, file_path: doc.file_path, content_sha256: doc.content_hash,
      question: doc.title, sources: [], source_item_ids: [], verified_urls: []
    }))});
  }
  const python = path.resolve(root, input.python || 'rag/.venv/Scripts/python.exe');
  if (!fs.existsSync(python)) throw Error('找不到向量环境的 Python，请先运行安装向量依赖.cmd，或填写 python 路径');
  const options = {enabled: true, library_root: libraryRoot, source_root: sourceRoot,
    source_map: sourceMap, index_directory: indexDirectory,
    replaced_directory: String(input.replacedDirectory || ''),
    endpoint: 'http://127.0.0.1:' + input.port, auto_start: true, python,
    service_script: path.join(root, 'rag', 'service.py'), runtime_config: path.join(build, 'runtime.json'),
    credential_settings: path.join(data, 'settings.json')};
  const snapshot = path.join(build, 'snapshot.json');
  const receipt = await createVectorSource().snapshot(options, snapshot);
  options.snapshot_sha256 = receipt.snapshot_sha256;
  atomic(options.runtime_config, {
    snapshot, storage: path.join(ragRoot, 'qdrant'), model: input.embeddingModel,
    dimensions: input.dimensions, base_address: input.baseAddress,
    collection_alias: 'interview_knowledge', embedding_cache: path.join(ragRoot, 'embedding-cache'),
    report: path.join(ragRoot, 'ingestion-report.json'), port: input.port,
    rerank_model: input.rerankModel || '', minimum_rerank_score: 0.35, rewrite_model: input.rewriteModel || ''
  });
  const apiKey = runtime.dashscopeApiKey || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw Error('请填写 config/runtime.json 的 dashscopeApiKey，或设置 DASHSCOPE_API_KEY 环境变量');
  execFileSync(python, [options.service_script, '--config', options.runtime_config, '--sync-only'], {
    windowsHide: true, stdio: 'inherit', env: {...process.env, DASHSCOPE_API_KEY: apiKey, PYTHONIOENCODING: 'utf-8'}
  });
  const config = read(libraryFile);
  const sameRoot = config.root && path.resolve(config.root).toLowerCase() === libraryRoot.toLowerCase();
  atomic(libraryFile, {...config, enabled: true, root: libraryRoot,
    role: sameRoot ? config.role : '', role_id: sameRoot ? config.role_id : null,
    persona_profile: sameRoot ? config.persona_profile : null,
    intro_script: sameRoot ? config.intro_script : null, vector_rag: options});
  console.log('向量检索已配置，共 ' + receipt.entries + ' 篇资料。重新启动软件后生效。');
}

configure().catch(error => { console.error(error.message); process.exitCode = 1; });
