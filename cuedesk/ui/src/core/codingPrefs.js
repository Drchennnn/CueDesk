export const CODING_LANGUAGES = [
  { id: 'python', label: 'Python' },
  { id: 'cpp', label: 'C++' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'go', label: 'Go' },
  { id: 'sql', label: 'SQL' },
  { id: 'other', label: '自动/其他' }
];

export const CODING_FORMATS = [
  { id: 'auto', label: '自动' },
  { id: 'acm', label: 'ACM' },
  { id: 'core', label: '核心' }
];

export const CODING_EXPLAIN_MODES = [
  { id: 'concise', label: '精简' },
  { id: 'detailed', label: '全面' },
  { id: 'code-only', label: '仅代码' }
];

export const DEFAULT_CODING_PREFS = Object.freeze({
  mode: 'normal',
  language: 'python',
  codeFormat: 'auto',
  explainMode: 'concise',
  includeComplexity: true,
  includeEdgeCases: true,
  extraInstruction: ''
});

export function normalizeCodingPrefs(input) {
  const src = input && typeof input === 'object' ? input : {};
  const validLangs = new Set(CODING_LANGUAGES.map(l => l.id));
  const validFormats = new Set(CODING_FORMATS.map(f => f.id));
  const validExplain = new Set(CODING_EXPLAIN_MODES.map(m => m.id));
  return {
    mode: src.mode === 'coding' ? 'coding' : 'normal',
    language: validLangs.has(src.language) ? src.language : 'python',
    codeFormat: validFormats.has(src.codeFormat) ? src.codeFormat : 'auto',
    explainMode: validExplain.has(src.explainMode) ? src.explainMode : 'concise',
    includeComplexity: src.includeComplexity !== false,
    includeEdgeCases: src.includeEdgeCases !== false,
    extraInstruction: String(src.extraInstruction || '').slice(0, 500)
  };
}

export function formatCodingSummary(prefs) {
  const p = normalizeCodingPrefs(prefs);
  if (p.mode !== 'coding') return '常规';
  const lang = CODING_LANGUAGES.find(l => l.id === p.language)?.label || 'Python';
  const fmt = p.codeFormat === 'acm' ? ' · ACM' : p.codeFormat === 'core' ? ' · 核心' : '';
  return `Coding · ${lang}${fmt}`;
}
