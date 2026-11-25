'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BUCKETS = [
  { id: 'speaking_style', file: '表达与偏好.md', title: '表达与偏好', desc: '口风、结构与边界声明习惯（实时注入 ② 层）' },
  { id: 'weakness_pitfall', file: '薄弱项与踩坑.md', title: '薄弱项与踩坑', desc: '历次真实面试暴露的纠偏与避雷清单（实时注入 ② 层）' },
  { id: 'company_insight', file: '公司与岗位洞察.md', title: '公司与岗位洞察', desc: '面试官透露的团队真实关注点与技术栈偏好（按公司匹配注入）' },
  { id: 'pending_fact', file: '待审核新事实.md', title: '待审核新事实（门禁）', desc: '外部 Agent 提取的个人事实候选，确认前绝不注入实时面试' }
];

const BUCKET_MAP = new Map(BUCKETS.map(b => [b.id, b]));

function sha256(str) {
  return crypto.createHash('sha256').update(String(str || ''), 'utf8').digest('hex');
}

function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, String(content ?? ''), 'utf8');
  fs.renameSync(tmp, filePath);
}

function formatYmd(ts = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ts));
}

function formatTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function defaultBucketContent(bucket) {
  return `---\nknowledge_kind: interview_memory\nmemory_bucket: ${bucket.id}\nupdated_at: ${formatYmd()}\n---\n\n# ${bucket.title}\n\n> ${bucket.desc}\n`;
}

function parseBulletItems(markdown) {
  const lines = String(markdown || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const items = [];
  let inFrontmatter = lines[0]?.trim() === '---';
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFrontmatter) {
      if (i > 0 && line.trim() === '---') inFrontmatter = false;
      continue;
    }
    if (line.includes('<!--')) inComment = true;
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    const pendingMatch = /^-\s+\[\s\]\s+(.+)$/.exec(line.trim());
    if (pendingMatch) {
      items.push({ lineIndex: i, text: pendingMatch[1].trim(), pending: true });
      continue;
    }
    const bulletMatch = /^-\s+(?!\[[xX]\])(.+)$/.exec(line.trim());
    if (bulletMatch) {
      items.push({ lineIndex: i, text: bulletMatch[1].trim(), pending: false });
    }
  }
  return items;
}

function insideRoot(root, absTarget) {
  const base = path.resolve(root);
  const target = path.resolve(absTarget);
  if (target !== base && !target.toLowerCase().startsWith((base + path.sep).toLowerCase())) {
    throw new Error('目标路径超出资料库根目录');
  }
  return target;
}

