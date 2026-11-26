import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconArrowRight,
  IconCamera,
  IconChevronDown,
  IconChevronRight,
  IconCode,
  IconEdit,
  IconFolder,
  IconFolderPlus,
  IconGrip,
  IconKeyboard,
  IconMessageSquare,
  IconMic,
  IconMore,
  IconPlay,
  IconPlus,
  IconScan,
  IconSearch,
  IconSettings,
  IconSpeaker,
  IconStar,
  IconTrash,
  IconX,
  IconZap
} from './Icons.jsx';
import { ScreenshotBatchPanel, Switch, computeServiceHealth } from './SharedWidgets.jsx';
import { CustomSelect } from './CustomSelect.jsx';
import { WorkbenchShortcutsModal } from './WorkbenchShortcutsModal.jsx';
import { formatCodingSummary } from '../core/codingPrefs.js';
import { summarizeWrittenCounts } from '../core/sessionModel.js';

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
              <CustomSelect
                className="mc-select"
                ariaLabel="所属分组"
                value={groupId}
                onChange={setGroupId}
                options={groups.map(g => ({ value: g.id, label: g.name }))}
              />
            </div>
            <div className="mc-field">
              <label className="mc-field-label">音频来源</label>
              <CustomSelect
                className="mc-select"
                ariaLabel="音频来源"
                value={audioSource}
                onChange={setAudioSource}
                options={[
                  { value: 'system', label: '系统音频（扬声器/会议软件）' },
                  { value: 'mic', label: '麦克风（线下/外放收音）' }
                ]}
              />
            </div>
            <div className="mc-field">
              <label className="mc-field-label">回答语言</label>
              <CustomSelect
                className="mc-select"
                ariaLabel="回答语言"
                value={answerLang}
                onChange={setAnswerLang}
                options={[
                  { value: 'chinese', label: '中文回答' },
                  { value: 'english', label: '英文回答' }
                ]}
              />
            </div>
            <div className="mc-field">
              <label className="mc-field-label">转写提问模式</label>
              <CustomSelect
                className="mc-select"
                ariaLabel="转写提问模式"
                value={transcriptionMode}
                onChange={setTranscriptionMode}
                options={[
                  { value: 'auto', label: '自动识别提问并生成' },
                  { value: 'manual', label: '手动累计后发送' },
                  { value: 'transcript-only', label: '仅实时转写' }
                ]}
              />
            </div>
            <div className="mc-field">
              <label className="mc-field-label">本地资料库 V2</label>
              <CustomSelect
                className="mc-select"
                ariaLabel="本地资料库开关"
                value={libraryEnabled}
                onChange={setLibraryEnabled}
                options={[
                  { value: 'inherit', label: '跟随全局设置' },
                  { value: 'on', label: '本模板强制启用' },
                  { value: 'off', label: '本模板临时关闭' }
                ]}
              />
            </div>
            <div className="mc-field">
              <label className="mc-field-label">绑定岗位目录</label>
              <CustomSelect
                className="mc-select"
                ariaLabel="绑定岗位目录"
                value={role}
                onChange={setRole}
                options={[
                  { value: '', label: '跟随全局默认岗位' },
                  ...(roles || []).map(r => ({ value: r, label: r }))
                ]}
              />
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
  onNavigateCapability,
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
  const [enableSecondaryMic, setEnableSecondaryMic] = useState(false);
  const [startAudioRecording, setStartAudioRecording] = useState(false);

  const health = computeServiceHealth(settings, asr, library);

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
          <button type="button" className="mc-icon-btn" aria-label="关闭弹窗" onClick={onClose}><IconX /></button>
        </div>

        <div className="mc-modal-body">
          {/* Capability-oriented readiness summary (fixes M06 / M21) */}
          {!health.llm.ready ? (
            <div className="mc-alert mc-alert-warn" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <strong style={{ color: 'var(--text)' }}>当前能力说明</strong>
              <div>• <strong>可先浏览工作台</strong>，但提问前需先配置回答模型（仅需 1 个 Key 即可手动打字问答）。</div>
              <div>• <strong>语音识别：</strong>{health.asr.ready ? '已就绪，可先记录转写' : `尚不可用（${health.asr.label}），不阻碍先配文本模型手动试问`}。</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 2 }}>
                <button
                  type="button"
                  className="mc-btn mc-btn-sm mc-btn-primary"
                  onClick={() => { onClose(); onNavigateCapability?.('text-llm'); }}
                >
                  先配置回答模型 →
                </button>
                {!health.asr.ready && (
                  <button
                    type="button"
                    className="mc-btn mc-btn-sm"
                    onClick={() => { onClose(); onNavigateCapability?.('asr'); }}
                  >
                    配置语音识别
                  </button>
                )}
              </div>
            </div>
          ) : health.asr.ready ? (
            <div className="mc-alert mc-alert-ok" style={{ padding: '8px 12px' }}>
              <strong>手动打字问答与实时语音转写均已就绪</strong>（当前模型：{settings?.llm?.model}）
            </div>
          ) : (
            <div className="mc-alert mc-alert-ok" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px' }}>
              <div>
                <strong>手动打字问答已可用</strong>（{settings?.llm?.model}）
                <div style={{ fontSize: 11.5, marginTop: 2, color: 'var(--text-secondary)' }}>
                  语音识别当前为「{health.asr.label}」，进入后可直接手动输入提问，随时可再补配语音。
                </div>
              </div>
              <button
                type="button"
                className="mc-btn mc-btn-sm"
                style={{ flexShrink: 0 }}
                onClick={() => { onClose(); onNavigateCapability?.('asr'); }}
              >
                去配语音
              </button>
            </div>
          )}

          {libraryEnabled && !library?.root && (
            <div className="mc-alert mc-alert-warn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px' }}>
              <span>已开启本场资料库，但尚未绑定资料文件夹。</span>
              <button
                type="button"
                className="mc-btn mc-btn-sm"
                onClick={() => { onClose(); onNavigateCapability?.('kb'); }}
              >
                选择资料文件夹
              </button>
            </div>
          )}

          <div className="mc-field">
            <label className="mc-field-label">本场会话名称</label>
            <input className="mc-input" value={sessionName} onChange={e => setSessionName(e.target.value)} maxLength={100} />
          </div>

          <div className="mc-grid-2">
            <div className="mc-field">
              <label className="mc-field-label">音频捕获源</label>
              <CustomSelect
                className="mc-select"
                ariaLabel="音频捕获源"
                value={audioSource}
                onChange={setAudioSource}
                options={[
                  { value: 'system', label: '系统音频（会议扬声器/耳机）' },
                  { value: 'mic', label: '本地麦克风（外放/线下）' }
                ]}
              />
            </div>
            <div className="mc-field">
              <label className="mc-field-label">回答语言</label>
              <CustomSelect
                className="mc-select"
                ariaLabel="回答语言"
                value={answerLang}
                onChange={setAnswerLang}
                options={[
                  { value: 'chinese', label: '中文' },
                  { value: 'english', label: 'English' }
                ]}
              />
            </div>
            <div className="mc-field">
              <label className="mc-field-label">转写提问策略</label>
              <CustomSelect
                className="mc-select"
                ariaLabel="转写提问策略"
                value={transcriptionMode}
                onChange={setTranscriptionMode}
                options={[
                  { value: 'auto', label: '自动提问' },
                  { value: 'manual', label: '手动累计后发送' },
                  { value: 'transcript-only', label: '仅转写' }
                ]}
              />
            </div>
            <div className="mc-field">
              <label className="mc-field-label">资料库岗位</label>
              <CustomSelect
                className="mc-select"
                ariaLabel="资料库岗位"
                value={role}
                disabled={!libraryEnabled}
                onChange={setRole}
                options={[
                  { value: '', label: '通用（不限定岗位）' },
                  ...(library?.roles || []).map(r => ({ value: r, label: r }))
                ]}
              />
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
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>
                    {audioSource === 'system' ? '进入后自动转写面试官（系统音频）' : '进入后自动开启麦克风转写'}
                  </div>
                  <div className="mc-field-hint">关闭则先以暂停状态进入浮窗，手动点按钮再开始</div>
                </div>
                <Switch checked={autoStartCapture} onChange={setAutoStartCapture} aria-label="进入后自动开启采集" />
              </div>
              {audioSource === 'system' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>同时转写我的回答（本人麦克风）</div>
                    <div className="mc-field-hint">本人发言标为「我」记入上下文与历史记录，不会单独触发 AI 回答；会中可在顶栏随时切换</div>
                  </div>
                  <Switch
                    checked={enableSecondaryMic || startAudioRecording}
                    disabled={startAudioRecording}
                    onChange={setEnableSecondaryMic}
                    aria-label="同时转写我的回答（麦克风）"
                  />
                </div>
              )}
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
                  <div className="mc-field-hint">独立保存对方轨与本人轨 WAV（开启双轨录音将同时启用本人麦克风）；也可会中手动启停</div>
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
              enableSecondaryMic: audioSource === 'system' && (enableSecondaryMic || startAudioRecording),
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

