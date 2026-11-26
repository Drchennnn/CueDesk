'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {Store, hash, atomic} = require('./store.cjs');

function createVectorSource(parsePdf) {
  let curated;
  async function open(options) {
    if (!curated || curated.root !== path.resolve(options.source_root) || curated.dir !== options.index_directory) {
      curated = new Store({root: options.source_root, dir: options.index_directory, parsePdf});
    }
    await curated.refresh();
    return curated;
  }
  return {
    async view(primary, options) {
      if (!options?.enabled || path.resolve(options.library_root) !== primary.root) return primary;
      let extra;
      try { extra = await open(options); }
      catch (error) {
        return {...primary, locate: primary.locate.bind(primary),
          diagnostics: [...primary.diagnostics, '整理问答加载失败：' + error.message]};
      }
      const documents = extra.manifest.documents.filter(d => d.document_type === 'technical_reference');
      const extraIds = new Set(documents.map(d => d.document_id));
      const originals = options.replaced_directory.replace(/\\/g, '/').replace(/\/$/, '') + '/';
      return {
        root: primary.root, dir: primary.dir,
        manifest: {...primary.manifest, documents: [
          ...primary.manifest.documents.map(d => d.document_type === 'technical_reference' && d.file_path.startsWith(originals)
            ? {...d, retrieval_excluded: true} : d),
          ...documents.map(d => ({...d, file_path: path.relative(primary.root, path.join(extra.root, d.file_path)).replace(/\\/g, '/')}))
        ]},
        index: {...primary.index, ...extra.index},
        diagnostics: [...primary.diagnostics, ...extra.diagnostics],
        locate(documentId, chunkId, contentHash) {
          // Keep the original Store available so historical citations still open.
          return (extraIds.has(documentId) ? extra : primary).locate(documentId, chunkId, contentHash);
        }
      };
    },
    async snapshot(options, output) {
      const source = await open(options);
      const mapping = JSON.parse(fs.readFileSync(options.source_map, 'utf8').replace(/^\uFEFF/, ''));
      const byFile = new Map(mapping.entries.map(e => [path.basename(e.file_path), e]));
      const byPath = new Map(mapping.entries.map(e => [e.file_path.replace(/\\/g, '/'), e]));
      const active = source.manifest.documents.filter(d => d.status === 'active');
      if (active.length !== mapping.entries.length || active.length === 0) throw Error('整理问答与来源映射的数量不一致');
      const entries = active.map(d => {
        const origin = byPath.get(d.file_path) || byFile.get(d.file_path);
        const chunks = source.index[d.document_id] || [];
        if (!origin || origin.content_sha256 !== d.content_hash || !chunks.length || d.document_type !== 'technical_reference') {
          throw Error('整理问答身份或内容校验失败：' + d.file_path);
        }
        return {
          entry_id: origin.entry_id, question: origin.question, file_path: d.file_path,
          document_id: d.document_id, document_hash: d.content_hash,
          sources: origin.sources, source_item_ids: origin.source_item_ids,
          verified_urls: origin.verified_urls, chunks
        };
      }).sort((a, b) => a.entry_id.localeCompare(b.entry_id));
      const payload = {schema: 1, source_root: source.root, entries};
      const snapshot = {...payload, snapshot_sha256: hash(JSON.stringify(payload))};
      atomic(output, snapshot);
      return {entries: entries.length, chunks: entries.reduce((n, e) => n + e.chunks.length, 0), snapshot_sha256: snapshot.snapshot_sha256};
    }
  };
}

module.exports = {createVectorSource};
