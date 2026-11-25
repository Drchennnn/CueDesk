import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconArrowRight,
  IconChevronDown,
  IconChevronRight,
  IconEdit,
  IconFolder,
  IconFolderPlus,
  IconGrip,
  IconMic,
  IconMore,
  IconPlay,
  IconPlus,
  IconScan,
  IconSearch,
  IconSpeaker,
  IconStar,
  IconTrash,
  IconX
} from './Icons.jsx';
import { ScreenshotBatchPanel, Switch, computeServiceHealth } from './SharedWidgets.jsx';

const MAX_NAME = 100;
const MAX_DESC = 2000;

function TemplateModal({ template, groups, roles, onClose, onSave }) {
  const isEdit = Boolean(template?.id);
  const [name, setName] = useState(template?.name || '');
  const [description, setDescription] = useState(template?.description || '');
  const [groupId, setGroupId] = useState(template?.groupId || groups[0]?.id || 'group-default');
  const [audioSource, setAudioSource] = useState(template?.audioSource || 'system');
  const [answerLang, setAnswerLang] = useState(template?.answerLang || 'chinese');
  const [transcriptionMode, setTranscriptionMode] = useState(template?.transcriptionMode || 'auto');
  const [libraryEnabled, setLibraryEnabled] = useState(
    template?.libraryEnabled === true ? 'on' : template?.libraryEnabled === false ? 'off' : 'inherit'
  );
  const [role, setRole] = useState(template?.role || '');
  const [resume, setResume] = useState(template?.resume || '');
  const [resumeName, setResumeName] = useState(template?.resumeName || '');
  const [jd, setJd] = useState(template?.jd || '');
  const [jdName, setJdName] = useState(template?.jdName || '');
  const [error, setError] = useState('');

  const pickDoc = async (slot) => {
    try {
      const picked = await window.mc.pickKnowledge(slot);
      if (!picked) return;
      if (slot === 'resume') { setResume(picked.text); setResumeName(picked.name); }
      else { setJd(picked.text); setJdName(picked.name); }
    } catch (e) {
      setError('读取文档失败：' + e.message);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) { setError('请填写模板名称'); return; }
    onSave({
      ...(template || {}),
      name: cleanName.slice(0, MAX_NAME),
      description: description.slice(0, MAX_DESC),
      groupId,
      audioSource,
      answerLang,
      scene: 'interview',
      transcriptionMode,
      libraryEnabled: libraryEnabled === 'on' ? true : libraryEnabled === 'off' ? false : null,
      role,
      resume,
      resumeName,
      jd,
      jdName,
      updatedAt: Date.now()
    });
  };

  return (
    <div className="mc-modal-backdrop" onClick={onClose}>
      <form className="mc-modal" onClick={e => e.stopPropagation()} onSubmit={handleSubmit} role="dialog" aria-modal="true" aria-label={isEdit ? '编辑面试模板' : '新建面试模板'}>
        <div className="mc-modal-header">
          <h3 className="mc-modal-title">{isEdit ? '编辑面试模板' : '新建面试模板'}</h3>
          <button type="button" className="mc-icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="mc-modal-body">
          <div className="mc-field">
            <label className="mc-field-label">
              <span>模板名称 *</span>
              <span className="mc-field-hint">{name.length} / {MAX_NAME}</span>
            </label>
            <input className="mc-input" maxLength={MAX_NAME} value={name} onChange={e => setName(e.target.value)} placeholder="例如：后端研发一面 / 系统音频" autoFocus />
          </div>

          <div className="mc-field">
            <label className="mc-field-label">
              <span>模板说明（可选）</span>
              <span className="mc-field-hint">{description.length} / {MAX_DESC}</span>
            </label>
            <textarea className="mc-textarea" rows={2} maxLength={MAX_DESC} value={description} onChange={e => setDescription(e.target.value)} placeholder="记录本场目标岗位、注意事项或收音方式说明" />
          </div>

          <div className="mc-grid-2">
            <div className="mc-field">
              <label className="mc-field-label">所属分组</label>
              <select className="mc-select" value={groupId} onChange={e => setGroupId(e.target.value)}>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="mc-field">
              <label className="mc-field-label">音频来源</label>
              <select className="mc-select" value={audioSource} onChange={e => setAudioSource(e.target.value)}>
                <option value="system">系统音频（扬声器/会议软件）</option>
                <option value="mic">麦克风（线下/外放收音）</option>
              </select>
            </div>
            <div className="mc-field">
              <label className="mc-field-label">回答语言</label>
              <select className="mc-select" value={answerLang} onChange={e => setAnswerLang(e.target.value)}>
                <option value="chinese">中文回答</option>
                <option value="english">英文回答</option>
              </select>
            </div>
            <div className="mc-field">
              <label className="mc-field-label">转写提问模式</label>
              <select className="mc-select" value={transcriptionMode} onChange={e => setTranscriptionMode(e.target.value)}>
                <option value="auto">自动识别提问并生成</option>
                <option value="manual">手动累计后发送</option>
                <option value="transcript-only">仅实时转写</option>
              </select>
            </div>
            <div className="mc-field">
              <label className="mc-field-label">本地资料库 V2</label>
              <select className="mc-select" value={libraryEnabled} onChange={e => setLibraryEnabled(e.target.value)}>
                <option value="inherit">跟随全局设置</option>
                <option value="on">本模板强制启用</option>
                <option value="off">本模板临时关闭</option>
              </select>
            </div>
            <div className="mc-field">
              <label className="mc-field-label">绑定岗位目录</label>
              <select className="mc-select" value={role} onChange={e => setRole(e.target.value)}>
                <option value="">跟随全局默认岗位</option>
                {(roles || []).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          <div className="mc-card">
            <div className="mc-card-body" style={{ padding: 12, gap: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>模板专属附件（可选，未启用 V2 资料库时自动生效）</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <button type="button" className="mc-btn mc-btn-sm" onClick={() => void pickDoc('resume')}>
                  {resumeName ? `简历：${resumeName}` : '导入简历 (.md/.txt/.docx/.pdf)'}
                </button>
                {resumeName && <button type="button" className="mc-btn mc-btn-sm mc-btn-ghost" onClick={() => { setResume(''); setResumeName(''); }}>清除</button>}
                <button type="button" className="mc-btn mc-btn-sm" onClick={() => void pickDoc('jd')}>
                  {jdName ? `JD：${jdName}` : '导入岗位 JD'}
                </button>
                {jdName && <button type="button" className="mc-btn mc-btn-sm mc-btn-ghost" onClick={() => { setJd(''); setJdName(''); }}>清除</button>}
              </div>
            </div>
          </div>

          {error && <div className="mc-alert mc-alert-err">{error}</div>}
        </div>
        <div className="mc-modal-footer">
          <button type="button" className="mc-btn" onClick={onClose}>取消</button>
          <button type="submit" className="mc-btn mc-btn-primary">{isEdit ? '保存模板' : '创建模板'}</button>
        </div>
      </form>
    </div>
  );
}

function PreSessionModal({
  template,
  settings,
  asr,
  library,
  workbenchPrefs,
  windowState,
  onClose,
  onOpenSettings,
  onConfirmStart
}) {
  const [sessionName, setSessionName] = useState(
    `${template.name} · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  );
  const [audioSource, setAudioSource] = useState(template.audioSource || 'system');
  const [answerLang, setAnswerLang] = useState(template.answerLang || settings?.llm?.answerLang || 'chinese');
  const [transcriptionMode, setTranscriptionMode] = useState(template.transcriptionMode || workbenchPrefs?.transcriptionMode || 'auto');
  const [libraryEnabled, setLibraryEnabled] = useState(
    typeof template.libraryEnabled === 'boolean' ? template.libraryEnabled : Boolean(library?.enabled)
  );
  const [role, setRole] = useState(template.role || library?.role || '');
  const [resume, setResume] = useState(template.resume || '');
  const [resumeName, setResumeName] = useState(template.resumeName || '');
  const [jd, setJd] = useState(template.jd || '');
  const [jdName, setJdName] = useState(template.jdName || '');
  const [autoSaveOnClose, setAutoSaveOnClose] = useState(workbenchPrefs?.autoSaveOnClose !== false);
  const [enableSessionSecurity, setEnableSessionSecurity] = useState(Boolean(windowState?.securityMode?.enabled));
  const [autoStartCapture, setAutoStartCapture] = useState(true);
  const [startAudioRecording, setStartAudioRecording] = useState(false);

  const health = computeServiceHealth(settings, asr, library);
  const blockers = [];
  const warnings = [];
  if (!health.llm.ready && !health.asr.ready) {
    blockers.push('文本大模型和语音识别均未配置，建议先在「高级设置」配置 API Key 后再开始。');
  } else {
    if (!health.llm.ready) warnings.push('文本模型未配置 API Key：可先记录转写，但无法生成 AI 回答。');
    if (!health.asr.ready) warnings.push(`语音识别当前为「${health.asr.label}」：进入后仍可手动输入或截图提问。`);
  }
  if (libraryEnabled && !library?.root) {
    warnings.push('已勾选启用本地资料库 V2，但尚未选择资料目录（可在知识库页面设置）。');
  }
  if (!health.vision.ready) {
    warnings.push('截图多模态接口未启用（可选，不影响语音与文本问答）。');
  }

  const pickDoc = async (slot) => {
    const picked = await window.mc.pickKnowledge(slot).catch(() => null);
    if (!picked) return;
    if (slot === 'resume') { setResume(picked.text); setResumeName(picked.name); }
    else { setJd(picked.text); setJdName(picked.name); }
  };

  return (
    <div className="mc-modal-backdrop" onClick={onClose}>
      <div className="mc-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="开始面试前准备">
        <div className="mc-modal-header">
          <div>
            <h3 className="mc-modal-title">准备进入实时面试</h3>
            <div className="mc-field-hint">基于模板「{template.name}」创建新会话，临时调整不会改写全局默认设置</div>
          </div>
          <button type="button" className="mc-icon-btn" onClick={onClose}><IconX /></button>
        </div>

        <div className="mc-modal-body">
          {blockers.length > 0 && (
            <div className="mc-alert mc-alert-err" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <strong>启动前提醒</strong>
              {blockers.map((b, i) => <div key={i}>{b}</div>)}
              <div>
                <button type="button" className="mc-btn mc-btn-sm" onClick={() => { onClose(); onOpenSettings('models'); }}>
                  前往高级设置
                </button>
              </div>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="mc-alert mc-alert-warn" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {warnings.map((w, i) => <div key={i}>• {w}</div>)}
            </div>
          )}

          <div className="mc-field">
            <label className="mc-field-label">本场会话名称</label>
            <input className="mc-input" value={sessionName} onChange={e => setSessionName(e.target.value)} maxLength={100} />
          </div>

          <div className="mc-grid-2">
            <div className="mc-field">
              <label className="mc-field-label">音频捕获源</label>
              <select className="mc-select" value={audioSource} onChange={e => setAudioSource(e.target.value)}>
                <option value="system">系统音频（会议扬声器/耳机）</option>
                <option value="mic">本地麦克风（外放/线下）</option>
              </select>
            </div>
            <div className="mc-field">
              <label className="mc-field-label">回答语言</label>
              <select className="mc-select" value={answerLang} onChange={e => setAnswerLang(e.target.value)}>
                <option value="chinese">中文</option>
                <option value="english">English</option>
              </select>
            </div>
            <div className="mc-field">
              <label className="mc-field-label">转写提问策略</label>
              <select className="mc-select" value={transcriptionMode} onChange={e => setTranscriptionMode(e.target.value)}>
                <option value="auto">自动提问</option>
                <option value="manual">手动累计后发送</option>
                <option value="transcript-only">仅转写</option>
              </select>
            </div>
            <div className="mc-field">
              <label className="mc-field-label">资料库岗位</label>
              <select className="mc-select" value={role} disabled={!libraryEnabled} onChange={e => setRole(e.target.value)}>
                <option value="">通用（不限定岗位）</option>
                {(library?.roles || []).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          <div className="mc-card">
            <div className="mc-card-body" style={{ padding: 12, gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>本场启用本地面试资料库 V2</div>
                  <div className="mc-field-hint">支持原文证据引用与防编造约束</div>
                </div>
                <Switch checked={libraryEnabled} onChange={setLibraryEnabled} aria-label="本场启用本地面试资料库" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>进入后自动开启音频采集</div>
                  <div className="mc-field-hint">关闭则先以暂停状态进入浮窗，手动点按钮再开始</div>
                </div>
                <Switch checked={autoStartCapture} onChange={setAutoStartCapture} aria-label="进入后自动开启采集" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>本场开启安全模式（防截屏 + 不抢焦点）</div>
                  <div className="mc-field-hint">结束本场会话时自动恢复原窗口偏好</div>
                </div>
                <Switch
                  checked={enableSessionSecurity}
                  success
                  disabled={windowState?.securityMode?.enabled && windowState?.securityMode?.scope === 'persistent'}
                  onChange={setEnableSessionSecurity}
                  aria-label="本场开启安全模式"
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>进入后开启整场双轨 WAV 录音</div>
                  <div className="mc-field-hint">默认关闭；也可随时在工作台顶栏点击录音按钮手动启停</div>
                </div>
                <Switch checked={startAudioRecording} onChange={setStartAudioRecording} aria-label="进入后开启整场录音" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>结束会话时自动保存到本地记录</div>
                  <div className="mc-field-hint">随时可在左侧「记忆与记录」中回看、听录音与复盘归档</div>
                </div>
                <Switch checked={autoSaveOnClose} onChange={setAutoSaveOnClose} aria-label="结束会话时自动保存" />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button type="button" className="mc-btn mc-btn-sm" onClick={() => void pickDoc('resume')}>
              {resumeName ? `已选简历：${resumeName}` : '临时附加简历'}
            </button>
            <button type="button" className="mc-btn mc-btn-sm" onClick={() => void pickDoc('jd')}>
              {jdName ? `已选 JD：${jdName}` : '临时附加 JD'}
            </button>
          </div>
        </div>

        <div className="mc-modal-footer">
          <button type="button" className="mc-btn" onClick={onClose}>取消</button>
          <button
            type="button"
            className="mc-btn mc-btn-primary"
            onClick={() => onConfirmStart({
              templateId: template.id,
              name: sessionName.trim() || template.name,
              audioSource,
              answerLang,
              scene: 'interview',
              transcriptionMode,
              libraryEnabled,
              role,
              resume,
              resumeName,
              jd,
              jdName,
              autoSaveOnClose,
              enableSessionSecurity,
              autoStartCapture: autoStartCapture && health.asr.ready,
              startAudioRecording
            })}
          >
            <IconPlay size={12} /> 进入实时面试
          </button>
        </div>
      </div>
    </div>
  );
}

export function HomeView({
  templatesStore,
  onSaveTemplates,
  settings,
  asr,
  library,
  workbenchPrefs,
  windowState,
  activeSession,
  onStartSession,
  onResumeWorkbench,
  onEndActiveSession,
  onOpenSettings,
  onEnterWrittenCompact,
  onQuickCaptureWritten,
  batch,
  batchController
}) {
  const [homeTab, setHomeTab] = useState('interview');
  const [search, setSearch] = useState('');
  const [audioFilter, setAudioFilter] = useState('all');
  const [sortBy, setSortBy] = useState('custom');
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [prepTemplate, setPrepTemplate] = useState(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [rowMenu, setRowMenu] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dragState, setDragState] = useState(null);
  const hoverTimerRef = useRef(null);
  const closePreviewTimerRef = useRef(null);
  const dragPressTimerRef = useRef(null);

  const groups = useMemo(
    () => [...(templatesStore?.groups || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [templatesStore]
  );
  const templates = templatesStore?.templates || [];

  useEffect(() => {
    const closeMenu = () => setRowMenu(null);
    window.addEventListener('click', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
      clearTimeout(hoverTimerRef.current);
      clearTimeout(closePreviewTimerRef.current);
      clearTimeout(dragPressTimerRef.current);
    };
  }, []);

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = templates.filter(tpl => {
      if (audioFilter !== 'all' && tpl.audioSource !== audioFilter) return false;
      if (!q) return true;
      return (tpl.name || '').toLowerCase().includes(q) ||
        (tpl.description || '').toLowerCase().includes(q) ||
        (tpl.role || '').toLowerCase().includes(q);
    });
    if (sortBy === 'name') {
      list = [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name, 'zh-CN'));
    } else if (sortBy === 'recent') {
      list = [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0));
    } else {
      list = [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.order ?? 0) - (b.order ?? 0));
    }
    return list;
  }, [templates, search, audioFilter, sortBy]);

  const activeTemplateVisible = Boolean(
    activeSession && filteredTemplates.some(t => t.id === activeSession.templateId)
  );

  const persistStore = (next) => {
    void onSaveTemplates(next);
  };

  const toggleGroupCollapse = (groupId) => {
    persistStore({
      ...templatesStore,
      groups: groups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)
    });
  };

  const handleSaveTemplate = (tpl) => {
    const exists = templates.some(x => x.id === tpl.id);
    const nextTemplates = exists
      ? templates.map(x => x.id === tpl.id ? tpl : x)
      : [...templates, { ...tpl, id: `tpl-${Date.now().toString(36)}`, order: templates.length, createdAt: Date.now() }];
    persistStore({ ...templatesStore, templates: nextTemplates });
    setEditingTemplate(null);
  };

  const togglePin = (tpl) => {
    persistStore({
      ...templatesStore,
      templates: templates.map(x => x.id === tpl.id ? { ...x, pinned: !x.pinned } : x)
    });
  };

  const duplicateTemplate = (tpl) => {
    const copy = {
      ...tpl,
      id: `tpl-${Date.now().toString(36)}`,
      name: `${tpl.name}（副本）`.slice(0, MAX_NAME),
      pinned: false,
      order: templates.length,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    persistStore({ ...templatesStore, templates: [...templates, copy] });
  };

  const deleteTemplate = (tpl) => {
    persistStore({
      ...templatesStore,
      templates: templates.filter(x => x.id !== tpl.id)
    });
  };

  const moveTemplateToGroup = (tpl, targetGroupId) => {
    persistStore({
      ...templatesStore,
      templates: templates.map(x => x.id === tpl.id ? { ...x, groupId: targetGroupId } : x)
    });
  };

  const createGroup = (e) => {
    e.preventDefault();
    const clean = newGroupName.trim();
    if (!clean) return;
    const nextGroup = { id: `group-${Date.now().toString(36)}`, name: clean.slice(0, 60), order: groups.length, collapsed: false };
    persistStore({ ...templatesStore, groups: [...groups, nextGroup] });
    setNewGroupName('');
    setNewGroupOpen(false);
  };

  const deleteGroup = (groupId) => {
    if (groups.length <= 1) return;
    const fallbackId = groups.find(g => g.id !== groupId)?.id;
    persistStore({
      ...templatesStore,
      groups: groups.filter(g => g.id !== groupId),
      templates: templates.map(t => t.groupId === groupId ? { ...t, groupId: fallbackId } : t)
    });
  };

  const reorderWithinGroup = (sourceId, targetId) => {
    const src = templates.find(t => t.id === sourceId);
    const dst = templates.find(t => t.id === targetId);
    if (!src || !dst || src.id === dst.id || src.groupId !== dst.groupId) return;
    const inGroup = templates.filter(t => t.groupId === src.groupId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const fromIdx = inGroup.findIndex(t => t.id === sourceId);
    const toIdx = inGroup.findIndex(t => t.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const moved = inGroup.slice();
    const [item] = moved.splice(fromIdx, 1);
    moved.splice(toIdx, 0, item);
    const orderMap = new Map(moved.map((t, i) => [t.id, i]));
    persistStore({
      ...templatesStore,
      templates: templates.map(t => orderMap.has(t.id) ? { ...t, order: orderMap.get(t.id) } : t)
    });
  };

  const schedulePreview = (tpl, event) => {
    if (event.pointerType === 'touch') return;
    if (event.target.closest?.('button,input,select,[data-template-preview-exclude="true"]')) return;
    clearTimeout(closePreviewTimerRef.current);
    clearTimeout(hoverTimerRef.current);
    const rect = event.currentTarget.getBoundingClientRect();
    hoverTimerRef.current = setTimeout(() => {
      const left = Math.max(12, Math.min(rect.left + 20, window.innerWidth - 332));
      const top = rect.bottom + 8 + 150 > window.innerHeight ? Math.max(12, rect.top - 150) : rect.bottom + 8;
      setPreview({ tpl, left, top });
    }, 200);
  };

  const cancelPreviewSoon = () => {
    clearTimeout(hoverTimerRef.current);
    closePreviewTimerRef.current = setTimeout(() => setPreview(null), 120);
  };

  const visionReady = Boolean(
    settings?.multimodal?.enabled &&
    (settings?.multimodal?.endpoints || []).some(e => e.enabled && e.baseUrl && e.model)
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
      <header className="mc-page-header">
        <h1 className="mc-page-title">首页</h1>
        {activeSession && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="mc-badge mc-badge-ok">活动会话：{activeSession.name}</span>
            <button type="button" className="mc-btn mc-btn-sm mc-btn-success" onClick={onResumeWorkbench}>
              继续 <IconArrowRight size={13} />
            </button>
          </div>
        )}
      </header>

      <div className="mc-tabs-row" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={homeTab === 'interview'}
          className={`mc-tab-btn${homeTab === 'interview' ? ' is-active' : ''}`}
          onClick={() => setHomeTab('interview')}
        >
          面试助手
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={homeTab === 'written'}
          className={`mc-tab-btn${homeTab === 'written' ? ' is-active' : ''}`}
          onClick={() => setHomeTab('written')}
        >
          笔试助手
        </button>
      </div>

      {homeTab === 'interview' ? (
        <>
          <div className="mc-toolbar">
            <div className="mc-toolbar-left">
              <div className="mc-search-wrap">
                <span className="mc-search-icon"><IconSearch size={14} /></span>
                <input
                  className="mc-search-input"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="搜索面试模板…"
                  aria-label="搜索面试模板"
                />
                {search && (
                  <button type="button" className="mc-search-clear" onClick={() => setSearch('')} aria-label="清空搜索">
                    <IconX size={12} />
                  </button>
                )}
              </div>

              <select className="mc-filter-select" value={audioFilter} onChange={e => setAudioFilter(e.target.value)} aria-label="按音频源筛选">
                <option value="all">全部音频源</option>
                <option value="system">系统音频</option>
                <option value="mic">麦克风</option>
              </select>

              <select className="mc-filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="排序方式">
                <option value="custom">自定义顺序</option>
                <option value="recent">最近编辑</option>
                <option value="name">按名称</option>
              </select>

              {activeSession && !activeTemplateVisible && (
                <button type="button" className="mc-btn mc-btn-sm mc-btn-success" onClick={onResumeWorkbench}>
                  继续当前面试 →
                </button>
              )}
            </div>

            <div className="mc-toolbar-right">
              <button type="button" className="mc-btn" style={{ minWidth: 96 }} onClick={() => setNewGroupOpen(true)}>
                <IconFolderPlus size={14} /> 新建分组
              </button>
              <button type="button" className="mc-btn mc-btn-primary" style={{ minWidth: 96 }} onClick={() => setEditingTemplate({})}>
                <IconPlus size={14} /> 新建模板
              </button>
            </div>
          </div>

          <div className="mc-template-list-outer">
            <div className="mc-template-list-box">
              <div className="mc-template-table-inner">
                <div className="mc-template-grid mc-list-header">
                  <div>面试模板</div>
                  <div>运行</div>
                  <div>语音模式</div>
                  <div>资料库</div>
                  <div>语言</div>
                  <div style={{ textAlign: 'right' }}>操作</div>
                </div>

                {groups.map((group) => {
                  const groupItems = filteredTemplates.filter(t => t.groupId === group.id);
                  return (
                    <div key={group.id}>
                      <div className="mc-list-group-row">
                        <button type="button" className="mc-group-toggle" onClick={() => toggleGroupCollapse(group.id)}>
                          {group.collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
                          <span>{group.name}</span>
                          <span className="mc-badge">{groupItems.length}</span>
                        </button>
                        {groups.length > 1 && (
                          <button
                            type="button"
                            className="mc-btn mc-btn-ghost mc-btn-sm"
                            title="删除分组（模板将移至默认分组）"
                            onClick={() => deleteGroup(group.id)}
                          >
                            <IconTrash size={13} />
                          </button>
                        )}
                      </div>

                      {!group.collapsed && groupItems.map((tpl) => {
                        const isRunning = activeSession?.templateId === tpl.id;
                        const isDragging = dragState?.sourceId === tpl.id;
                        const isDropTarget = dragState?.targetId === tpl.id && dragState.sourceId !== tpl.id && dragState.groupId === tpl.groupId;
                        const libBadge = tpl.libraryEnabled === false
                          ? '关闭'
                          : tpl.role
                            ? tpl.role
                            : (tpl.libraryEnabled === true || library?.enabled) ? (library?.role || 'V2 资料库') : '未绑定';

                        return (
                          <div
                            key={tpl.id}
                            className={`mc-template-grid mc-template-row${isDragging ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
                            onMouseEnter={(e) => schedulePreview(tpl, e)}
                            onMouseLeave={cancelPreviewSoon}
                            onMouseMove={() => {
                              if (dragState && dragState.groupId === tpl.groupId && dragState.targetId !== tpl.id) {
                                setDragState(prev => prev ? { ...prev, targetId: tpl.id } : null);
                              }
                            }}
                            onMouseUp={() => {
                              clearTimeout(dragPressTimerRef.current);
                              if (dragState) {
                                reorderWithinGroup(dragState.sourceId, tpl.id);
                                setDragState(null);
                              }
                            }}
                          >
                            <div className="mc-tpl-name-cell">
                              <span
                                className="mc-drag-handle"
                                data-template-preview-exclude="true"
                                title="按住拖动排序（同分组内）"
                                onMouseDown={(e) => {
                                  if (sortBy !== 'custom') return;
                                  e.preventDefault();
                                  clearTimeout(dragPressTimerRef.current);
                                  dragPressTimerRef.current = setTimeout(() => {
                                    setPreview(null);
                                    setDragState({ sourceId: tpl.id, groupId: tpl.groupId, targetId: tpl.id });
                                  }, 320);
                                  const onWinUp = () => {
                                    clearTimeout(dragPressTimerRef.current);
                                    setDragState(null);
                                    window.removeEventListener('mouseup', onWinUp);
                                  };
                                  window.addEventListener('mouseup', onWinUp);
                                }}
                              >
                                <IconGrip size={14} />
                              </span>
                              <div className="mc-tpl-text" onClick={() => setEditingTemplate(tpl)} style={{ cursor: 'pointer' }}>
                                <div className="mc-tpl-title">
                                  {tpl.pinned && <IconStar size={12} filled style={{ color: 'var(--warning-dot)', flexShrink: 0 }} />}
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tpl.name}</span>
                                </div>
                                <div className="mc-tpl-desc">{tpl.description || '点击编辑模板说明或绑定简历与岗位资料'}</div>
                              </div>
                            </div>

                            <div className="mc-tpl-run-cell" data-template-preview-exclude="true">
                              {isRunning ? (
                                <>
                                  <button type="button" className="mc-btn mc-btn-sm mc-btn-success" onClick={onResumeWorkbench}>
                                    继续 →
                                  </button>
                                  <button type="button" className="mc-icon-btn is-danger" title="结束当前会话" aria-label="结束当前会话" onClick={onEndActiveSession}>
                                    <IconX size={13} />
                                  </button>
                                </>
                              ) : (
                                <button type="button" className="mc-btn mc-btn-sm" onClick={() => setPrepTemplate(tpl)}>
                                  <IconPlay size={11} /> 开始
                                </button>
                              )}
                            </div>

                            <div className="mc-tpl-col-center">
                              <span className="mc-badge">
                                {tpl.audioSource === 'mic' ? <><IconMic size={11} /> 麦克风</> : <><IconSpeaker size={11} /> 系统音频</>}
                              </span>
                            </div>

                            <div className="mc-tpl-col-center">
                              <span className={`mc-badge${tpl.libraryEnabled === false ? '' : (library?.enabled ? ' mc-badge-info' : '')}`} title={libBadge} style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {libBadge}
                              </span>
                            </div>

                            <div className="mc-tpl-col-center">
                              <span className="mc-badge">{tpl.answerLang === 'english' ? 'EN' : '中文'}</span>
                            </div>

                            <div className="mc-tpl-actions-cell" data-template-preview-exclude="true">
                              <button
                                type="button"
                                className="mc-icon-btn"
                                title={tpl.pinned ? '取消置顶' : '置顶模板'}
                                onClick={() => togglePin(tpl)}
                              >
                                <IconStar size={14} filled={tpl.pinned} style={tpl.pinned ? { color: 'var(--warning-dot)' } : undefined} />
                              </button>
                              <button
                                type="button"
                                className="mc-icon-btn"
                                title="更多操作"
                                aria-label="更多操作"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setRowMenu({
                                    tpl,
                                    left: Math.max(8, Math.min(rect.right - 160, window.innerWidth - 172)),
                                    top: Math.min(rect.bottom + 4, window.innerHeight - 210)
                                  });
                                }}
                              >
                                <IconMore size={15} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {filteredTemplates.length === 0 && (
                  <div style={{ padding: '44px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                      {search || audioFilter !== 'all' ? '没有匹配的面试模板' : '还没有创建任何面试模板'}
                    </div>
                    <button type="button" className="mc-btn mc-btn-primary" onClick={() => setEditingTemplate({})}>
                      <IconPlus size={14} /> 新建模板
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="mc-page-scroll">
          <div className="mc-page-inner">
            <div className="mc-card">
              <div className="mc-card-head">
                <div>
                  <h3 className="mc-card-title">笔试小窗与多模型并行识题</h3>
                  <p className="mc-card-desc">静默截取题目屏幕或框选区域，支持多图暂存与多视觉模型同时作答。</p>
                </div>
                <span className={`mc-badge ${visionReady ? 'mc-badge-ok' : 'mc-badge-warn'}`}>
                  {visionReady ? '截图视觉模型已就绪' : '视觉模型待配置'}
                </span>
              </div>
              <div className="mc-card-body">
                {!visionReady && (
                  <div className="mc-alert mc-alert-warn">
                    尚未启用或配置完整的视觉模型接口，请先在「高级设置 → 模型接口」中启用截图问答并填写至少一个视觉接口。
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" className="mc-btn mc-btn-primary" onClick={onEnterWrittenCompact}>
                    <IconPlay size={12} /> 启动笔试小窗
                  </button>
                  <button type="button" className="mc-btn" disabled={!visionReady} onClick={() => onQuickCaptureWritten('full')}>
                    <IconScan size={14} /> 静默全屏截图识题
                  </button>
                  <button type="button" className="mc-btn" disabled={!visionReady} onClick={() => onQuickCaptureWritten('region')}>
                    框选截图识题
                  </button>
                  <button type="button" className="mc-btn" onClick={() => onOpenSettings('models')}>
                    配置视觉接口
                  </button>
                </div>
              </div>
            </div>

            <div className="mc-card">
              <div className="mc-card-head">
                <div>
                  <h3 className="mc-card-title">多图暂存队列</h3>
                  <p className="mc-card-desc">适用于一道笔试题跨多屏展示的情况：开启多图后逐张截图，最后一次性提交。</p>
                </div>
              </div>
              <div className="mc-card-body">
                <ScreenshotBatchPanel batch={batch} controller={batchController} management />
              </div>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div
          className="mc-preview-card"
          style={{ left: preview.left, top: preview.top }}
          onMouseEnter={() => clearTimeout(closePreviewTimerRef.current)}
          onMouseLeave={cancelPreviewSoon}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>{preview.tpl.name}</div>
          <div style={{ marginBottom: 8 }}>{preview.tpl.description || '无说明'}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span className="mc-badge">{preview.tpl.audioSource === 'mic' ? '麦克风' : '系统音频'}</span>
            <span className="mc-badge">{preview.tpl.answerLang === 'english' ? '英文' : '中文'}</span>
            <span className="mc-badge">
              {preview.tpl.transcriptionMode === 'manual' ? '手动发送' : preview.tpl.transcriptionMode === 'transcript-only' ? '仅转写' : '自动提问'}
            </span>
            {preview.tpl.role && <span className="mc-badge mc-badge-info">岗位：{preview.tpl.role}</span>}
          </div>
        </div>
      )}

      {rowMenu && (
        <div className="mc-dropdown-menu" style={{ left: rowMenu.left, top: rowMenu.top }} onClick={e => e.stopPropagation()}>
          <button type="button" className="mc-dropdown-item" onClick={() => { setEditingTemplate(rowMenu.tpl); setRowMenu(null); }}>
            <IconEdit size={13} /> 编辑模板
          </button>
          <button type="button" className="mc-dropdown-item" onClick={() => { duplicateTemplate(rowMenu.tpl); setRowMenu(null); }}>
            <IconPlus size={13} /> 复制模板
          </button>
          {groups.length > 1 && (
            <>
              <div className="mc-dropdown-sep" />
              {groups.filter(g => g.id !== rowMenu.tpl.groupId).map(g => (
                <button key={g.id} type="button" className="mc-dropdown-item" onClick={() => { moveTemplateToGroup(rowMenu.tpl, g.id); setRowMenu(null); }}>
                  <IconFolder size={13} /> 移至「{g.name}」
                </button>
              ))}
            </>
          )}
          <div className="mc-dropdown-sep" />
          <button type="button" className="mc-dropdown-item is-danger" onClick={() => { deleteTemplate(rowMenu.tpl); setRowMenu(null); }}>
            <IconTrash size={13} /> 删除模板
          </button>
        </div>
      )}

      {newGroupOpen && (
        <div className="mc-modal-backdrop" onClick={() => setNewGroupOpen(false)}>
          <form className="mc-modal mc-modal-sm" onClick={e => e.stopPropagation()} onSubmit={createGroup}>
            <div className="mc-modal-header">
              <h3 className="mc-modal-title">新建模板分组</h3>
              <button type="button" className="mc-icon-btn" onClick={() => setNewGroupOpen(false)}><IconX /></button>
            </div>
            <div className="mc-modal-body">
              <div className="mc-field">
                <label className="mc-field-label">分组名称</label>
                <input className="mc-input" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} maxLength={60} placeholder="例如：秋招技术面 / 英文算法面" autoFocus />
              </div>
            </div>
            <div className="mc-modal-footer">
              <button type="button" className="mc-btn" onClick={() => setNewGroupOpen(false)}>取消</button>
              <button type="submit" className="mc-btn mc-btn-primary">创建</button>
            </div>
          </form>
        </div>
      )}

      {editingTemplate && (
        <TemplateModal
          template={editingTemplate}
          groups={groups}
          roles={library?.roles || []}
          onClose={() => setEditingTemplate(null)}
          onSave={handleSaveTemplate}
        />
      )}

      {prepTemplate && (
        <PreSessionModal
          template={prepTemplate}
          settings={settings}
          asr={asr}
          library={library}
          workbenchPrefs={workbenchPrefs}
          windowState={windowState}
          onClose={() => setPrepTemplate(null)}
          onOpenSettings={onOpenSettings}
          onConfirmStart={(payload) => {
            setPrepTemplate(null);
            onStartSession(payload);
          }}
        />
      )}
    </div>
  );
}
