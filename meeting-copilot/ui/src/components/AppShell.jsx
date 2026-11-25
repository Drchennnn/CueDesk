import React from 'react';
import {
  IconActivity,
  IconBook,
  IconHelp,
  IconHistory,
  IconHome,
  IconMaximize,
  IconMinus,
  IconRestore,
  IconSettings,
  IconShield,
  IconX
} from './Icons.jsx';
import { Switch, computeServiceHealth } from './SharedWidgets.jsx';

const NAV_ITEMS = [
  { id: 'home', label: '首页', icon: IconHome },
  { id: 'knowledge', label: '知识库', icon: IconBook },
  { id: 'records', label: '面试记录', icon: IconHistory },
  { id: 'settings', label: '高级设置', icon: IconSettings }
];

function dotClass(state) {
  if (state === 'ok') return 'mc-dot mc-dot-ok';
  if (state === 'warn') return 'mc-dot mc-dot-warn';
  if (state === 'err') return 'mc-dot mc-dot-err';
  return 'mc-dot mc-dot-idle';
}

export function AppShell({
  route,
  onNavigate,
  settings,
  asr,
  library,
  windowState,
  activeSession,
  onResumeWorkbench,
  onToggleSecurity,
  onOpenHealth,
  onOpenDiagnostics,
  onOpenHelp,
  onMinimize,
  onToggleMaximize,
  onQuit,
  children
}) {
  const health = computeServiceHealth(settings, asr, library);
  const securityOn = Boolean(windowState?.securityMode?.enabled);
  const maximized = Boolean(windowState?.maximized);

  return (
    <div className={`mc-shell${maximized ? ' is-maximized' : ''}`}>
      <header className="mc-shell-titlebar">
        <div className="mc-shell-brand">
          <span className="mc-brand-mark">M</span>
          <span>MeetingCopilot</span>
          {activeSession && (
            <button
              type="button"
              className="mc-btn mc-btn-sm mc-btn-success"
              style={{ height: 22, padding: '0 8px', fontSize: 11, marginLeft: 6 }}
              onClick={onResumeWorkbench}
              title="返回正在进行的实时面试工作台"
            >
              进行中：{activeSession.name} · 继续 →
            </button>
          )}
        </div>
        <div className="mc-shell-wincontrols">
          <button type="button" className="mc-icon-btn" title="最小化" aria-label="最小化" onClick={onMinimize}>
            <IconMinus size={14} />
          </button>
          <button type="button" className="mc-icon-btn" title={maximized ? '还原' : '最大化'} aria-label={maximized ? '还原' : '最大化'} onClick={onToggleMaximize}>
            {maximized ? <IconRestore size={13} /> : <IconMaximize size={13} />}
          </button>
          <button type="button" className="mc-icon-btn is-danger" title="退出应用" aria-label="退出应用" onClick={onQuit}>
            <IconX size={14} />
          </button>
        </div>
      </header>

      <div className="mc-shell-body">
        <aside className="mc-sidebar" aria-label="主导航">
          <button
            type="button"
            className="mc-health-card mc-hide-narrow"
            onClick={onOpenHealth}
            title="查看或测试本地模型、语音识别与资料库状态"
          >
            <div className="mc-health-card-head">
              <span>本地服务状态</span>
              <IconActivity size={12} />
            </div>
            <div className="mc-health-row-mini">
              <span><i className={dotClass(health.llm.state)} /> 文本模型</span>
              <span style={{ maxWidth: 62, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                {health.llm.ready ? '已就绪' : '待配置'}
              </span>
            </div>
            <div className="mc-health-row-mini">
              <span><i className={dotClass(health.asr.state)} /> 语音识别</span>
              <span style={{ color: 'var(--text-muted)' }}>{health.asr.label}</span>
            </div>
            <div className="mc-health-row-mini">
              <span><i className={dotClass(health.kb.state)} /> 资料库</span>
              <span style={{ color: 'var(--text-muted)' }}>{health.kb.label}</span>
            </div>
          </button>

          <nav className="mc-nav-list">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`mc-nav-item${route === id ? ' is-active' : ''}`}
                aria-current={route === id ? 'page' : undefined}
                onClick={() => onNavigate(id)}
              >
                <Icon size={15} />
                <span className="mc-hide-narrow">{label}</span>
              </button>
            ))}
          </nav>

          <div className="mc-sidebar-footer">
            <div
              className={`mc-security-pill${securityOn ? ' is-active' : ''}`}
              title={securityOn ? '安全模式已开启：强制防截屏 + 不抢焦点' : '开启安全模式：防截屏隐藏窗口并屏蔽焦点'}
            >
              <span className="mc-security-pill-label">
                <IconShield size={14} />
                <span className="mc-hide-narrow">安全模式</span>
              </span>
              <Switch
                checked={securityOn}
                success
                aria-label="切换安全模式"
                onChange={(next) => onToggleSecurity(next)}
              />
            </div>

            <div style={{ display: 'flex', gap: 4, justifyContent: 'space-between' }}>
              <button type="button" className="mc-btn mc-btn-ghost mc-btn-sm" style={{ flex: 1 }} onClick={onOpenHelp} title="帮助与配置指南">
                <IconHelp size={14} />
                <span className="mc-hide-narrow">帮助</span>
              </button>
              <button type="button" className="mc-btn mc-btn-ghost mc-btn-sm" style={{ flex: 1 }} onClick={onOpenDiagnostics} title="本地诊断报告">
                <IconActivity size={14} />
                <span className="mc-hide-narrow">诊断</span>
              </button>
            </div>
          </div>
        </aside>

        <main className="mc-workspace">{children}</main>
      </div>
    </div>
  );
}
