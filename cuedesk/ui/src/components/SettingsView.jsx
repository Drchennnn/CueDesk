import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  LOCAL_REALTIME_MODELS,
  candidateKeyTest,
  isTestableTarget,
  listMics,
  providerIdForEndpoint,
  sanitizeApiKeyInput,
  storedKeyTest
} from '@mc/runtime';
import { buildSettingsDiffPatch } from '../core/settingsPatch.js';
import { EyeContactSettings } from './EyeContactSettings.jsx';
import { WorkbenchShortcutsModal } from './GearPopover.jsx';
import { IconCheck, IconFolder, IconKeyboard, IconMic, IconRefresh, IconShield, IconX } from './Icons.jsx';
import {
  ShortcutRecorder,
  Switch,
  renderProviderConnectionResult,
  settingsAutoFlushers,
  useAutoSaveValue,
  useKeySlot
} from './SharedWidgets.jsx';
import { CustomSelect } from './CustomSelect.jsx';

const REASONING_EFFORT_OPTIONS = [
  { value: 'default', label: '跟随模型默认（不传思考参数）' },
  { value: 'none', label: 'none · 关闭思考（首字最快，推荐实时面试）' },
  { value: 'minimal', label: 'minimal · 极低思考' },
  { value: 'low', label: 'low · 低思考' },
  { value: 'medium', label: 'medium · 中思考' },
  { value: 'high', label: 'high · 高思考（适合笔试/难题）' },
  { value: 'xhigh', label: 'xhigh · 最高思考' }
];

const REALTIME_PROTOCOL_OPTIONS = [
  { value: 'dashscope', label: '阿里云百炼 DashScope（Paraformer / Fun-ASR）' },
  { value: 'doubao', label: '火山豆包流式 ASR v3（SAUC 二进制协议）' },
  { value: 'openai-realtime', label: 'OpenAI Realtime 转写协议（兼容 OpenAI & 阿里 Qwen3-ASR 实时）' },
  { value: 'deepgram', label: 'Deepgram Live 流式协议（Nova-3 / Nova-2）' },
  { value: 'tencent', label: '腾讯云实时语音识别（WebSocket v2）' },
  { value: 'xfyun', label: '科大讯飞实时语音转写（RTASR）' }
];

const SEGMENT_PROTOCOL_OPTIONS = [
  { value: 'openai-transcriptions', label: 'OpenAI 标准 /audio/transcriptions（兼容硅基流动 / 智谱 / Groq / OpenAI / 中转站）' },
  { value: 'chat-audio', label: '音频对话 /chat/completions（input_audio · 兼容 gpt-4o-audio / qwen-audio）' }
];

const SEGMENTATION_MODE_OPTIONS = [
  { value: 'fast', label: '极速抢答（云端 450ms + 前端 120ms · 首字最快）' },
  { value: 'balanced', label: '均衡推荐（云端 650ms + 前端 180ms + 同题自动修订）' },
  { value: 'long', label: '长句连贯（云端 1100ms + 前端 320ms · 适合思考停顿多的面试官）' }
];

const REALTIME_META = {
  dashscope: {
    shortName: '百炼 DashScope',
    defaultBaseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    defaultModel: 'paraformer-realtime-v2',
    urlDesc: '常用：wss://dashscope.aliyuncs.com/api-ws/v1/inference（也支持自定义中转 / 本地 ws://127.0.0.1）',
    urlPlaceholder: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    modelLabel: 'Realtime 模型名',
    modelDesc: '例如：paraformer-realtime-v2 / fun-asr-realtime',
    modelPlaceholder: 'paraformer-realtime-v2 / fun-asr-realtime',
    keyLabel: '百炼实时 ASR API Key',
    keyPlaceholder: 'sk-...'
  },
  doubao: {
    shortName: '火山豆包',
    defaultBaseUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
    defaultModel: 'bigmodel',
    defaultResourceId: 'volc.seedasr.sauc.duration',
    urlDesc: '常用：wss://openspeech.bytedance.com/api/v3/sauc/bigmodel（或 bigmodel_async）',
    urlPlaceholder: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
    modelLabel: '模型名（model_name）',
    modelDesc: '豆包流式大模型固定为 bigmodel（具体 1.0/2.0 版本由上方 Resource ID 决定）',
    modelPlaceholder: 'bigmodel',
    keyLabel: '豆包 API Key（X-Api-Key）',
    keyPlaceholder: '填写豆包 API Key / Access Token'
  },
  'openai-realtime': {
    shortName: 'OpenAI / Qwen Realtime',
    defaultBaseUrl: 'wss://api.openai.com/v1/realtime?intent=transcription',
    defaultModel: 'gpt-4o-mini-transcribe',
    urlDesc: 'OpenAI：wss://api.openai.com/v1/realtime?intent=transcription；阿里百炼 Qwen3-ASR：wss://dashscope.aliyuncs.com/api-ws/v1/realtime（自动适配 16kHz/24kHz）',
    urlPlaceholder: 'wss://api.openai.com/v1/realtime?intent=transcription',
    modelLabel: 'Realtime 转写模型名',
    modelDesc: '例如：gpt-4o-mini-transcribe / gpt-4o-transcribe / qwen3-asr-flash-realtime',
    modelPlaceholder: 'gpt-4o-mini-transcribe / qwen3-asr-flash-realtime',
    keyLabel: 'Realtime API Key（Bearer）',
    keyPlaceholder: 'sk-...'
  },
  deepgram: {
    shortName: 'Deepgram',
    defaultBaseUrl: 'wss://api.deepgram.com/v1/listen',
    defaultModel: 'nova-3',
    urlDesc: '常用：wss://api.deepgram.com/v1/listen（可自定义 EU/自托管节点，鉴权头 Authorization: Token）',
    urlPlaceholder: 'wss://api.deepgram.com/v1/listen',
    modelLabel: 'Deepgram 模型名',
    modelDesc: '例如：nova-3（多语种推荐） / nova-2 / nova-2-general',
    modelPlaceholder: 'nova-3',
    keyLabel: 'Deepgram API Key',
    keyPlaceholder: '填写 Deepgram Console API Key'
  },
  tencent: {
    shortName: '腾讯云 ASR',
    defaultBaseUrl: 'wss://asr.cloud.tencent.com/asr/v2',
    defaultModel: '16k_zh',
    urlDesc: '常用：wss://asr.cloud.tencent.com/asr/v2（自动拼接 /{AppID} 并计算 HMAC-SHA1 实时签名）',
    urlPlaceholder: 'wss://asr.cloud.tencent.com/asr/v2',
    modelLabel: '引擎模型（engine_model_type）',
    modelDesc: '例如：16k_zh（中英自由说） / 16k_zh_large（大模型） / 16k_en / 16k_zh-PY',
    modelPlaceholder: '16k_zh',
    keyLabel: '腾讯云 SecretKey',
    keyPlaceholder: '填写腾讯云 API SecretKey（加密保存，用于计算签名）'
  },
  xfyun: {
    shortName: '科大讯飞 RTASR',
    defaultBaseUrl: 'wss://rtasr.xfyun.cn/v1/ws',
    defaultModel: 'cn',
    urlDesc: '常用：wss://rtasr.xfyun.cn/v1/ws（自动按 MD5+HMAC-SHA1 计算 signa 签名，1280B/帧发送）',
    urlPlaceholder: 'wss://rtasr.xfyun.cn/v1/ws',
    modelLabel: '语言参数（lang）',
    modelDesc: '默认 cn（中文/中英混合），英文可填 en；其他语种填讯飞 lang 代码',
    modelPlaceholder: 'cn / en',
    keyLabel: '科大讯飞 RTASR APIKey',
    keyPlaceholder: '填写讯飞「实时语音转写」专用 APIKey'
  }
};

const DOUBAO_AUTH_MODE_OPTIONS = [
  { value: 'api-key', label: '新版 API Key（X-Api-Key，推荐）' },
  { value: 'app-access', label: '旧版 App ID + Access Token' }
];

const STAGE_LABELS = {
  config: '本地配置校验',
  connect: '建立连接',
  auth: '凭证与资源鉴权',
  handshake: '协议握手',
  audio: '音频帧协议',
  transcribe: '转写定稿',
  done: '完成'
};

function inferRealtimeProviderClient(rt = {}) {
  const p = String(rt?.provider || '').trim().toLowerCase();
  if (p === 'doubao' || p === 'volcengine' || p === 'seedasr') return 'doubao';
  if (p === 'openai-realtime' || p === 'openai' || p === 'qwen-realtime') return 'openai-realtime';
  if (p === 'deepgram') return 'deepgram';
  if (p === 'tencent' || p === 'qcloud') return 'tencent';
  if (p === 'xfyun' || p === 'iflytek' || p === 'rtasr') return 'xfyun';
  if (p === 'dashscope' || p === 'aliyun' || p === 'bailian') return 'dashscope';
  const u = String(rt?.baseUrl || '').toLowerCase();
  if (u.includes('openspeech.bytedance.com') || u.includes('bytepluses.com') || u.includes('/api/v3/sauc') || String(rt?.resourceId || '').startsWith('volc.')) {
    return 'doubao';
  }
  if (u.includes('api.deepgram.com') || u.includes('/v1/listen')) return 'deepgram';
  if (u.includes('asr.cloud.tencent.com')) return 'tencent';
  if (u.includes('rtasr.xfyun.cn') || u.includes('xfyun.cn')) return 'xfyun';
  if (u.includes('/v1/realtime') || u.includes('intent=transcription') || String(rt?.model || '').toLowerCase().includes('qwen3-asr')) {
    return 'openai-realtime';
  }
  return 'dashscope';
}

