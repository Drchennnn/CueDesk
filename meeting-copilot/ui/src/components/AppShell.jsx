import React from 'react';
import appIconUrl from '../assets/app-icon-64.png';
import {
  IconBook,
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
  { id: 'records', label: '记忆与记录', icon: IconHistory },
  { id: 'settings', label: '高级设置', icon: IconSettings }
];

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
  onMinimize,
  onToggleMaximize,
  onQuit,
  children
}) {
  const health = computeServiceHealth(settings, asr, library);
  const summary = health.taskSummary;
  const securityOn = Boolean(windowState?.securityMode?.enabled);
  const maximized = Boolean(windowState?.maximized);

  return (
    <div className={`mc-shell${maximized ? ' is-maximized' : ''}`}>
      <header className="mc-shell-titlebar">
        <div className="mc-shell-brand">
          <img className="mc-brand-mark" src={appIconUrl} alt="" draggable={false} />
          <span>MeetingCopilot</span>
          {activeSession && (
            <button
              type="button"
              className="mc-btn mc-btn-sm mc-btn-success"
              style={{ height: 22, padding: '0 8px', fontSize: 11, marginLeft: 6 }}
              onClick={onResumeWorkbench}
              title="返回正在进行的实时面试工作台"
            >
              进行中：{activeSession.name} · 返回面试 →
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
            className="mc-sidebar-status-pill mc-hide-narrow"
            onClick={onOpenHealth}
            title={`回答模型：${health.llm.ready ? '已就绪' : '待配置'} · 语音：${health.asr.label} · 资料库：${health.kb.label}（点击查看快速配置与服务状态）`}
          >
            <span className="mc-sidebar-status-row">
              <i className={`mc-dot ${summary.dot}`} />
              <span className="mc-sidebar-status-text">{summary.label}</span>
            </span>
            {summary.meta && (
              <span className="mc-sidebar-status-meta">{summary.meta}</span>
            )}
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
          </div>
        </aside>

        <main className="mc-workspace">{children}</main>
      </div>
    </div>
  );
}
