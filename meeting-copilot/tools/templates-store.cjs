'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_GROUP_ID = 'group-default';
const AUDIO_SOURCES = ['system', 'mic'];
const ANSWER_LANGS = ['chinese', 'english'];
const SCENES = ['interview', 'written'];
const TRANSCRIPTION_MODES = ['auto', 'manual', 'transcript-only'];

function createDefaultStore(now = Date.now()) {
  return {
    version: 1,
    groups: [
      {
        id: DEFAULT_GROUP_ID,
        name: '默认分组',
        order: 0,
        collapsed: false
      }
    ],
    templates: [
      {
        id: 'tpl-system-default',
        groupId: DEFAULT_GROUP_ID,
        order: 0,
        pinned: false,
        name: '系统音频模式',
        description: '默认捕获电脑系统播放声音（推荐在线视频/语音面试使用）',
        audioSource: 'system',
        answerLang: 'chinese',
        scene: 'interview',
        role: '',
        libraryEnabled: null,
        transcriptionMode: 'auto',
        resume: '',
        resumeName: '',
        jd: '',
        jdName: '',
        customNotes: '',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'tpl-mic-default',
        groupId: DEFAULT_GROUP_ID,
        order: 1,
        pinned: false,
        name: '麦克风模式',
        description: '通过本地麦克风捕获对方提问（适合线下或外放设备面试）',
        audioSource: 'mic',
        answerLang: 'chinese',
        scene: 'interview',
        role: '',
        libraryEnabled: null,
        transcriptionMode: 'auto',
        resume: '',
        resumeName: '',
        jd: '',
        jdName: '',
        customNotes: '',
        createdAt: now,
        updatedAt: now
      }
    ]
  };
}

function normalizeGroup(raw, index, seenIds) {
  const idBase = String(raw?.id || '').trim() || `group-${randomUUID().slice(0, 8)}`;
  const id = seenIds.has(idBase) ? `${idBase}-${index}` : idBase;
  seenIds.add(id);
  const name = String(raw?.name || '').trim().slice(0, 60) || `分组 ${index + 1}`;
  const order = Number.isFinite(Number(raw?.order)) ? Math.round(Number(raw.order)) : index;
  return {
    id,
    name,
    order,
    collapsed: raw?.collapsed === true
  };
}

function normalizeTemplate(raw, index, validGroupIds, fallbackGroupId, seenIds, now) {
  const idBase = String(raw?.id || '').trim() || `tpl-${randomUUID().slice(0, 8)}`;
  const id = seenIds.has(idBase) ? `${idBase}-${index}` : idBase;
  seenIds.add(id);
  const groupId = validGroupIds.has(String(raw?.groupId || '')) ? String(raw.groupId) : fallbackGroupId;
  const order = Number.isFinite(Number(raw?.order)) ? Math.round(Number(raw.order)) : index;
  const name = String(raw?.name || '').trim().slice(0, 100) || `面试模板 ${index + 1}`;
  const description = String(raw?.description || '').slice(0, 2000);
  const audioSource = AUDIO_SOURCES.includes(raw?.audioSource) ? raw.audioSource : 'system';
  const answerLang = ANSWER_LANGS.includes(raw?.answerLang) ? raw.answerLang : 'chinese';
  const scene = SCENES.includes(raw?.scene) ? raw.scene : 'interview';
  const role = String(raw?.role || '').trim().slice(0, 120);
  const libraryEnabled = typeof raw?.libraryEnabled === 'boolean' ? raw.libraryEnabled : null;
  const transcriptionMode = TRANSCRIPTION_MODES.includes(raw?.transcriptionMode) ? raw.transcriptionMode : 'auto';
  const resume = String(raw?.resume || '').slice(0, 80000);
  const resumeName = String(raw?.resumeName || '').trim().slice(0, 200);
  const jd = String(raw?.jd || '').slice(0, 80000);
  const jdName = String(raw?.jdName || '').trim().slice(0, 200);
  const customNotes = String(raw?.customNotes || '').slice(0, 4000);
  const createdAt = Number.isFinite(Number(raw?.createdAt)) ? Number(raw.createdAt) : now;
  const updatedAt = Number.isFinite(Number(raw?.updatedAt)) ? Number(raw.updatedAt) : now;
  return {
    id,
    groupId,
    order,
    pinned: raw?.pinned === true,
    name,
    description,
    audioSource,
    answerLang,
    scene,
    role,
    libraryEnabled,
    transcriptionMode,
    resume,
    resumeName,
    jd,
    jdName,
    customNotes,
    createdAt,
    updatedAt
  };
}

function normalizeStore(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('模板数据格式无效');
  }
  const seenGroupIds = new Set();
  const rawGroups = Array.isArray(raw.groups) && raw.groups.length
    ? raw.groups
    : [{ id: DEFAULT_GROUP_ID, name: '默认分组', order: 0, collapsed: false }];
  const groups = rawGroups.map((g, idx) => normalizeGroup(g, idx, seenGroupIds));
  const validGroupIds = new Set(groups.map(g => g.id));
  const fallbackGroupId = groups[0].id;
  const seenTemplateIds = new Set();
  const rawTemplates = Array.isArray(raw.templates) ? raw.templates : [];
  const templates = rawTemplates.map((t, idx) =>
    normalizeTemplate(t, idx, validGroupIds, fallbackGroupId, seenTemplateIds, now)
  );
  return { version: 1, groups, templates };
}

function createTemplatesStore({ file, now = () => Date.now() }) {
  function writeAtomic(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  function load() {
    try {
      if (!fs.existsSync(file)) {
        const seeded = createDefaultStore(now());
        try { writeAtomic(seeded); } catch {}
        return seeded;
      }
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return normalizeStore(parsed, now());
    } catch {
      return createDefaultStore(now());
    }
  }

  function save(incoming) {
    const normalized = normalizeStore(incoming, now());
    writeAtomic(normalized);
    return normalized;
  }

  return { load, save };
}

module.exports = {
  createTemplatesStore,
  createDefaultStore,
  normalizeStore,
  DEFAULT_GROUP_ID
};