function inferSegmentProtocolClient(cloud = {}) {
  const explicit = String(cloud?.protocol || '').trim().toLowerCase();
  if (explicit === 'chat-audio' || explicit === 'chat-completions') return 'chat-audio';
  if (explicit === 'openai-transcriptions' || explicit === 'transcriptions' || explicit === 'multipart') return 'openai-transcriptions';
  const u = String(cloud?.baseUrl || '').trim().toLowerCase();
  const m = String(cloud?.model || '').trim().toLowerCase();
  if (u.endsWith('/chat/completions') || /audio-preview|qwen.*audio|omni/i.test(m)) return 'chat-audio';
  return 'openai-transcriptions';
}

function realtimeProfileDefaults(provider) {
  const meta = REALTIME_META[provider] || REALTIME_META.dashscope;
  return {
    baseUrl: provider === 'dashscope' ? '' : meta.defaultBaseUrl,
    model: provider === 'dashscope' ? '' : meta.defaultModel,
    resourceId: provider === 'doubao' ? (meta.defaultResourceId || 'volc.seedasr.sauc.duration') : '',
    authMode: 'api-key',
    appId: '',
    appKey: ''
  };
}

function readRealtimeProfile(settings, provider) {
  const rt = settings?.asr?.realtime || {};
  const fromMap = rt.profiles?.[provider];
  if (fromMap && typeof fromMap === 'object') {
    const def = realtimeProfileDefaults(provider);
    return {
      baseUrl: fromMap.baseUrl || (provider === 'dashscope' ? '' : def.baseUrl),
      model: fromMap.model || (provider === 'dashscope' ? '' : def.model),
      resourceId: provider === 'doubao' ? (fromMap.resourceId ?? def.resourceId) : '',
      authMode: fromMap.authMode === 'app-access' ? 'app-access' : 'api-key',
      appId: (provider === 'tencent' || provider === 'xfyun') ? (fromMap.appId || '') : '',
      appKey: (provider === 'doubao' || provider === 'tencent') ? (fromMap.appKey || '') : '',
      apiKeySet: Boolean(fromMap.apiKeySet),
      apiKeyHint: fromMap.apiKeyHint,
      verification: fromMap.verification
    };
  }
  const activeProvider = inferRealtimeProviderClient(rt);
  if (activeProvider === provider) {
    return {
      baseUrl: rt.baseUrl || '',
      model: rt.model || '',
      resourceId: rt.resourceId || '',
      authMode: rt.authMode === 'app-access' ? 'app-access' : 'api-key',
      appId: rt.appId || '',
      appKey: rt.appKey || '',
      apiKeySet: Boolean(rt.apiKeySet),
      apiKeyHint: rt.apiKeyHint,
      verification: rt.verification
    };
  }
  const def = realtimeProfileDefaults(provider);
  return { ...def, apiKeySet: false, apiKeyHint: undefined, verification: undefined };
}

