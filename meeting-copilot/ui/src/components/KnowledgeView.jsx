import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IconBookOpen,
  IconCheck,
  IconEdit,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconFolderPlus,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconShield,
  IconSparkles,
  IconTrash,
  IconX
} from './Icons.jsx';
import { EvidencePanel, Switch, useAutoSaveValue } from './SharedWidgets.jsx';

const DOC_TYPE_LABELS = {
  resume: '① 个人简历',
  project_fact: '① 项目事实',
  experiment: '① 实验记录',
  personal_experience: '① 个人经历',
  candidate_profile: '① 候选人画像',
  interview_memory: '② 面试记忆',
  role_prep: '③ 岗位预测',
  interview_asked_qa: '④ 实战真题',
  technical_reference: '④ 1326 向量库',
  technical_note: '④ 技术笔记',
  design_proposal: '设计方案',
  guideline: '规则 / JD',
  pending_fact: '待确认资料',
  practice_drill: '⑤ 专项练习',
  draft: '⑤ 草稿',
  archived: '⑤ 已归档'
};

const ROLE_STATUS_META = {
  preparing: { label: '准备中', cls: 'mc-badge-info' },
  interviewing: { label: '面试中', cls: 'mc-badge-warn' },
  waiting: { label: '待结果', cls: '' },
  offer: { label: '已获 Offer', cls: 'mc-badge-ok' },
  closed: { label: '已结束', cls: '' }
};

const SKILL_LEVELS = [
  { id: 'independent', label: '独立负责 / 熟练落地' },
  { id: 'ai_assisted_verified', label: '借助 AI 可完成并验证' },
  { id: 'conceptual_no_practice', label: '了解原理，尚未实践' },
  { id: 'unfamiliar', label: '不熟悉（仅答基础概念）' }
];

function docLayer(d) {
  const t = d?.document_type;
  if (['resume', 'project_fact', 'experiment', 'personal_experience', 'candidate_profile'].includes(t)) return 'truth';
  if (t === 'interview_memory') return 'memory';
  if (t === 'role_prep' || (d?.file_path || '').startsWith('岗位档案/')) return 'role';
  if (['interview_asked_qa', 'technical_reference', 'technical_note'].includes(t)) return 'tech';
  return 'archive';
}

/* Simple, crisp line diff for save confirmation */
function computeLineDiff(beforeText, afterText) {
  const a = String(beforeText || '').split(/\r?\n/);
  const b = String(afterText || '').split(/\r?\n/);
  const rows = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const la = a[i];
    const lb = b[i];
    if (la === lb) {
      rows.push({ kind: 'same', line: i + 1, text: la ?? '' });
    } else {
      if (la !== undefined) rows.push({ kind: 'del', line: i + 1, text: la });
      if (lb !== undefined) rows.push({ kind: 'add', line: i + 1, text: lb });
    }
  }
  return rows;
}

function SimpleMarkdownPreview({ content }) {
  const blocks = useMemo(() => {
    const text = String(content || '').replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const out = [];
    const fence = /^```([^\n]*)\r?\n([\s\S]*?)^```/gm;
    let last = 0;
    let m;
    while ((m = fence.exec(text))) {
      if (m.index > last) out.push({ kind: 'md', text: text.slice(last, m.index) });
      out.push({ kind: 'code', lang: m[1].trim(), text: m[2] });
      last = fence.lastIndex;
    }
    if (last < text.length) out.push({ kind: 'md', text: text.slice(last) });
    return out;
  }, [content]);

  return (
    <div className="mc-md-preview">
      {blocks.map((blk, i) => {
        if (blk.kind === 'code') {
          return (
            <pre key={i} className="mc-answer-code">
              <code>{blk.text}</code>
            </pre>
          );
        }
        return blk.text.split(/\r?\n/).map((line, j) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={`${i}-${j}`} style={{ height: 6 }} />;
          const h = /^(#{1,4})\s+(.+)$/.exec(trimmed);
          if (h) {
            const lvl = h[1].length;
            const size = lvl === 1 ? 17 : lvl === 2 ? 15 : 13.5;
            return <div key={`${i}-${j}`} style={{ fontSize: size, fontWeight: 700, marginTop: 10, marginBottom: 4 }}>{h[2]}</div>;
          }
          if (trimmed.startsWith('> ')) {
            return <blockquote key={`${i}-${j}`} className="mc-md-quote">{trimmed.slice(2)}</blockquote>;
          }
          if (/^[-*]\s+/.test(trimmed)) {
            return <div key={`${i}-${j}`} style={{ paddingLeft: 14, position: 'relative' }}><span style={{ position: 'absolute', left: 3 }}>•</span>{trimmed.replace(/^[-*]\s+/, '')}</div>;
          }
          return <p key={`${i}-${j}`} style={{ margin: '2px 0' }}>{line}</p>;
        });
      })}
    </div>
  );
}

