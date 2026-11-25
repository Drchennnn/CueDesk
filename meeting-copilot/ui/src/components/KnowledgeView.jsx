import React, { useEffect, useMemo, useState } from 'react';
import { IconFolder, IconRefresh, IconSearch, IconSparkles } from './Icons.jsx';
import { EvidencePanel, Switch, useAutoSaveValue } from './SharedWidgets.jsx';

const DOC_TYPE_LABELS = {
  resume: '个人简历',
  project_fact: '项目事实',
  experiment: '实验记录',
  personal_experience: '个人经历',
  technical_reference: '通用技术参考',
  technical_note: '技术笔记',
  candidate_profile: '候选人画像',
  design_proposal: '设计方案',
  guideline: '规范/说明',
  pending_fact: '待确认资料',
  draft: '草稿/练习',
  archived: '已归档'
};

export function KnowledgeView({ library, onLibraryUpdated, settings, onSettingsUpdated }) {
  const [draft, setDraft] = useState(null);
  const [docSearch, setDocSearch] = useState('');
  const [testQuestion, setTestQuestion] = useState('');
  const [testing, setTesting] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);
  const [error, setError] = useState('');
  const [promptDraft, setPromptDraft] = useState(settings?.modelPrompts?.interview || '');
  const [promptMsg, setPromptMsg] = useState('');

  useEffect(() => {
    if (library) setDraft(library);
  }, [library]);

  useEffect(() => {
    setPromptDraft(settings?.modelPrompts?.interview || '');
  }, [settings?.modelPrompts?.interview]);

  const autoSavePayload = draft ? { enabled: !!draft.enabled, root: draft.root || '', role: draft.role || '' } : null;
  const auto = useAutoSaveValue(
    autoSavePayload,
    (value) => window.mc.setInterviewLibrary(value),
    (res) => {
      setDraft(res);
      onLibraryUpdated?.(res);
      window.dispatchEvent(new Event('mc-library-updated'));
    }
  );

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

  const refreshLibrary = async () => {
    try {
      const next = await window.mc.getInterviewLibrary();
      setDraft(next);
      onLibraryUpdated?.(next);
      setError('');
    } catch (e) {
      setError('刷新资料库失败：' + e.message);
    }
  };

  const runRetrievalTest = async () => {
    setTesting(true);
    setError('');
    try {
      const res = await window.mc.previewInterviewLibrary(testQuestion.trim() || '请介绍自己');
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

  const docs = useMemo(() => {
    const list = draft?.documents || [];
    const q = docSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(d =>
      (d.title || '').toLowerCase().includes(q) ||
      (d.document_type || '').toLowerCase().includes(q)
    );
  }, [draft?.documents, docSearch]);

  const activeCount = (draft?.files || []).length;
  const retiredCount = (draft?.retired_sources || []).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <header className="mc-page-header" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="mc-page-title">本地面试资料库 V2</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mc-field-hint" role="status">
            {auto.error || (auto.status === 'saving' ? '自动保存中…' : auto.status === 'pending' ? '待保存…' : '已自动保存')}
          </span>
          <button type="button" className="mc-btn mc-btn-sm" onClick={() => void refreshLibrary()}>
            <IconRefresh size={13} /> 刷新索引
          </button>
        </div>
      </header>

      <div className="mc-page-scroll">
        <div className="mc-page-inner">
          {draft?.material_status && (
            <div className={`mc-alert ${draft.material_status.level === 'warning' ? 'mc-alert-warn' : 'mc-alert-ok'}`}>
              {draft.material_status.message}
            </div>
          )}

          {draft?.warning && (
            <div className="mc-alert mc-alert-warn" style={{ whiteSpace: 'pre-wrap' }}>{draft.warning}</div>
          )}

          {error && <div className="mc-alert mc-alert-err">{error}</div>}

          <section className="mc-card">
            <div className="mc-card-head">
              <div>
                <h3 className="mc-card-title">资料目录与岗位绑定</h3>
                <p className="mc-card-desc">启用后自动按目录建立本地文档身份、证据切片与防编造引用；修改 Markdown 后下次提问自动生效。</p>
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
                <div className="mc-srow-desc">建议按「项目资料/」「岗位档案/岗位名/」「通用技术知识/」组织文件</div>
              </div>
              <div className="mc-srow-control">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="mc-input"
                    value={draft?.root || ''}
                    placeholder="请选择或输入本地资料文件夹路径"
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
                <div className="mc-srow-label">默认面试岗位</div>
                <div className="mc-srow-desc">更换目录后自动扫描「岗位档案/」子目录；单场面试也可临时切换岗位</div>
              </div>
              <div className="mc-srow-control">
                <select
                  className="mc-select"
                  value={draft?.role || ''}
                  onChange={e => setDraft(prev => ({ ...(prev || {}), role: e.target.value }))}
                >
                  <option value="">通用（不指定岗位）</option>
                  {(draft?.roles || []).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>

            <div className="mc-srow mc-srow-compact">
              <div>
                <div className="mc-srow-label">索引统计与特性</div>
                <div className="mc-srow-desc">
                  当前有效可检索 {activeCount} 个文件{retiredCount > 0 ? `，已归档 ${retiredCount} 个旧来源` : ''}
                  {draft?.vector_rag?.enabled ? ' · 已开启向量 RAG 增强检索' : ' · 本地关键词与语义分面检索'}
                </div>
              </div>
              <div className="mc-srow-control is-inline">
                {draft?.persona_profile?.enabled && <span className="mc-badge mc-badge-ok">已绑定候选人画像</span>}
                {draft?.intro_script?.enabled && <span className="mc-badge mc-badge-info">已绑定自我介绍稿</span>}
                <span className="mc-badge">{activeCount} 份有效资料</span>
              </div>
            </div>
          </section>

          <section className="mc-card">
            <div className="mc-card-head">
              <div>
                <h3 className="mc-card-title">检索测试台</h3>
                <p className="mc-card-desc">输入面试题测试本地资料召回与来源定位（向量模式仅调用检索接口，不消耗回答生成 Token）。</p>
              </div>
            </div>
            <div className="mc-card-body">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="mc-input"
                  value={testQuestion}
                  onChange={e => setTestQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void runRetrievalTest(); }}
                  placeholder="输入测试问题，例如：讲讲你项目里遇到的最大性能瓶颈？"
                />
                <button type="button" className="mc-btn mc-btn-primary" disabled={testing || !draft?.enabled} onClick={() => void runRetrievalTest()}>
                  <IconSparkles size={14} /> {testing ? '检索中…' : '检索预览'}
                </button>
                <button type="button" className="mc-btn" onClick={() => void loadLastSelection()}>
                  最近选材
                </button>
              </div>

              {previewResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <span className="mc-badge mc-badge-info">问题：{previewResult.question}</span>
                    {previewResult.role && <span className="mc-badge">岗位：{previewResult.role}</span>}
                    {previewResult.strategy && <span className="mc-badge">{previewResult.strategy}</span>}
                    {typeof previewResult.retrievalMs === 'number' && (
                      <span className="mc-badge">{Math.round(previewResult.retrievalMs)} ms</span>
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

          <section className="mc-card">
            <div className="mc-card-head">
              <div>
                <h3 className="mc-card-title">已索引文档列表 ({docs.length})</h3>
                <p className="mc-card-desc">展示所有识别到的资料类型、版本与活跃状态。</p>
              </div>
              <div className="mc-search-wrap" style={{ width: 180 }}>
                <span className="mc-search-icon"><IconSearch size={13} /></span>
                <input className="mc-search-input" value={docSearch} onChange={e => setDocSearch(e.target.value)} placeholder="筛选文档…" />
              </div>
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {docs.length > 0 ? (
                <table className="mc-table">
                  <thead>
                    <tr>
                      <th>文档标题</th>
                      <th>资料类型</th>
                      <th>版本</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map(d => (
                      <tr key={d.document_id}>
                        <td style={{ fontWeight: 500 }}>{d.title}</td>
                        <td><span className="mc-badge">{DOC_TYPE_LABELS[d.document_type] || d.document_type}</span></td>
                        <td>v{d.version || 1}</td>
                        <td>
                          <span className={`mc-badge ${d.status === 'active' ? 'mc-badge-ok' : d.status === 'error' ? 'mc-badge-err' : 'mc-badge-warn'}`}>
                            {d.status === 'active' ? '活跃' : d.status === 'retired' ? '已归档' : d.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 20, textAlign: 'center' }} className="mc-field-hint">
                  {draft?.root ? '未发现可索引文档或无筛选结果' : '尚未配置本地资料目录'}
                </div>
              )}
            </div>
          </section>

          <details className="mc-card">
            <summary style={{ padding: '12px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13.5 }}>
              备用面试 Prompt（未启用资料库时生效）
            </summary>
            <div className="mc-card-body" style={{ borderTop: '1px solid var(--border)' }}>
              <textarea
                className="mc-textarea"
                rows={8}
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
    </div>
  );
}
