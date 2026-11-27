import React, { useEffect, useState } from 'react';
import {
  IconArrowRight,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconPlay,
  IconSettings
} from './Icons.jsx';
import { computeServiceHealth } from './SharedWidgets.jsx';

const STEPS = [
  {
    id: 'asr',
    num: 1,
    title: '连接语音转写',
    subtitle: '推荐：火山豆包实时语音',
    capability: 'asr',
    settingsBtn: '前往配置语音转写',
    summary: '把面试官的问题实时转成文字。推荐豆包流式 ASR，延迟低、配置简单，只需填 1 个 API Key。',
    fields: [
      { label: '识别引擎', value: '云端流式实时（WebSocket）' },
      { label: '实时协议', value: '火山豆包流式 ASR v3' },
      { label: 'WebSocket 地址', value: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel（默认已填）' },
      { label: 'Resource ID', value: 'volc.seedasr.sauc.duration（豆包 2.0 小时版）' },
      { label: 'API Key', value: '在火山引擎语音控制台创建并复制，填入即可' }
    ],
    links: [
      { label: '火山引擎 · 豆包语音控制台（推荐）', url: 'https://console.volcengine.com/speech/app' },
      { label: '备选：阿里云百炼控制台（DashScope）', url: 'https://bailian.console.aliyun.com/' }
    ],
    verify: '填好后点「试转写（发送样本音频）」，出现绿色“连接成功”并识别出中文样本即完成。',
    troubleshoot: '若报鉴权或资源错误，检查控制台是否已开通流式语音服务及 Resource ID 是否匹配，修改都在「高级设置 → 语音与录制」。'
  },
  {
    id: 'llm',
    num: 2,
    title: '配置面试问答',
    subtitle: '推荐：DeepSeek',
    capability: 'text-llm',
    settingsBtn: '前往配置回答模型',
    summary: '负责根据问题与本地资料库实时生成回答。推荐 DeepSeek（性价比高、首字快），也兼容任意 OpenAI 接口。',
    fields: [
      { label: 'Base URL', value: 'https://api.deepseek.com/v1' },
      { label: 'API Key', value: '在 DeepSeek 开放平台新建并复制' },
      { label: '模型名称', value: 'deepseek-chat（也可点「获取模型列表」直接勾选）' }
    ],
    links: [
      { label: 'DeepSeek 开放平台 · API Keys（推荐）', url: 'https://platform.deepseek.com/api_keys' },
      { label: '备选：火山方舟控制台（豆包大模型）', url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' }
    ],
    verify: '填完点「测试连接」，显示绿色“连接成功 · xxx ms”即表示可正常回答。',
    troubleshoot: '若提示 Key 无效或余额不足，到对应平台确认 Key 与余额后，回到「高级设置 → 模型接口 → 文本大模型」更换。'
  },
  {
    id: 'vision',
    num: 3,
    title: '配置截图识题',
    subtitle: '面试截屏 / 笔试助手（可选）',
    capability: 'vision',
    settingsBtn: '前往配置截图接口',
    summary: '用于截取聊天框题目、算法题或笔试页面直接识别作答。支持任意 OpenAI 兼容视觉模型。',
    fields: [
      {
        label: '复用说明',
        value: '如果你填的是支持视觉的聚合/多模态平台（如火山方舟、百炼、OpenRouter、GPT-4o / Gemini 中转站），可直接复用同平台 Base URL 与 Key；若第 2 步填的是 DeepSeek 官方纯文本接口（deepseek-chat 暂不支持图片），只需在此单独补配一个视觉接口。'
      },
      { label: 'Base URL', value: '例如火山方舟 https://ark.cn-beijing.volces.com/api/v3 或百炼兼容地址' },
      { label: '视觉模型 ID', value: '点击「获取模型列表」选择带视觉能力的模型（如豆包视觉、Qwen-VL、Gemini / GPT-4o）' },
      { label: '启用开关', value: '打开「启用截图问答」并保持主接口为开启状态' }
    ],
    links: [
      { label: '火山方舟 · 豆包视觉 API Key（推荐）', url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' },
      { label: '阿里云百炼 · Qwen-VL API Key', url: 'https://bailian.console.aliyun.com/?tab=model#/api-key' },
      { label: 'DeepSeek 开放平台', url: 'https://platform.deepseek.com/api_keys' }
    ],
    verify: '开启后回到首页「笔试助手」，点击「框选截图识题」试截任意文字或题目，能正常返回解析即通过。',
    troubleshoot: '若提示不支持图片或连接失败，在错误卡片点「配置截图模型」回到「高级设置 → 模型接口 → 截图多模态模型」核对模型是否支持视觉。'
  }
];

export function GuideView({
  initialStep = 'asr',
  settings,
  asr,
  library,
  onNavigateCapability,
  onBackHome
}) {
  const health = computeServiceHealth(settings, asr, library);
  const visionReady = Boolean(
    settings?.multimodal?.enabled &&
    (settings?.multimodal?.endpoints || []).some(e => e.enabled && e.baseUrl && e.model)
  );
  const doneMap = {
    asr: Boolean(health.asr.ready),
    llm: Boolean(health.llm.ready),
    vision: visionReady
  };
  const completedCount = Object.values(doneMap).filter(Boolean).length;

  const [activeStepId, setActiveStepId] = useState(
    STEPS.some(s => s.id === initialStep) ? initialStep : 'asr'
  );
  const [copiedUrl, setCopiedUrl] = useState('');

  useEffect(() => {
    if (initialStep && STEPS.some(s => s.id === initialStep)) {
      setActiveStepId(initialStep);
    }
  }, [initialStep]);

  const activeIdx = Math.max(0, STEPS.findIndex(s => s.id === activeStepId));
  const step = STEPS[activeIdx];
  const nextStep = STEPS[activeIdx + 1] || null;

  const openUrl = async (url) => {
    try {
      if (window.mc?.openExternalUrl) {
        await window.mc.openExternalUrl(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      try { await navigator.clipboard.writeText(url); } catch {}
    }
  };

  const copyUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(prev => (prev === url ? '' : prev)), 1600);
    } catch {}
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <header className="mc-page-header" style={{ borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 className="mc-page-title">使用教程</h1>
          <span className={`mc-badge ${completedCount === 3 ? 'mc-badge-ok' : 'mc-badge-info'}`}>
            已完成 {completedCount} / 3 步
          </span>
        </div>
        <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={onBackHome}>
          <IconPlay size={11} /> {doneMap.llm ? '回到首页开始使用' : '返回首页'}
        </button>
      </header>

      <div className="mc-page-scroll">
        <div className="mc-page-inner" style={{ maxWidth: 820, gap: 14 }}>
          <div className="mc-alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5 }}>
              <strong>推荐新手默认组合：</strong>火山豆包实时语音 + DeepSeek 面试问答（可选配视觉接口用于截屏识题）。随时可回来重看。
            </span>
            {doneMap.asr && doneMap.llm && (
              <span className="mc-badge mc-badge-ok">核心面试配置已就绪</span>
            )}
          </div>

          {/* 3-step progressive stepper */}
          <div className="mc-guide-stepper" role="tablist" aria-label="渐进式配置步骤">
            {STEPS.map(item => {
              const isDone = doneMap[item.id];
              const isActive = item.id === step.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`mc-guide-step-tab${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}
                  onClick={() => setActiveStepId(item.id)}
                >
                  <span className="mc-guide-step-num">
                    {isDone ? <IconCheck size={13} /> : item.num}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.title}</div>
                    <div className="mc-field-hint" style={{ marginTop: 1 }}>
                      {isDone ? '已配置就绪' : item.subtitle}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active step detail card */}
          <section className="mc-card">
            <div className="mc-card-head">
              <div>
                <h2 className="mc-card-title">第 {step.num} 步：{step.title}</h2>
                <p className="mc-card-desc">{step.summary}</p>
              </div>
              <span className={`mc-badge ${doneMap[step.id] ? 'mc-badge-ok' : 'mc-badge-warn'}`}>
                {doneMap[step.id] ? '已就绪' : '待配置'}
              </span>
            </div>

            <div className="mc-card-body" style={{ gap: 14 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>需要填写的字段</div>
                <div className="mc-guide-kv">
                  {step.fields.map((f, idx) => (
                    <React.Fragment key={idx}>
                      <span className="mc-guide-kv-label">{f.label}</span>
                      <span className="mc-guide-kv-val">{f.value}</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>

              <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>从哪里获取 API Key</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {step.links.map(link => (
                    <div
                      key={link.url}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '7px 10px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border)'
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{link.label}</div>
                        <div className="mc-field-hint" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {link.url}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button type="button" className="mc-btn mc-btn-sm" onClick={() => void copyUrl(link.url)}>
                          {copiedUrl === link.url ? <><IconCheck size={12} /> 已复制</> : <><IconCopy size={12} /> 复制网址</>}
                        </button>
                        <button type="button" className="mc-btn mc-btn-sm" onClick={() => void openUrl(link.url)}>
                          <IconExternalLink size={12} /> 打开网页
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12.5 }}><strong>怎样算测试成功：</strong>{step.verify}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}><strong>如果失败了：</strong>{step.troubleshoot}</div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="mc-btn mc-btn-primary"
                  onClick={() => onNavigateCapability?.(step.capability)}
                >
                  <IconSettings size={14} /> {step.settingsBtn} →
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  {activeIdx > 0 && (
                    <button type="button" className="mc-btn" onClick={() => setActiveStepId(STEPS[activeIdx - 1].id)}>
                      上一步
                    </button>
                  )}
                  {nextStep ? (
                    <button type="button" className="mc-btn" onClick={() => setActiveStepId(nextStep.id)}>
                      下一步：{nextStep.title} <IconArrowRight size={13} />
                    </button>
                  ) : (
                    <button type="button" className="mc-btn mc-btn-success" onClick={onBackHome}>
                      完成，回到首页 <IconArrowRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