function NewRoleModal({ onClose, onCreated }) {
  const [company, setCompany] = useState('');
  const [roleName, setRoleName] = useState('');
  const [location, setLocation] = useState('');
  const [resumeRef, setResumeRef] = useState('简历.md');
  const [priorityProjects, setPriorityProjects] = useState('SRAG, IOD');
  const [jdText, setJdText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!company.trim() || !roleName.trim()) {
      setError('请填写公司名称和岗位名称');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await window.mc.kbCreateRole({
        company: company.trim(),
        roleName: roleName.trim(),
        location: location.trim(),
        resumeRef: resumeRef.trim() || '简历.md',
        priorityProjects: priorityProjects.split(/[,，\s]+/).filter(Boolean),
        jdText
      });
      onCreated(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mc-modal-backdrop" onClick={onClose}>
      <form className="mc-modal" onClick={e => e.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-label="新建标准岗位档案">
        <div className="mc-modal-header">
          <div>
            <h3 className="mc-modal-title">新建标准岗位档案</h3>
            <div className="mc-field-hint">严格按《新增岗位与预测题规则》自动生成 JD.md、预测题与标准子目录</div>
          </div>
          <button type="button" className="mc-icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="mc-modal-body">
          <div className="mc-grid-2">
            <div className="mc-field">
              <label className="mc-field-label">公司名称 *</label>
              <input className="mc-input" value={company} onChange={e => setCompany(e.target.value)} placeholder="如：字节跳动 / Paradoox AI" autoFocus />
            </div>
            <div className="mc-field">
              <label className="mc-field-label">岗位名称 *（无需带状态后缀）</label>
              <input className="mc-input" value={roleName} onChange={e => setRoleName(e.target.value)} placeholder="如：AI应用研发实习生" />
            </div>
            <div className="mc-field">
              <label className="mc-field-label">工作地点</label>
              <input className="mc-input" value={location} onChange={e => setLocation(e.target.value)} placeholder="深圳 / 香港" />
            </div>
            <div className="mc-field">
              <label className="mc-field-label">投递简历版本</label>
              <select className="mc-select" value={resumeRef} onChange={e => setResumeRef(e.target.value)}>
                <option value="简历.md">简历.md（中文主简历）</option>
                <option value="英文简历.md">英文简历.md（英文 CV）</option>
              </select>
            </div>
          </div>
          <div className="mc-field">
            <label className="mc-field-label">重点关联项目（逗号分隔）</label>
            <input className="mc-input" value={priorityProjects} onChange={e => setPriorityProjects(e.target.value)} placeholder="SRAG, IOD, 九寨沟" />
          </div>
          <div className="mc-field">
            <label className="mc-field-label">岗位 JD 原文（可选，可稍后在线编辑）</label>
            <textarea className="mc-textarea" rows={5} value={jdText} onChange={e => setJdText(e.target.value)} placeholder="粘贴招聘职责与任职要求…" />
          </div>
          {error && <div className="mc-alert mc-alert-err">{error}</div>}
        </div>
        <div className="mc-modal-footer">
          <button type="button" className="mc-btn" onClick={onClose}>取消</button>
          <button type="submit" className="mc-btn mc-btn-primary" disabled={busy}>
            <IconFolderPlus size={14} /> {busy ? '正在创建…' : '创建并选中岗位'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function KnowledgeView({ library, onLibraryUpdated, settings, onSettingsUpdated }) {
  const [subTab, setSubTab] = useState('overview'); // 'overview' | 'workspace' | 'persona' | 'lab'
  const [draft, setDraft] = useState(null);
  const [ragStatus, setRagStatus] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Workspace state
  const [layerFilter, setLayerFilter] = useState('all'); // 'all' | 'truth' | 'role' | 'tech' | 'memory' | 'archive'
  const [docSearch, setDocSearch] = useState('');
  const [selectedDocId, setSelectedDocId] = useState('');
  const [docViewMode, setDocViewMode] = useState('preview'); // 'preview' | 'edit' | 'chunks'
  const [docContent, setDocContent] = useState('');
  const [docOriginal, setDocOriginal] = useState('');
  const [docLoading, setDocLoading] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [docChunks, setDocChunks] = useState(null);
  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [importTarget, setImportTarget] = useState('项目资料');
  const [dragOverImport, setDragOverImport] = useState(false);

  // Persona & Intro state
  const [personaData, setPersonaData] = useState(null);
  const [introData, setIntroData] = useState(null);
  const [personaSaving, setPersonaSaving] = useState(false);
  const [promptDraft, setPromptDraft] = useState(settings?.modelPrompts?.interview || '');
  const [promptMsg, setPromptMsg] = useState('');

  // Retrieval Lab state
  const [testQuestion, setTestQuestion] = useState('');
  const [testing, setTesting] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);

  const notify = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(prev => (prev === msg ? '' : prev)), 2600);
  }, []);

  useEffect(() => {
    if (library) setDraft(library);
  }, [library]);

  useEffect(() => {
    setPromptDraft(settings?.modelPrompts?.interview || '');
  }, [settings?.modelPrompts?.interview]);

  const loadRagStatus = useCallback(async () => {
    try {
      const st = await window.mc.getRagStatus?.();
      if (st) setRagStatus(st);
    } catch {}
  }, []);

  useEffect(() => {
    void loadRagStatus();
  }, [loadRagStatus, draft?.root]);

  useEffect(() => {
    if (subTab !== 'persona' || !draft?.root) return;
    void window.mc.kbReadPersona?.().then(setPersonaData).catch(() => {});
    void window.mc.kbListIntro?.().then(setIntroData).catch(() => {});
  }, [subTab, draft?.root]);

  const autoSavePayload = draft ? {
    enabled: !!draft.enabled,
    root: draft.root || '',
    role: draft.role || '',
    persona_profile: draft.persona_profile,
    intro_script: draft.intro_script
  } : null;

  const auto = useAutoSaveValue(
    autoSavePayload,
    (value) => window.mc.setInterviewLibrary(value),
    (res) => {
      setDraft(res);
      onLibraryUpdated?.(res);
      window.dispatchEvent(new Event('mc-library-updated'));
    }
  );

  const refreshLibrary = async () => {
    try {
      const next = await window.mc.getInterviewLibrary();
      setDraft(next);
      onLibraryUpdated?.(next);
      void loadRagStatus();
      setError('');
      notify('资料库索引已刷新');
    } catch (e) {
      setError('刷新资料库失败：' + e.message);
    }
  };

  const pickRootFolder = async () => {
    try {
      const picked = await window.mc.pickInterviewLibraryRoot();
      if (!picked) return;
      setDraft(prev => ({ ...(prev || {}), root: picked, role: '' }));
      setError('');
    } catch (e) {
      setError('选择目录失败：' + e.message);
    }
  };

  // Workspace document filtering (exclude the 1,326 Qdrant bulk files from cluttering the human editing list unless explicitly searching)
  const visibleDocs = useMemo(() => {
    const list = (draft?.documents || []).filter(d => d.status !== 'retired' && d.status !== 'missing');
    const q = docSearch.trim().toLowerCase();
    return list.filter(d => {
      if (d.document_type === 'technical_reference' && !q) return false;
      const layer = docLayer(d);
      if (layerFilter !== 'all' && layer !== layerFilter) return false;
      if (!q) return true;
      return (d.title || '').toLowerCase().includes(q) ||
        (d.file_path || '').toLowerCase().includes(q) ||
        (d.document_type || '').toLowerCase().includes(q);
    }).sort((a, b) => (a.file_path || '').localeCompare(b.file_path || '', 'zh-CN'));
  }, [draft?.documents, layerFilter, docSearch]);

  const selectedDoc = useMemo(
    () => (draft?.documents || []).find(d => d.document_id === selectedDocId || d.file_path === selectedDocId) || null,
    [draft?.documents, selectedDocId]
  );

  const openDocumentInPane = useCallback(async (docOrPath, targetMode) => {
    const key = typeof docOrPath === 'string' ? docOrPath : (docOrPath?.document_id || docOrPath?.file_path);
    if (!key) return;
    setSelectedDocId(key);
    if (targetMode) setDocViewMode(targetMode);
    setDocLoading(true);
    setShowDiff(false);
    setError('');
    try {
      const [docRes, chunkRes] = await Promise.all([
        window.mc.readInterviewDocument(key),
        window.mc.readInterviewChunks?.(key).catch(() => null)
      ]);
      setDocContent(docRes.content || '');
      setDocOriginal(docRes.content || '');
      setDocChunks(chunkRes);
    } catch (e) {
      setError('读取文档失败：' + e.message);
    } finally {
      setDocLoading(false);
    }
  }, []);

  const isSelectedReadOnly = Boolean(
    !selectedDoc ||
    selectedDoc.file_type === 'pdf' ||
    selectedDoc.document_type === 'technical_reference' ||
    (selectedDoc.file_path || '').includes('_backup面试问答整理')
  );

  const docDirty = docContent !== docOriginal;

  const saveSelectedDoc = async () => {
    if (!selectedDoc || isSelectedReadOnly) return;
    setError('');
    try {
      const res = await window.mc.kbWriteDoc({ filePath: selectedDoc.file_path, content: docContent });
      setDocOriginal(docContent);
      setShowDiff(false);
      if (res?.library) {
        setDraft(res.library);
        onLibraryUpdated?.(res.library);
        window.dispatchEvent(new Event('mc-library-updated'));
      }
      const chunkRes = await window.mc.readInterviewChunks?.(selectedDoc.file_path).catch(() => null);
      if (chunkRes) setDocChunks(chunkRes);
      notify(`已保存 ${selectedDoc.file_path} 并刷新索引`);
    } catch (e) {
      setError('保存失败：' + e.message);
    }
  };

  const trashSelectedDoc = async () => {
    if (!selectedDoc) return;
    setError('');
    try {
      const res = await window.mc.kbTrashDoc({ filePath: selectedDoc.file_path });
      if (res?.library) {
        setDraft(res.library);
        onLibraryUpdated?.(res.library);
      }
      setSelectedDocId('');
      setDocContent('');
      setDocOriginal('');
      setDocChunks(null);
      notify(`已移入系统回收站：${selectedDoc.file_path}`);
    } catch (e) {
      setError('移入回收站失败：' + e.message);
    }
  };

  const handleImportPaths = async (paths) => {
    if (!paths?.length) return;
    setError('');
    try {
      const res = await window.mc.kbImportFiles({ targetSubdir: importTarget, sourcePaths: paths });
      if (res?.library) {
        setDraft(res.library);
        onLibraryUpdated?.(res.library);
      }
      notify(`已导入 ${res.imported?.length || 0} 份资料至 ${importTarget}`);
    } catch (e) {
      setError('导入失败：' + e.message);
    }
  };

  const handleUpdateRoleStatus = async (directory, status) => {
    try {
      const res = await window.mc.kbUpdateRoleStatus({ directory, status });
      if (res?.library) {
        setDraft(res.library);
        onLibraryUpdated?.(res.library);
      }
      notify(`已更新 ${directory} 状态`);
    } catch (e) {
      setError('更新岗位状态失败：' + e.message);
    }
  };

  const savePersonaForm = async () => {
    if (!personaData?.profile) return;
    setPersonaSaving(true);
    setError('');
    try {
      const res = await window.mc.kbSavePersona({ profile: personaData.profile });
      setPersonaData(prev => ({ ...prev, profile: res.profile }));
      if (res?.library) {
        setDraft(res.library);
        onLibraryUpdated?.(res.library);
      }
      notify('候选人画像已保存并刷新 V2 约束');
    } catch (e) {
      setError('保存画像失败：' + e.message);
    } finally {
      setPersonaSaving(false);
    }
  };

  const runRetrievalTest = async (customQ) => {
    const q = (customQ !== undefined ? customQ : testQuestion).trim() || '请介绍自己';
    if (customQ !== undefined) setTestQuestion(customQ);
    setTesting(true);
    setError('');
    try {
      const res = await window.mc.previewInterviewLibrary(q);
      setPreviewResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setTesting(false);
    }
  };

  const loadLastSelection = async () => {
    setError('');
    try {
      const next = await window.mc.getInterviewLibrary();
      setDraft(next);
      setPreviewResult(next.last || null);
    } catch (e) {
      setError(e.message);
    }
  };

  const savePrompt = async () => {
    try {
      const next = await window.mc.setSettings({ modelPrompts: { interview: promptDraft } });
      onSettingsUpdated?.(next);
      setPromptMsg('备用 Prompt 已保存');
      setTimeout(() => setPromptMsg(''), 2500);
    } catch (e) {
      setPromptMsg('保存失败：' + e.message);
    }
  };

  const ls = draft?.layer_summary || {};
  const rolesMeta = draft?.roles_meta || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <header className="mc-page-header" style={{ borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 className="mc-page-title">知识库</h1>
          <span className="mc-field-hint" role="status">
            {toast || auto.error || (auto.status === 'saving' ? '自动保存中…' : '5 层隔离架构 · 实时同步')}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" className="mc-btn mc-btn-sm" onClick={() => setNewRoleOpen(true)} disabled={!draft?.root}>
            <IconFolderPlus size={13} /> 新建标准岗位
          </button>
          <button type="button" className="mc-btn mc-btn-sm" onClick={() => void refreshLibrary()}>
            <IconRefresh size={13} /> 刷新索引
          </button>
        </div>
      </header>

      <div className="mc-tabs-row" role="tablist">
        {[
          ['overview', '总览与 RAG 状态'],
          ['workspace', '资料工作台'],
          ['persona', '画像与口述稿'],
          ['lab', '检索测试台']
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={subTab === id}
            className={`mc-tab-btn${subTab === id ? ' is-active' : ''}`}
            onClick={() => setSubTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW & RAG STATUS */}
      {subTab === 'overview' && (
        <div className="mc-page-scroll">
          <div className="mc-page-inner">
            {draft?.material_status && (
              <div className={`mc-alert ${draft.material_status.level === 'warning' ? 'mc-alert-warn' : 'mc-alert-ok'}`}>
                {draft.material_status.message}
              </div>
            )}
            {draft?.warning && <div className="mc-alert mc-alert-warn" style={{ whiteSpace: 'pre-wrap' }}>{draft.warning}</div>}
            {error && <div className="mc-alert mc-alert-err">{error}</div>}

            {/* 5-Layer Architecture Summary Cards */}
            <div className="mc-layer-grid">
              <div className="mc-layer-card">
                <div className="mc-layer-tag">① 个人真源层</div>
                <div className="mc-layer-num">{ls.personal_truth ?? 0}</div>
                <div className="mc-field-hint">简历 / 项目 / 画像（唯一可证“我做过”）</div>
              </div>
              <div className="mc-layer-card">
                <div className="mc-layer-tag">② 面试记忆层</div>
                <div className="mc-layer-num">{ls.interview_memory ?? 0}</div>
                <div className="mc-field-hint">口风偏好 / 避坑清单 / 公司洞察</div>
              </div>
              <div className="mc-layer-card">
                <div className="mc-layer-tag">③ 岗位预测层</div>
                <div className="mc-layer-num">{ls.role_prep ?? 0}</div>
                <div className="mc-field-hint">仅当前选中岗位的预演参考</div>
              </div>
              <div className="mc-layer-card">
                <div className="mc-layer-tag">④ 客观 & 实战真题</div>
                <div className="mc-layer-num">{(ls.technical_reference ?? 0) + (ls.interview_asked_qa ?? 0)}</div>
                <div className="mc-field-hint">Qdrant {ls.technical_reference ?? 0} 条 + 实战补充 {ls.interview_asked_qa ?? 0} 篇</div>
              </div>
            </div>

            <section className="mc-card">
              <div className="mc-card-head">
                <div>
                  <h3 className="mc-card-title">目录绑定与当前面试岗位</h3>
                  <p className="mc-card-desc">修改 Markdown 文件后下次提问自动生效；切换岗位仅变更 ③ 层预测范围与 JD 上下文。</p>
                </div>
                <Switch
                  checked={!!draft?.enabled}
                  onChange={(v) => setDraft(prev => ({ ...(prev || {}), enabled: v }))}
                  aria-label="启用本地面试资料库"
                />
              </div>
              <div className="mc-srow">
                <div>
                  <div className="mc-srow-label">资料根目录</div>
                  <div className="mc-srow-desc">当前索引目录：{draft?.root || '未选择'}</div>
                </div>
                <div className="mc-srow-control">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="mc-input"
                      value={draft?.root || ''}
                      placeholder="请选择本地资料文件夹"
                      onChange={e => setDraft(prev => ({ ...(prev || {}), root: e.target.value, role: '' }))}
                    />
                    <button type="button" className="mc-btn" onClick={() => void pickRootFolder()}>
                      <IconFolder size={14} /> 选择
                    </button>
                  </div>
                </div>
              </div>
              <div className="mc-srow mc-srow-compact">
                <div>
                  <div className="mc-srow-label">当前默认面试岗位</div>
                  <div className="mc-srow-desc">共发现 {rolesMeta.length} 个标准岗位档案</div>
                </div>
                <div className="mc-srow-control">
                  <select
                    className="mc-select"
                    value={draft?.role || ''}
                    onChange={e => setDraft(prev => ({ ...(prev || {}), role: e.target.value }))}
                  >
                    <option value="">通用（不限定岗位）</option>
                    {(draft?.roles || []).map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            </section>

            {/* Live Qdrant RAG Health & Rulebook shortcuts */}
            <section className="mc-card">
              <div className="mc-card-head">
                <div>
                  <h3 className="mc-card-title">本地 Qdrant 向量 RAG 状态</h3>
                  <p className="mc-card-desc">技术八股底座采用本地持久化 Qdrant（Dense + Sparse RRF + Rerank），首轮清晰客观题自动跳过改写降延迟。</p>
                </div>
                <span className={`mc-badge ${ragStatus?.online ? 'mc-badge-ok' : draft?.vector_rag?.enabled ? 'mc-badge-warn' : ''}`}>
                  {ragStatus?.online ? '在线就绪' : draft?.vector_rag?.enabled ? '待唤醒 / 离线' : '未启用'}
                </span>
              </div>
              <div className="mc-card-body" style={{ gap: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <span className="mc-badge">条目数：{ragStatus?.entries ?? ls.technical_reference ?? 0}</span>
                  {ragStatus?.model && <span className="mc-badge">向量模型：{ragStatus.model}</span>}
                  {ragStatus?.endpoint && <span className="mc-badge">本地服务：{ragStatus.endpoint}</span>}
                  <span className="mc-badge">归档/练习隔离：{ls.archived_or_drill ?? 0} 份</span>
                </div>
                {ragStatus?.error && <div className="mc-field-hint">说明：{ragStatus.error}（首次提问时会自动拉起本地服务）</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                  <button
                    type="button"
                    className="mc-btn mc-btn-sm"
                    onClick={() => { setSubTab('workspace'); void openDocumentInPane('复盘与更新规则.md', 'preview'); }}
                  >
                    <IconFileText size={13} /> 查看《复盘与更新规则》
                  </button>
                  <button
                    type="button"
                    className="mc-btn mc-btn-sm"
                    onClick={() => { setSubTab('workspace'); void openDocumentInPane('新增岗位与预测题规则.md', 'preview'); }}
                  >
                    <IconFileText size={13} /> 查看《新增岗位与预测题规则》
                  </button>
                </div>
              </div>
            </section>

            {/* Role Cards Grid */}
            {rolesMeta.length > 0 && (
              <section className="mc-card">
                <div className="mc-card-head">
                  <div>
                    <h3 className="mc-card-title">岗位档案一览 ({rolesMeta.length})</h3>
                    <p className="mc-card-desc">状态由各岗位 JD.md 头部 YAML 管理，切换状态不改变目录路径。</p>
                  </div>
                  <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={() => setNewRoleOpen(true)}>
                    <IconPlus size={12} /> 新建岗位
                  </button>
                </div>
                <div className="mc-card-body">
                  <div className="mc-role-grid">
                    {rolesMeta.map(r => {
                      const stMeta = ROLE_STATUS_META[r.status] || { label: r.status || '准备中', cls: '' };
                      const isActive = draft?.role === r.directory;
                      return (
                        <div key={r.role_id || r.directory} className={`mc-role-card${isActive ? ' is-active' : ''}`}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                            <strong style={{ fontSize: 13 }}>{r.company} · {r.role_name}</strong>
                            <span className={`mc-badge ${stMeta.cls}`}>{stMeta.label}</span>
                          </div>
                          <div className="mc-field-hint">
                            {r.location ? `${r.location} · ` : ''}{(r.priority_projects || []).join(' / ') || '通用项目'}
                            {r.rounds?.length ? ` · 已面 ${r.rounds.length} 轮` : ''}
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                            <button
                              type="button"
                              className={`mc-btn mc-btn-sm ${isActive ? 'mc-btn-primary' : ''}`}
                              onClick={() => setDraft(prev => ({ ...(prev || {}), role: r.directory }))}
                            >
                              {isActive ? '当前岗位 ✓' : '设为当前'}
                            </button>
                            <select
                              className="mc-select"
                              style={{ height: 24, fontSize: 11.5, padding: '0 6px', width: 'auto' }}
                              aria-label={`${r.directory} 状态`}
                              value={r.status || 'preparing'}
                              onChange={e => void handleUpdateRoleStatus(r.directory, e.target.value)}
                            >
                              {Object.entries(ROLE_STATUS_META).map(([k, v]) => (
                                <option key={k} value={k}>{v.label}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="mc-btn mc-btn-sm mc-btn-ghost"
                              onClick={() => {
                                setSubTab('workspace');
                                void openDocumentInPane(`岗位档案/${r.directory}/JD.md`, 'preview');
                              }}
                            >
                              打开 JD
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: WORKSPACE (MASTER-DETAIL EDITOR + DIFF + CHUNK INSPECTOR) */}
      {subTab === 'workspace' && (
        <div className="mc-kb-workbench">
          {/* Left Tree / Doc List */}
          <aside
            className={`mc-kb-left${dragOverImport ? ' is-drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOverImport(true); }}
            onDragLeave={() => setDragOverImport(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverImport(false);
              const paths = [...(e.dataTransfer?.files || [])].map(f => f.path).filter(Boolean);
              void handleImportPaths(paths);
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <div className="mc-search-wrap" style={{ flex: 1 }}>
                <span className="mc-search-icon"><IconSearch size={13} /></span>
                <input
                  className="mc-search-input"
                  value={docSearch}
                  onChange={e => setDocSearch(e.target.value)}
                  placeholder="搜索标题 / 路径（搜关键词可查1326库）"
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {[
                ['all', '全部'],
                ['truth', '① 真源'],
                ['role', '③ 岗位'],
                ['tech', '④ 实战真题'],
                ['memory', '② 记忆'],
                ['archive', '⑤ 归档']
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`mc-btn mc-btn-sm ${layerFilter === id ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
                  style={{ height: 22, padding: '0 7px', fontSize: 11 }}
                  onClick={() => setLayerFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Drag-drop / button file importer */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <select
                className="mc-select"
                style={{ height: 26, fontSize: 11.5, padding: '0 6px', flex: 1 }}
                value={importTarget}
                onChange={e => setImportTarget(e.target.value)}
                aria-label="导入目标目录"
              >
                <option value="项目资料">导入到：项目资料/</option>
                <option value="通用问答">导入到：通用问答/</option>
                <option value="通用技术知识/实战真题补充">导入到：实战真题补充/</option>
                {draft?.role && <option value={`岗位档案/${draft.role}/岗位准备`}>导入到：{draft.role}/岗位准备/</option>}
                {draft?.role && <option value={`岗位档案/${draft.role}/外部面经`}>导入到：{draft.role}/外部面经/</option>}
              </select>
              <button
                type="button"
                className="mc-btn mc-btn-sm"
                onClick={async () => {
                  const files = await window.mc.kbPickImportFiles?.();
                  if (files?.length) void handleImportPaths(files);
                }}
              >
                导入
              </button>
            </div>

            <div className="mc-kb-doc-list">
              {visibleDocs.map(d => {
                const active = selectedDoc?.document_id === d.document_id;
                return (
                  <button
                    key={d.document_id}
                    type="button"
                    className={`mc-kb-doc-item${active ? ' is-active' : ''}`}
                    onClick={() => void openDocumentInPane(d)}
                  >
                    <div className="mc-kb-doc-title">{d.title}</div>
                    <div className="mc-kb-doc-meta">
                      <span>{DOC_TYPE_LABELS[d.document_type] || d.document_type}</span>
                      <span>v{d.version || 1}</span>
                    </div>
                    <div className="mc-kb-doc-path">{d.file_path}</div>
                  </button>
                );
              })}
              {visibleDocs.length === 0 && (
                <div className="mc-field-hint" style={{ textAlign: 'center', padding: 20 }}>
                  当前筛选下暂无文档；拖入 .md/.txt/.pdf 文件可直接导入。
                </div>
              )}
            </div>
          </aside>

          {/* Right 3-Tab Inspector */}
          <section className="mc-kb-right">
            {error && <div className="mc-alert mc-alert-err" style={{ margin: '8px 12px 0' }}>{error}</div>}
            {!selectedDoc ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)' }}>
                <IconBookOpen size={28} />
                <div style={{ fontSize: 13 }}>在左侧选择任意文档，即可预览 Markdown、在线编辑对比 Diff 或透视 V2 切片权限。</div>
              </div>
            ) : (
              <>
                <div className="mc-kb-right-head">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <strong style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedDoc.title}
                      </strong>
                      <span className="mc-badge">{DOC_TYPE_LABELS[selectedDoc.document_type] || selectedDoc.document_type}</span>
                      {docDirty && <span className="mc-badge mc-badge-warn">未保存</span>}
                    </div>
                    <div className="mc-field-hint" style={{ fontSize: 11 }}>{selectedDoc.file_path}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <div className="mc-segmented">
                      <button type="button" className={`mc-seg-btn${docViewMode === 'preview' ? ' is-active' : ''}`} onClick={() => setDocViewMode('preview')}>阅读</button>
                      <button type="button" className={`mc-seg-btn${docViewMode === 'edit' ? ' is-active' : ''}`} onClick={() => setDocViewMode('edit')} disabled={isSelectedReadOnly}>编辑</button>
                      <button type="button" className={`mc-seg-btn${docViewMode === 'chunks' ? ' is-active' : ''}`} onClick={() => setDocViewMode('chunks')}>切片透视</button>
                    </div>
                    <button
                      type="button"
                      className="mc-icon-btn"
                      title="使用系统默认程序打开原文件"
                      onClick={() => void window.mc.openInterviewDocument(selectedDoc.document_id).catch(e => setError(e.message))}
                    >
                      <IconExternalLink size={14} />
                    </button>
                    {!isSelectedReadOnly && (
                      <button
                        type="button"
                        className="mc-icon-btn is-danger"
                        title="移入系统回收站"
                        onClick={() => void trashSelectedDoc()}
                      >
                        <IconTrash size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {docLoading ? (
                  <div style={{ padding: 24 }} className="mc-field-hint">正在读取文档与 V2 切片…</div>
                ) : docViewMode === 'preview' ? (
                  <div className="mc-kb-right-scroll">
                    {isSelectedReadOnly && selectedDoc.document_type === 'technical_reference' && (
                      <div className="mc-alert" style={{ marginBottom: 12 }}>
                        此条目属于本地 Qdrant 1,326 向量库只读真源，已锁定保护以防破坏向量索引；新增实战真题请写入 <code>通用技术知识/实战真题补充/</code>。
                      </div>
                    )}
                    <SimpleMarkdownPreview content={docContent} />
                  </div>
                ) : docViewMode === 'edit' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 12, gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className={`mc-btn mc-btn-sm ${showDiff ? 'mc-btn-primary' : ''}`}
                          onClick={() => setShowDiff(v => !v)}
                        >
                          <IconEdit size={12} /> {showDiff ? '返回编辑' : '预览 Diff 变更'}
                        </button>
                        {docDirty && (
                          <button type="button" className="mc-btn mc-btn-sm" onClick={() => setDocContent(docOriginal)}>
                            撤销未保存修改
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        className="mc-btn mc-btn-sm mc-btn-primary"
                        disabled={!docDirty}
                        onClick={() => void saveSelectedDoc()}
                      >
                        <IconCheck size={12} /> 保存并刷新索引
                      </button>
                    </div>

                    {showDiff ? (
                      <div className="mc-kb-diff-box">
                        {computeLineDiff(docOriginal, docContent).map((row, idx) => (
                          <div key={idx} className={`mc-kb-diff-line is-${row.kind}`}>
                            <span className="mc-kb-diff-ln">{row.line}</span>
                            <span className="mc-kb-diff-sign">{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</span>
                            <span>{row.text}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        className="mc-textarea"
                        style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6, resize: 'none' }}
                        value={docContent}
                        onChange={e => setDocContent(e.target.value)}
                        spellCheck={false}
                      />
                    )}
                  </div>
                ) : (
                  <div className="mc-kb-right-scroll">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        <span className="mc-badge mc-badge-info">共 {docChunks?.chunks?.length || 0} 个语义切片</span>
                        {docChunks?.frontmatter && (
                          <span className="mc-badge">YAML 字段：{Object.keys(docChunks.frontmatter).join(', ')}</span>
                        )}
                      </div>
                      {(docChunks?.chunks || []).map((c, idx) => (
                        <div key={c.chunk_id || idx} className="mc-evidence-item">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 12.5 }}>#{idx + 1} {c.heading || '（正文段落）'}</strong>
                            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                              <span className="mc-badge">{DOC_TYPE_LABELS[c.document_type] || c.document_type}</span>
                              <span className={`mc-badge ${c.may_support_personal_action ? 'mc-badge-ok' : ''}`}>
                                <IconShield size={10} /> {c.may_support_personal_action ? '可证个人经历' : '仅作参考，不证经历'}
                              </span>
                              <span className="mc-field-hint">{c.chars} 字</span>
                            </div>
                          </div>
                          <pre className="mc-evidence-excerpt">{c.excerpt}</pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {/* TAB 3: PERSONA & INTRO SCRIPT */}
      {subTab === 'persona' && (
        <div className="mc-page-scroll">
          <div className="mc-page-inner">
            {error && <div className="mc-alert mc-alert-err">{error}</div>}

            <section className="mc-card">
              <div className="mc-card-head">
                <div>
                  <h3 className="mc-card-title">候选人能力画像（候选人画像.md）</h3>
                  <p className="mc-card-desc">每轮面试常驻生效，用于限定个人能力边界，防止大模型过度吹嘘或编造未实践经历。</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Switch
                    checked={Boolean(draft?.persona_profile?.enabled)}
                    onChange={v => {
                      const profileDoc = (draft?.documents || []).find(d => d.document_type === 'candidate_profile');
                      setDraft(prev => ({
                        ...(prev || {}),
                        persona_profile: { enabled: v, document_id: prev?.persona_profile?.document_id || profileDoc?.document_id || '' }
                      }));
                    }}
                    aria-label="启用固定候选人画像"
                  />
                  <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" disabled={personaSaving || !personaData?.profile} onClick={() => void savePersonaForm()}>
                    <IconCheck size={12} /> {personaSaving ? '保存中…' : '保存画像'}
                  </button>
                </div>
              </div>

              {personaData?.profile ? (
                <div className="mc-card-body" style={{ gap: 14 }}>
                  <div className="mc-grid-2">
                    <div className="mc-field">
                      <label className="mc-field-label">姓名</label>
                      <input
                        className="mc-input"
                        value={personaData.profile.identity?.name || ''}
                        onChange={e => setPersonaData(p => ({ ...p, profile: { ...p.profile, identity: { ...p.profile.identity, name: e.target.value } } }))}
                      />
                    </div>
                    <div className="mc-field">
                      <label className="mc-field-label">确认日期</label>
                      <input
                        className="mc-input"
                        value={personaData.profile.confirmed_at || ''}
                        onChange={e => setPersonaData(p => ({ ...p, profile: { ...p.profile, confirmed_at: e.target.value } }))}
                      />
                    </div>
                  </div>
                  <div className="mc-field">
                    <label className="mc-field-label">学历背景</label>
                    <input
                      className="mc-input"
                      value={personaData.profile.identity?.education || ''}
                      onChange={e => setPersonaData(p => ({ ...p, profile: { ...p.profile, identity: { ...p.profile.identity, education: e.target.value } } }))}
                    />
                  </div>
                  <div className="mc-field">
                    <label className="mc-field-label">整体定位与边界</label>
                    <input
                      className="mc-input"
                      value={personaData.profile.identity?.positioning || ''}
                      onChange={e => setPersonaData(p => ({ ...p, profile: { ...p.profile, identity: { ...p.profile.identity, positioning: e.target.value } } }))}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: 13 }}>分项技能能力上限 ({(personaData.profile.skills || []).length})</strong>
                    <button
                      type="button"
                      className="mc-btn mc-btn-sm"
                      onClick={() => setPersonaData(p => ({
                        ...p,
                        profile: {
                          ...p.profile,
                          skills: [...(p.profile.skills || []), { area: '', level: 'ai_assisted_verified', scope: '' }]
                        }
                      }))}
                    >
                      <IconPlus size={12} /> 添加技能边界
                    </button>
                  </div>

                  {(personaData.profile.skills || []).map((sk, idx) => (
                    <div key={idx} className="mc-card" style={{ background: 'var(--bg-subtle)' }}>
                      <div className="mc-card-body" style={{ padding: 10, gap: 8 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            className="mc-input"
                            style={{ flex: 1 }}
                            placeholder="技术域，如：SQL及MySQL/Redis"
                            value={sk.area || ''}
                            onChange={e => setPersonaData(p => ({
                              ...p,
                              profile: { ...p.profile, skills: p.profile.skills.map((x, i) => i === idx ? { ...x, area: e.target.value } : x) }
                            }))}
                          />
                          <select
                            className="mc-select"
                            style={{ width: 200 }}
                            value={sk.level || 'ai_assisted_verified'}
                            onChange={e => setPersonaData(p => ({
                              ...p,
                              profile: { ...p.profile, skills: p.profile.skills.map((x, i) => i === idx ? { ...x, level: e.target.value } : x) }
                            }))}
                          >
                            {SKILL_LEVELS.map(lv => <option key={lv.id} value={lv.id}>{lv.label}</option>)}
                          </select>
                          <button
                            type="button"
                            className="mc-icon-btn is-danger"
                            title="移除此技能项"
                            onClick={() => setPersonaData(p => ({
                              ...p,
                              profile: { ...p.profile, skills: p.profile.skills.filter((_, i) => i !== idx) }
                            }))}
                          >
                            <IconTrash size={13} />
                          </button>
                        </div>
                        <input
                          className="mc-input"
                          placeholder="边界说明（如：借助 AI 可落地验证，不声称独立生产运维）"
                          value={sk.scope || ''}
                          onChange={e => setPersonaData(p => ({
                            ...p,
                            profile: { ...p.profile, skills: p.profile.skills.map((x, i) => i === idx ? { ...x, scope: e.target.value } : x) }
                          }))}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mc-card-body">
                  <div className="mc-field-hint">当前资料库未检测到 <code>候选人画像.md</code>（可在资料工作台新建）。</div>
                </div>
              )}
            </section>

            {/* Intro script binder */}
            <section className="mc-card">
              <div className="mc-card-head">
                <div>
                  <h3 className="mc-card-title">固定自我介绍口述稿（通用问答/自我介绍.md）</h3>
                  <p className="mc-card-desc">启用后，面试官要求“自我介绍”时将直接零延迟返回选定章节原稿，不经模型自由发挥。</p>
                </div>
                <Switch
                  checked={Boolean(draft?.intro_script?.enabled)}
                  onChange={v => {
                    const introDoc = (draft?.documents || []).find(d => (d.file_path || '').endsWith('自我介绍.md'));
                    setDraft(prev => ({
                      ...(prev || {}),
                      intro_script: {
                        enabled: v,
                        document_id: prev?.intro_script?.document_id || introDoc?.document_id || '',
                        heading: prev?.intro_script?.heading || '约2分钟'
                      }
                    }));
                  }}
                  aria-label="启用固定自我介绍原稿"
                />
              </div>
              {introData?.exists ? (
                <div className="mc-card-body" style={{ gap: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(introData.headings || []).map(h => {
                      const active = (draft?.intro_script?.heading || '约2分钟') === h.heading;
                      return (
                        <button
                          key={h.heading}
                          type="button"
                          className={`mc-btn mc-btn-sm ${active ? 'mc-btn-primary' : ''}`}
                          onClick={() => setDraft(prev => ({
                            ...(prev || {}),
                            intro_script: { ...(prev?.intro_script || { enabled: true }), heading: h.heading }
                          }))}
                        >
                          {h.heading}
                        </button>
                      );
                    })}
                  </div>
                  {(introData.headings || []).filter(h => h.heading === (draft?.intro_script?.heading || '约2分钟')).map(h => (
                    <pre key={h.heading} className="mc-evidence-excerpt" style={{ maxHeight: 220 }}>{h.text}</pre>
                  ))}
                </div>
              ) : (
                <div className="mc-card-body"><span className="mc-field-hint">未找到 <code>通用问答/自我介绍.md</code></span></div>
              )}
            </section>

            <details className="mc-card">
              <summary style={{ padding: '12px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                备用面试 Prompt（仅关闭本地资料库时生效）
              </summary>
              <div className="mc-card-body" style={{ borderTop: '1px solid var(--border)' }}>
                <textarea
                  className="mc-textarea"
                  rows={7}
                  maxLength={64000}
                  value={promptDraft}
                  onChange={e => setPromptDraft(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button type="button" className="mc-btn mc-btn-primary mc-btn-sm" onClick={() => void savePrompt()}>保存 Prompt</button>
                  {settings?.modelPrompts?.defaultInterview && (
                    <button type="button" className="mc-btn mc-btn-sm" onClick={() => setPromptDraft(settings.modelPrompts.defaultInterview)}>恢复默认</button>
                  )}
                  <span className="mc-field-hint">{promptDraft.length} / 64000</span>
                  {promptMsg && <span className="mc-badge mc-badge-ok">{promptMsg}</span>}
                </div>
              </div>
            </details>
          </div>
        </div>
      )}

      {/* TAB 4: 5-LAYER RETRIEVAL LAB */}
      {subTab === 'lab' && (
        <div className="mc-page-scroll">
          <div className="mc-page-inner">
            {error && <div className="mc-alert mc-alert-err">{error}</div>}
            <section className="mc-card">
              <div className="mc-card-head">
                <div>
                  <h3 className="mc-card-title">5 层交互式检索测试台</h3>
                  <p className="mc-card-desc">直观检验个人真源、当前岗位预测、实战真题补充与 Qdrant 1,326 向量库的实际召回与防幻觉门禁。</p>
                </div>
              </div>
              <div className="mc-card-body" style={{ gap: 10 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="mc-input"
                    value={testQuestion}
                    onChange={e => setTestQuestion(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void runRetrievalTest(); }}
                    placeholder="输入面试题测试 5 层召回，例如：Agent 的 Trace、Span 和 Evaluator 是怎么串联的？"
                  />
                  <button type="button" className="mc-btn mc-btn-primary" disabled={testing || !draft?.enabled} onClick={() => void runRetrievalTest()}>
                    <IconSparkles size={14} /> {testing ? '检索中…' : '测试召回'}
                  </button>
                  <button type="button" className="mc-btn" onClick={() => void loadLastSelection()}>
                    最近选材
                  </button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    '介绍一下你在 SRAG 里负责的切块与检索评测',
                    'Agent 的 tool_use 底层怎么触发代码执行？',
                    'Trace、Span 和 Evaluator 如何串起来？',
                    '高并发秒杀怎么防超卖和做幂等？'
                  ].map(sample => (
                    <button
                      key={sample}
                      type="button"
                      className="mc-btn mc-btn-sm mc-btn-ghost"
                      disabled={testing || !draft?.enabled}
                      onClick={() => void runRetrievalTest(sample)}
                    >
                      {sample}
                    </button>
                  ))}
                </div>

                {previewResult && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <span className="mc-badge mc-badge-info">问题：{previewResult.question}</span>
                      {previewResult.role && <span className="mc-badge">岗位：{previewResult.role}</span>}
                      {previewResult.strategy && <span className="mc-badge">{previewResult.strategy}</span>}
                      {typeof previewResult.retrievalMs === 'number' && (
                        <span className="mc-badge mc-badge-ok">总耗时 {Math.round(previewResult.retrievalMs)} ms</span>
                      )}
                      {previewResult.vector_retrieval?.query_plan?.fast_path && (
                        <span className="mc-badge mc-badge-ok">快速通道（跳过改写）</span>
                      )}
                    </div>
                    <EvidencePanel
                      inline
                      attempt={{
                        evidence: previewResult.evidence || [],
                        diagnostics: previewResult.diagnostics || [],
                        evidenceRefs: (previewResult.evidence || []).map(e => e.evidence_id)
                      }}
                    />
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {newRoleOpen && (
        <NewRoleModal
          onClose={() => setNewRoleOpen(false)}
          onCreated={(res) => {
            setNewRoleOpen(false);
            if (res?.library) {
              setDraft({ ...res.library, role: res.directory });
              onLibraryUpdated?.(res.library);
            }
            setSubTab('workspace');
            void openDocumentInPane(res.jdPath, 'edit');
            notify(`已创建标准岗位档案：${res.directory}`);
          }}
        />
      )}
    </div>
  );
}
