const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../meeting-copilot/answer-reading-ui.js'), 'utf8'), ctx);
test('removes file reference footer and keeps explanation, code and following paragraphs', () => {
  assert.equal(ctx.cleanAnswerReferences('我的经历。\n\n依据：岗位档案/CBCX/自我介绍.md#一分钟；简历.md#教育背景'), '我的经历。');
  assert.equal(ctx.cleanAnswerReferences('答复\n依据：'), '答复');
  assert.equal(ctx.cleanAnswerReferences('依据：牛顿第二定律'), '依据：牛顿第二定律');
  const code = '```\n依据：example.md#test\n```';
  assert.equal(ctx.cleanAnswerReferences(code), code);
  assert.equal(ctx.cleanAnswerReferences('回答\n**依据：** 简历.md#项目\n\n补充回答'), '回答\n\n补充回答');
});
test('font follows window width, clamps for readability and can be fixed', () => {
  assert.equal(ctx.answerReadingPixels({size:14,responsive:true},1000),14);
  assert.equal(ctx.answerReadingPixels({size:14,responsive:true},800),11.200000000000001);
  assert.equal(ctx.answerReadingPixels({size:14,responsive:true},400),10);
  assert.equal(ctx.answerReadingPixels({size:14,responsive:false},400),14);
  assert.equal(ctx.normalizeAnswerReading({size:99}).size,28);
  assert.equal(ctx.normalizeAnswerReading({size:NaN}).size,14);
});
