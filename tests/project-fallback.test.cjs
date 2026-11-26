'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInterviewLibrary } = require('../cuedesk/v2/library.cjs');
const { materialStatus, fallbackMessages } = require('../cuedesk/v2/material-status.cjs');
const { parseAnswer, createAnswerStream } = require('../cuedesk/v2/evidence.cjs');

async function setup(t, role = '') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-project-fallback-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'docs');
  fs.mkdirSync(path.join(root, '项目资料'), { recursive: true });
  fs.mkdirSync(path.join(root, '岗位档案/港深'), { recursive: true });
  fs.writeFileSync(path.join(root, '岗位档案/港深/JD.md'), '# 港深\n\nAI开发');
  fs.writeFileSync(path.join(root, '项目资料/SRAG.md'), '# SRAG\n\n## 检索\nDense Sparse混合检索。');
  fs.writeFileSync(path.join(root, '项目资料/IOD.md'), '# IOD\n\n## 个人主责\n本人负责光照规则分类器和Wi-Fi特征实验，负责人合并光照分支。\n\n## Wi-Fi数据与AP\nWi-Fi扫描记录包含SSID、MAC和RSSI。AP数量是离散计数，树模型可直接接收20。\n\n## 融合\n六模态子分类器输出按权重加权平均。\n\n## 统计\n方差需要说明样本轴，协方差比较多个特征共同变化。');
  const library = createInterviewLibrary({ file: path.join(directory, 'config.json') });
  await library.save({ enabled: true, root, role });
  return { library, root };
}

for (const role of ['', '港深']) test('Huawei followups retain IOD across SRAG switch in scope ' + (role || 'generic'), async t => {
  const { library } = await setup(t, role);
  let state;
  const questions = ['SRAG项目怎么做混合检索？', '华为这个项目怎么融合多个模态？', '你是哪个模块？', '这两个怎么处理？', 'WiFi信号是什么样的数据？', 'AP是一个什么样的值，20可以直接输入吗？', '它是连续还是离散的数值？', '特征方差下降说明什么？', '协方差怎么算？'];
  for (const [index, question] of questions.entries()) {
    const messages = await library.build({ question, sessionId: 'interview', dialogueState: state }, []);
    state = messages.dialogueState;
    if (!index) continue;
    assert(state.project_titles.includes('IOD'), question);
    assert(messages.evidence.some(item => item.document_title === 'IOD'), question);
    assert(messages.evidence.every(item => !item.project_id || item.document_title === 'IOD'), question);
    assert(messages.some(item => item.content.includes('参考实现')), question);
  }
  const generic = await library.build({ question: '换个话题，Python线程和进程有什么区别？', sessionId: 'interview', dialogueState: state }, []);
  assert.equal(generic.dialogueState.project_ids.length, 0);
});

test('material status distinguishes generic, disabled, missing and ready', async t => {
  const { library, root } = await setup(t);
  assert.equal((await library.getPublic()).material_status.code, 'generic');
  await library.save({ enabled: true, root, role: '港深' });
  assert.equal((await library.getPublic()).material_status.code, 'ready');
  await library.save({ enabled: false, root, role: '' });
  assert.equal((await library.getPublic()).material_status.code, 'disabled');
  assert.equal(materialStatus({ enabled: true }, [], '不存在').code, 'unavailable');
  assert.equal(materialStatus({ enabled: true }, []).code, 'no_projects');
});

test('disabled materials still provide conditional project reference and preserve translation path', async t => {
  const { library, root } = await setup(t);
  await library.save({ enabled: false, root, role: '' });
  const original = [{ role: 'system', content: '已有备用规则' }];
  const messages = await library.build({ question: '华为项目Wi-Fi特征怎么处理？' }, original);
  assert.equal(messages[0].content, original[0].content);
  assert(messages.suggestionOnly);
  assert.equal(messages.blockedUnknown, null);
  assert(messages.some(message => message.content.includes('不把回答停在')));
  assert.equal(await library.build({ mode: 'translate' }, original), original);
  assert.equal(await library.build({ scene: 'written' }, original), original);
  const screenshot = fallbackMessages({ question: '截图里的项目怎么设计', images: ['data:image/png;base64,AA=='] }, [], 'disabled');
  assert.equal(screenshot.at(-1).role, 'user');
  assert.equal(screenshot.at(-1).content[0].type, 'image_url');
});

test('missing directory returns usable fallback with an explicit diagnostic', async t => {
  const { library, root } = await setup(t);
  fs.renameSync(root, root + '-moved');
  const messages = await library.build({ question: '华为项目Wi-Fi怎么处理？' }, []);
  assert.equal(messages.blockedUnknown, null);
  assert(messages.diagnostics.some(item => item.includes('加载失败')));
  assert(messages.length > 0);
});

test('unknown historical detail still yields project fallback, and images remain in user message', async t => {
  const { library } = await setup(t);
  const messages = await library.build({ question: '华为项目具体用了什么模型？', images: ['data:image/png;base64,AA=='] }, []);
  assert.equal(messages.at(-1).role, 'user');
  assert(messages.some(message => typeof message.content === 'string' && message.content.includes('参考实现')));
  const unknownProject = await library.build({ question: '你做过的医疗影像项目怎么处理数据？' }, []);
  assert(unknownProject.suggestionOnly);
});

test('hidden unknown detail removes dangling introductory clause for every streaming split', () => {
  const raw = '检索要看召回率。具体准确率的数据，[[UNKNOWN:准确率需核对]]。';
  for (let index = 0; index <= raw.length; index++) {
    const stream = createAnswerStream([], () => {});
    stream.push(raw.slice(0, index));
    stream.push(raw.slice(index));
    const result = stream.finish();
    assert.equal(result.oral_answer, '检索要看召回率。');
    assert.deepEqual(result.unknown_facts, ['准确率需核对']);
  }
  assert.equal(parseAnswer('[[UNKNOWN:模型名]]', [], true).oral_answer, '');
});

test('project detail gaps appear privately while method explanation remains in oral output', () => {
  const raw = '协方差的计算我这边没有直接记录，不能确认当时算过。我会将样本按特征列排列，再计算两列协方差。';
  for (let index = 0; index <= raw.length; index++) {
    const observed = [];
    const stream = createAnswerStream([], value => observed.push(value.oral_answer), { projectReference: true });
    stream.push(raw.slice(0, index));
    stream.push(raw.slice(index));
    const result = stream.finish();
    assert.equal(result.oral_answer, '我会将样本按特征列排列，再计算两列协方差。');
    assert.equal(result.unknown_facts.length, 1);
    assert(observed.every(value => !/没.{0,5}记录|不能确认/.test(value)));
  }
  const lead = parseAnswer('具体到低AP那组特征，协方差有没有算过，这部分我确认一下。我会先固定样本，再计算两列协方差。', [], true, { projectReference: true });
  assert.equal(lead.oral_answer, '我会先固定样本，再计算两列协方差。');
  assert.equal(lead.unknown_facts.length, 1);
  const denial = parseAnswer('项目里我没有算过协方差。如果按这个目标，我会先固定样本，再计算特征之间的协方差。', [], true, { projectReference: true, absenceUnknown: true });
  assert.equal(denial.oral_answer, '如果按这个目标，我会先固定样本，再计算特征之间的协方差。');
  assert(denial.unknown_facts.length);
});
