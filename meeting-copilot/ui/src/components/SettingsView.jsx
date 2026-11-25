import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  LOCAL_REALTIME_MODELS,
  PROVIDER_HELP,
  candidateKeyTest,
  findPresetByEndpoint,
  findPresetById,
  isTestableTarget,
  listMics,
  presetsForCapability,
  providerIdForEndpoint,
  sanitizeApiKeyInput,
  storedKeyTest
} from '@mc/runtime';
import { buildSettingsDiffPatch } from '../core/settingsPatch.js';
import { EyeContactSettings } from './EyeContactSettings.jsx';
import { IconFolder, IconShield } from './Icons.jsx';
import {
  ScreenshotBatchPanel,
  ShortcutRecorder,
  Switch,
  renderProviderConnectionResult,
  settingsAutoFlushers,
  useAutoSaveValue,
  useKeySlot
} from './SharedWidgets.jsx';

const TABS = [
  { id: 'models', title: '模型接口', desc: '配置文本大模型与截图多模态接口，各自独立保存。' },
  { id: 'audio', title: '语音与音频', desc: '选择语音识别后端、连接测试与本地音频输入设备。' },
  { id: 'interview', title: '面试资料', desc: '管理本地面试资料库目录、岗位与备用面试 Prompt。' },
  { id: 'shortcuts', title: '快捷键与窗口', desc: '全局热键、窗口移动缩放、多图暂存与笔试小窗设置。' },
  { id: 'general', title: '通用与安全', desc: '主题、字号、安全模式、防截屏环境检测与诊断入口。' },
  { id: 'camera', title: '摄像头与眼神矫正', desc: '输入摄像头、NVIDIA Maxine 眼神矫正预览与诊断。' }
];

const TEST_RESULT_COPY = {
  locale: 'zh-CN',
  testing: '正在测试连接…',
  success: '连接成功',
  failed: '连接失败',
  hintLabel: '建议',
  retryableNote: '可重试',
  detailShow: '展开详情',
  detailHide: '收起详情',
  detailCode: '状态码',
  detailRequestId: '请求 ID',
  detailTime: '时间'
};

function publicSlot(settings, slot) {
  switch (slot) {
    case 'llm': return settings.llm;
    case 'vision': return settings.vision;
    case 'asr-cloud': return settings.asr.cloud;
    case 'asr-realtime':
    default: return settings.asr.realtime;
  }
}

function WindowControlsCard() {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    window.mc.getWindowControls().then(v => { if (active) setDraft(v); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  const auto = useAutoSaveValue(
    draft && { opacity: draft.opacity, moveStep: draft.moveStep, bindings: draft.bindings },
    (value) => window.mc.setWindowControls(value)
  );

  const labels = {
    left: '窗口左移', right: '窗口右移', up: '窗口上移', down: '窗口下移',
    grow: '放大窗口', shrink: '缩小窗口', toggleBatch: '多图开关', sendBatch: '发送多图'
  };

  return (
    <section className="mc-card">
      <div className="mc-card-head">
        <div>
          <h3 className="mc-card-title">窗口移动、缩放与多图快捷键</h3>
          <p className="mc-card-desc">清空对应快捷键即可禁用；冲突时自动回滚并提示。</p>
        </div>
        <span className="mc-field-hint" role="status">
          {auto.error || (auto.status === 'saved' ? '已自动保存' : auto.status === 'saving' ? '保存中…' : '待保存…')}
        </span>
      </div>
      {draft ? (
        <>
          <div className="mc-srow">
            <div>
              <div className="mc-srow-label">全局窗口总不透明度 ({Math.round(draft.opacity * 100)}%)</div>
              <div className="mc-srow-desc">在工作台中也可通过齿轮菜单分层调节背景/文字/悬停透明度</div>
            </div>
            <div className="mc-srow-control">
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round(draft.opacity * 100)}
                onChange={e => setDraft({ ...draft, opacity: Number(e.target.value) / 100 })}
              />
            </div>
          </div>
          <div className="mc-srow mc-srow-compact">
            <div><div className="mc-srow-label">键盘单次移动步长（px）</div></div>
            <div className="mc-srow-control">
              <input
                className="mc-input"
                type="number"
                min={1}
                max={200}
                value={draft.moveStep}
                onChange={e => setDraft({ ...draft, moveStep: Number(e.target.value) })}
              />
            </div>
          </div>
          {Object.entries(labels).map(([key, label]) => (
            <div key={key} className="mc-srow mc-srow-compact">
              <div><div className="mc-srow-label">{label}</div></div>
              <div className="mc-srow-control">
                <input
                  className="mc-input"
                  value={draft.bindings?.[key] || ''}
                  spellCheck={false}
                  placeholder="如 Control+Alt+Left"
                  onChange={e => setDraft({ ...draft, bindings: { ...draft.bindings, [key]: e.target.value } })}
                />
              </div>
            </div>
          ))}
          {draft.errors?.length > 0 && (
            <div className="mc-card-body"><div className="mc-alert mc-alert-err">{draft.errors.join('；')}</div></div>
          )}
        </>
      ) : (
        <div className="mc-card-body"><span className="mc-field-hint">{error || '正在读取窗口控制设置…'}</span></div>
      )}
    </section>
  );
}

function QuickLibraryCard({ onOpenKnowledgePage }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    window.mc.getInterviewLibrary().then(setState).catch(e => setError(e.message));
  }, []);

  const auto = useAutoSaveValue(
    state && { enabled: !!state.enabled, root: state.root || '', role: state.role || '' },
    (value) => window.mc.setInterviewLibrary(value),
    (res) => {
      setState(res);
      window.dispatchEvent(new Event('mc-library-updated'));
    }
  );

  const pickRoot = async () => {
    try {
      const folder = await window.mc.pickInterviewLibraryRoot();
      if (folder) setState(prev => ({ ...(prev || {}), root: folder, role: '' }));
    } catch (e) { setError(e.message); }
  };

  return (
    <section className="mc-card">
      <div className="mc-card-head">
        <div>
          <h3 className="mc-card-title">本地面试资料库（文件夹 V2）</h3>
          <p className="mc-card-desc">启用后优先基于目录内的项目事实、简历与技术参考作答，并展示原文引用证据。</p>
        </div>
        <button type="button" className="mc-btn mc-btn-sm" onClick={onOpenKnowledgePage}>
          打开完整知识库页 →
        </button>
      </div>
      {state ? (
        <>
          <div className="mc-srow mc-srow-compact">
            <div><div className="mc-srow-label">启用面试资料库</div></div>
            <div className="mc-srow-control is-inline">
              <Switch checked={!!state.enabled} onChange={v => setState({ ...state, enabled: v })} />
            </div>
          </div>
          <div className="mc-srow">
            <div>
              <div className="mc-srow-label">资料库目录</div>
              <div className="mc-srow-desc">当前可检索 {state.files?.length || 0} 份有效资料</div>
            </div>
            <div className="mc-srow-control">
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="mc-input" value={state.root || ''} onChange={e => setState({ ...state, root: e.target.value, role: '' })} placeholder="选择本地文件夹" />
                <button type="button" className="mc-btn" onClick={() => void pickRoot()}><IconFolder size={14} /></button>
              </div>
            </div>
          </div>
          <div className="mc-srow mc-srow-compact">
            <div><div className="mc-srow-label">默认岗位目录</div></div>
            <div className="mc-srow-control">
              <select className="mc-select" value={state.role || ''} onChange={e => setState({ ...state, role: e.target.value })}>
                <option value="">通用（不指定岗位）</option>
                {(state.roles || []).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div className="mc-card-body" style={{ paddingTop: 0 }}>
            <span className="mc-field-hint" role="status">{auto.error || (auto.status === 'saved' ? '已自动保存' : '自动保存中…')}</span>
            {state.warning && <div className="mc-alert mc-alert-warn">{state.warning}</div>}
          </div>
        </>
      ) : (
        <div className="mc-card-body"><span className="mc-field-hint">{error || '正在读取资料库状态…'}</span></div>
      )}
    </section>
  );
}

