'use strict';

function materialStatus(config, documents = [], error = '') {
  const projects = [...new Set(documents.filter(document => document.project_id).map(document => document.project_id))];
  const scope = config.role || '通用';
  if (!config.enabled) return { code: 'disabled', level: 'warning', scope, project_count: 0, message: '面试资料库未启用，请在设置中检查资料选择。当前回答使用参考思路兜底。' };
  if (error) return { code: 'unavailable', level: 'warning', scope, project_count: 0, message: '面试资料加载失败，请检查目录与岗位。' + error };
  if (!projects.length) return { code: 'no_projects', level: 'warning', scope, project_count: 0, message: '当前范围没有项目资料，请检查目录及项目文件。' };
  if (!config.role) return { code: 'generic', level: 'warning', scope, project_count: projects.length, message: '通用资料已加载，包含' + projects.length + '份项目资料。面试岗位未选，可在设置中补选。' };
  return { code: 'ready', level: 'info', scope, project_count: projects.length, message: scope + ' · 已加载' + projects.length + '份项目资料' };
}

const PROJECT_FALLBACK = `项目问题需要可说出的参考回答。先用本轮直接相关的项目事实回答已知部分，事实足够时只解释这些事实。缺少实现细节时补一个合理、基础、可解释的参考实现，以“按这个目标，我会…”自然衔接，最多补两句。缺少整份项目材料也要围绕题目给出输入、处理、输出或验证中的关键步骤，不把回答停在“没有资料、不知道、无法回答”。技术追问直接解释本轮的数据或方法，个人职责仅在本轮问职责时说明。具体历史模型名、精确参数、指标、负责人及已完成状态缺项，仅写UNKNOWN私下提示；口述省去“没记录、缺证据、不能确认、需要本人核实、这部分我确认一下”等资料说明。通用统计定义采用一般原理或我会的口吻，不能推定历史方差实验实际采用了该统计轴。参考方案使用条件式，保持简短，不扩写未问的高级架构。已知记录优先，例如项目实际使用RSSI和AP计数时，就围绕这些字段解释，不自行替换成CSI或AP编号。对方的错误前提可简短澄清后继续解释。`;

function fallbackMessages(input, original, reason) {
  const question = String(input.freeQuestion || input.question || '请根据当前内容回答');
  const project = /项目|模块|特征|融合|AP|Wi[\s-]?Fi|IOD|华为|当时|你.{0,8}(?:负责|做过|用过)/i.test(question);
  const messages = [...original, { role: 'system', content: PROJECT_FALLBACK + '\n个人材料状态未知，原有通用知识和AI草稿不能证明个人经历。可解释概念与方法，具体事实保留UNKNOWN。本轮口述80—160字、2—4句，选择一条简单链路，不列完整架构，不朗读资料状态。' }, { role: 'user', content: JSON.stringify({ question, transcript: (input.recentTranscript || []).slice(-4), material_status: reason, answer_mode: project ? 'conditional_project_reference' : 'general_reference' }) }];
  if (input.images?.length) messages.at(-1).content = [...input.images.map(url => ({ type: 'image_url', image_url: { url } })), { type: 'text', text: messages.at(-1).content }];
  const answerPolicy = project ? { projectReference: true, suggestionOnly: true, absenceUnknown: true, requiredUnknown: ['本轮项目材料未载入，口述为条件式参考方案。'] } : { absenceUnknown: true };
  for (const [key, value] of Object.entries({ evidence: [], diagnostics: [reason], answerPolicy, suggestionOnly: project, blockedUnknown: null })) Object.defineProperty(messages, key, { value });
  return messages;
}

module.exports = { materialStatus, PROJECT_FALLBACK, fallbackMessages };
