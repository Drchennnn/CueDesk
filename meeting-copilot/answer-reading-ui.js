// answer-reading-v1
function cleanAnswerReferences(value) {
  const text = String(value || '');
  // Only remove a trailing file-reference section, preserving ordinary reasoning and code.
  const marker = /(?:^|\n)[ \t]*(?:\*\*)?(?:依据|参考来源|资料来源|来源)(?:\*\*)?[：:][ \t]*(?:\*\*)?/g;
  let match;
  while ((match = marker.exec(text))) {
    if ((text.slice(0, match.index).match(/```/g) || []).length % 2) continue;
    const tail = text.slice(marker.lastIndex);
    if (!/\.md(?:#|\b)/i.test(tail) && tail.trim()) continue;
    // A blank paragraph after references belongs to the answer and must be preserved.
    const end = tail.search(/\r?\n[ \t]*\r?\n/);
    return (text.slice(0, match.index).trimEnd() + (end >= 0 ? '\n\n' + cleanAnswerReferences(tail.slice(end).trimStart()) : '')).trimEnd();
  }
  return text;
}
const ANSWER_READING_KEY = 'mc-answer-reading-v1';
function normalizeAnswerReading(value = {}) {
  return { size: Number.isFinite(value.size) ? Math.max(10, Math.min(28, value.size)) : 14, responsive: value.responsive !== false };
}
function readAnswerReading() {
  try { return normalizeAnswerReading(JSON.parse(localStorage.getItem(ANSWER_READING_KEY)) || {}); }
  catch { return normalizeAnswerReading(); }
}
function answerReadingPixels(value, width) {
  return Math.max(10, Math.min(40, value.size * (value.responsive ? Math.max(.65, Math.min(1.5, width / 1000)) : 1)));
}
function applyAnswerReading() {
  document.documentElement.style.setProperty('--answer-font-size', answerReadingPixels(readAnswerReading(), window.innerWidth) + 'px');
}
if (typeof window !== 'undefined') {
  window.addEventListener('resize', applyAnswerReading);
  window.addEventListener('storage', applyAnswerReading);
  applyAnswerReading();
}
function AnswerReadingSettings() {
  const h = jsxRuntimeExports.jsx, hs = jsxRuntimeExports.jsxs;
  const [value, setValue] = reactExports.useState(readAnswerReading);
  const [error, setError] = reactExports.useState('');
  const change = patch => {
    const next = normalizeAnswerReading({ ...value, ...patch });
    try { localStorage.setItem(ANSWER_READING_KEY, JSON.stringify(next)); setValue(next); applyAnswerReading(); setError(''); }
    catch { setError('字号保存失败，请重试'); }
  };
  return hs('div', { children: [
    hs('label', { style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [
      h('input', { type: 'range', min: 10, max: 28, step: 1, value: value.size, 'aria-label': '答案字号', onChange: e => change({ size: Number(e.target.value) }) }),
      h('span', { children: value.size + ' px' })
    ] }),
    hs('label', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }, children: [
      h('input', { type: 'checkbox', checked: value.responsive, onChange: e => change({ responsive: e.target.checked }) }), '随窗口宽度等比例缩放'
    ] }),
    h('p', { className: 'settings-hint', children: '自动保存。以窗口内容宽度 1000 px 为基准，最小显示字号 10 px。关闭联动可固定字号；窗口缩放快捷键仍会缩放整个界面。' }),
    error && h('span', { role: 'alert', children: error })
  ] });
}