export function SettingsView({
  initialTab = 'models',
  settings,
  workbenchPrefs,
  windowState,
  onSaved,
  onUpdateWorkbenchPrefs,
  onToggleSecurity,
  onSetSecurityPrefs,
  onNavigate,
  onOpenHealth,
  onOpenDiagnostics,
  onOpenHelp,
  onEnterWrittenCompact,
  closeRef,
  batch,
  batchController
}) {
  const [activeTab, setActiveTab] = useState(TABS.some(t => t.id === initialTab) ? initialTab : 'models');
  const rootRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (initialTab && TABS.some(t => t.id === initialTab)) setActiveTab(initialTab);
  }, [initialTab]);

  // Form states mirrored from settings
  const [live, setLive] = useState(settings);
  const [baseUrl, setBaseUrl] = useState(settings.llm.baseUrl || '');
  const [model, setModel] = useState(settings.llm.model || '');
  const [answerLang, setAnswerLang] = useState(settings.llm.answerLang || 'chinese');
  const [visionBaseUrl, setVisionBaseUrl] = useState(settings.vision?.baseUrl || '');
  const [visionModel, setVisionModel] = useState(settings.vision?.model || '');
  const [visionProxy, setVisionProxy] = useState(settings.vision?.proxyUrl || '');
  const [mmConfig, setMmConfig] = useState(settings.multimodal);

  const [asrBackend, setAsrBackend] = useState(settings.asr.backend || 'cloud-realtime');
  const [language, setLanguage] = useState(settings.asr.language || 'auto');
  const [cloudBaseUrl, setCloudBaseUrl] = useState(settings.asr.cloud?.baseUrl || '');
  const [cloudModel, setCloudModel] = useState(settings.asr.cloud?.model || '');
  const [rtBaseUrl, setRtBaseUrl] = useState(settings.asr.realtime?.baseUrl || '');
  const [rtModel, setRtModel] = useState(settings.asr.realtime?.model || '');
  const [rtLocalModel, setRtLocalModel] = useState(settings.asr.localRealtime?.model || 'fun-asr-nano');
  const [themDeviceId, setThemDeviceId] = useState(settings.audio?.themDeviceId || '');
  const [micDeviceId, setMicDeviceId] = useState(settings.audio?.micDeviceId || '');
  const [devices, setDevices] = useState([]);

  const [hotkey, setHotkey] = useState(settings.ui.hotkeyToggle || 'Control+B');
  const [hotkeyShot, setHotkeyShot] = useState(settings.ui.hotkeyShot || 'Control+Shift+S');
  const [hotkeyRegion, setHotkeyRegion] = useState(settings.capture?.hotkeyRegion ?? 'Control+Shift+A');

  const [theme, setTheme] = useState(settings.ui.theme || 'light');
  const [fontScale, setFontScale] = useState(settings.ui.fontScale || 'medium');
  const [uiLang, setUiLang] = useState(settings.ui.lang || 'zh');
  const [autoLaunch, setAutoLaunch] = useState(!!settings.ui.autoLaunch);
  const [interviewPrompt, setInterviewPrompt] = useState(settings.modelPrompts?.interview || '');

  const llmKey = useKeySlot();
  const visionKey = useKeySlot();
  const cloudKey = useKeySlot();
  const rtKey = useKeySlot();

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [tests, setTests] = useState({});
  const [envCheck, setEnvCheck] = useState(null);
  const [envChecking, setEnvChecking] = useState(false);
  const [promptFolderErr, setPromptFolderErr] = useState('');

  useEffect(() => {
    void listMics().then(setDevices).catch(() => setDevices([]));
  }, []);

  const snapshotFromSettings = useCallback((s) => ({
    baseUrl: s.llm.baseUrl || '',
    model: s.llm.model || '',
    answerLang: s.llm.answerLang || 'chinese',
    llmProviderId: s.llm.providerId || '',
    visionBaseUrl: s.vision?.baseUrl || '',
    visionModel: s.vision?.model || '',
    visionProxy: s.vision?.proxyUrl || '',
    multimodal: s.multimodal,
    asrBackend: s.asr.backend || 'cloud-realtime',
    language: s.asr.language || 'auto',
    cloudBaseUrl: s.asr.cloud?.baseUrl || '',
    cloudModel: s.asr.cloud?.model || '',
    rtBaseUrl: s.asr.realtime?.baseUrl || '',
    rtModel: s.asr.realtime?.model || '',
    rtLocalModel: s.asr.localRealtime?.model || 'fun-asr-nano',
    asrProviderId: s.asr.providerId || '',
    themDeviceId: s.audio?.themDeviceId || '',
    micDeviceId: s.audio?.micDeviceId || '',
    hotkey: s.ui.hotkeyToggle || 'Control+B',
    hotkeyShot: s.ui.hotkeyShot || 'Control+Shift+S',
    hotkeyRegion: s.capture?.hotkeyRegion ?? 'Control+Shift+A',
    theme: s.ui.theme || 'light',
    fontScale: s.ui.fontScale || 'medium',
    uiLang: s.ui.lang || 'zh',
    autoLaunch: !!s.ui.autoLaunch,
    interviewPrompt: s.modelPrompts?.interview || ''
  }), []);

  const baselineRef = useRef(snapshotFromSettings(settings));

  const currentDraft = useMemo(() => ({
    baseUrl, model, answerLang,
    llmProviderId: providerIdForEndpoint(baseUrl.trim(), model.trim(), 'text-llm'),
    visionBaseUrl, visionModel, visionProxy,
    multimodal: mmConfig,
    asrBackend, language, cloudBaseUrl, cloudModel, rtBaseUrl, rtModel, rtLocalModel,
    asrProviderId: asrBackend === 'cloud-realtime'
      ? providerIdForEndpoint(rtBaseUrl.trim(), rtModel.trim(), 'asr-realtime')
      : asrBackend === 'cloud'
        ? providerIdForEndpoint(cloudBaseUrl.trim(), cloudModel.trim(), 'asr-segment')
        : '',
    themDeviceId, micDeviceId,
    hotkey, hotkeyShot, hotkeyRegion,
    theme, fontScale, uiLang, autoLaunch, interviewPrompt
  }), [
    baseUrl, model, answerLang, visionBaseUrl, visionModel, visionProxy, mmConfig,
    asrBackend, language, cloudBaseUrl, cloudModel, rtBaseUrl, rtModel, rtLocalModel,
    themDeviceId, micDeviceId, hotkey, hotkeyShot, hotkeyRegion,
    theme, fontScale, uiLang, autoLaunch, interviewPrompt
  ]);

  const diffPatch = useMemo(() => buildSettingsDiffPatch(baselineRef.current, currentDraft, {
    keys: {
      llm: llmKey.patchValue(),
      vision: visionKey.patchValue(),
      cloud: cloudKey.patchValue(),
      realtime: rtKey.patchValue()
    }
  }), [currentDraft, llmKey, visionKey, cloudKey, rtKey]);

  const dirty = Object.keys(diffPatch).length > 0;
  const draftSignature = JSON.stringify(diffPatch);
  const attemptedSigRef = useRef('');
  const saveRunningRef = useRef(false);
  const latestDiffRef = useRef(diffPatch);
  latestDiffRef.current = diffPatch;

  const commitSave = useCallback(async () => {
    const patch = latestDiffRef.current;
    if (!Object.keys(patch).length) return true;
    if (saveRunningRef.current) return false;
    saveRunningRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const next = await window.mc.setSettings(patch);
      setLive(next);
      baselineRef.current = snapshotFromSettings(next);
      if (patch.llm?.apiKey !== undefined) llmKey.reset();
      if (patch.vision?.apiKey !== undefined) visionKey.reset();
      if (patch.asr?.cloud?.apiKey !== undefined) cloudKey.reset();
      if (patch.asr?.realtime?.apiKey !== undefined) rtKey.reset();
      if (patch.multimodal) setMmConfig(next.multimodal);
      setSavedMsg('已自动保存');
      onSaved?.(next);
      return true;
    } catch (err) {
      setSaveError(err.message);
      return false;
    } finally {
      saveRunningRef.current = false;
      setSaving(false);
    }
  }, [llmKey, visionKey, cloudKey, rtKey, onSaved, snapshotFromSettings]);

  // 600ms debounced auto-save
  useEffect(() => {
    if (!dirty || saving || attemptedSigRef.current === draftSignature) return;
    const timer = setTimeout(() => {
      attemptedSigRef.current = draftSignature;
      void commitSave();
    }, 600);
    return () => clearTimeout(timer);
  }, [dirty, saving, draftSignature, commitSave]);

  const flushAndLeave = useCallback(async (nextAction) => {
    const subResults = await Promise.all([...settingsAutoFlushers].map(fn => fn()));
    if (subResults.some(ok => !ok)) {
      setSaveError('部分独立设置项存在校验错误，请修正后再离开');
      return false;
    }
    if (Object.keys(latestDiffRef.current).length > 0) {
      const ok = await commitSave();
      if (!ok) return false;
    }
    nextAction?.();
    return true;
  }, [commitSave]);

  useLayoutEffect(() => {
    if (!closeRef) return;
    closeRef.current = flushAndLeave;
    return () => { closeRef.current = null; };
  }, [closeRef, flushAndLeave]);

  const runSlotTest = async (slotId, target, candidate) => {
    setTests(prev => ({ ...prev, [slotId]: { testing: true, candidate: candidate !== '' } }));
    try {
      const result = await window.mc.providerTest(candidate ? candidateKeyTest(target, candidate) : storedKeyTest(target));
      setTests(prev => ({ ...prev, [slotId]: { testing: false, result, at: Date.now(), candidate: candidate !== '' } }));
      const refreshed = await window.mc.getSettings();
      setLive(refreshed);
      onSaved?.(refreshed);
    } catch (err) {
      setTests(prev => ({ ...prev, [slotId]: { testing: false, error: err.message } }));
    }
  };

  const renderProviderSelect = (capability, curUrl, curModel, onPick) => {
    const presets = presetsForCapability(capability).filter(p => p.baseUrl && p.model);
    const current = findPresetByEndpoint(curUrl, curModel, capability);
    return (
      <select
        className="mc-select"
        value={current?.id ?? ''}
        onChange={e => {
          const p = findPresetById(e.target.value);
          if (p) onPick(p);
        }}
      >
        {!current && <option value="">自定义服务商</option>}
        {presets.map(p => <option key={p.id} value={p.id}>{p.nameZh || p.nameEn}</option>)}
      </select>
    );
  };

  const renderKeySlotRow = (label, slot, slotId, target) => {
    const pub = publicSlot(live, slotId);
    const apiKeySet = !!pub?.apiKeySet;
    const hint = pub?.apiKeyHint;
    const st = tests[slotId];
    const candidate = sanitizeApiKeyInput(slot.value).value;
    const canTest = isTestableTarget(target) && !slot.pendingDelete && (candidate !== '' || apiKeySet);
    const keyUrl = findPresetByEndpoint(target.baseUrl, target.model, target.capability)?.help?.keyUrl ?? PROVIDER_HELP[target.providerId]?.keyUrl;

    return (
      <div className="mc-srow">
        <div>
          <div className="mc-srow-label">{label}</div>
          <div className="mc-srow-desc">
            {apiKeySet && !slot.editing && !slot.pendingDelete
              ? `已安全加密保存${hint ? `（尾号 ••••${hint}）` : ''}；不编辑时不会覆盖`
              : '仅保存在本机，自动清理首尾空格'}
          </div>
        </div>
        <div className="mc-srow-control">
          {apiKeySet && !slot.editing && !slot.pendingDelete ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span className="mc-badge mc-badge-ok">已配置</span>
              <button type="button" className="mc-btn mc-btn-sm" onClick={() => slot.setEditing(true)}>更换</button>
              {slot.confirming ? (
                <>
                  <button type="button" className="mc-btn mc-btn-sm mc-btn-danger" onClick={() => { slot.setPendingDelete(true); slot.setConfirming(false); }}>确认清除</button>
                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => slot.setConfirming(false)}>取消</button>
                </>
              ) : (
                <button type="button" className="mc-btn mc-btn-sm" onClick={() => slot.setConfirming(true)}>清除</button>
              )}
            </div>
          ) : slot.pendingDelete ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="mc-badge mc-badge-err">待清除</span>
              <button type="button" className="mc-btn mc-btn-sm" onClick={slot.reset}>撤销</button>
            </div>
          ) : (
            <input
              className="mc-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={slot.value}
              onChange={e => slot.setValue(e.target.value)}
              placeholder={apiKeySet ? '输入新密钥以替换，留空保留原密钥' : 'sk-...'}
            />
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="mc-btn mc-btn-sm"
              disabled={!canTest || Object.values(tests).some(x => x?.testing)}
              onClick={() => void runSlotTest(slotId, target, candidate)}
            >
              {st?.testing ? '测试中…' : '测试连接'}
            </button>
            {pub?.verification?.lastTestAt && (
              <span className="mc-field-hint">
                上次：{pub.verification.lastTestOk ? `成功 (${pub.verification.latencyMs ?? '?'}ms)` : '失败'}
              </span>
            )}
          </div>
          {renderProviderConnectionResult(TEST_RESULT_COPY, st, keyUrl)}
        </div>
      </div>
    );
  };

  const updateMm = (patch) => setMmConfig(prev => ({ ...prev, ...patch }));
  const updateEndpoint = (idx, patch) => updateMm({
    endpoints: mmConfig.endpoints.map((ep, i) => i === idx ? { ...ep, ...patch } : ep)
  });

  const runEnvCheck = async () => {
    setEnvChecking(true);
    try {
      const res = await window.mc.checkSecurityEnvironment();
      setEnvCheck(res);
    } catch (e) {
      setEnvCheck({ ok: false, warnings: [e.message] });
    } finally {
      setEnvChecking(false);
    }
  };

  const activeTabMeta = TABS.find(t => t.id === activeTab) || TABS[0];

  return (
    <div className="mc-settings-root" ref={rootRef}>
      <header className="mc-settings-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 className="mc-page-title" style={{ fontSize: 18 }}>高级设置</h1>
          <span className="mc-field-hint" role="status">
            {saveError ? '' : saving ? '正在自动保存…' : dirty ? '等待自动保存…' : (savedMsg || '修改后自动保存')}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {dirty && (
            <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" disabled={saving} onClick={() => void commitSave()}>
              立即保存
            </button>
          )}
        </div>
      </header>

      <div className="mc-settings-body">
        <nav className="mc-settings-nav" role="tablist" aria-orientation="vertical" aria-label="设置分类">
          {TABS.map((tab, idx) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`settings-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className="mc-settings-tab"
              onClick={() => { setActiveTab(tab.id); scrollRef.current?.scrollTo(0, 0); }}
              onKeyDown={(e) => {
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                  e.preventDefault();
                  const nextIdx = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (idx + (e.key === 'ArrowDown' ? 1 : -1) + TABS.length) % TABS.length;
                  setActiveTab(TABS[nextIdx].id);
                  rootRef.current?.querySelector(`#settings-tab-${TABS[nextIdx].id}`)?.focus();
                }
              }}
            >
              {tab.title}
            </button>
          ))}
        </nav>

        <div className="mc-settings-scroll" ref={scrollRef}>
          <div className="mc-settings-container">
            <div>
              <h2 className="mc-settings-cat-title">{activeTabMeta.title}</h2>
              <p className="mc-settings-cat-desc">{activeTabMeta.desc}</p>
            </div>

            {(saveError || live.capture?.registrationError) && (
              <div className="mc-alert mc-alert-err" role="alert">{saveError || live.capture.registrationError}</div>
            )}

            {/* 1. MODELS TAB */}
            <div hidden={activeTab !== 'models'} style={{ display: activeTab === 'models' ? 'flex' : 'none', flexDirection: 'column', gap: 20 }}>
              <section className="mc-card">
                <div className="mc-card-head">
                  <div>
                    <h3 className="mc-card-title">文本大模型</h3>
                    <p className="mc-card-desc">用于实时面试问答、手动提问、翻译与滚动备忘维护。</p>
                  </div>
                </div>
                <div className="mc-srow">
                  <div><div className="mc-srow-label">服务商预设</div></div>
                  <div className="mc-srow-control">
                    {renderProviderSelect('text-llm', baseUrl, model, (p) => { setBaseUrl(p.baseUrl); setModel(p.model); })}
                  </div>
                </div>
                <div className="mc-srow">
                  <div><div className="mc-srow-label">Base URL</div></div>
                  <div className="mc-srow-control">
                    <input className="mc-input" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} spellCheck={false} placeholder="https://api.deepseek.com/v1" />
                  </div>
                </div>
                <div className="mc-srow">
                  <div><div className="mc-srow-label">模型名称</div></div>
                  <div className="mc-srow-control">
                    <input className="mc-input" value={model} onChange={e => setModel(e.target.value)} spellCheck={false} placeholder="deepseek-chat" />
                  </div>
                </div>
                {renderKeySlotRow('文本模型 API Key', llmKey, 'llm', {
                  capability: 'text-llm',
                  providerId: providerIdForEndpoint(baseUrl.trim(), model.trim(), 'text-llm'),
                  baseUrl, model, slot: 'llm'
                })}
                <div className="mc-srow mc-srow-compact">
                  <div><div className="mc-srow-label">默认回答语言</div></div>
                  <div className="mc-srow-control">
                    <select className="mc-select" value={answerLang} onChange={e => setAnswerLang(e.target.value)}>
                      <option value="chinese">中文</option>
                      <option value="english">English</option>
                    </select>
                  </div>
                </div>
              </section>

              {mmConfig && (
                <section className="mc-card">
                  <div className="mc-card-head">
                    <div>
                      <h3 className="mc-card-title">截图多模态模型（支持多接口回退 / 笔试并行回答）</h3>
                      <p className="mc-card-desc">支持 OpenAI 兼容图片接口；面试模式按顺序回退，笔试模式可开启多模型同时作答。</p>
                    </div>
                    <button
                      type="button"
                      className="mc-btn mc-btn-sm"
                      onClick={() => updateMm({
                        endpoints: [...mmConfig.endpoints, {
                          id: crypto.randomUUID(), name: '', enabled: true, baseUrl: '', model: '', proxyUrl: '', timeoutMs: 30000, apiKeySet: false
                        }]
                      })}
                    >
                      ＋ 添加接口
                    </button>
                  </div>
                  <div className="mc-srow mc-srow-compact">
                    <div><div className="mc-srow-label">启用截图问答</div></div>
                    <div className="mc-srow-control is-inline"><Switch checked={!!mmConfig.enabled} onChange={v => updateMm({ enabled: v })} /></div>
                  </div>
                  <div className="mc-srow mc-srow-compact">
                    <div><div className="mc-srow-label">默认截图场景</div></div>
                    <div className="mc-srow-control">
                      <select className="mc-select" value={mmConfig.mode} onChange={e => updateMm({ mode: e.target.value })}>
                        <option value="auto">自动判断</option>
                        <option value="interview">面试截图</option>
                        <option value="written">笔试截图</option>
                      </select>
                    </div>
                  </div>
                  <div className="mc-srow mc-srow-compact">
                    <div>
                      <div className="mc-srow-label">笔试截图同时回答</div>
                      <div className="mc-srow-desc">笔试场景下同时请求所有已启用视觉接口，按模型分栏显示</div>
                    </div>
                    <div className="mc-srow-control is-inline"><Switch checked={!!mmConfig.simultaneousAnswers} onChange={v => updateMm({ simultaneousAnswers: v })} /></div>
                  </div>
                  <div className="mc-srow mc-srow-compact">
                    <div><div className="mc-srow-label">拒答时自动切换备用接口</div></div>
                    <div className="mc-srow-control is-inline">
                      <Switch checked={!!mmConfig.retryOnRefusal} disabled={mmConfig.mode === 'written' && !!mmConfig.simultaneousAnswers} onChange={v => updateMm({ retryOnRefusal: v })} />
                    </div>
                  </div>

                  <div className="mc-card-body" style={{ borderTop: '1px solid var(--border)' }}>
                    {mmConfig.endpoints.map((ep, idx) => (
                      <div key={ep.id} className="mc-card" style={{ background: 'var(--bg-subtle)' }}>
                        <div className="mc-card-head" style={{ padding: '10px 14px' }}>
                          <strong style={{ fontSize: 13 }}>接口 {idx + 1}{idx === 0 ? '（主接口）' : '（备用）'}</strong>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Switch checked={ep.enabled !== false} onChange={v => updateEndpoint(idx, { enabled: v })} aria-label={`启用接口 ${idx + 1}`} />
                            {mmConfig.endpoints.length > 1 && (
                              <button type="button" className="mc-btn mc-btn-sm mc-btn-danger" onClick={() => updateMm({ endpoints: mmConfig.endpoints.filter(x => x.id !== ep.id) })}>
                                移除
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="mc-card-body" style={{ padding: 12 }}>
                          <div className="mc-grid-2">
                            <div className="mc-field">
                              <label className="mc-field-label">服务商预设</label>
                              {renderProviderSelect('vision', ep.baseUrl, ep.model, (p) => updateEndpoint(idx, { baseUrl: p.baseUrl, model: p.model, proxyUrl: p.defaultProxyUrl || '' }))}
                            </div>
                            <div className="mc-field">
                              <label className="mc-field-label">接口备注名</label>
                              <input className="mc-input" value={ep.name || ''} placeholder={`接口 ${idx + 1}`} onChange={e => updateEndpoint(idx, { name: e.target.value })} />
                            </div>
                            <div className="mc-field">
                              <label className="mc-field-label">Base URL</label>
                              <input className="mc-input" value={ep.baseUrl || ''} spellCheck={false} placeholder="https://.../v1" onChange={e => updateEndpoint(idx, { baseUrl: e.target.value })} />
                            </div>
                            <div className="mc-field">
                              <label className="mc-field-label">视觉模型 ID</label>
                              <input className="mc-input" value={ep.model || ''} spellCheck={false} onChange={e => updateEndpoint(idx, { model: e.target.value })} />
                            </div>
                            <div className="mc-field">
                              <label className="mc-field-label">API Key</label>
                              <input
                                className="mc-input"
                                type="password"
                                autoComplete="new-password"
                                value={ep.apiKey ?? ''}
                                placeholder={ep.apiKeySet ? '已保存；留空保留原密钥' : '未填写（本地接口可留空）'}
                                onChange={e => {
                                  const next = { ...ep };
                                  if (e.target.value) next.apiKey = e.target.value;
                                  else delete next.apiKey;
                                  updateMm({ endpoints: mmConfig.endpoints.map((x, i) => i === idx ? next : x) });
                                }}
                              />
                            </div>
                            <div className="mc-field">
                              <label className="mc-field-label">代理（可选）与超时（秒）</label>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <input className="mc-input" value={ep.proxyUrl || ''} placeholder="http://127.0.0.1:7890" onChange={e => updateEndpoint(idx, { proxyUrl: e.target.value })} />
                                <input className="mc-input" type="number" min={5} max={180} style={{ width: 76 }} value={Math.round((ep.timeoutMs || 30000) / 1000)} onChange={e => updateEndpoint(idx, { timeoutMs: Number(e.target.value) * 1000 })} />
                              </div>
                            </div>
                          </div>
                          {ep.apiKeySet && (
                            <div>
                              <button type="button" className="mc-btn mc-btn-sm" onClick={() => updateEndpoint(idx, { apiKey: '' })}>
                                {ep.apiKey === '' ? '已标记清除密钥' : '清除已保存密钥'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="mc-btn mc-btn-sm" onClick={async () => { try { await window.mc.openModelPrompt('written'); setPromptFolderErr(''); } catch (e) { setPromptFolderErr(e.message); } }}>
                        编辑笔试提示词
                      </button>
                      <button type="button" className="mc-btn mc-btn-sm" onClick={async () => { try { await window.mc.openMultimodalPrompts(); setPromptFolderErr(''); } catch (e) { setPromptFolderErr(e.message); } }}>
                        打开提示词文件夹
                      </button>
                    </div>
                    {promptFolderErr && <div className="mc-alert mc-alert-err">{promptFolderErr}</div>}
                  </div>
                </section>
              )}
            </div>

            {/* 2. AUDIO TAB */}
            <div hidden={activeTab !== 'audio'} style={{ display: activeTab === 'audio' ? 'flex' : 'none', flexDirection: 'column', gap: 20 }}>
              <section className="mc-card">
                <div className="mc-card-head"><h3 className="mc-card-title">语音识别后端（ASR）</h3></div>
                <div className="mc-srow">
                  <div><div className="mc-srow-label">识别引擎</div></div>
                  <div className="mc-srow-control">
                    <select className="mc-select" value={asrBackend} onChange={e => setAsrBackend(e.target.value)}>
                      <optgroup label="云端识别（低占用）">
                        <option value="cloud-realtime">云端流式实时（WebSocket）</option>
                        <option value="cloud">云端分段识别（HTTP）</option>
                      </optgroup>
                      <optgroup label="本地识别（离线）">
                        <option value="local-realtime">本地流式（FunASR / MOSS Sidecar）</option>
                        <option value="local">本地分段（Whisper ONNX）</option>
                      </optgroup>
                    </select>
                  </div>
                </div>

                {asrBackend === 'local-realtime' && (
                  <div className="mc-srow">
                    <div><div className="mc-srow-label">本地实时模型</div></div>
                    <div className="mc-srow-control">
                      <select className="mc-select" value={rtLocalModel} onChange={e => setRtLocalModel(e.target.value)}>
                        {LOCAL_REALTIME_MODELS.map(m => <option key={m.value} value={m.value}>{m.nameZh || m.nameEn}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {asrBackend === 'cloud-realtime' && (
                  <>
                    <div className="mc-srow">
                      <div><div className="mc-srow-label">服务商预设</div></div>
                      <div className="mc-srow-control">
                        {renderProviderSelect('asr-realtime', rtBaseUrl, rtModel, (p) => { setRtBaseUrl(p.baseUrl); setRtModel(p.model); })}
                      </div>
                    </div>
                    <div className="mc-srow">
                      <div><div className="mc-srow-label">Realtime WebSocket URL</div></div>
                      <div className="mc-srow-control"><input className="mc-input" value={rtBaseUrl} onChange={e => setRtBaseUrl(e.target.value)} spellCheck={false} /></div>
                    </div>
                    <div className="mc-srow">
                      <div><div className="mc-srow-label">Realtime 模型名</div></div>
                      <div className="mc-srow-control"><input className="mc-input" value={rtModel} onChange={e => setRtModel(e.target.value)} spellCheck={false} /></div>
                    </div>
                    {renderKeySlotRow('云端实时 ASR Key', rtKey, 'asr-realtime', {
                      capability: 'asr-realtime',
                      providerId: providerIdForEndpoint(rtBaseUrl.trim(), rtModel.trim(), 'asr-realtime'),
                      baseUrl: rtBaseUrl, model: rtModel, slot: 'asr-realtime'
                    })}
                  </>
                )}

                {asrBackend === 'cloud' && (
                  <>
                    <div className="mc-srow">
                      <div><div className="mc-srow-label">服务商预设</div></div>
                      <div className="mc-srow-control">
                        {renderProviderSelect('asr-segment', cloudBaseUrl, cloudModel, (p) => { setCloudBaseUrl(p.baseUrl); setCloudModel(p.model); })}
                      </div>
                    </div>
                    <div className="mc-srow">
                      <div><div className="mc-srow-label">云端分段 Base URL</div></div>
                      <div className="mc-srow-control"><input className="mc-input" value={cloudBaseUrl} onChange={e => setCloudBaseUrl(e.target.value)} spellCheck={false} /></div>
                    </div>
                    <div className="mc-srow">
                      <div><div className="mc-srow-label">云端分段模型名</div></div>
                      <div className="mc-srow-control"><input className="mc-input" value={cloudModel} onChange={e => setCloudModel(e.target.value)} spellCheck={false} /></div>
                    </div>
                    {renderKeySlotRow('云端分段 ASR Key', cloudKey, 'asr-cloud', {
                      capability: 'asr-segment',
                      providerId: providerIdForEndpoint(cloudBaseUrl.trim(), cloudModel.trim(), 'asr-segment'),
                      baseUrl: cloudBaseUrl, model: cloudModel, slot: 'asr-cloud'
                    })}
                  </>
                )}

                <div className="mc-srow mc-srow-compact">
                  <div><div className="mc-srow-label">识别语言偏好</div></div>
                  <div className="mc-srow-control">
                    <select className="mc-select" value={language} onChange={e => setLanguage(e.target.value)}>
                      <option value="auto">自动检测（中/英）</option>
                      <option value="chinese">中文为主</option>
                      <option value="english">English</option>
                    </select>
                  </div>
                </div>
              </section>

              <section className="mc-card">
                <div className="mc-card-head">
                  <div><h3 className="mc-card-title">音频输入设备</h3></div>
                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => void listMics().then(setDevices).catch(() => {})}>刷新设备</button>
                </div>
                <div className="mc-srow">
                  <div>
                    <div className="mc-srow-label">麦克风设备</div>
                    <div className="mc-srow-desc">用于「麦克风模式」主收音或「系统音频模式」下的本人发言采集</div>
                  </div>
                  <div className="mc-srow-control">
                    <select className="mc-select" value={micDeviceId} onChange={e => setMicDeviceId(e.target.value)}>
                      <option value="">系统默认麦克风</option>
                      {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
                    </select>
                  </div>
                </div>
                {window.mc.platform === 'darwin' && (
                  <div className="mc-srow">
                    <div><div className="mc-srow-label">对方虚拟音频设备（BlackHole 等）</div></div>
                    <div className="mc-srow-control">
                      <select className="mc-select" value={themDeviceId} onChange={e => setThemDeviceId(e.target.value)}>
                        <option value="">系统默认输入</option>
                        {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* 3. INTERVIEW MATERIALS TAB */}
            <div hidden={activeTab !== 'interview'} style={{ display: activeTab === 'interview' ? 'flex' : 'none', flexDirection: 'column', gap: 20 }}>
              <QuickLibraryCard onOpenKnowledgePage={() => void flushAndLeave(() => onNavigate('knowledge'))} />
              <section className="mc-card">
                <div className="mc-card-head">
                  <div>
                    <h3 className="mc-card-title">备用面试 Prompt</h3>
                    <p className="mc-card-desc">未启用本地资料库 V2 时，文本模型将使用此系统提示词作答。</p>
                  </div>
                  {settings.modelPrompts?.defaultInterview && (
                    <button type="button" className="mc-btn mc-btn-sm" onClick={() => setInterviewPrompt(settings.modelPrompts.defaultInterview)}>恢复默认</button>
                  )}
                </div>
                <div className="mc-card-body">
                  <textarea
                    className="mc-textarea"
                    rows={9}
                    maxLength={64000}
                    spellCheck={false}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                    value={interviewPrompt}
                    onChange={e => setInterviewPrompt(e.target.value)}
                  />
                  <div className="mc-field-hint">{interviewPrompt.length} / 64000</div>
                </div>
              </section>
            </div>

            {/* 4. SHORTCUTS & WINDOW TAB */}
            <div hidden={activeTab !== 'shortcuts'} style={{ display: activeTab === 'shortcuts' ? 'flex' : 'none', flexDirection: 'column', gap: 20 }}>
              <section className="mc-card">
                <div className="mc-card-head"><h3 className="mc-card-title">核心全局快捷键</h3></div>
                <ShortcutRecorder label="隐藏 / 显示主窗口" description="在任意应用中一键切换窗口显示状态" value={hotkey} onChange={setHotkey} />
                <ShortcutRecorder label="静默全屏截图识题" description="支持组合键、F1–F24 或鼠标侧键 Mouse4 / Mouse5" value={hotkeyShot} onChange={setHotkeyShot} />
                <ShortcutRecorder label="框选区域截图识题" description="拖动选取屏幕局部区域并发送到视觉模型" value={hotkeyRegion} onChange={setHotkeyRegion} />
                <div className="mc-srow mc-srow-compact">
                  <div>
                    <div className="mc-srow-label">工作台防干扰快捷键（内置）</div>
                    <div className="mc-srow-desc">可在工作台齿轮菜单或键盘直接触发，无需抢占焦点</div>
                  </div>
                  <div className="mc-srow-control is-inline">
                    <span className="mc-kbd">Ctrl+Shift+8</span> <span className="mc-field-hint">不抢焦点</span>
                    <span className="mc-kbd">Ctrl+Shift+9</span> <span className="mc-field-hint">鼠标穿透</span>
                  </div>
                </div>
              </section>

              <WindowControlsCard />

              <section className="mc-card">
                <div className="mc-card-head">
                  <div><h3 className="mc-card-title">多图暂存与笔试小窗</h3></div>
                  <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={() => void flushAndLeave(onEnterWrittenCompact)}>
                    进入笔试小窗
                  </button>
                </div>
                <div className="mc-card-body">
                  <ScreenshotBatchPanel batch={batch} controller={batchController} management />
                </div>
              </section>
            </div>

            {/* 5. GENERAL & SECURITY TAB */}
            <div hidden={activeTab !== 'general'} style={{ display: activeTab === 'general' ? 'flex' : 'none', flexDirection: 'column', gap: 20 }}>
              <section className="mc-card">
                <div className="mc-card-head"><h3 className="mc-card-title">外观与阅读体验</h3></div>
                <div className="mc-srow mc-srow-compact">
                  <div>
                    <div className="mc-srow-label">主题外观</div>
                    <div className="mc-srow-desc">默认浅色主题，支持暗色或跟随系统切换</div>
                  </div>
                  <div className="mc-srow-control">
                    <select className="mc-select" value={theme} onChange={e => setTheme(e.target.value)}>
                      <option value="light">浅色（默认）</option>
                      <option value="dark">深色</option>
                      <option value="system">跟随系统</option>
                    </select>
                  </div>
                </div>
                <div className="mc-srow mc-srow-compact">
                  <div>
                    <div className="mc-srow-label">回答默认字号 ({workbenchPrefs?.fontSize ?? 14} px)</div>
                    <div className="mc-srow-desc">独立保存于工作台偏好，调整时不会重启语音识别</div>
                  </div>
                  <div className="mc-srow-control is-inline">
                    <input
                      type="range"
                      min={10}
                      max={24}
                      value={workbenchPrefs?.fontSize ?? 14}
                      onChange={e => void onUpdateWorkbenchPrefs({ fontSize: Number(e.target.value) })}
                    />
                    <span style={{ minWidth: 38, textAlign: 'right', fontSize: 12 }}>{workbenchPrefs?.fontSize ?? 14}px</span>
                  </div>
                </div>
                <div className="mc-srow mc-srow-compact">
                  <div><div className="mc-srow-label">界面缩放字号</div></div>
                  <div className="mc-srow-control">
                    <select className="mc-select" value={fontScale} onChange={e => setFontScale(e.target.value)}>
                      <option value="small">紧凑</option>
                      <option value="medium">标准</option>
                      <option value="large">大号</option>
                    </select>
                  </div>
                </div>
                <div className="mc-srow mc-srow-compact">
                  <div><div className="mc-srow-label">界面语言</div></div>
                  <div className="mc-srow-control">
                    <select className="mc-select" value={uiLang} onChange={e => setUiLang(e.target.value)}>
                      <option value="zh">简体中文</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                </div>
                <div className="mc-srow mc-srow-compact">
                  <div><div className="mc-srow-label">开机自动启动</div></div>
                  <div className="mc-srow-control is-inline">
                    <Switch checked={autoLaunch} onChange={setAutoLaunch} />
                  </div>
                </div>
              </section>

              <section className="mc-card">
                <div className="mc-card-head">
                  <div>
                    <h3 className="mc-card-title">安全模式与本机防截屏检测</h3>
                    <p className="mc-card-desc">开启安全模式后强制禁用截屏捕获并开启「不抢焦点」，关闭后自动恢复原偏好。</p>
                  </div>
                  <Switch
                    checked={Boolean(windowState?.securityMode?.enabled)}
                    success
                    onChange={(next) => onToggleSecurity(next)}
                    aria-label="全局安全模式开关"
                  />
                </div>
                <div className="mc-srow mc-srow-compact">
                  <div>
                    <div className="mc-srow-label">启动时自动开启安全模式</div>
                    <div className="mc-srow-desc">每次打开 MeetingCopilot 自动进入防截屏 + 不抢焦点状态</div>
                  </div>
                  <div className="mc-srow-control is-inline">
                    <Switch
                      checked={Boolean(workbenchPrefs?.securityMode?.autoEnableOnLaunch)}
                      onChange={(next) => onSetSecurityPrefs({ autoEnableOnLaunch: next })}
                    />
                  </div>
                </div>
                <div className="mc-card-body" style={{ borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button type="button" className="mc-btn mc-btn-sm" disabled={envChecking} onClick={() => void runEnvCheck()}>
                      <IconShield size={13} /> {envChecking ? '正在检测…' : '检查本机防截屏与录屏环境'}
                    </button>
                    <span className="mc-field-hint">只读本地检查，不修改当前窗口保护状态</span>
                  </div>
                  {envCheck && (
                    <div className={`mc-alert ${envCheck.ok ? 'mc-alert-ok' : 'mc-alert-warn'}`}>
                      <div><strong>防截屏接口：</strong>{envCheck.contentProtectionSupported ? '系统支持 SetWindowDisplayAffinity' : '不可用'} · 当前{envCheck.contentProtectionActive ? '已隐藏保护' : '允许截屏'}</div>
                      {envCheck.screenRecorders?.length > 0 && (
                        <div><strong>检测到录屏软件：</strong>{envCheck.screenRecorders.join('、')}</div>
                      )}
                      {envCheck.meetingApps?.length > 0 && (
                        <div><strong>检测到会议软件：</strong>{envCheck.meetingApps.join('、')}</div>
                      )}
                      {(envCheck.warnings || []).map((w, i) => <div key={i}>• {w}</div>)}
                    </div>
                  )}
                </div>
              </section>

              <section className="mc-card">
                <div className="mc-card-head"><h3 className="mc-card-title">系统工具与支持</h3></div>
                <div className="mc-card-body" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => void flushAndLeave(onOpenHealth)}>服务健康检查</button>
                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => void flushAndLeave(onOpenDiagnostics)}>查看诊断报告</button>
                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => void flushAndLeave(onOpenHelp)}>帮助与配置指南</button>
                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.openLogsFolder()}>打开本地数据目录</button>
                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => void flushAndLeave(() => void window.mc.rerunOnboarding())}>重新运行配置向导</button>
                </div>
              </section>
            </div>

            {/* 6. CAMERA & EYE CONTACT TAB (mounted via hidden, stops preview when active=false) */}
            <div hidden={activeTab !== 'camera'} style={{ display: activeTab === 'camera' ? 'flex' : 'none', flexDirection: 'column', gap: 20 }}>
              <EyeContactSettings active={activeTab === 'camera'} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