function formatShortcutBadge(acc) {
  if (!acc) return '未设置';
  return String(acc)
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/\+/g, ' + ');
}

function PreWrittenModal({
  settings,
  workbenchPrefs,
  windowState,
  onClose,
  onNavigateCapability,
  onConfirmStart
}) {
  const wCfg = workbenchPrefs?.writtenConfig || {};
  const enabledEndpoints = (settings?.multimodal?.endpoints || []).filter(e => e.enabled && e.baseUrl && e.model);
  const visionReady = Boolean(settings?.multimodal?.enabled && enabledEndpoints.length > 0);
  const [name, setName] = useState(`笔试 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
  const [mode, setMode] = useState(wCfg.mode === 'followup' ? 'followup' : 'fast');
  const [compactMini, setCompactMini] = useState(Boolean(wCfg.compactMini));
  const [autoSecurity, setAutoSecurity] = useState(Boolean(wCfg.autoSecurity || windowState?.securityMode?.enabled));
  const [skipNext, setSkipNext] = useState(Boolean(wCfg.skipPreCheck));

  return (
    <div className="mc-modal-backdrop" onClick={onClose}>
      <div className="mc-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="笔试前准备">
        <div className="mc-modal-header">
          <div>
            <h3 className="mc-modal-title">笔试前准备</h3>
            <div className="mc-field-hint">确认视觉模型与浮窗形态；笔试浮窗内置五大窗口防干扰控制</div>
          </div>
          <button type="button" className="mc-icon-btn" aria-label="关闭弹窗" onClick={onClose}><IconX /></button>
        </div>

        <div className="mc-modal-body">
          {visionReady ? (
            <div className="mc-alert mc-alert-ok" style={{ padding: '8px 12px' }}>
              <strong>视觉识题已就绪</strong>（已启用 {enabledEndpoints.length} 个接口 · 首选视觉：{enabledEndpoints[0]?.model || enabledEndpoints[0]?.name}）
            </div>
          ) : (
            <div className="mc-alert mc-alert-warn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <strong>尚未配置视觉模型接口</strong>
                <div style={{ fontSize: 12, marginTop: 2 }}>可以先进入笔试浮窗熟悉操作，截题前需配置至少一个多模态视觉模型。</div>
              </div>
              <button
                type="button"
                className="mc-btn mc-btn-sm mc-btn-primary"
                style={{ flexShrink: 0 }}
                onClick={() => { onClose(); onNavigateCapability?.('vision'); }}
              >
                去配置视觉模型 →
              </button>
            </div>
          )}

          <div className="mc-field">
            <label className="mc-field-label">本次笔试名称</label>
            <input className="mc-input" value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="例如：算法机考 / 后端笔试" />
          </div>

          <div className="mc-grid-2">
            <div className="mc-field">
              <label className="mc-field-label">默认作答模式</label>
              <div className="mc-segmented" style={{ width: '100%' }}>
                <button type="button" className={`mc-seg-btn${mode === 'fast' ? ' is-active' : ''}`} style={{ flex: 1 }} onClick={() => setMode('fast')}>
                  <IconZap size={11} /> 极速识题
                </button>
                <button type="button" className={`mc-seg-btn${mode === 'followup' ? ' is-active' : ''}`} style={{ flex: 1 }} onClick={() => setMode('followup')}>
                  <IconMessageSquare size={11} /> 对话追问
                </button>
              </div>
              <span className="mc-field-hint">
                {mode === 'fast' ? '截屏直出答案，支持多模型并行交叉验证' : '由首选视觉模型承接多轮追问与改代码'}
              </span>
            </div>

            <div className="mc-field">
              <label className="mc-field-label">默认窗口形态</label>
              <div className="mc-segmented" style={{ width: '100%' }}>
                <button type="button" className={`mc-seg-btn${!compactMini ? ' is-active' : ''}`} style={{ flex: 1 }} onClick={() => setCompactMini(false)}>
                  标准浮窗
                </button>
                <button type="button" className={`mc-seg-btn${compactMini ? ' is-active' : ''}`} style={{ flex: 1 }} onClick={() => setCompactMini(true)}>
                  极简选项条
                </button>
              </div>
              <span className="mc-field-hint">进入后随时可在顶栏一键互切</span>
            </div>
          </div>

          <div className="mc-card" style={{ padding: '10px 12px', background: 'var(--bg-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>本场开启安全模式（防截屏 + 不抢焦点）</div>
                <div className="mc-field-hint">退出笔试浮窗时自动恢复原状态；当前 Coding 偏好：{formatCodingSummary(workbenchPrefs?.codingPrefs)}</div>
              </div>
              <Switch
                checked={autoSecurity}
                success
                disabled={windowState?.securityMode?.enabled && windowState?.securityMode?.scope === 'persistent'}
                aria-label="笔试开启安全模式"
                onChange={setAutoSecurity}
              />
            </div>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={skipNext} onChange={e => setSkipNext(e.target.checked)} />
            <span>以后点击「开始笔试」直接启动浮窗，不再弹出此确认框</span>
          </label>
        </div>

        <div className="mc-modal-footer">
          <button type="button" className="mc-btn" onClick={onClose}>取消</button>
          <button
            type="button"
            className="mc-btn mc-btn-primary"
            onClick={() => onConfirmStart({
              fresh: true,
              name: name.trim(),
              mode,
              compactMini,
              autoSecurity,
              skipPreCheck: skipNext
            })}
          >
            <IconPlay size={12} /> 启动笔试浮窗
          </button>
        </div>
      </div>
    </div>
  );
}

export function HomeView({
  homeTab: controlledHomeTab,
  onChangeHomeTab,
  templatesStore,
  onSaveTemplates,
  settings,
  asr,
  library,
  workbenchPrefs,
  windowState,
  activeSession,
  activeWrittenSession,
  onStartSession,
  onResumeWorkbench,
  onEndActiveSession,
  onNavigateCapability,
  onOpenSettings,
  onEnterWrittenCompact,
  onEndWrittenSession,
  onQuickCaptureWritten,
  onUpdateWorkbenchPrefs,
  onSettingsUpdated,
  batch,
  batchController
}) {
  const [localHomeTab, setLocalHomeTab] = useState('interview');
  const homeTab = controlledHomeTab ?? localHomeTab;
  const setHomeTab = onChangeHomeTab ?? setLocalHomeTab;
  const [search, setSearch] = useState('');
  const [audioFilter, setAudioFilter] = useState('all');
  const [sortBy, setSortBy] = useState('custom');
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [prepTemplate, setPrepTemplate] = useState(null);
  const [prepWrittenOpen, setPrepWrittenOpen] = useState(false);
  const [writtenShortcutsOpen, setWrittenShortcutsOpen] = useState(false);
  const [writtenPromptDraft, setWrittenPromptDraft] = useState(workbenchPrefs?.writtenConfig?.systemPrompt || '');
  const [writtenPromptSavedAt, setWrittenPromptSavedAt] = useState(0);
  const [windowControlsInfo, setWindowControlsInfo] = useState(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [rowMenu, setRowMenu] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dragState, setDragState] = useState(null);
  const hoverTimerRef = useRef(null);
  const closePreviewTimerRef = useRef(null);
  const dragPressTimerRef = useRef(null);
  const dismissedPreviewTplIdRef = useRef(null);
  const promptSaveTimerRef = useRef(null);

  useEffect(() => {
    setWrittenPromptDraft(workbenchPrefs?.writtenConfig?.systemPrompt || '');
  }, [workbenchPrefs?.writtenConfig?.systemPrompt]);

  useEffect(() => {
    if (homeTab !== 'written') return;
    window.mc?.getWindowControls?.().then(setWindowControlsInfo).catch(() => {});
  }, [homeTab, writtenShortcutsOpen]);

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
      clearTimeout(promptSaveTimerRef.current);
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

  // Dismiss template hover preview immediately on Escape and suppress reopen on same row until pointer leaves (M17)
  useEffect(() => {
    if (!preview) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        clearTimeout(hoverTimerRef.current);
        clearTimeout(closePreviewTimerRef.current);
        dismissedPreviewTplIdRef.current = preview.tpl.id;
        setPreview(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const schedulePreview = (tpl, event) => {
    if (event.pointerType === 'touch') return;
    if (dismissedPreviewTplIdRef.current === tpl.id) return;
    if (event.target.closest?.('button,input,select,[role="combobox"],[data-template-preview-exclude="true"]')) return;
    clearTimeout(closePreviewTimerRef.current);
    clearTimeout(hoverTimerRef.current);
    const rect = event.currentTarget.getBoundingClientRect();
    hoverTimerRef.current = setTimeout(() => {
      const left = Math.max(12, Math.min(rect.left + 20, window.innerWidth - 316));
      const top = rect.bottom + 8 + 168 > window.innerHeight ? Math.max(12, rect.top - 168) : rect.bottom + 8;
      setPreview({ tpl, left, top });
    }, 200);
  };

  const cancelPreviewSoon = (tplId) => {
    clearTimeout(hoverTimerRef.current);
    if (tplId && dismissedPreviewTplIdRef.current === tplId) {
      dismissedPreviewTplIdRef.current = null;
    }
    closePreviewTimerRef.current = setTimeout(() => setPreview(null), 120);
  };

  const visionReady = Boolean(
    settings?.multimodal?.enabled &&
    (settings?.multimodal?.endpoints || []).some(e => e.enabled && e.baseUrl && e.model)
  );
  const health = computeServiceHealth(settings, asr, library);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
      <header className="mc-page-header">
        <h1 className="mc-page-title">首页</h1>
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

              <CustomSelect
                className="mc-filter-select"
                ariaLabel="按音频源筛选"
                value={audioFilter}
                onChange={setAudioFilter}
                style={{ minWidth: 108 }}
                options={[
                  { value: 'all', label: '全部音频源' },
                  { value: 'system', label: '系统音频' },
                  { value: 'mic', label: '麦克风' }
                ]}
              />

              <CustomSelect
                className="mc-filter-select"
                ariaLabel="排序方式"
                value={sortBy}
                onChange={setSortBy}
                style={{ minWidth: 108 }}
                options={[
                  { value: 'custom', label: '自定义顺序' },
                  { value: 'recent', label: '最近编辑' },
                  { value: 'name', label: '按名称' }
                ]}
              />

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
                            onMouseLeave={() => cancelPreviewSoon(tpl.id)}
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
                                <button type="button" className="mc-btn mc-btn-sm" aria-label={`开始 ${tpl.name}`} onClick={() => setPrepTemplate(tpl)}>
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
            {(() => {
              const wCfg = workbenchPrefs?.writtenConfig || {};
              const enabledVision = (settings?.multimodal?.endpoints || []).filter(e => e.enabled && e.baseUrl && e.model);
              const patchW = (delta) => void onUpdateWorkbenchPrefs?.({ writtenConfig: { ...wCfg, ...delta } });
              const handleStartWrittenClick = () => {
                if (wCfg.skipPreCheck) {
                  onEnterWrittenCompact({
                    fresh: true,
                    mode: wCfg.mode || 'fast',
                    compactMini: Boolean(wCfg.compactMini),
                    autoSecurity: Boolean(wCfg.autoSecurity)
                  });
                } else {
                  setPrepWrittenOpen(true);
                }
              };
              const handlePromptChange = (val) => {
                setWrittenPromptDraft(val);
                clearTimeout(promptSaveTimerRef.current);
                promptSaveTimerRef.current = setTimeout(() => {
                  patchW({ systemPrompt: val });
                  setWrittenPromptSavedAt(Date.now());
                }, 420);
              };

              return (
                <>
                  {/* Main launch & readiness card */}
                  <div className="mc-card">
                    <div className="mc-card-head">
                      <div>
                        <h3 className="mc-card-title">笔试助手（本机静默截题 + 多模态追问）</h3>
                        <p className="mc-card-desc">
                          参考随思轻量浮窗交互，完整接入五大窗口防干扰控制，同时保留多视觉模型并行对比与鼠标侧键截题。
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span className={`mc-badge ${visionReady ? 'mc-badge-ok' : 'mc-badge-warn'}`}>
                          {visionReady ? `已就绪 · ${enabledVision.length} 个视觉模型` : '视觉模型待配置'}
                        </span>
                        <button type="button" className="mc-btn mc-btn-primary" onClick={handleStartWrittenClick}>
                          <IconPlay size={12} /> {activeWrittenSession?.questions?.length ? '启动全新笔试小窗' : '开始笔试'}
                        </button>
                      </div>
                    </div>
                    <div className="mc-card-body">
                      {!visionReady && (
                        <div className="mc-alert mc-alert-warn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <span>尚未启用或配置完整的视觉模型接口，请先配置至少一个 OpenAI 兼容多模态模型后再截题。</span>
                          <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" style={{ flexShrink: 0 }} onClick={() => (onNavigateCapability ? onNavigateCapability('vision') : onOpenSettings('models'))}>
                            配置视觉接口 →
                          </button>
                        </div>
                      )}
                      {activeWrittenSession && (activeWrittenSession.questions?.length || 0) > 0 && (
                        <div className="mc-alert mc-alert-ok" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div>
                            <strong>当前笔试：{activeWrittenSession.name}</strong>
                            <span style={{ marginLeft: 8, fontSize: 12 }}>{summarizeWrittenCounts(activeWrittenSession).summaryText}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className="mc-btn mc-btn-sm mc-btn-success" onClick={() => onEnterWrittenCompact({ fresh: false })}>
                              继续本次笔试浮窗 →
                            </button>
                            <button type="button" className="mc-btn mc-btn-sm" onClick={onEndWrittenSession}>
                              结束本次笔试
                            </button>
                          </div>
                        </div>
                      )}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <button type="button" className="mc-btn" disabled={!visionReady} onClick={() => onQuickCaptureWritten('region')}>
                          <IconScan size={14} /> 框选截图识题
                        </button>
                        <button type="button" className="mc-btn" disabled={!visionReady} onClick={() => onQuickCaptureWritten('full')}>
                          <IconCamera size={14} /> 静默全屏截题
                        </button>
                        <button type="button" className="mc-btn" onClick={() => (onNavigateCapability ? onNavigateCapability('vision') : onOpenSettings('models'))}>
                          <IconSettings size={14} /> 配置视觉接口
                        </button>
                        {wCfg.skipPreCheck && (
                          <button
                            type="button"
                            className="mc-btn mc-btn-ghost mc-btn-sm"
                            style={{ marginLeft: 'auto' }}
                            onClick={() => patchW({ skipPreCheck: false })}
                          >
                            恢复显示「笔试前准备」弹窗
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Two-column quick configuration grid (Model Strategy + Hotkeys) */}
                  <div className="mc-written-home-grid">
                    <div className="mc-card">
                      <div className="mc-card-head">
                        <div>
                          <h3 className="mc-card-title">视觉模型与作答策略</h3>
                          <p className="mc-card-desc">极速识题支持多模型并行；对话追问默认由首选视觉模型承接。</p>
                        </div>
                      </div>
                      <div className="mc-card-body" style={{ gap: 10 }}>
                        <div className="mc-field">
                          <label className="mc-field-label">极速识题并行策略</label>
                          <div className="mc-segmented" style={{ width: '100%' }}>
                            {[
                              ['inherit', '跟随全局'],
                              ['parallel', '多模型并行'],
                              ['single', '首选单模型']
                            ].map(([id, label]) => (
                              <button
                                key={id}
                                type="button"
                                className={`mc-seg-btn${(wCfg.simultaneousMode || 'inherit') === id ? ' is-active' : ''}`}
                                style={{ flex: 1 }}
                                onClick={() => patchW({ simultaneousMode: id })}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="mc-field">
                          <label className="mc-field-label">追问 / 单模型首选视觉接口</label>
                          {enabledVision.length > 0 ? (
                            <CustomSelect
                              className="mc-select"
                              ariaLabel="笔试首选视觉模型"
                              value={wCfg.preferredEndpointId || ''}
                              onChange={(val) => patchW({ preferredEndpointId: val })}
                              options={[
                                { value: '', label: `默认首选（${enabledVision[0]?.name || enabledVision[0]?.model}）` },
                                ...enabledVision.map(ep => ({ value: ep.id, label: `${ep.name || ep.model} · ${ep.model}` }))
                              ]}
                            />
                          ) : (
                            <div className="mc-field-hint">暂未启用任何视觉接口，请先前往视觉设置添加。</div>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
                          <span>当前 Coding 偏好：{formatCodingSummary(workbenchPrefs?.codingPrefs)}</span>
                          <span className="mc-field-hint">可在浮窗底栏随时切换</span>
                        </div>
                      </div>
                    </div>

                    <div className="mc-card">
                      <div className="mc-card-head">
                        <div>
                          <h3 className="mc-card-title">截屏与多图快捷键</h3>
                          <p className="mc-card-desc">全屏与框选均支持键盘组合键、F 键或 Mouse4 / Mouse5 鼠标侧键。</p>
                        </div>
                        <button type="button" className="mc-btn mc-btn-sm" onClick={() => setWrittenShortcutsOpen(true)}>
                          <IconKeyboard size={13} /> 编辑快捷键
                        </button>
                      </div>
                      <div className="mc-card-body" style={{ gap: 2 }}>
                        <div className="mc-written-hotkey-row">
                          <span>静默全屏截题</span>
                          <span className="mc-kbd">{formatShortcutBadge(settings?.ui?.hotkeyShot)}</span>
                        </div>
                        <div className="mc-written-hotkey-row">
                          <span>框选区域截题</span>
                          <span className="mc-kbd">{formatShortcutBadge(settings?.capture?.hotkeyRegion)}</span>
                        </div>
                        <div className="mc-written-hotkey-row">
                          <span>开关多图暂存</span>
                          <span className="mc-kbd">{formatShortcutBadge(windowControlsInfo?.bindings?.toggleBatch || 'Control+Alt+M')}</span>
                        </div>
                        <div className="mc-written-hotkey-row">
                          <span>发送全部暂存多图</span>
                          <span className="mc-kbd">{formatShortcutBadge(windowControlsInfo?.bindings?.sendBatch || 'Control+Alt+S')}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Custom Written Exam System Prompt */}
                  <div className="mc-card">
                    <div className="mc-card-head">
                      <div>
                        <h3 className="mc-card-title">笔试模型提示词（自定义附加要求）</h3>
                        <p className="mc-card-desc">会自动附加到本机笔试极速识题与对话追问请求中，实时保存。</p>
                      </div>
                      {writtenPromptSavedAt > 0 && (
                        <span className="mc-field-hint" role="status">已自动保存</span>
                      )}
                    </div>
                    <div className="mc-card-body">
                      <textarea
                        className="mc-textarea"
                        rows={3}
                        value={writtenPromptDraft}
                        onChange={e => handlePromptChange(e.target.value)}
                        placeholder="例如：选择题请先直接给出正确选项字母，再附一句核心依据；编程题默认使用 C++ ACM 模式，避免多余寒暄。"
                      />
                    </div>
                  </div>

                  {/* Multi-image batch queue management */}
                  <div className="mc-card">
                    <div className="mc-card-head">
                      <div>
                        <h3 className="mc-card-title">多图暂存队列</h3>
                        <p className="mc-card-desc">长题目跨多屏时，可开启多图连续截取（最多 12 张），浮窗内支持内联缩略图预览与一键发题。</p>
                      </div>
                    </div>
                    <div className="mc-card-body">
                      <ScreenshotBatchPanel batch={batch} controller={batchController} management />
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {preview && (
        <div
          className="mc-preview-card"
          style={{ left: preview.left, top: preview.top }}
          onMouseEnter={() => clearTimeout(closePreviewTimerRef.current)}
          onMouseLeave={() => cancelPreviewSoon(preview.tpl.id)}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <strong style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {preview.tpl.name}
            </strong>
            <span className="mc-kbd" title="按 Esc 收起预览卡">Esc</span>
          </div>
          <div className="mc-preview-kv">
            <span>采集方式</span>
            <strong>{preview.tpl.audioSource === 'mic' ? '本地麦克风' : '系统音频'}</strong>
            <span>回答语言</span>
            <strong>{preview.tpl.answerLang === 'english' ? 'English' : '中文'}</strong>
            <span>转写策略</span>
            <strong>
              {preview.tpl.transcriptionMode === 'manual' ? '手动累计发送' : preview.tpl.transcriptionMode === 'transcript-only' ? '仅实时转写' : '自动识别提问'}
            </strong>
            <span>文本模型</span>
            <strong>{settings?.llm?.model || '未配置'}</strong>
            <span>本地资料库</span>
            <strong>
              {preview.tpl.libraryEnabled === false
                ? '本模板关闭'
                : preview.tpl.role || (library?.enabled ? (library?.role || '通用资料库') : '未启用')}
            </strong>
            {(preview.tpl.resumeName || preview.tpl.jdName) && (
              <>
                <span>模板附件</span>
                <strong>{[preview.tpl.resumeName, preview.tpl.jdName].filter(Boolean).join(' · ')}</strong>
              </>
            )}
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
          onNavigateCapability={onNavigateCapability || ((cap) => onOpenSettings(cap === 'asr' ? 'audio' : 'models'))}
          onConfirmStart={(payload) => {
            setPrepTemplate(null);
            onStartSession(payload);
          }}
        />
      )}

      {prepWrittenOpen && (
        <PreWrittenModal
          settings={settings}
          workbenchPrefs={workbenchPrefs}
          windowState={windowState}
          onClose={() => setPrepWrittenOpen(false)}
          onNavigateCapability={onNavigateCapability || (() => onOpenSettings('models'))}
          onConfirmStart={(payload) => {
            setPrepWrittenOpen(false);
            const wCfg = workbenchPrefs?.writtenConfig || {};
            void onUpdateWorkbenchPrefs?.({
              writtenConfig: {
                ...wCfg,
                mode: payload.mode,
                compactMini: payload.compactMini,
                autoSecurity: payload.autoSecurity,
                skipPreCheck: payload.skipPreCheck
              }
            });
            onEnterWrittenCompact(payload);
          }}
        />
      )}

      {writtenShortcutsOpen && (
        <WorkbenchShortcutsModal
          settings={settings}
          windowState={windowState}
          onSettingsUpdated={onSettingsUpdated}
          onOpenFullSettings={() => {
            setWrittenShortcutsOpen(false);
            if (onNavigateCapability) onNavigateCapability('shortcuts');
            else onOpenSettings('shortcuts');
          }}
          onClose={() => setWrittenShortcutsOpen(false)}
        />
      )}
    </div>
  );
}