function ModelPickerField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  baseUrl,
  apiKey,
  slot,
  endpointId,
  proxyUrl,
  compact = false
}) {
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');

  const handleFetch = async () => {
    const cleanUrl = String(baseUrl || '').trim();
    if (!cleanUrl) {
      setErrMsg('请先填写 Base URL 再获取模型列表');
      setStatusMsg('');
      return;
    }
    setLoading(true);
    setErrMsg('');
    setStatusMsg('');
    try {
      const res = await window.mc.listModels({
        baseUrl: cleanUrl,
        apiKey: String(apiKey || '').trim(),
        slot,
        endpointId,
        proxyUrl: String(proxyUrl || '').trim()
      });
      if (!res?.ok) {
        setErrMsg(res?.error || '获取模型列表失败，可直接手动输入模型 ID');
        setOpen(false);
        return;
      }
      const list = Array.isArray(res.models) ? res.models : [];
      setModels(list);
      setFilter('');
      if (!list.length) {
        setStatusMsg('接口返回了空模型列表，请手动输入模型 ID');
        setOpen(false);
      } else {
        setStatusMsg(`已获取 ${list.length} 个模型${res.latencyMs ? ` (${res.latencyMs}ms)` : ''}`);
        setOpen(true);
      }
    } catch (e) {
      setErrMsg(e?.message || '获取模型列表失败，可直接手动输入模型 ID');
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return models;
    return models.filter(m => m.toLowerCase().includes(q));
  }, [models, filter]);

  return (
    <div className="mc-model-picker">
      <div className="mc-model-picker-row">
        <input
          className="mc-input"
          aria-label={ariaLabel}
          value={value}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="mc-btn mc-btn-sm"
          style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
          disabled={loading}
          title="向当前 Base URL 请求 /models 拉取可用模型列表"
          onClick={() => void handleFetch()}
        >
          <IconRefresh size={12} /> {loading ? '获取中…' : (compact ? '获取模型' : '获取模型列表')}
        </button>
      </div>

      {errMsg && <div className="mc-field-hint" style={{ color: 'var(--danger)' }}>{errMsg}</div>}
      {!errMsg && (statusMsg || models.length > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span className="mc-field-hint">{statusMsg || `已缓存 ${models.length} 个模型`}</span>
          {models.length > 0 && (
            <button
              type="button"
              className="mc-btn mc-btn-sm"
              style={{ height: 22, padding: '0 8px', fontSize: 11, flexShrink: 0 }}
              onClick={() => setOpen(v => !v)}
            >
              {open ? '收起列表' : `展开列表 (${models.length})`}
            </button>
          )}
        </div>
      )}

      {open && models.length > 0 && (
        <div className="mc-model-picker-panel" role="listbox" aria-label="已获取的模型列表">
          <div className="mc-model-picker-head">
            <input
              className="mc-input"
              style={{ height: 28, fontSize: 12 }}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder={`筛选 ${models.length} 个模型（如 gpt / claude / gemini / qwen）…`}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
              }}
            />
            <button type="button" className="mc-icon-btn" style={{ width: 26, height: 26 }} aria-label="关闭模型列表" onClick={() => setOpen(false)}>
              <IconX size={13} />
            </button>
          </div>
          <div className="mc-model-picker-list">
            {filtered.length === 0 ? (
              <div className="mc-field-hint" style={{ padding: '8px 10px' }}>没有匹配的模型，可直接在上方输入框手动填写</div>
            ) : (
              filtered.map(m => {
                const active = m === value;
                return (
                  <button
                    key={m}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`mc-model-picker-item${active ? ' is-selected' : ''}`}
                    onClick={() => {
                      onChange(m);
                      setOpen(false);
                    }}
                  >
                    <span className="mc-model-picker-id">{m}</span>
                    {active && <IconCheck size={12} />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const NAV_GROUPS = [
  {
    label: '核心能力',
    items: [
      { id: 'models', title: '模型接口', desc: '配置文本大模型与截图多模态接口（BYOK，密钥加密存于本机）。' },
      { id: 'audio', title: '语音与录制', desc: '配置语音识别引擎、麦克风电平测试与整场 WAV 录音目录。' },
      { id: 'camera', title: '摄像头与眼神矫正', desc: '输入摄像头、NVIDIA Maxine 眼神矫正预览与状态。' }
    ]
  },
  {
    label: '安全与控制',
    items: [
      { id: 'security', title: '安全模式', desc: '防截屏隐身、启动自动开启、安全模式虚拟光标与环境检测。' },
      { id: 'shortcuts', title: '快捷键', desc: '点击直接录制全局快捷键、窗口控制热键与会中工作台热键。' }
    ]
  },
  {
    label: '偏好',
    items: [
      { id: 'general', title: '通用偏好', desc: '外观主题、字号阅读偏好、语言与会话保存策略。' }
    ]
  }
];

const ALL_TABS = NAV_GROUPS.flatMap(g => g.items);

const TEST_RESULT_COPY = {
  locale: 'zh-CN',
  testing: '正在测试连接…',
  success: (ms) => (typeof ms === 'number' ? `连接成功 · ${ms} ms` : '连接成功'),
  failed: '连接失败',
  hintLabel: '建议',
  retryableNote: '可重试',
  detailShow: '展开详情',
  detailHide: '收起详情',
  detailCode: '状态码',
  detailRequestId: '请求 ID',
  detailTime: '时间'
};

function parseHotkeyConflict(rawError, bindings) {
  const text = String(rawError || '').trim();
  if (!text) return null;
  const cleanDetail = text.replace(/请在设置中更换[。.]?/, '').replace(/[，,。.;；\s]+$/, '').trim();
  const { hotkey, hotkeyShot, hotkeyRegion } = bindings || {};
  const matches = (acc) => acc && text.toLowerCase().includes(String(acc).toLowerCase());
  if (matches(hotkeyRegion) || /框选|region/i.test(text)) {
    return {
      feature: '框选区域截图识题',
      buttonLabel: '更换框选快捷键',
      targetSection: 'hotkeyRegion',
      detail: cleanDetail
    };
  }
  if (matches(hotkeyShot) || /全屏|shot/i.test(text)) {
    return {
      feature: '静默全屏截图识题',
      buttonLabel: '更换全屏截图快捷键',
      targetSection: 'hotkeyShot',
      detail: cleanDetail
    };
  }
  if (matches(hotkey) || /隐藏|显示|toggle/i.test(text)) {
    return {
      feature: '隐藏 / 显示主窗口',
      buttonLabel: '更换显隐快捷键',
      targetSection: 'hotkeyToggle',
      detail: cleanDetail
    };
  }
  return {
    feature: '全局快捷键',
    buttonLabel: '前往快捷键设置',
    targetSection: 'shortcuts',
    detail: cleanDetail
  };
}

function publicSlot(settings, slot) {
  switch (slot) {
    case 'llm': return settings.llm;
    case 'vision': return settings.vision;
    case 'asr-cloud': return settings.asr.cloud;
    case 'asr-realtime':
    default: return settings.asr.realtime;
  }
}

/* SuiSi-style live microphone volume meter test */
function MicLevelTester({ deviceId }) {
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const cleanupRef = useRef(null);

  const stop = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setTesting(false);
    setLevel(0);
  }, []);

  useEffect(() => stop, [stop, deviceId]);

  const start = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false
      });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let rafId = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(100, Math.round(rms * 280)));
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      cleanupRef.current = () => {
        cancelAnimationFrame(rafId);
        try { source.disconnect(); } catch {}
        try { ctx.close(); } catch {}
        for (const t of stream.getTracks()) t.stop();
      };
      setTesting(true);
    } catch (e) {
      setError(`麦克风不可用：${e?.message || e}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          className={`mc-btn mc-btn-sm ${testing ? 'mc-btn-danger' : ''}`}
          onClick={() => (testing ? stop() : void start())}
        >
          <IconMic size={12} /> {testing ? '停止检测' : '麦克风实时测试'}
        </button>
        <div className="mc-mic-meter" aria-label="麦克风输入电平">
          <div className="mc-mic-meter-fill" style={{ width: `${level}%` }} />
        </div>
        <span className="mc-field-hint" style={{ minWidth: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {testing ? `${level}%` : '未测'}
        </span>
      </div>
      {error && <div className="mc-field-hint" style={{ color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
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

  const labels = [
    ['left', '窗口左移', '键盘控制悬浮窗向左微移'],
    ['right', '窗口右移', '键盘控制悬浮窗向右微移'],
    ['up', '窗口上移', '键盘控制悬浮窗向上微移'],
    ['down', '窗口下移', '键盘控制悬浮窗向下微移'],
    ['grow', '放大窗口', '等比放大悬浮窗与字号'],
    ['shrink', '缩小窗口', '等比缩小悬浮窗与字号'],
    ['toggleBatch', '多图暂存开关', '笔试模式开启/关闭多图连拍暂存'],
    ['sendBatch', '发送暂存多图', '一键提交全部暂存截图给视觉模型']
  ];

  return (
    <section className="mc-card">
      <div className="mc-card-head">
        <div>
          <h3 className="mc-card-title">窗口移动、缩放与多图快捷键</h3>
          <p className="mc-card-desc">点击「录制」后直接按下组合键或鼠标侧键；Delete / Backspace 清除绑定，冲突自动回滚。</p>
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
              <div className="mc-srow-desc">在工作台中也可通过齿轮菜单分层调节背景 / 文字 / 悬停透明度</div>
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
          {labels.map(([key, label, desc]) => (
            <ShortcutRecorder
              key={key}
              label={label}
              description={desc}
              value={draft.bindings?.[key] || ''}
              onChange={(val) => setDraft({ ...draft, bindings: { ...draft.bindings, [key]: val } })}
            />
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

export function SettingsView({
  initialTab = 'models',
  focusRequest = null,
  settings,
  workbenchPrefs,
  windowState,
  activeSession = null,
  onSaved,
  onUpdateWorkbenchPrefs,
  onToggleSecurity,
  onSetSecurityPrefs,
  onResumeWorkbench,
  onOpenQuickStart,
  onOpenDiagnostics,
  closeRef
}) {
  const normalizedInitial = ALL_TABS.some(t => t.id === initialTab) ? initialTab : 'models';
  const [activeTab, setActiveTab] = useState(normalizedInitial);
  const [highlightedSection, setHighlightedSection] = useState('');
  const [wbShortcutsOpen, setWbShortcutsOpen] = useState(false);
  const rootRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (initialTab && ALL_TABS.some(t => t.id === initialTab)) setActiveTab(initialTab);
  }, [initialTab, focusRequest?.seq]);

  const jumpToSection = useCallback((tabId, sectionId) => {
    if (tabId && ALL_TABS.some(t => t.id === tabId)) setActiveTab(tabId);
    if (!sectionId) return;
    setHighlightedSection(sectionId);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`settings-section-${sectionId}`);
        el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      });
    });
    const timer = setTimeout(() => {
      setHighlightedSection(prev => (prev === sectionId ? '' : prev));
    }, 2400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!focusRequest?.section) return undefined;
    return jumpToSection(null, focusRequest.section);
  }, [focusRequest?.seq, focusRequest?.section, jumpToSection]);

  // Form states mirrored from settings
  const [live, setLive] = useState(settings);
  const [baseUrl, setBaseUrl] = useState(settings.llm.baseUrl || '');
  const [model, setModel] = useState(settings.llm.model || '');
  const [reasoningEffort, setReasoningEffort] = useState(settings.llm.reasoningEffort || 'default');
  const [answerLang, setAnswerLang] = useState(settings.llm.answerLang || 'chinese');
  const [visionBaseUrl] = useState(settings.vision?.baseUrl || '');
  const [visionModel] = useState(settings.vision?.model || '');
  const [visionProxy] = useState(settings.vision?.proxyUrl || '');
  const [mmConfig, setMmConfig] = useState(settings.multimodal);

  const [asrBackend, setAsrBackend] = useState(settings.asr.backend || 'cloud-realtime');
  const [language, setLanguage] = useState(settings.asr.language || 'auto');
  const [segmentationMode, setSegmentationMode] = useState(settings.asr.segmentationMode || 'balanced');
  const [echoGuard, setEchoGuard] = useState(settings.asr.echoGuard !== false);
  const [cloudProtocol, setCloudProtocol] = useState(inferSegmentProtocolClient(settings.asr.cloud));
  const [cloudBaseUrl, setCloudBaseUrl] = useState(settings.asr.cloud?.baseUrl || '');
  const [cloudModel, setCloudModel] = useState(settings.asr.cloud?.model || '');
  const [cloudTestState, setCloudTestState] = useState({ running: false, result: null, error: '', showDetail: false });
  const initialRtProvider = inferRealtimeProviderClient(settings.asr.realtime);
  const initialRtProfile = readRealtimeProfile(settings, initialRtProvider);
  const [rtProvider, setRtProvider] = useState(initialRtProvider);
  const [rtBaseUrl, setRtBaseUrl] = useState(initialRtProfile.baseUrl || '');
  const [rtModel, setRtModel] = useState(initialRtProfile.model || '');
  const [rtResourceId, setRtResourceId] = useState(initialRtProfile.resourceId || '');
  const [rtAuthMode, setRtAuthMode] = useState(initialRtProfile.authMode || 'api-key');
  const [rtAppId, setRtAppId] = useState(initialRtProfile.appId || '');
  const [rtAppKey, setRtAppKey] = useState(initialRtProfile.appKey || '');
  const [rtLocalModel, setRtLocalModel] = useState(settings.asr.localRealtime?.model || 'fun-asr-nano');
  const [rtTestState, setRtTestState] = useState({ running: null, result: null, error: '', showDetail: false });
  const [themDeviceId, setThemDeviceId] = useState(settings.audio?.themDeviceId || '');
  const [micDeviceId, setMicDeviceId] = useState(settings.audio?.micDeviceId || '');
  const [devices, setDevices] = useState([]);
  const [recDirInfo, setRecDirInfo] = useState('');

  const [hotkey, setHotkey] = useState(settings.ui.hotkeyToggle || 'Control+B');
  const [hotkeyShot, setHotkeyShot] = useState(settings.ui.hotkeyShot || 'Control+Shift+S');
  const [hotkeyRegion, setHotkeyRegion] = useState(settings.capture?.hotkeyRegion ?? 'Control+Alt+A');

  const [theme, setTheme] = useState(settings.ui.theme || 'light');
  const [fontScale, setFontScale] = useState(settings.ui.fontScale || 'medium');
  const [uiLang, setUiLang] = useState(settings.ui.lang || 'zh');
  const [autoLaunch, setAutoLaunch] = useState(!!settings.ui.autoLaunch);

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
    void window.mc.getRecordingStatus?.().then(st => { if (st?.recordingDir) setRecDirInfo(st.recordingDir); }).catch(() => {});
  }, [workbenchPrefs?.recordingDir]);

  const snapshotFromSettings = useCallback((s) => {
    const p = inferRealtimeProviderClient(s.asr.realtime);
    const prof = readRealtimeProfile(s, p);
    return {
      baseUrl: s.llm.baseUrl || '',
      model: s.llm.model || '',
      reasoningEffort: s.llm.reasoningEffort || 'default',
      answerLang: s.llm.answerLang || 'chinese',
      llmProviderId: s.llm.providerId || '',
      visionBaseUrl: s.vision?.baseUrl || '',
      visionModel: s.vision?.model || '',
      visionProxy: s.vision?.proxyUrl || '',
      multimodal: s.multimodal,
      asrBackend: s.asr.backend || 'cloud-realtime',
      language: s.asr.language || 'auto',
      segmentationMode: s.asr.segmentationMode || 'balanced',
      echoGuard: s.asr.echoGuard !== false,
      cloudProtocol: inferSegmentProtocolClient(s.asr.cloud),
      cloudBaseUrl: s.asr.cloud?.baseUrl || '',
      cloudModel: s.asr.cloud?.model || '',
      rtProvider: p,
      rtBaseUrl: prof.baseUrl || '',
      rtModel: prof.model || '',
      rtResourceId: prof.resourceId || '',
      rtAuthMode: prof.authMode || 'api-key',
      rtAppId: prof.appId || '',
      rtAppKey: prof.appKey || '',
      rtLocalModel: s.asr.localRealtime?.model || 'fun-asr-nano',
      asrProviderId: s.asr.providerId || '',
      themDeviceId: s.audio?.themDeviceId || '',
      micDeviceId: s.audio?.micDeviceId || '',
      hotkey: s.ui.hotkeyToggle || 'Control+B',
      hotkeyShot: s.ui.hotkeyShot || 'Control+Shift+S',
      hotkeyRegion: s.capture?.hotkeyRegion ?? 'Control+Alt+A',
      theme: s.ui.theme || 'light',
      fontScale: s.ui.fontScale || 'medium',
      uiLang: s.ui.lang || 'zh',
      autoLaunch: !!s.ui.autoLaunch,
      interviewPrompt: s.modelPrompts?.interview || ''
    };
  }, []);

  const baselineRef = useRef(snapshotFromSettings(settings));

  const currentDraft = useMemo(() => ({
    baseUrl, model, reasoningEffort, answerLang,
    llmProviderId: 'custom',
    visionBaseUrl, visionModel, visionProxy,
    multimodal: mmConfig,
    asrBackend, language, segmentationMode, echoGuard, cloudProtocol, cloudBaseUrl, cloudModel,
    rtProvider, rtBaseUrl, rtModel, rtResourceId, rtAuthMode, rtAppId, rtAppKey, rtLocalModel,
    asrProviderId: asrBackend === 'cloud-realtime'
      ? rtProvider
      : asrBackend === 'cloud'
        ? (cloudProtocol || providerIdForEndpoint(cloudBaseUrl.trim(), cloudModel.trim(), 'asr-segment'))
        : '',
    themDeviceId, micDeviceId,
    hotkey, hotkeyShot, hotkeyRegion,
    theme, fontScale, uiLang, autoLaunch,
    interviewPrompt: baselineRef.current.interviewPrompt
  }), [
    baseUrl, model, reasoningEffort, answerLang, visionBaseUrl, visionModel, visionProxy, mmConfig,
    asrBackend, language, segmentationMode, echoGuard, cloudProtocol, cloudBaseUrl, cloudModel,
    rtProvider, rtBaseUrl, rtModel, rtResourceId, rtAuthMode, rtAppId, rtAppKey, rtLocalModel,
    themDeviceId, micDeviceId, hotkey, hotkeyShot, hotkeyRegion,
    theme, fontScale, uiLang, autoLaunch
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

  const handleSwitchRealtimeProvider = (nextProvider) => {
    if (nextProvider === rtProvider) return;
    const targetProfile = readRealtimeProfile(live, nextProvider);
    setRtProvider(nextProvider);
    setRtBaseUrl(targetProfile.baseUrl || '');
    setRtModel(targetProfile.model || '');
    setRtResourceId(targetProfile.resourceId || '');
    setRtAuthMode(targetProfile.authMode || 'api-key');
    setRtAppId(targetProfile.appId || '');
    setRtAppKey(targetProfile.appKey || '');
    rtKey.reset();
    setRtTestState({ running: null, result: null, error: '', showDetail: false });
  };

  const runRealtimeCheck = async (mode) => {
    const candidate = sanitizeApiKeyInput(rtKey.value).value;
    const req = {
      capability: 'asr-realtime',
      provider: rtProvider,
      providerId: rtProvider,
      baseUrl: rtBaseUrl.trim(),
      model: rtModel.trim(),
      resourceId: rtProvider === 'doubao' ? rtResourceId.trim() : '',
      authMode: rtProvider === 'doubao' ? rtAuthMode : 'api-key',
      appId: (rtProvider === 'tencent' || rtProvider === 'xfyun') ? rtAppId.trim() : '',
      appKey: (rtProvider === 'doubao' || rtProvider === 'tencent') ? rtAppKey.trim() : '',
      language,
      slot: 'asr-realtime',
      ...(candidate ? { candidateApiKey: candidate } : { useStoredKey: true })
    };
    setRtTestState({ running: mode, result: null, error: '', showDetail: false });
    try {
      const result = mode === 'transcribe'
        ? await window.mc.testRealtimeTranscribe(req)
        : await window.mc.providerTest(req);
      setRtTestState({ running: null, result, error: '', showDetail: false });
      const refreshed = await window.mc.getSettings();
      setLive(refreshed);
      onSaved?.(refreshed);
    } catch (err) {
      setRtTestState({ running: null, result: null, error: err.message || '测试请求失败', showDetail: false });
    }
  };

  const runSegmentTranscribe = async () => {
    const candidate = sanitizeApiKeyInput(cloudKey.value).value;
    const req = {
      capability: 'asr-segment',
      protocol: cloudProtocol,
      providerId: cloudProtocol,
      baseUrl: cloudBaseUrl.trim(),
      model: cloudModel.trim(),
      language,
      slot: 'asr-cloud',
      ...(candidate ? { candidateApiKey: candidate } : { useStoredKey: true })
    };
    setCloudTestState({ running: true, result: null, error: '', showDetail: false });
    try {
      const result = await window.mc.providerTest(req);
      setCloudTestState({ running: false, result, error: '', showDetail: false });
      const refreshed = await window.mc.getSettings();
      setLive(refreshed);
      onSaved?.(refreshed);
    } catch (err) {
      setCloudTestState({ running: false, result: null, error: err.message || '试转写请求失败', showDetail: false });
    }
  };

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

  const renderKeySlotRow = (label, slot, slotId, target) => {
    const pub = publicSlot(live, slotId);
    const apiKeySet = !!pub?.apiKeySet;
    const hint = pub?.apiKeyHint;
    const st = tests[slotId];
    const candidate = sanitizeApiKeyInput(slot.value).value;
    const canTest = isTestableTarget(target) && !slot.pendingDelete && (candidate !== '' || apiKeySet);
    const keyUrl = null;

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
          {renderProviderConnectionResult(TEST_RESULT_COPY, st, keyUrl, onOpenDiagnostics)}
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

  const activeTabMeta = ALL_TABS.find(t => t.id === activeTab) || ALL_TABS[0];
  const hotkeyConflict = useMemo(
    () => parseHotkeyConflict(live.capture?.registrationError, { hotkey, hotkeyShot, hotkeyRegion }),
    [live.capture?.registrationError, hotkey, hotkeyShot, hotkeyRegion]
  );
  const recommendedHotkeyFix = useMemo(() => {
    if (!hotkeyConflict) return null;
    if (hotkeyConflict.targetSection === 'hotkeyRegion') {
      const next = hotkeyRegion.toLowerCase() === 'control+alt+a' ? 'Alt+Shift+A' : 'Control+Alt+A';
      return {
        label: `一键改为 ${next.replace(/Control/g, 'Ctrl')}`,
        apply: () => setHotkeyRegion(next)
      };
    }
    if (hotkeyConflict.targetSection === 'hotkeyShot') {
      const next = hotkeyShot.toLowerCase() === 'control+alt+s' ? 'Alt+Shift+S' : 'Control+Alt+S';
      return {
        label: `一键改为 ${next.replace(/Control/g, 'Ctrl')}`,
        apply: () => setHotkeyShot(next)
      };
    }
    if (hotkeyConflict.targetSection === 'hotkeyToggle') {
      const next = hotkey.toLowerCase() === 'control+alt+b' ? 'Alt+Shift+B' : 'Control+Alt+B';
      return {
        label: `一键改为 ${next.replace(/Control/g, 'Ctrl')}`,
        apply: () => setHotkey(next)
      };
    }
    return null;
  }, [hotkeyConflict, hotkey, hotkeyShot, hotkeyRegion]);
  const llmReadyNow = Boolean(live?.llm?.baseUrl && live?.llm?.model && live?.llm?.apiKeySet);

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
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mc-settings-nav-group">
              <div className="mc-settings-nav-label">{group.label}</div>
              {group.items.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`settings-tab-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  className="mc-settings-tab"
                  onClick={() => { setActiveTab(tab.id); scrollRef.current?.scrollTo(0, 0); }}
                >
                  {tab.title}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="mc-settings-scroll" ref={scrollRef}>
          <div className="mc-settings-container">
            <div>
              <h2 className="mc-settings-cat-title">{activeTabMeta.title}</h2>
              <p className="mc-settings-cat-desc">{activeTabMeta.desc}</p>
            </div>

            {saveError && (
              <div className="mc-alert mc-alert-err" role="alert">{saveError}</div>
            )}

            {hotkeyConflict && (
              <div className="mc-alert mc-alert-warn" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <strong>「{hotkeyConflict.feature}」快捷键被占用</strong>
                  <div style={{ fontSize: 12, marginTop: 2 }}>{hotkeyConflict.detail}（不影响模型或语音连接状态）</div>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {recommendedHotkeyFix && (
                    <button
                      type="button"
                      className="mc-btn mc-btn-sm mc-btn-primary"
                      onClick={() => recommendedHotkeyFix.apply()}
                    >
                      {recommendedHotkeyFix.label}
                    </button>
                  )}
                  <button
                    type="button"
                    className="mc-btn mc-btn-sm"
                    onClick={() => void jumpToSection('shortcuts', hotkeyConflict.targetSection)}
                  >
                    {hotkeyConflict.buttonLabel} →
                  </button>
                </div>
              </div>
            )}

            {/* 1. MODELS */}
            <div hidden={activeTab !== 'models'} style={{ display: activeTab === 'models' ? 'flex' : 'none', flexDirection: 'column', gap: 20 }}>
              {activeSession && llmReadyNow && onResumeWorkbench && (
                <div className="mc-alert mc-alert-ok" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <strong>回答模型已就绪</strong>
                    <span style={{ marginLeft: 8, fontSize: 12 }}>可直接返回当前面试「{activeSession.name}」并重答原题。</span>
                  </div>
                  <button type="button" className="mc-btn mc-btn-sm mc-btn-success" onClick={() => void flushAndLeave(onResumeWorkbench)}>
                    返回当前面试 →
                  </button>
                </div>
              )}
              <section id="settings-section-text-llm" className={`mc-card${highlightedSection === 'text-llm' ? ' is-highlight-flash' : ''}`}>
                <div className="mc-card-head">
                  <div>
                    <h3 className="mc-card-title">文本大模型（回答模型）</h3>
                    <p className="mc-card-desc">任意 OpenAI 兼容接口（自定义 Base URL + 模型列表动态拉取）；配好这一项即可直接提问。</p>
                  </div>
                </div>
                <div className="mc-srow">
                  <div><div className="mc-srow-label">Base URL</div></div>
                  <div className="mc-srow-control">
                    <input className="mc-input" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} spellCheck={false} placeholder="https://your-api-host/v1" />
                  </div>
                </div>
                {renderKeySlotRow('文本模型 API Key', llmKey, 'llm', {
                  capability: 'text-llm',
                  providerId: 'custom',
                  baseUrl, model, slot: 'llm'
                })}
                <div className="mc-srow">
                  <div>
                    <div className="mc-srow-label">模型名称</div>
                    <div className="mc-srow-desc">可手动输入模型 ID，或点击「获取模型列表」从接口拉取后选择</div>
                  </div>
                  <div className="mc-srow-control">
                    <ModelPickerField
                      value={model}
                      onChange={setModel}
                      placeholder="例如：gpt-5.4 / deepseek-chat / claude-sonnet-4"
                      ariaLabel="文本模型名称"
                      baseUrl={baseUrl}
                      apiKey={sanitizeApiKeyInput(llmKey.value).value}
                      slot="llm"
                    />
                  </div>
                </div>
                <div className="mc-srow">
                  <div>
                    <div className="mc-srow-label">思考等级（可选）</div>
                    <div className="mc-srow-desc">仅非默认时向接口传标准 reasoning_effort（百炼自动映射 enable_thinking）；普通非思考模型请保持默认</div>
                  </div>
                  <div className="mc-srow-control">
                    <CustomSelect
                      className="mc-select"
                      ariaLabel="文本模型思考等级"
                      value={reasoningEffort}
                      onChange={setReasoningEffort}
                      options={REASONING_EFFORT_OPTIONS}
                    />
                  </div>
                </div>
                <div className="mc-srow mc-srow-compact">
                  <div><div className="mc-srow-label">默认回答语言</div></div>
                  <div className="mc-srow-control">
                    <CustomSelect
                      className="mc-select"
                      ariaLabel="默认回答语言"
                      value={answerLang}
                      onChange={setAnswerLang}
                      options={[
                        { value: 'chinese', label: '中文' },
                        { value: 'english', label: 'English' }
                      ]}
                    />
                  </div>
                </div>
              </section>

              {mmConfig && (
                <section id="settings-section-vision" className={`mc-card${highlightedSection === 'vision' ? ' is-highlight-flash' : ''}`}>
                  <div className="mc-card-head">
                    <div>
                      <h3 className="mc-card-title">截图多模态模型（多接口回退 / 笔试并行）</h3>
                      <p className="mc-card-desc">OpenAI 兼容图片接口；面试按序回退，笔试可多模型同时作答。</p>
                    </div>
                    <button
                      type="button"
                      className="mc-btn mc-btn-sm"
                      onClick={() => updateMm({
                        endpoints: [...mmConfig.endpoints, {
                          id: crypto.randomUUID(), name: '', enabled: true, baseUrl: '', model: '', reasoningEffort: 'default', proxyUrl: '', timeoutMs: 30000, apiKeySet: false
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
                      <CustomSelect
                        className="mc-select"
                        ariaLabel="默认截图场景"
                        value={mmConfig.mode}
                        onChange={val => updateMm({ mode: val })}
                        options={[
                          { value: 'auto', label: '自动判断' },
                          { value: 'interview', label: '面试截图' },
                          { value: 'written', label: '笔试截图' }
                        ]}
                      />
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
                              <label className="mc-field-label">接口备注名</label>
                              <input className="mc-input" value={ep.name || ''} placeholder={`接口 ${idx + 1}`} onChange={e => updateEndpoint(idx, { name: e.target.value })} />
                            </div>
                            <div className="mc-field">
                              <label className="mc-field-label">Base URL</label>
                              <input className="mc-input" value={ep.baseUrl || ''} spellCheck={false} placeholder="https://your-api-host/v1" onChange={e => updateEndpoint(idx, { baseUrl: e.target.value })} />
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
                          <div className="mc-field">
                            <label className="mc-field-label">视觉模型 ID</label>
                            <ModelPickerField
                              value={ep.model || ''}
                              onChange={val => updateEndpoint(idx, { model: val })}
                              placeholder="填写模型 ID，或点击右侧按钮拉取列表"
                              ariaLabel={`接口 ${idx + 1} 视觉模型 ID`}
                              baseUrl={ep.baseUrl}
                              apiKey={ep.apiKey}
                              slot="vision-endpoint"
                              endpointId={ep.id}
                              proxyUrl={ep.proxyUrl}
                              compact
                            />
                          </div>
                          <div className="mc-field">
                            <label className="mc-field-label">思考等级（可选）</label>
                            <CustomSelect
                              className="mc-select"
                              ariaLabel={`接口 ${idx + 1} 思考等级`}
                              value={ep.reasoningEffort || 'default'}
                              onChange={val => updateEndpoint(idx, { reasoningEffort: val })}
                              options={REASONING_EFFORT_OPTIONS}
                            />
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

            {/* 2. AUDIO & RECORDING */}
            <div hidden={activeTab !== 'audio'} style={{ display: activeTab === 'audio' ? 'flex' : 'none', flexDirection: 'column', gap: 20 }}>
              <section id="settings-section-asr" className={`mc-card${highlightedSection === 'asr' ? ' is-highlight-flash' : ''}`}>
                <div className="mc-card-head"><h3 className="mc-card-title">语音识别引擎（ASR）</h3></div>
                <div className="mc-srow">
                  <div><div className="mc-srow-label">识别引擎</div></div>
                  <div className="mc-srow-control">
                    <CustomSelect
                      className="mc-select"
                      ariaLabel="识别引擎"
                      value={asrBackend}
                      onChange={setAsrBackend}
                      options={[
                        { value: 'cloud-realtime', label: '云端流式实时（WebSocket · 低占用）' },
                        { value: 'cloud', label: '云端分段识别（HTTP）' },
                        { value: 'local-realtime', label: '本地流式（FunASR / MOSS Sidecar）' },
                        { value: 'local', label: '本地分段（Whisper ONNX）' }
                      ]}
                    />
                  </div>
                </div>

                {asrBackend === 'local-realtime' && (
                  <div className="mc-srow">
                    <div><div className="mc-srow-label">本地实时模型</div></div>
                    <div className="mc-srow-control">
                      <CustomSelect
                        className="mc-select"
                        ariaLabel="本地实时模型"
                        value={rtLocalModel}
                        onChange={setRtLocalModel}
                        options={LOCAL_REALTIME_MODELS.map(m => ({ value: m.value, label: m.nameZh || m.nameEn }))}
                      />
                    </div>
                  </div>
                )}

                {asrBackend === 'cloud-realtime' && (() => {
                  const rtProf = readRealtimeProfile(live, rtProvider);
                  const rtMeta = REALTIME_META[rtProvider] || REALTIME_META.dashscope;
                  const rtApiKeySet = Boolean(rtProf?.apiKeySet);
                  const rtHint = rtProf?.apiKeyHint;
                  const rtCandidate = sanitizeApiKeyInput(rtKey.value).value;
                  const isLocalWs = /^ws:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(rtBaseUrl.trim());
                  const missingResource = rtProvider === 'doubao' && !rtResourceId.trim();
                  const missingAppId = (rtProvider === 'tencent' || rtProvider === 'xfyun') && !rtAppId.trim();
                  const missingAppKey =
                    (rtProvider === 'doubao' && rtAuthMode === 'app-access' && !rtAppKey.trim()) ||
                    (rtProvider === 'tencent' && !rtAppKey.trim() && !isLocalWs);
                  const missingModel = (rtProvider === 'dashscope' || rtProvider === 'openai-realtime') && !rtModel.trim();
                  const missingKey = !rtKey.pendingDelete && !rtCandidate && !rtApiKeySet && !isLocalWs;
                  const canRunRtTest = Boolean(rtBaseUrl.trim()) && !rtKey.pendingDelete && !rtTestState.running;
                  const keyLabel = rtProvider === 'doubao'
                    ? (rtAuthMode === 'app-access' ? 'Access Token（X-Api-Access-Key）' : rtMeta.keyLabel)
                    : rtMeta.keyLabel;

                  return (
                    <>
                      <div className="mc-srow">
                        <div>
                          <div className="mc-srow-label">实时流式协议</div>
                          <div className="mc-srow-desc">选择底层 WebSocket 协议族，地址与模型可完全自定义；各协议配置与加密密钥分别独立保存，切换互不覆盖</div>
                        </div>
                        <div className="mc-srow-control">
                          <CustomSelect
                            className="mc-select"
                            ariaLabel="实时流式协议"
                            value={rtProvider}
                            onChange={handleSwitchRealtimeProvider}
                            options={REALTIME_PROTOCOL_OPTIONS}
                          />
                        </div>
                      </div>

                      <div className="mc-srow">
                        <div>
                          <div className="mc-srow-label">WebSocket 地址</div>
                          <div className="mc-srow-desc">{rtMeta.urlDesc}</div>
                        </div>
                        <div className="mc-srow-control">
                          <input
                            className="mc-input"
                            aria-label="实时 ASR WebSocket 地址"
                            value={rtBaseUrl}
                            onChange={e => setRtBaseUrl(e.target.value)}
                            spellCheck={false}
                            placeholder={rtMeta.urlPlaceholder}
                          />
                        </div>
                      </div>

                      {rtProvider === 'doubao' && (
                        <>
                          <div className="mc-srow">
                            <div>
                              <div className="mc-srow-label">Resource ID（X-Api-Resource-Id）</div>
                              <div className="mc-srow-desc">
                                必填：豆包 2.0 小时版填 <code>volc.seedasr.sauc.duration</code>；1.0 小时版填 <code>volc.bigasr.sauc.duration</code>
                              </div>
                            </div>
                            <div className="mc-srow-control">
                              <input
                                className="mc-input"
                                aria-label="豆包 Resource ID"
                                value={rtResourceId}
                                onChange={e => setRtResourceId(e.target.value)}
                                spellCheck={false}
                                placeholder="volc.seedasr.sauc.duration"
                              />
                              {missingResource && (
                                <div className="mc-field-hint" style={{ color: 'var(--danger)' }}>
                                  必须填写 Resource ID（例如 volc.seedasr.sauc.duration），否则服务端会拒绝连接
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mc-srow">
                            <div>
                              <div className="mc-srow-label">鉴权方式</div>
                              <div className="mc-srow-desc">新版豆包控制台仅需单 API Key；旧版语音控制台需填 App ID + Access Token</div>
                            </div>
                            <div className="mc-srow-control">
                              <CustomSelect
                                className="mc-select"
                                ariaLabel="豆包鉴权方式"
                                value={rtAuthMode}
                                onChange={setRtAuthMode}
                                options={DOUBAO_AUTH_MODE_OPTIONS}
                              />
                            </div>
                          </div>

                          {rtAuthMode === 'app-access' && (
                            <div className="mc-srow">
                              <div>
                                <div className="mc-srow-label">App ID（X-Api-App-Key）</div>
                                <div className="mc-srow-desc">旧版控制台应用 ID，与下方 Access Token 配套使用</div>
                              </div>
                              <div className="mc-srow-control">
                                <input
                                  className="mc-input"
                                  aria-label="豆包 App ID"
                                  value={rtAppKey}
                                  onChange={e => setRtAppKey(e.target.value)}
                                  spellCheck={false}
                                  placeholder="填写火山控制台 App ID"
                                />
                                {missingAppKey && (
                                  <div className="mc-field-hint" style={{ color: 'var(--danger)' }}>
                                    旧版鉴权模式必须填写 App ID（X-Api-App-Key）
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {rtProvider === 'tencent' && (
                        <>
                          <div className="mc-srow">
                            <div>
                              <div className="mc-srow-label">腾讯云 AppID</div>
                              <div className="mc-srow-desc">在腾讯云控制台「账号信息」中查看的数字 AppID，用于拼接 /asr/v2/{'{AppID}'}</div>
                            </div>
                            <div className="mc-srow-control">
                              <input
                                className="mc-input"
                                aria-label="腾讯云 AppID"
                                value={rtAppId}
                                onChange={e => setRtAppId(e.target.value)}
                                spellCheck={false}
                                placeholder="例如：1300000000"
                              />
                              {missingAppId && (
                                <div className="mc-field-hint" style={{ color: 'var(--danger)' }}>请填写腾讯云数字 AppID</div>
                              )}
                            </div>
                          </div>
                          <div className="mc-srow">
                            <div>
                              <div className="mc-srow-label">腾讯云 SecretId</div>
                              <div className="mc-srow-desc">在「访问管理 → API 密钥管理」获取，与下方 SecretKey 共同参与签名</div>
                            </div>
                            <div className="mc-srow-control">
                              <input
                                className="mc-input"
                                aria-label="腾讯云 SecretId"
                                value={rtAppKey}
                                onChange={e => setRtAppKey(e.target.value)}
                                spellCheck={false}
                                placeholder="AKID..."
                              />
                              {missingAppKey && (
                                <div className="mc-field-hint" style={{ color: 'var(--danger)' }}>请填写腾讯云 SecretId</div>
                              )}
                            </div>
                          </div>
                        </>
                      )}

                      {rtProvider === 'xfyun' && (
                        <div className="mc-srow">
                          <div>
                            <div className="mc-srow-label">科大讯飞 AppID</div>
                            <div className="mc-srow-desc">在讯飞开放平台「实时语音转写（RTASR）」应用详情页复制 AppID</div>
                          </div>
                          <div className="mc-srow-control">
                            <input
                              className="mc-input"
                              aria-label="科大讯飞 AppID"
                              value={rtAppId}
                              onChange={e => setRtAppId(e.target.value)}
                              spellCheck={false}
                              placeholder="填写讯飞应用 AppID"
                            />
                            {missingAppId && (
                              <div className="mc-field-hint" style={{ color: 'var(--danger)' }}>请填写科大讯飞 AppID</div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="mc-srow">
                        <div>
                          <div className="mc-srow-label">{rtMeta.modelLabel}</div>
                          <div className="mc-srow-desc">{rtMeta.modelDesc}</div>
                        </div>
                        <div className="mc-srow-control">
                          <input
                            className="mc-input"
                            aria-label={rtMeta.modelLabel}
                            value={rtModel}
                            onChange={e => setRtModel(e.target.value)}
                            spellCheck={false}
                            placeholder={rtMeta.modelPlaceholder}
                          />
                          {missingModel && (
                            <div className="mc-field-hint" style={{ color: 'var(--danger)' }}>请填写当前实时协议的模型名</div>
                          )}
                        </div>
                      </div>

                      <div className="mc-srow">
                        <div>
                          <div className="mc-srow-label">{keyLabel}</div>
                          <div className="mc-srow-desc">
                            {rtApiKeySet && !rtKey.editing && !rtKey.pendingDelete
                              ? `已按「${rtMeta.shortName}」独立加密保存${rtHint ? `（尾号 ••••${rtHint}）` : ''}；切换协议互不覆盖`
                              : '仅加密保存于本机，自动清理首尾空格'}
                          </div>
                        </div>
                        <div className="mc-srow-control">
                          {rtApiKeySet && !rtKey.editing && !rtKey.pendingDelete ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                              <span className="mc-badge mc-badge-ok">已配置</span>
                              <button type="button" className="mc-btn mc-btn-sm" onClick={() => rtKey.setEditing(true)}>更换</button>
                              {rtKey.confirming ? (
                                <>
                                  <button type="button" className="mc-btn mc-btn-sm mc-btn-danger" onClick={() => { rtKey.setPendingDelete(true); rtKey.setConfirming(false); }}>确认清除</button>
                                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => rtKey.setConfirming(false)}>取消</button>
                                </>
                              ) : (
                                <button type="button" className="mc-btn mc-btn-sm" onClick={() => rtKey.setConfirming(true)}>清除</button>
                              )}
                            </div>
                          ) : rtKey.pendingDelete ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span className="mc-badge mc-badge-err">待清除</span>
                              <button type="button" className="mc-btn mc-btn-sm" onClick={rtKey.reset}>撤销</button>
                            </div>
                          ) : (
                            <input
                              className="mc-input"
                              aria-label={keyLabel}
                              type="password"
                              autoComplete="off"
                              spellCheck={false}
                              value={rtKey.value}
                              onChange={e => rtKey.setValue(e.target.value)}
                              placeholder={rtApiKeySet ? '输入新密钥以替换，留空保留原密钥' : rtMeta.keyPlaceholder}
                            />
                          )}

                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                            <button
                              type="button"
                              className="mc-btn mc-btn-sm"
                              disabled={!canRunRtTest}
                              onClick={() => void runRealtimeCheck('handshake')}
                            >
                              {rtTestState.running === 'handshake' ? '握手中…' : '测试连接（握手）'}
                            </button>
                            <button
                              type="button"
                              className="mc-btn mc-btn-sm mc-btn-primary"
                              disabled={!canRunRtTest}
                              title="通过当前实时适配器发送内置 16kHz 样本音频，验证建连、分包与真实转写结果"
                              onClick={() => void runRealtimeCheck('transcribe')}
                            >
                              {rtTestState.running === 'transcribe' ? '试转写中…' : '试转写（发送样本音频）'}
                            </button>
                            {rtProf?.verification?.lastTestAt && (
                              <span className="mc-field-hint">
                                上次：{rtProf.verification.lastTestOk ? `成功 (${rtProf.verification.latencyMs ?? '?'}ms)` : `失败 (${rtProf.verification.lastTestCode || 'ERR'})`}
                              </span>
                            )}
                          </div>

                          {missingKey && !rtTestState.result && (
                            <div className="mc-field-hint">提示：尚未填写或保存当前协议的密钥，点测试将返回本地缺失提示。</div>
                          )}

                          {rtTestState.error && (
                            <div className="mc-alert mc-alert-err" role="alert">{rtTestState.error}</div>
                          )}

                          {rtTestState.result && (
                            <div
                              className={`mc-alert ${rtTestState.result.ok ? 'mc-alert-ok' : 'mc-alert-err'}`}
                              role="status"
                              style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px' }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <strong>
                                  {rtTestState.result.messageZh}
                                  {typeof rtTestState.result.latencyMs === 'number' ? ` · ${rtTestState.result.latencyMs} ms` : ''}
                                </strong>
                                {!rtTestState.result.ok && (
                                  <button
                                    type="button"
                                    className="mc-link-subtle"
                                    style={{ fontSize: 11.5, flexShrink: 0 }}
                                    onClick={() => setRtTestState(prev => ({ ...prev, showDetail: !prev.showDetail }))}
                                  >
                                    {rtTestState.showDetail ? '收起诊断' : '展开诊断'}
                                  </button>
                                )}
                              </div>
                              {rtTestState.result.hintZh && (
                                <div style={{ fontSize: 12, opacity: 0.92 }}>{rtTestState.result.hintZh}</div>
                              )}
                              {!rtTestState.result.ok && rtTestState.showDetail && (
                                <div style={{ fontSize: 11.5, opacity: 0.88, marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                                  阶段：{STAGE_LABELS[rtTestState.result.stage] || rtTestState.result.stage} · 错误类型：{rtTestState.result.code}
                                  {rtTestState.result.connected ? ' · 握手已成功' : ' · 未完成握手'}
                                  {rtTestState.result.rawCode ? ` · 原始码：${rtTestState.result.rawCode}` : ''}
                                  {rtTestState.result.requestId ? ` · 请求 ID：${rtTestState.result.requestId}` : ''}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}

                {asrBackend === 'cloud' && (() => {
                  const cloudPub = live?.asr?.cloud || {};
                  const cloudApiKeySet = Boolean(cloudPub.apiKeySet);
                  const cloudHint = cloudPub.apiKeyHint;
                  const cloudCandidate = sanitizeApiKeyInput(cloudKey.value).value;
                  const isLocalHttp = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(cloudBaseUrl.trim());
                  const canTestCloud = Boolean(cloudBaseUrl.trim() && cloudModel.trim()) && !cloudKey.pendingDelete && !cloudTestState.running;

                  return (
                    <>
                      <div className="mc-srow">
                        <div>
                          <div className="mc-srow-label">HTTP 请求协议</div>
                          <div className="mc-srow-desc">推荐标准 /audio/transcriptions（兼容硅基流动 SenseVoice、智谱 GLM-ASR、Groq、OpenAI、One-API 及本地 Whisper 服务）</div>
                        </div>
                        <div className="mc-srow-control">
                          <CustomSelect
                            className="mc-select"
                            ariaLabel="云端分段 HTTP 协议"
                            value={cloudProtocol}
                            onChange={(v) => { setCloudProtocol(v); setCloudTestState({ running: false, result: null, error: '', showDetail: false }); }}
                            options={SEGMENT_PROTOCOL_OPTIONS}
                          />
                        </div>
                      </div>

                      <div className="mc-srow">
                        <div>
                          <div className="mc-srow-label">云端分段 Base URL</div>
                          <div className="mc-srow-desc">
                            {cloudProtocol === 'chat-audio'
                              ? '将请求 {Base URL}/chat/completions（传入 Base64 WAV input_audio）'
                              : '将请求 {Base URL}/audio/transcriptions（multipart 上传 16kHz WAV），如 https://api.siliconflow.cn/v1'}
                          </div>
                        </div>
                        <div className="mc-srow-control">
                          <input
                            className="mc-input"
                            aria-label="云端分段 Base URL"
                            value={cloudBaseUrl}
                            onChange={e => setCloudBaseUrl(e.target.value)}
                            spellCheck={false}
                            placeholder="https://api.siliconflow.cn/v1 或 https://api.groq.com/openai/v1"
                          />
                        </div>
                      </div>

                      <div className="mc-srow">
                        <div>
                          <div className="mc-srow-label">云端分段模型名</div>
                          <div className="mc-srow-desc">可手动输入模型 ID，或点击右侧按钮拉取该接口模型列表</div>
                        </div>
                        <div className="mc-srow-control">
                          <ModelPickerField
                            value={cloudModel}
                            onChange={setCloudModel}
                            placeholder={cloudProtocol === 'chat-audio'
                              ? '例如：gpt-4o-audio-preview / qwen-audio-turbo'
                              : '例如：FunAudioLLM/SenseVoiceSmall / glm-asr-2512 / whisper-large-v3-turbo'}
                            ariaLabel="云端分段模型名"
                            baseUrl={cloudBaseUrl}
                            apiKey={cloudCandidate}
                            slot="asr-cloud"
                            compact
                          />
                        </div>
                      </div>

                      <div className="mc-srow">
                        <div>
                          <div className="mc-srow-label">云端分段 ASR API Key</div>
                          <div className="mc-srow-desc">
                            {cloudApiKeySet && !cloudKey.editing && !cloudKey.pendingDelete
                              ? `已安全加密保存${cloudHint ? `（尾号 ••••${cloudHint}）` : ''}；不编辑时不会覆盖`
                              : '仅保存在本机，本地 http://127.0.0.1 服务可留空'}
                          </div>
                        </div>
                        <div className="mc-srow-control">
                          {cloudApiKeySet && !cloudKey.editing && !cloudKey.pendingDelete ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                              <span className="mc-badge mc-badge-ok">已配置</span>
                              <button type="button" className="mc-btn mc-btn-sm" onClick={() => cloudKey.setEditing(true)}>更换</button>
                              {cloudKey.confirming ? (
                                <>
                                  <button type="button" className="mc-btn mc-btn-sm mc-btn-danger" onClick={() => { cloudKey.setPendingDelete(true); cloudKey.setConfirming(false); }}>确认清除</button>
                                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => cloudKey.setConfirming(false)}>取消</button>
                                </>
                              ) : (
                                <button type="button" className="mc-btn mc-btn-sm" onClick={() => cloudKey.setConfirming(true)}>清除</button>
                              )}
                            </div>
                          ) : cloudKey.pendingDelete ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span className="mc-badge mc-badge-err">待清除</span>
                              <button type="button" className="mc-btn mc-btn-sm" onClick={cloudKey.reset}>撤销</button>
                            </div>
                          ) : (
                            <input
                              className="mc-input"
                              aria-label="云端分段 ASR API Key"
                              type="password"
                              autoComplete="off"
                              spellCheck={false}
                              value={cloudKey.value}
                              onChange={e => cloudKey.setValue(e.target.value)}
                              placeholder={cloudApiKeySet ? '输入新密钥以替换，留空保留原密钥' : (isLocalHttp ? '本地服务可留空' : 'sk-...')}
                            />
                          )}

                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                            <button
                              type="button"
                              className="mc-btn mc-btn-sm mc-btn-primary"
                              disabled={!canTestCloud}
                              title="向当前 HTTP 分段接口上传内置 16kHz 样本 WAV，验证鉴权、协议与真实识别文本"
                              onClick={() => void runSegmentTranscribe()}
                            >
                              {cloudTestState.running ? '试转写中…' : '试转写（发送样本音频）'}
                            </button>
                            {cloudPub?.verification?.lastTestAt && (
                              <span className="mc-field-hint">
                                上次：{cloudPub.verification.lastTestOk ? `成功 (${cloudPub.verification.latencyMs ?? '?'}ms)` : `失败 (${cloudPub.verification.lastTestCode || 'ERR'})`}
                              </span>
                            )}
                          </div>

                          {cloudTestState.error && (
                            <div className="mc-alert mc-alert-err" role="alert">{cloudTestState.error}</div>
                          )}

                          {cloudTestState.result && (
                            <div
                              className={`mc-alert ${cloudTestState.result.ok ? 'mc-alert-ok' : 'mc-alert-err'}`}
                              role="status"
                              style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px' }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <strong>
                                  {cloudTestState.result.messageZh}
                                  {typeof cloudTestState.result.latencyMs === 'number' ? ` · ${cloudTestState.result.latencyMs} ms` : ''}
                                </strong>
                                {!cloudTestState.result.ok && (
                                  <button
                                    type="button"
                                    className="mc-link-subtle"
                                    style={{ fontSize: 11.5, flexShrink: 0 }}
                                    onClick={() => setCloudTestState(prev => ({ ...prev, showDetail: !prev.showDetail }))}
                                  >
                                    {cloudTestState.showDetail ? '收起诊断' : '展开诊断'}
                                  </button>
                                )}
                              </div>
                              {cloudTestState.result.hintZh && (
                                <div style={{ fontSize: 12, opacity: 0.92 }}>{cloudTestState.result.hintZh}</div>
                              )}
                              {!cloudTestState.result.ok && cloudTestState.showDetail && (
                                <div style={{ fontSize: 11.5, opacity: 0.88, marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                                  阶段：{STAGE_LABELS[cloudTestState.result.stage] || cloudTestState.result.stage} · 错误类型：{cloudTestState.result.code}
                                  {cloudTestState.result.rawCode ? ` · 原始码：${cloudTestState.result.rawCode}` : ''}
                                  {cloudTestState.result.requestId ? ` · 请求 ID：${cloudTestState.result.requestId}` : ''}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}

                <div className="mc-srow mc-srow-compact">
                  <div><div className="mc-srow-label">识别语言偏好</div></div>
                  <div className="mc-srow-control">
                    <CustomSelect
                      className="mc-select"
                      ariaLabel="识别语言偏好"
                      value={language}
                      onChange={setLanguage}
                      options={[
                        { value: 'auto', label: '自动检测（中/英）' },
                        { value: 'chinese', label: '中文为主' },
                        { value: 'english', label: 'English' }
                      ]}
                    />
                  </div>
                </div>

                <div className="mc-srow">
                  <div>
                    <div className="mc-srow-label">断句响应速度与智能修订</div>
                    <div className="mc-srow-desc">同步调节豆包 end_window_size / 百炼 max_sentence_silence 与前端话轮缓冲；若刚抢答后 3.5 秒内面试官继续补充，自动合并到同一题重答</div>
                  </div>
                  <div className="mc-srow-control">
                    <CustomSelect
                      className="mc-select"
                      ariaLabel="断句响应速度"
                      value={segmentationMode}
                      onChange={setSegmentationMode}
                      options={SEGMENTATION_MODE_OPTIONS}
                    />
                  </div>
                </div>

                <div className="mc-srow mc-srow-compact">
                  <div>
                    <div className="mc-srow-label">外放双轨回声过滤（推荐开启）</div>
                    <div className="mc-srow-desc">电脑外放开会时自动压制并去重串入本人麦克风的面试官声音，不影响正常说话且不增加系统音频延迟</div>
                  </div>
                  <div className="mc-srow-control is-inline">
                    <Switch checked={echoGuard} onChange={setEchoGuard} aria-label="外放双轨回声过滤" />
                  </div>
                </div>
              </section>

              <section className="mc-card">
                <div className="mc-card-head">
                  <div><h3 className="mc-card-title">音频输入与麦克风实时检测</h3></div>
                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => void listMics().then(setDevices).catch(() => {})}>刷新设备</button>
                </div>
                <div className="mc-srow">
                  <div>
                    <div className="mc-srow-label">麦克风设备</div>
                    <div className="mc-srow-desc">用于「麦克风模式」主收音及「双轨录音」下的本人轨采集</div>
                  </div>
                  <div className="mc-srow-control">
                    <CustomSelect
                      className="mc-select"
                      ariaLabel="麦克风设备"
                      value={micDeviceId}
                      onChange={setMicDeviceId}
                      options={[
                        { value: '', label: '系统默认麦克风' },
                        ...devices.map(d => ({ value: d.deviceId, label: d.label || d.deviceId }))
                      ]}
                    />
                  </div>
                </div>
                <div className="mc-srow">
                  <div>
                    <div className="mc-srow-label">实时电平检测</div>
                    <div className="mc-srow-desc">对着麦克风讲话，确认输入电平随声音波动</div>
                  </div>
                  <div className="mc-srow-control">
                    <MicLevelTester deviceId={micDeviceId} />
                  </div>
                </div>
                {window.mc.platform === 'darwin' && (
                  <div className="mc-srow">
                    <div><div className="mc-srow-label">对方虚拟音频设备（BlackHole 等）</div></div>
                    <div className="mc-srow-control">
                      <CustomSelect
                        className="mc-select"
                        ariaLabel="对方虚拟音频设备"
                        value={themDeviceId}
                        onChange={setThemDeviceId}
                        options={[
                          { value: '', label: '系统默认输入' },
                          ...devices.map(d => ({ value: d.deviceId, label: d.label || d.deviceId }))
                        ]}
                      />
                    </div>
                  </div>
                )}
              </section>

              <section className="mc-card">
                <div className="mc-card-head">
                  <div>
                    <h3 className="mc-card-title">整场双轨 WAV 录音</h3>
                    <p className="mc-card-desc">默认手动在工作台顶栏点击开启；独立录制对方轨与本人轨（16kHz PCM WAV），防崩溃损坏且不写入知识库目录。</p>
                  </div>
                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => void window.mc.openRecordingFolder?.()}>
                    <IconFolder size={13} /> 打开录音目录
                  </button>
                </div>
                <div className="mc-srow">
                  <div>
                    <div className="mc-srow-label">录音存储路径</div>
                    <div className="mc-srow-desc" style={{ wordBreak: 'break-all' }}>
                      当前：{workbenchPrefs?.recordingDir || recDirInfo || '默认应用数据目录/recordings'}
                    </div>
                  </div>
                  <div className="mc-srow-control is-inline" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="mc-btn mc-btn-sm"
                      onClick={async () => {
                        const picked = await window.mc.pickRecordingDir?.();
                        if (picked) void onUpdateWorkbenchPrefs({ recordingDir: picked });
                      }}
                    >
                      更改目录
                    </button>
                    {workbenchPrefs?.recordingDir && (
                      <button type="button" className="mc-btn mc-btn-sm mc-btn-ghost" onClick={() => void onUpdateWorkbenchPrefs({ recordingDir: '' })}>
                        恢复默认
                      </button>
                    )}
                  </div>
                </div>
              </section>
            </div>

            {/* 3. CAMERA & EYE CONTACT */}
            <div hidden={activeTab !== 'camera'} style={{ display: activeTab === 'camera' ? 'flex' : 'none', flexDirection: 'column', gap: 20 }}>
              <EyeContactSettings active={activeTab === 'camera'} />
            </div>

            {/* 4. SECURITY MODE */}
            <div hidden={activeTab !== 'security'} style={{ display: activeTab === 'security' ? 'flex' : 'none', flexDirection: 'column', gap: 20 }}>
              <section className="mc-card">
                <div className="mc-card-head">
                  <div>
                    <h3 className="mc-card-title">安全模式（防截屏 + 不抢焦点）</h3>
                    <p className="mc-card-desc">开启后强制禁止窗口出现在系统截屏/共享屏幕中，并在进入工作台时自动屏蔽焦点抢占。</p>
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
                    <div className="mc-srow-desc">每次打开 CueDesk 自动进入隐身保护状态</div>
                  </div>
                  <div className="mc-srow-control is-inline">
                    <Switch
                      checked={Boolean(workbenchPrefs?.securityMode?.autoEnableOnLaunch)}
                      onChange={(next) => onSetSecurityPrefs({ autoEnableOnLaunch: next })}
                    />
                  </div>
                </div>
                <div className="mc-srow mc-srow-compact">
                  <div>
                    <div className="mc-srow-label">隐藏真实鼠标（启用浮窗内虚拟光标）</div>
                    <div className="mc-srow-desc">开启安全模式时，工作台内隐藏系统光标并在防截屏保护层内渲染替代 SVG 光标</div>
                  </div>
                  <div className="mc-srow-control is-inline">
                    <Switch
                      checked={workbenchPrefs?.securityMode?.hideCursor !== false}
                      onChange={(next) => onSetSecurityPrefs({ hideCursor: next })}
                    />
                  </div>
                </div>
                <div className="mc-card-body" style={{ borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button type="button" className="mc-btn mc-btn-sm" disabled={envChecking} onClick={() => void runEnvCheck()}>
                      <IconShield size={13} /> {envChecking ? '正在检测…' : '检测本机防截屏与录屏软件'}
                    </button>
                    <span className="mc-field-hint">只读本地检查，不改变当前保护状态</span>
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
            </div>

            {/* 5. SHORTCUTS */}
            <div hidden={activeTab !== 'shortcuts'} style={{ display: activeTab === 'shortcuts' ? 'flex' : 'none', flexDirection: 'column', gap: 20 }}>
              <section id="settings-section-shortcuts" className="mc-card">
                <div className="mc-card-head">
                  <div>
                    <h3 className="mc-card-title">核心全局快捷键</h3>
                    <p className="mc-card-desc">点击按钮直接按下按键组合、F1–F24 或鼠标侧键（Mouse4 / Mouse5）完成绑定。</p>
                  </div>
                  <button type="button" className="mc-btn mc-btn-sm" onClick={() => setWbShortcutsOpen(true)}>
                    <IconKeyboard size={13} /> 配置会中工作台快捷键
                  </button>
                </div>
                <ShortcutRecorder
                  rowId="settings-section-hotkeyToggle"
                  highlighted={highlightedSection === 'hotkeyToggle'}
                  label="隐藏 / 显示主窗口"
                  description="在任意应用中一键切换窗口显示状态"
                  value={hotkey}
                  onChange={setHotkey}
                />
                <ShortcutRecorder
                  rowId="settings-section-hotkeyShot"
                  highlighted={highlightedSection === 'hotkeyShot'}
                  label="静默全屏截图识题"
                  description="支持组合键、F1–F24 或鼠标侧键 Mouse4 / Mouse5"
                  value={hotkeyShot}
                  onChange={setHotkeyShot}
                />
                <ShortcutRecorder
                  rowId="settings-section-hotkeyRegion"
                  highlighted={highlightedSection === 'hotkeyRegion'}
                  label="框选区域截图识题"
                  description="拖动选取屏幕局部区域并发送到视觉模型"
                  value={hotkeyRegion}
                  onChange={setHotkeyRegion}
                />
              </section>

              <WindowControlsCard />
            </div>

            {/* 6. GENERAL PREFERENCES */}
            <div hidden={activeTab !== 'general'} style={{ display: activeTab === 'general' ? 'flex' : 'none', flexDirection: 'column', gap: 20 }}>
              <section className="mc-card">
                <div className="mc-card-head"><h3 className="mc-card-title">外观与阅读体验</h3></div>
                <div className="mc-srow mc-srow-compact">
                  <div>
                    <div className="mc-srow-label">主题外观</div>
                    <div className="mc-srow-desc">默认浅色主题，支持暗色或跟随系统切换</div>
                  </div>
                  <div className="mc-srow-control">
                    <CustomSelect
                      className="mc-select"
                      ariaLabel="主题外观"
                      value={theme}
                      onChange={setTheme}
                      options={[
                        { value: 'light', label: '浅色（默认）' },
                        { value: 'dark', label: '深色' },
                        { value: 'system', label: '跟随系统' }
                      ]}
                    />
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
                    <CustomSelect
                      className="mc-select"
                      ariaLabel="界面缩放字号"
                      value={fontScale}
                      onChange={setFontScale}
                      options={[
                        { value: 'small', label: '紧凑' },
                        { value: 'medium', label: '标准' },
                        { value: 'large', label: '大号' }
                      ]}
                    />
                  </div>
                </div>
                <div className="mc-srow">
                  <div>
                    <div className="mc-srow-label">界面语言</div>
                    <div className="mc-srow-desc">
                      当前版本界面仅提供简体中文。回答语言（支持英文）与语音识别语言可在各自设置中独立配置：
                      <button type="button" className="mc-link-subtle" style={{ padding: '0 4px' }} onClick={() => setActiveTab('models')}>默认回答语言</button>
                      ·
                      <button type="button" className="mc-link-subtle" style={{ padding: '0 4px' }} onClick={() => setActiveTab('audio')}>识别语言偏好</button>
                    </div>
                  </div>
                  <div className="mc-srow-control is-inline">
                    <span className="mc-badge">简体中文</span>
                  </div>
                </div>
                <div className="mc-srow mc-srow-compact">
                  <div><div className="mc-srow-label">结束面试时默认自动保存记录</div></div>
                  <div className="mc-srow-control is-inline">
                    <Switch
                      checked={workbenchPrefs?.autoSaveOnClose !== false}
                      onChange={v => void onUpdateWorkbenchPrefs({ autoSaveOnClose: v })}
                    />
                  </div>
                </div>
                <div className="mc-srow mc-srow-compact">
                  <div><div className="mc-srow-label">开机自动启动</div></div>
                  <div className="mc-srow-control is-inline">
                    <Switch checked={autoLaunch} onChange={setAutoLaunch} />
                  </div>
                </div>
              </section>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '0 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {onOpenQuickStart && (
                    <button type="button" className="mc-link-subtle" onClick={onOpenQuickStart}>
                      重播快速配置引导
                    </button>
                  )}
                  {onOpenDiagnostics && (
                    <button type="button" className="mc-link-subtle" onClick={onOpenDiagnostics}>
                      故障排查与诊断信息
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="mc-link-subtle"
                  onClick={() => void window.mc.openLogsFolder()}
                >
                  打开本地数据目录
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {wbShortcutsOpen && (
        <WorkbenchShortcutsModal
          settings={live}
          windowState={windowState}
          onSettingsUpdated={(next) => { setLive(next); onSaved?.(next); }}
          onClose={() => setWbShortcutsOpen(false)}
        />
      )}
    </div>
  );
}
