'use strict';
const fs = require('node:fs');
const path = require('node:path');

const PROTECTED_WRITE_PATTERNS = [
  /^通用技术知识\/_backup面试问答整理\//i
];

const PROTECTED_DELETE_PATTERNS = [
  /^通用技术知识\/_backup面试问答整理\//i,
  /^候选人画像\.md$/i,
  /^简历\.md$/i,
  /^复盘与更新规则\.md$/i,
  /^新增岗位与预测题规则\.md$/i
];

const VALID_ROLE_STATUSES = ['preparing', 'interviewing', 'waiting', 'offer', 'closed'];

function normRel(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function sanitizeSegment(raw) {
  const s = String(raw || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[（(](?:已面|未面试|待面|已结束)[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || s === '.' || s === '..') throw new Error('名称包含非法字符或为空');
  return s.slice(0, 80);
}

function insideRoot(root, absTarget) {
  const base = path.resolve(root);
  const target = path.resolve(absTarget);
  if (target !== base && !target.toLowerCase().startsWith((base + path.sep).toLowerCase())) {
    throw new Error('目标路径超出资料库根目录');
  }
  return target;
}

function writeAtomicUtf8(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, String(content ?? ''), 'utf8');
  fs.renameSync(tmp, filePath);
}

function formatDateYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function upsertYamlFrontmatter(text, patch) {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(clean);
  const existingLines = m ? m[1].split(/\r?\n/) : [];
  const body = m ? clean.slice(m[0].length) : clean;
  const patchKeys = new Set(Object.keys(patch));
  const kept = [];
  let skipArray = false;
  for (const line of existingLines) {
    if (!line.trim()) continue;
    if (/^\s+-\s/.test(line) && skipArray) continue;
    const km = /^([^:\s]+)\s*:/.exec(line);
    if (km && patchKeys.has(km[1])) {
      skipArray = true;
      continue;
    }
    skipArray = false;
    kept.push(line);
  }
  const added = [];
  for (const [k, v] of Object.entries(patch)) {
    if (Array.isArray(v)) {
      if (!v.length) added.push(`${k}: []`);
      else {
        added.push(`${k}:`);
        for (const item of v) added.push(`  - ${item}`);
      }
    } else {
      added.push(`${k}: ${v}`);
    }
  }
  return '---\n' + [...added, ...kept].join('\n') + '\n---\n\n' + body.replace(/^\r?\n+/, '');
}

function createKbWorkspace({ getRoot, trashItem }) {
  function requireRoot() {
    const r = String(getRoot?.() || '').trim();
    if (!r || !fs.existsSync(r)) throw new Error('尚未配置有效的本地资料库目录');
    return path.resolve(r);
  }

  function writeDocument({ filePath, content }) {
    const root = requireRoot();
    const rel = normRel(filePath);
    if (!rel || !/\.(md|txt|json)$/i.test(rel)) throw new Error('仅支持编辑 .md / .txt / .json 文档');
    if (PROTECTED_WRITE_PATTERNS.some(re => re.test(rel))) {
      throw new Error('该目录为本地向量库只读真源，请勿直接修改');
    }
    const full = insideRoot(root, path.join(root, rel));
    const prev = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
    writeAtomicUtf8(full, content);
    return { ok: true, filePath: rel, bytes: Buffer.byteLength(String(content ?? ''), 'utf8'), changed: prev !== content };
  }

  async function trashDocument({ filePath }) {
    const root = requireRoot();
    const rel = normRel(filePath);
    if (!rel) throw new Error('未指定文档路径');
    if (PROTECTED_DELETE_PATTERNS.some(re => re.test(rel))) {
      throw new Error('受保护的核心真源或规则文档不允许删除');
    }
    const full = insideRoot(root, path.join(root, rel));
    if (!fs.existsSync(full)) throw new Error('目标文件不存在');
    if (typeof trashItem === 'function') {
      await trashItem(full);
    } else {
      fs.rmSync(full, { force: true });
    }
    return { ok: true, filePath: rel };
  }

  function createRolePackage({ company, roleName, location = '', resumeRef = '简历.md', priorityProjects = [], jdText = '' }) {
    const root = requireRoot();
    const cleanCompany = sanitizeSegment(company);
    const cleanRole = sanitizeSegment(roleName);
    const dirName = `${cleanCompany}-${cleanRole}`;
    const roleDir = insideRoot(root, path.join(root, '岗位档案', dirName));
    if (fs.existsSync(roleDir)) throw new Error(`岗位目录已存在：${dirName}`);

    const today = formatDateYmd();
    const projects = (Array.isArray(priorityProjects) ? priorityProjects : String(priorityProjects || '').split(/[,，\s]+/))
      .map(s => s.trim())
      .filter(Boolean);

    const jdPath = path.join(roleDir, 'JD.md');
    const prepPath = path.join(roleDir, '岗位准备', '预测题与场景设计.md');
    fs.mkdirSync(path.join(roleDir, '岗位准备'), { recursive: true });
    fs.mkdirSync(path.join(roleDir, '外部面经'), { recursive: true });
    fs.mkdirSync(path.join(roleDir, '面试记录'), { recursive: true });

    const jdContent = upsertYamlFrontmatter(
      `# ${cleanCompany} · ${cleanRole} JD\n\n${String(jdText || '').trim() || '## 岗位职责\n\n- （待补充岗位职责与要求）\n\n## 面试安排与边界\n\n- 到岗时间、轮次与面试形式待通知确认。\n'}\n`,
      {
        company: cleanCompany,
        role: cleanRole,
        status: 'preparing',
        location: String(location || '').trim() || '待确认',
        resume_ref: String(resumeRef || '简历.md').trim(),
        priority_projects: projects,
        applied_at: today,
        updated_at: today,
        rounds: []
      }
    );

    const prepContent = upsertYamlFrontmatter(
      `# ${cleanCompany} · ${cleanRole} 预测题与场景设计\n\n> 本文件为当前岗位 ③ 层预演参考思路，仅在选定本岗位时参与检索，不作为已完成的个人项目经历。\n\n### [P01] 结合 JD 业务场景，你会如何切入这个岗位的核心任务？\n\n**一句话切入判断**\n先明确业务约束、输入输出与验证指标，再从最小可运行闭环切入。\n\n**展开思路（假设方案）**\n- 如果由我设计，我会先梳理数据流与失败边界，再确定可验证的评测标准。\n\n**高频追问预演**\n- 追问：你的哪个项目与这里最接近？→ 按 \`项目资料/\` 真实边界作答，未实现部分用“我会”展开。\n`,
      {
        knowledge_kind: 'role_prep',
        company: cleanCompany,
        role: cleanRole,
        updated_at: today
      }
    );

    writeAtomicUtf8(jdPath, jdContent);
    writeAtomicUtf8(prepPath, prepContent);

    return {
      ok: true,
      directory: dirName,
      jdPath: `岗位档案/${dirName}/JD.md`,
      prepPath: `岗位档案/${dirName}/岗位准备/预测题与场景设计.md`
    };
  }

  function updateRoleStatus({ directory, status, roundLabel }) {
    const root = requireRoot();
    if (!VALID_ROLE_STATUSES.includes(status)) throw new Error('无效的岗位状态：' + status);
    const dirName = sanitizeSegment(directory);
    const jdFull = insideRoot(root, path.join(root, '岗位档案', dirName, 'JD.md'));
    if (!fs.existsSync(jdFull)) throw new Error('未找到该岗位的 JD.md');
    const raw = fs.readFileSync(jdFull, 'utf8');
    const patch = { status, updated_at: formatDateYmd() };
    if (roundLabel && String(roundLabel).trim()) {
      const existingRounds = [];
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw.replace(/^\uFEFF/, ''));
      if (m) {
        const lines = m[1].split(/\r?\n/);
        let inRounds = false;
        for (const l of lines) {
          if (/^rounds\s*:\s*\[(.*)\]/.test(l)) {
            const inner = /^rounds\s*:\s*\[(.*)\]/.exec(l)[1];
            existingRounds.push(...inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
            inRounds = false;
          } else if (/^rounds\s*:/.test(l)) {
            inRounds = true;
          } else if (inRounds && /^\s+-\s+(.+)/.test(l)) {
            existingRounds.push(/^\s+-\s+(.+)/.exec(l)[1].trim().replace(/^['"]|['"]$/g, ''));
          } else if (/^[^\s]/.test(l)) {
            inRounds = false;
          }
        }
      }
      const cleanRound = String(roundLabel).trim();
      if (!existingRounds.includes(cleanRound)) existingRounds.push(cleanRound);
      patch.rounds = existingRounds;
    }
    const next = upsertYamlFrontmatter(raw, patch);
    writeAtomicUtf8(jdFull, next);
    return { ok: true, directory: dirName, status };
  }

  function importFiles({ targetSubdir = '项目资料', sourcePaths = [] }) {
    const root = requireRoot();
    const relDir = normRel(targetSubdir) || '项目资料';
    if (PROTECTED_WRITE_PATTERNS.some(re => re.test(relDir + '/'))) {
      throw new Error('不能向只读向量库目录导入文件');
    }
    const destDir = insideRoot(root, path.join(root, relDir));
    fs.mkdirSync(destDir, { recursive: true });
    const imported = [];
    for (const src of sourcePaths || []) {
      const absSrc = path.resolve(String(src || ''));
      if (!fs.existsSync(absSrc) || !fs.statSync(absSrc).isFile()) continue;
      const ext = path.extname(absSrc).toLowerCase();
      if (!['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) continue;
      let baseName = path.basename(absSrc, ext);
      let candidate = path.join(destDir, `${baseName}${ext}`);
      let n = 1;
      while (fs.existsSync(candidate)) {
        candidate = path.join(destDir, `${baseName}-${n}${ext}`);
        n++;
      }
      insideRoot(root, candidate);
      fs.copyFileSync(absSrc, candidate);
      imported.push(normRel(path.relative(root, candidate)));
    }
    return { ok: true, imported };
  }

  function readPersona() {
    const root = requireRoot();
    const full = insideRoot(root, path.join(root, '候选人画像.md'));
    if (!fs.existsSync(full)) return { exists: false, filePath: '候选人画像.md', profile: null, raw: '' };
    const raw = fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '');
    const m = /```json\r?\n([\s\S]*?)\r?\n```/i.exec(raw);
    let profile = null;
    if (m) {
      try { profile = JSON.parse(m[1]); } catch {}
    }
    return { exists: true, filePath: '候选人画像.md', profile, raw };
  }

  function savePersona({ profile }) {
    const root = requireRoot();
    if (!profile || typeof profile !== 'object') throw new Error('画像对象无效');
    const normalized = { ...profile, schema: 1 };
    const full = insideRoot(root, path.join(root, '候选人画像.md'));
    const existing = fs.existsSync(full) ? fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '') : '';
    const jsonBlock = '```json\n' + JSON.stringify(normalized, null, 2) + '\n```';
    let next;
    if (/```json\r?\n[\s\S]*?\r?\n```/i.test(existing)) {
      next = existing.replace(/```json\r?\n[\s\S]*?\r?\n```/i, jsonBlock);
    } else {
      next = `---\nknowledge_kind: candidate_profile\n---\n\n# 候选人画像\n\n${jsonBlock}\n`;
    }
    writeAtomicUtf8(full, next);
    return { ok: true, filePath: '候选人画像.md', profile: normalized };
  }

  function listIntroHeadings() {
    const root = requireRoot();
    const full = insideRoot(root, path.join(root, '通用问答', '自我介绍.md'));
    if (!fs.existsSync(full)) return { exists: false, filePath: '通用问答/自我介绍.md', headings: [] };
    const raw = fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/);
    const headings = [];
    let current = null;
    for (const line of lines) {
      const m = /^##\s+(.+)$/.exec(line.trim());
      if (m) {
        if (current) headings.push(current);
        current = { heading: m[1].trim(), preview: [] };
      } else if (current && line.trim()) {
        current.preview.push(line.trim());
      }
    }
    if (current) headings.push(current);
    return {
      exists: true,
      filePath: '通用问答/自我介绍.md',
      headings: headings.map(h => ({ heading: h.heading, text: h.preview.join('\n') }))
    };
  }

  return {
    writeDocument,
    trashDocument,
    createRolePackage,
    updateRoleStatus,
    importFiles,
    readPersona,
    savePersona,
    listIntroHeadings
  };
}

module.exports = {
  createKbWorkspace,
  upsertYamlFrontmatter,
  VALID_ROLE_STATUSES
};