function createMemoryStore({ getRoot, snapshotDir }) {
  function requireRoot() {
    const r = String(getRoot?.() || '').trim();
    if (!r || !fs.existsSync(r)) throw new Error('尚未配置有效的本地资料库目录');
    return path.resolve(r);
  }

  function memoryDir(root) {
    const dir = insideRoot(root, path.join(root, '面试记忆'));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function readAllBuckets(root) {
    const dir = memoryDir(root);
    const files = {};
    const parsed = [];
    for (const b of BUCKETS) {
      const fp = path.join(dir, b.file);
      if (!fs.existsSync(fp)) {
        writeAtomic(fp, defaultBucketContent(b));
      }
      const content = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '');
      files[b.id] = content;
      parsed.push({
        ...b,
        filePath: `面试记忆/${b.file}`,
        absPath: fp,
        content,
        hash: sha256(content),
        items: parseBulletItems(content)
      });
    }
    return { files, parsed, combinedHash: sha256(JSON.stringify(files)) };
  }

  function loadIndex() {
    const idxFile = path.join(snapshotDir, 'index.json');
    if (!fs.existsSync(idxFile)) return { schema: 1, latestVersion: 0, snapshots: [] };
    try {
      const data = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
      if (data?.schema === 1 && Array.isArray(data.snapshots)) return data;
    } catch {}
    return { schema: 1, latestVersion: 0, snapshots: [] };
  }

  function saveIndex(idx) {
    writeAtomic(path.join(snapshotDir, 'index.json'), JSON.stringify(idx, null, 2));
  }

  function recordSnapshotIfChanged(files, combinedHash, { source = 'external-agent', summary = '' } = {}) {
    const idx = loadIndex();
    const last = idx.snapshots[idx.snapshots.length - 1];
    if (last && last.combinedHash === combinedHash) {
      return { recorded: false, index: idx };
    }
    const prevFiles = last ? readSnapshotFiles(last.version) : {};
    const changedBuckets = BUCKETS
      .map(b => b.id)
      .filter(id => (prevFiles[id] || '') !== (files[id] || ''));

    const version = (idx.latestVersion || 0) + 1;
    const entry = {
      version,
      createdAt: Date.now(),
      source,
      summary: summary || (version === 1 ? '初始化记忆库基线快照' : `检测到 ${changedBuckets.map(id => BUCKET_MAP.get(id)?.title || id).join('、')} 更新`),
      changedBuckets,
      combinedHash
    };
    writeAtomic(path.join(snapshotDir, `v${version}.json`), JSON.stringify({ ...entry, files }, null, 2));
    idx.latestVersion = version;
    idx.snapshots.push(entry);
    if (idx.snapshots.length > 60) idx.snapshots = idx.snapshots.slice(-60);
    saveIndex(idx);
    return { recorded: true, entry, index: idx };
  }

  function readSnapshotFiles(version) {
    const fp = path.join(snapshotDir, `v${Number(version)}.json`);
    if (!fs.existsSync(fp)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      return data.files || {};
    } catch {
      return {};
    }
  }

  function getState() {
    const root = requireRoot();
    const { files, parsed, combinedHash } = readAllBuckets(root);
    const { index } = recordSnapshotIfChanged(files, combinedHash, { source: 'external-agent' });
    const pendingBucket = parsed.find(b => b.id === 'pending_fact');
    const pendingCount = (pendingBucket?.items || []).filter(i => i.pending).length;
    return {
      root,
      memoryDir: path.join(root, '面试记忆'),
      buckets: parsed,
      pendingCount,
      latestVersion: index.latestVersion,
      snapshots: [...index.snapshots].reverse()
    };
  }

  function getSnapshotDiff(version) {
    const v = Number(version);
    const idx = loadIndex();
    const curIdx = idx.snapshots.findIndex(s => s.version === v);
    if (curIdx < 0) throw new Error(`未找到快照 v${v}`);
    const cur = idx.snapshots[curIdx];
    const prev = curIdx > 0 ? idx.snapshots[curIdx - 1] : null;
    const curFiles = readSnapshotFiles(cur.version);
    const prevFiles = prev ? readSnapshotFiles(prev.version) : {};
    return {
      version: cur.version,
      prevVersion: prev ? prev.version : 0,
      createdAt: cur.createdAt,
      source: cur.source,
      summary: cur.summary,
      changedBuckets: cur.changedBuckets || [],
      files: BUCKETS.map(b => ({
        id: b.id,
        title: b.title,
        before: prevFiles[b.id] || '',
        after: curFiles[b.id] || '',
        changed: (prevFiles[b.id] || '') !== (curFiles[b.id] || '')
      }))
    };
  }

  function saveBucket({ bucket, content, summary }) {
    const meta = BUCKET_MAP.get(bucket);
    if (!meta) throw new Error('未知记忆分区：' + bucket);
    const root = requireRoot();
    const fp = path.join(memoryDir(root), meta.file);
    writeAtomic(fp, String(content ?? ''));
    const { files, combinedHash } = readAllBuckets(root);
    recordSnapshotIfChanged(files, combinedHash, {
      source: 'app-edit',
      summary: summary || `在应用内编辑了「${meta.title}」`
    });
    return getState();
  }

  function appendItem({ bucket, text }) {
    const meta = BUCKET_MAP.get(bucket);
    if (!meta) throw new Error('未知记忆分区：' + bucket);
    const clean = String(text || '').trim().replace(/\r?\n+/g, ' ');
    if (!clean) throw new Error('记忆内容不能为空');
    const root = requireRoot();
    const fp = path.join(memoryDir(root), meta.file);
    const cur = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : defaultBucketContent(meta);
    const prefix = bucket === 'pending_fact' ? '- [ ] **[pending]** ' : '- ';
    const next = cur.trimEnd() + '\n' + prefix + clean + '\n';
    writeAtomic(fp, next);
    const { files, combinedHash } = readAllBuckets(root);
    recordSnapshotIfChanged(files, combinedHash, {
      source: 'app-edit',
      summary: `向「${meta.title}」新增 1 条记录`
    });
    return getState();
  }

  function resolvePendingFact({ lineIndex, decision = 'approve', targetBucket = 'weakness_pitfall' }) {
    const root = requireRoot();
    const dir = memoryDir(root);
    const pendingPath = path.join(dir, '待审核新事实.md');
    const raw = fs.readFileSync(pendingPath, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/);
    if (lineIndex < 0 || lineIndex >= lines.length) throw new Error('待审核条目行号无效');
    const targetLine = lines[lineIndex];
    const m = /^-\s+\[\s\]\s+(.+)$/.exec(targetLine.trim());
    if (!m) throw new Error('该行不是待审核条目');
    const cleanFact = m[1].replace(/^\*\*\[pending\]\*\*\s*/i, '').trim();

    if (decision === 'approve') {
      lines[lineIndex] = `- [x] **[approved ${formatYmd()}]** ${cleanFact}`;
      writeAtomic(pendingPath, lines.join('\n'));
      const destMeta = BUCKET_MAP.get(targetBucket) || BUCKET_MAP.get('weakness_pitfall');
      if (destMeta && destMeta.id !== 'pending_fact') {
        const destPath = path.join(dir, destMeta.file);
        const destRaw = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : defaultBucketContent(destMeta);
        writeAtomic(destPath, destRaw.trimEnd() + `\n- **[已审核确认 ${formatYmd()}]** ${cleanFact}\n`);
      }
    } else {
      lines.splice(lineIndex, 1);
      writeAtomic(pendingPath, lines.join('\n'));
    }
    const { files, combinedHash } = readAllBuckets(root);
    recordSnapshotIfChanged(files, combinedHash, {
      source: 'approval',
      summary: decision === 'approve' ? `审核通过 1 条新事实并并入记忆` : `驳回 1 条待审核事实`
    });
    return getState();
  }

  function rollbackSnapshot(version) {
    const v = Number(version);
    const snapFiles = readSnapshotFiles(v);
    if (!Object.keys(snapFiles).length) throw new Error(`快照 v${v} 不存在或为空`);
    const root = requireRoot();
    const dir = memoryDir(root);
    for (const b of BUCKETS) {
      if (typeof snapFiles[b.id] === 'string') {
        writeAtomic(path.join(dir, b.file), snapFiles[b.id]);
      }
    }
    const { files, combinedHash } = readAllBuckets(root);
    recordSnapshotIfChanged(files, combinedHash, {
      source: 'rollback',
      summary: `回滚记忆库至快照 v${v}`
    });
    return getState();
  }

  function archiveSessionToRole({ session, roleDirectory, roundLabel = '一面', userFeeling = '', audioTakes = [] }) {
    const root = requireRoot();
    if (!session || !session.id) throw new Error('无效的会话对象');
    const cleanRole = String(roleDirectory || session.role || '').trim();
    if (!cleanRole) throw new Error('请先选择要归档的目标岗位目录');
    const safeRound = String(roundLabel || '一面').replace(/[\\/:*?"<>|]/g, '-').trim() || '一面';
    const ymd = formatYmd(session.createdAt || Date.now());
    const folderName = `${ymd}-${safeRound}`;
    const roleDir = insideRoot(root, path.join(root, '岗位档案', cleanRole));
    if (!fs.existsSync(roleDir)) throw new Error(`岗位目录不存在：${cleanRole}`);

    const archiveDir = insideRoot(root, path.join(roleDir, '面试记录', folderName));
    fs.mkdirSync(archiveDir, { recursive: true });

    // 1. Build immutable raw transcript + AI reference Markdown
    const lines = [
      `# ${cleanRole} · ${folderName} 原始转录与 AI 参考`,
      '',
      `- 会话名称：${session.name || ''}`,
      `- 会话 ID：${session.id}`,
      `- 开始时间：${new Date(session.createdAt || Date.now()).toLocaleString('zh-CN')}`,
      `- 音频来源：${session.audioSource === 'mic' ? '麦克风' : '系统音频'}`,
      `- 录音文件（存于外部应用目录，不入 Git）：${audioTakes.length ? `${audioTakes.length} 段双轨 WAV（见 session.json）` : '本场未开启整场录音'}`,
      '',
      '> **声明**：本文件为 MeetingCopilot 原始只读归档。下方「实时语音转写」为未校对 ASR 原文；「当场 AI 参考回答」为软件生成的实时草稿，**绝不等同于候选人真实说过的话或已具备的经历**。',
      '',
      '## 一、实时语音转写（原始未校对）',
      ''
    ];
    const segs = session.segments || [];
    if (!segs.length) {
      lines.push('（本场未记录语音转写片段）', '');
    } else {
      segs.forEach((seg, idx) => {
        const tag = seg.speaker === 'me' ? '我（本人）' : '面试官（对方）';
        const ts = formatTime(seg.endTs || seg.startTs);
        lines.push(`- **S${String(idx + 1).padStart(3, '0')}** [${ts}] **${tag}**：${seg.text}`);
      });
      lines.push('');
    }

    lines.push('## 二、当场提问与 AI 参考回答（仅供对照，非本人发言）', '');
    const qs = session.questions || [];
    if (!qs.length) {
      lines.push('（本场未记录 AI 问答）', '');
    } else {
      qs.forEach((q, idx) => {
        const activeAtt = (q.attempts || []).find(a => a.id === q.activeAttemptId) || (q.attempts || []).at(-1);
        lines.push(`### Q${String(idx + 1).padStart(2, '0')}：${q.prompt}`);
        lines.push('');
        lines.push('**[AI 参考草稿]**');
        lines.push('');
        lines.push(activeAtt?.text || '（无回答文本）');
        lines.push('');
      });
    }

    const rawMdPath = path.join(archiveDir, '原始转录与AI参考.md');
    writeAtomic(rawMdPath, lines.join('\n'));

    // 2. Write session.json with external audio pointers (NEVER copy WAVs here!)
    const sessionJsonPath = path.join(archiveDir, 'session.json');
    const sessionMeta = {
      schema: 1,
      archivedAt: Date.now(),
      roleDirectory: cleanRole,
      round: folderName,
      session: {
        id: session.id,
        name: session.name,
        role: cleanRole,
        audioSource: session.audioSource,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        segmentsCount: segs.length,
        questionsCount: qs.length
      },
      audio_takes: audioTakes.map(t => ({
        takeId: t.takeId,
        durationSec: t.durationSec,
        tracks: (t.tracks || []).map(tr => ({ channel: tr.channel, path: tr.path, bytes: tr.bytes, durationSec: tr.durationSec }))
      }))
    };
    writeAtomic(sessionJsonPath, JSON.stringify(sessionMeta, null, 2));

    // 3. Optional user reflection file
    let reflectionPath = null;
    const cleanFeeling = String(userFeeling || '').trim();
    if (cleanFeeling) {
      reflectionPath = path.join(archiveDir, '本人面试后感受.md');
      writeAtomic(reflectionPath, `# 本人面试后感受（${folderName}）\n\n${cleanFeeling}\n`);
    }

    // 4. Build ready-to-paste Codex / Antigravity review instruction prompt
    const relArchive = path.relative(root, archiveDir).replace(/\\/g, '/');
    const agentPrompt = [
      `请严格按照 \`${path.join(root, '复盘与更新规则.md')}\` 执行本场面试复盘与知识库更新：`,
      '',
      `- 资料库根目录：\`${root}\``,
      `- 本场归档目录：\`${archiveDir}\`（相对路径：\`${relArchive}\`）`,
      `- 原始转录与 AI 参考：\`${rawMdPath}\``,
      `- 会话元数据与双轨 WAV 指针：\`${sessionJsonPath}\``,
      cleanFeeling
        ? `- 本人本次面试感受（请按模式 A 忠实保留并核对）：\n  > ${cleanFeeling.replace(/\r?\n/g, '\n  > ')}`
        : `- 本人未额外填写感受：请按规则「模式 B」回看未校对原始转录中的可观察表达特征（严谨区分 ASR 断句误差与语义卡壳，不武断给紧张打分）。`,
      '',
      '请依次完成：',
      `1. 保持原件只读不变，在本场目录输出 \`转录校对版.md\` 和 6 段标准 \`面试复盘.md\`；`,
      `2. 按 4 路分流规则更新 \`面试记忆/\`（个人/项目新事实写入 \`面试记忆/待审核新事实.md\` 等待我确认；口风/避坑/公司洞察增量更新对应文件），并在必要时向 \`通用问答/\` 或 \`通用技术知识/实战真题补充/\` 沉淀高价值真题；`,
      `3. 同步更新 \`岗位档案/${cleanRole}/JD.md\` 顶部 YAML 的 \`status\` 与 \`rounds\`（追加 \`${folderName}\`），最后给我一份清晰的变更摘要。`
    ].join('\n');

    return {
      ok: true,
      archiveDir,
      relArchive,
      rawMdPath,
      sessionJsonPath,
      reflectionPath,
      roundFolder: folderName,
      agentPrompt
    };
  }

  return {
    getState,
    getSnapshotDiff,
    saveBucket,
    appendItem,
    resolvePendingFact,
    rollbackSnapshot,
    archiveSessionToRole
  };
}

module.exports = {
  createMemoryStore,
  BUCKETS
};
