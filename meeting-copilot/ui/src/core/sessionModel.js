export const SESSION_SCHEMA_VERSION = 2;
export const MAX_SEGMENTS = 500;
export const TERMINAL_ATTEMPT_STATUSES = new Set(['done', 'cancelled', 'error', 'interrupted']);

let idCounter = 0;
export function createId(prefix = 'id') {
  idCounter = (idCounter + 1) % 1000000;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeAttempt(raw, fallbackId) {
  const id = String(raw?.id || raw?.requestId || fallbackId || createId('req'));
  const rawStatus = String(raw?.status || 'done');
  // Never restore a lingering streaming status across restarts.
  const status = rawStatus === 'streaming'
    ? 'interrupted'
    : ['done', 'cancelled', 'error', 'interrupted'].includes(rawStatus)
      ? rawStatus
      : 'done';
  return {
    id,
    requestId: String(raw?.requestId || id),
    createdAt: Number.isFinite(Number(raw?.createdAt)) ? Number(raw.createdAt) : Date.now(),
    completedAt: Number.isFinite(Number(raw?.completedAt)) ? Number(raw.completedAt) : (status === 'streaming' ? null : Date.now()),
    status,
    text: String(raw?.text || ''),
    error: String(raw?.error || ''),
    statusText: '',
    evidence: Array.isArray(raw?.evidence) ? raw.evidence : [],
    citations: Array.isArray(raw?.citations) ? raw.citations : [],
    unknownFacts: Array.isArray(raw?.unknownFacts) ? raw.unknownFacts : (Array.isArray(raw?.unknown_facts) ? raw.unknown_facts : []),
    privateNotes: Array.isArray(raw?.privateNotes) ? raw.privateNotes : (Array.isArray(raw?.private_notes) ? raw.private_notes : []),
    diagnostics: Array.isArray(raw?.diagnostics) ? raw.diagnostics : [],
    dialogueState: raw?.dialogueState || raw?.dialogue_state || null,
    modelResults: Array.isArray(raw?.modelResults) ? raw.modelResults : [],
    images: Array.isArray(raw?.images) ? raw.images : [],
    translation: String(raw?.translation || ''),
    translationError: ''
  };
}

function normalizeQuestion(raw, index, seenIds) {
  const baseId = String(raw?.id || '').trim() || `q-${index + 1}`;
  const id = seenIds.has(baseId) ? `${baseId}-${index}` : baseId;
  seenIds.add(id);
  const attempts = Array.isArray(raw?.attempts) && raw.attempts.length
    ? raw.attempts.map((a, ai) => normalizeAttempt(a, `${id}-a${ai + 1}`))
    : [normalizeAttempt({ id: `${id}-a1`, status: 'done', text: '' })];
  const activeAttemptId = attempts.some(a => a.id === raw?.activeAttemptId)
    ? raw.activeAttemptId
    : attempts[attempts.length - 1].id;
  return {
    id,
    ordinal: index + 1,
    prompt: String(raw?.prompt || raw?.label || '').trim() || `问题 ${index + 1}`,
    kind: ['segment', 'manual', 'free', 'shot', 'batch'].includes(raw?.kind) ? raw.kind : 'free',
    sourceSegmentIds: Array.isArray(raw?.sourceSegmentIds) ? raw.sourceSegmentIds.filter(n => Number.isFinite(Number(n))).map(Number) : [],
    mergedFromOrdinals: Array.isArray(raw?.mergedFromOrdinals) ? raw.mergedFromOrdinals.filter(n => Number.isFinite(Number(n))).map(Number) : [],
    createdAt: Number.isFinite(Number(raw?.createdAt)) ? Number(raw.createdAt) : Date.now(),
    updatedAt: Number.isFinite(Number(raw?.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
    activeAttemptId,
    attempts
  };
}

function normalizeSegments(rawSegments) {
  const list = Array.isArray(rawSegments) ? rawSegments : [];
  const used = new Set();
  let maxId = 0;
  const segments = list.map((seg, idx) => {
    let id = Number.isFinite(Number(seg?.id)) && Number(seg.id) > 0 ? Math.floor(Number(seg.id)) : idx + 1;
    while (used.has(id)) id += 1;
    used.add(id);
    if (id > maxId) maxId = id;
    return {
      id,
      speaker: seg?.speaker === 'me' ? 'me' : 'them',
      text: String(seg?.text || ''),
      startTs: Number.isFinite(Number(seg?.startTs)) ? Number(seg.startTs) : Date.now(),
      endTs: Number.isFinite(Number(seg?.endTs)) ? Number(seg.endTs) : Date.now(),
      translation: seg?.translation ? String(seg.translation) : '',
      translationError: ''
    };
  });
  return { segments, nextSegmentId: maxId + 1 };
}

export function migrateSession(raw) {
  if (!raw || typeof raw !== 'object') return createEmptySession();
  const now = Date.now();
  const { segments, nextSegmentId } = normalizeSegments(raw.segments);
  const seenQuestionIds = new Set();

  let questions;
  if (raw.schemaVersion === SESSION_SCHEMA_VERSION && Array.isArray(raw.questions)) {
    questions = raw.questions.map((q, idx) => normalizeQuestion(q, idx, seenQuestionIds));
  } else {
    const legacyTurns = Array.isArray(raw.turns) ? raw.turns : [];
    questions = legacyTurns.map((turn, idx) => {
      // Deterministic, unique persistent questionId per legacy turn so identical question text stays distinct
      // and repeated reloads never spawn duplicate questions.
      const baseKey = String(turn?.id || `idx-${idx}`).trim();
      const qIdBase = `q-legacy-${baseKey}`;
      const qId = seenQuestionIds.has(qIdBase) ? `${qIdBase}-${idx}` : qIdBase;
      seenQuestionIds.add(qId);
      const attempt = normalizeAttempt({
        ...turn,
        id: String(turn?.id || `${qId}-a1`),
        requestId: String(turn?.id || `${qId}-a1`),
        createdAt: turn?.createdAt || raw.createdAt || now
      });
      const matchingSeg = turn?.sourceSegmentIds?.length
        ? turn.sourceSegmentIds
        : [];
      return {
        id: qId,
        ordinal: idx + 1,
        prompt: String(turn?.label || turn?.question || '').trim() || `问题 ${idx + 1}`,
        kind: ['segment', 'manual', 'free', 'shot', 'batch'].includes(turn?.kind) ? turn.kind : 'free',
        sourceSegmentIds: matchingSeg,
        mergedFromOrdinals: [],
        createdAt: Number.isFinite(Number(turn?.createdAt)) ? Number(turn.createdAt) : (Number(raw.createdAt) || now),
        updatedAt: Number.isFinite(Number(turn?.updatedAt)) ? Number(turn.updatedAt) : (Number(raw.updatedAt) || Number(raw.createdAt) || now),
        activeAttemptId: attempt.id,
        attempts: [attempt]
      };
    });
  }

  const selectedQuestionId = raw.selectedQuestionId && questions.some(q => q.id === raw.selectedQuestionId)
    ? raw.selectedQuestionId
    : (questions.length ? questions[questions.length - 1].id : null);

  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: String(raw.id || createId('sess')),
    name: String(raw.name || '未命名面试'),
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : now,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : (Number(raw.createdAt) || now),
    templateId: raw.templateId ? String(raw.templateId) : null,
    audioSource: raw.audioSource === 'mic' ? 'mic' : 'system',
    answerLang: raw.answerLang === 'english' ? 'english' : 'chinese',
    scene: raw.scene === 'written' ? 'written' : 'interview',
    role: String(raw.role || ''),
    libraryEnabled: typeof raw.libraryEnabled === 'boolean' ? raw.libraryEnabled : null,
    transcriptionMode: ['auto', 'manual', 'transcript-only'].includes(raw.transcriptionMode) ? raw.transcriptionMode : 'auto',
    resume: String(raw.resume || ''),
    resumeName: String(raw.resumeName || ''),
    jd: String(raw.jd || ''),
    jdName: String(raw.jdName || ''),
    memo: String(raw.memo || ''),
    // Preserve legacy single-KB fields cleanly
    kbText: String(raw.kbText || ''),
    kbName: String(raw.kbName || ''),
    dialogueState: raw.dialogueState || null,
    segments,
    nextSegmentId: Math.max(nextSegmentId, Number(raw.nextSegmentId) || 1),
    questions,
    selectedQuestionId,
    unreadQuestionIds: []
  };
}

export function migrateSessionsFile(raw) {
  const list = Array.isArray(raw?.sessions) ? raw.sessions : [];
  const sessions = list.map(migrateSession);
  const currentId = raw?.currentId && sessions.some(s => s.id === raw.currentId)
    ? raw.currentId
    : (sessions[0]?.id ?? null);
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessions,
    currentId
  };
}

export function createEmptySession(overrides = {}) {
  const now = Date.now();
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: overrides.id || createId('sess'),
    name: String(overrides.name || '新面试会话'),
    createdAt: now,
    updatedAt: now,
    templateId: overrides.templateId || null,
    audioSource: overrides.audioSource === 'mic' ? 'mic' : 'system',
    answerLang: overrides.answerLang === 'english' ? 'english' : 'chinese',
    scene: overrides.scene === 'written' ? 'written' : 'interview',
    role: String(overrides.role || ''),
    libraryEnabled: typeof overrides.libraryEnabled === 'boolean' ? overrides.libraryEnabled : null,
    transcriptionMode: ['auto', 'manual', 'transcript-only'].includes(overrides.transcriptionMode) ? overrides.transcriptionMode : 'auto',
    resume: String(overrides.resume || ''),
    resumeName: String(overrides.resumeName || ''),
    jd: String(overrides.jd || ''),
    jdName: String(overrides.jdName || ''),
    memo: '',
    kbText: String(overrides.kbText || ''),
    kbName: String(overrides.kbName || ''),
    dialogueState: null,
    segments: [],
    nextSegmentId: 1,
    questions: [],
    selectedQuestionId: null,
    unreadQuestionIds: []
  };
}

export function getActiveAttempt(question) {
  if (!question || !Array.isArray(question.attempts) || !question.attempts.length) return null;
  return question.attempts.find(a => a.id === question.activeAttemptId) || question.attempts[question.attempts.length - 1];
}

export function getSelectedQuestion(session) {
  if (!session || !Array.isArray(session.questions) || !session.questions.length) return null;
  if (session.selectedQuestionId) {
    const found = session.questions.find(q => q.id === session.selectedQuestionId);
    if (found) return found;
  }
  return session.questions[session.questions.length - 1];
}

export function findByRequestId(session, requestId) {
  if (!session || !requestId) return null;
  for (let qi = 0; qi < session.questions.length; qi++) {
    const q = session.questions[qi];
    for (let ai = 0; ai < q.attempts.length; ai++) {
      if (q.attempts[ai].requestId === requestId || q.attempts[ai].id === requestId) {
        return { question: q, questionIndex: qi, attempt: q.attempts[ai], attemptIndex: ai };
      }
    }
  }
  return null;
}

export function appendSegment(session, segInput) {
  const id = Math.max(session.nextSegmentId || 1, Number(segInput.id) || 0);
  const seg = {
    id,
    speaker: segInput.speaker === 'me' ? 'me' : 'them',
    text: String(segInput.text || ''),
    startTs: Number.isFinite(Number(segInput.startTs)) ? Number(segInput.startTs) : Date.now(),
    endTs: Number.isFinite(Number(segInput.endTs)) ? Number(segInput.endTs) : Date.now(),
    translation: '',
    translationError: ''
  };
  let nextSegments = [...session.segments, seg];
  // Trim from the head without ever renumbering remaining segment IDs.
  if (nextSegments.length > MAX_SEGMENTS) {
    nextSegments = nextSegments.slice(nextSegments.length - MAX_SEGMENTS);
  }
  return {
    ...session,
    updatedAt: Date.now(),
    segments: nextSegments,
    nextSegmentId: id + 1
  };
}

export function addQuestionWithAttempt(session, {
  questionId = createId('q'),
  requestId = createId('req'),
  prompt,
  kind = 'free',
  sourceSegmentIds = [],
  images = [],
  followIfAtLatest = true,
  forceSelect = false
}) {
  const now = Date.now();
  const attempt = {
    id: requestId,
    requestId,
    createdAt: now,
    completedAt: null,
    status: 'streaming',
    text: '',
    error: '',
    statusText: '',
    evidence: [],
    citations: [],
    unknownFacts: [],
    privateNotes: [],
    diagnostics: [],
    dialogueState: null,
    modelResults: [],
    images: Array.isArray(images) ? images : [],
    translation: '',
    translationError: ''
  };
  const question = {
    id: questionId,
    ordinal: session.questions.length + 1,
    prompt: String(prompt || '').trim() || `问题 ${session.questions.length + 1}`,
    kind,
    sourceSegmentIds: Array.isArray(sourceSegmentIds) ? [...sourceSegmentIds] : [],
    mergedFromOrdinals: [],
    createdAt: now,
    updatedAt: now,
    activeAttemptId: attempt.id,
    attempts: [attempt]
  };
  const wasAtLatest = !session.questions.length ||
    !session.selectedQuestionId ||
    session.selectedQuestionId === session.questions[session.questions.length - 1].id;
  const shouldSelect = forceSelect || (followIfAtLatest && wasAtLatest);
  const unreadQuestionIds = shouldSelect
    ? []
    : [...new Set([...(session.unreadQuestionIds || []), question.id])];
  return {
    ...session,
    updatedAt: now,
    questions: [...session.questions, question],
    selectedQuestionId: shouldSelect ? question.id : session.selectedQuestionId,
    unreadQuestionIds
  };
}

export function regenerateQuestion(session, questionId, { requestId = createId('req'), images } = {}) {
  const idx = session.questions.findIndex(q => q.id === questionId);
  if (idx < 0) return session;
  const now = Date.now();
  const target = session.questions[idx];
  const prevAttempts = target.attempts.map(a =>
    a.status === 'streaming' ? { ...a, status: 'cancelled', completedAt: now, statusText: '' } : a
  );
  const lastImages = images !== undefined ? images : (getActiveAttempt(target)?.images || []);
  const nextAttempt = {
    id: requestId,
    requestId,
    createdAt: now,
    completedAt: null,
    status: 'streaming',
    text: '',
    error: '',
    statusText: '',
    evidence: [],
    citations: [],
    unknownFacts: [],
    privateNotes: [],
    diagnostics: [],
    dialogueState: null,
    modelResults: [],
    images: Array.isArray(lastImages) ? [...lastImages] : [],
    translation: '',
    translationError: ''
  };
  const updatedQuestion = {
    ...target,
    updatedAt: now,
    activeAttemptId: nextAttempt.id,
    attempts: [...prevAttempts, nextAttempt]
  };
  const questions = session.questions.slice();
  questions[idx] = updatedQuestion;
  return {
    ...session,
    updatedAt: now,
    questions
  };
}

export function cancelAttempt(session, requestId) {
  const hit = findByRequestId(session, requestId);
  if (!hit) return session;
  if (TERMINAL_ATTEMPT_STATUSES.has(hit.attempt.status)) return session;
  const now = Date.now();
  const nextAttempt = {
    ...hit.attempt,
    status: 'cancelled',
    completedAt: now,
    statusText: ''
  };
  const nextAttempts = hit.question.attempts.slice();
  nextAttempts[hit.attemptIndex] = nextAttempt;
  const nextQuestion = { ...hit.question, updatedAt: now, attempts: nextAttempts };
  const questions = session.questions.slice();
  questions[hit.questionIndex] = nextQuestion;
  return {
    ...session,
    updatedAt: now,
    questions
  };
}

export function applyLlmEvent(session, ev) {
  if (!ev || !ev.requestId) return session;
  const hit = findByRequestId(session, ev.requestId);
  if (!hit) return session;
  // Terminal-state guard: once an attempt is done/cancelled/error/interrupted, late IPC packets are ignored.
  if (TERMINAL_ATTEMPT_STATUSES.has(hit.attempt.status)) return session;

  const now = Date.now();
  let nextAttempt = { ...hit.attempt };
  let nextDialogueState = session.dialogueState;
  let contentUpdated = false;

  if (ev.kind === 'delta') {
    nextAttempt.text += String(ev.text || '');
    contentUpdated = true;
  } else if (ev.kind === 'status') {
    nextAttempt.statusText = String(ev.message || '');
  } else if (ev.kind === 'oral') {
    if (ev.oral_answer !== undefined) nextAttempt.text = String(ev.oral_answer || '');
    if (Array.isArray(ev.evidence)) nextAttempt.evidence = ev.evidence;
    if (Array.isArray(ev.citations)) nextAttempt.citations = ev.citations;
    if (Array.isArray(ev.unknown_facts)) nextAttempt.unknownFacts = ev.unknown_facts;
    if (Array.isArray(ev.private_notes)) nextAttempt.privateNotes = ev.private_notes;
    if (Array.isArray(ev.diagnostics)) nextAttempt.diagnostics = ev.diagnostics;
    if (ev.dialogue_state) {
      nextAttempt.dialogueState = ev.dialogue_state;
      nextDialogueState = ev.dialogue_state;
    }
    contentUpdated = true;
  } else if (ev.kind === 'model' && ev.result) {
    const key = ev.result.endpointId || ev.result.id || ev.result.name;
    const list = nextAttempt.modelResults.slice();
    const existing = list.findIndex(r => (r.endpointId || r.id || r.name) === key);
    if (existing >= 0) list[existing] = { ...list[existing], ...ev.result };
    else list.push(ev.result);
    nextAttempt.modelResults = list;
    contentUpdated = true;
  } else if (ev.kind === 'done') {
    nextAttempt.status = 'done';
    nextAttempt.completedAt = now;
    nextAttempt.statusText = '';
    if (ev.text !== undefined) nextAttempt.text = String(ev.text);
    contentUpdated = true;
  } else if (ev.kind === 'error') {
    nextAttempt.status = 'error';
    nextAttempt.completedAt = now;
    nextAttempt.statusText = '';
    nextAttempt.error = String(ev.message || '请求失败');
    contentUpdated = true;
  } else {
    return session;
  }

  const nextAttempts = hit.question.attempts.slice();
  nextAttempts[hit.attemptIndex] = nextAttempt;
  const nextQuestion = { ...hit.question, updatedAt: now, attempts: nextAttempts };
  const questions = session.questions.slice();
  questions[hit.questionIndex] = nextQuestion;

  // Track unread newer questions without ever hijacking the user's current selection.
  let unreadQuestionIds = session.unreadQuestionIds || [];
  if (contentUpdated && session.selectedQuestionId && hit.question.id !== session.selectedQuestionId) {
    const selectedIdx = questions.findIndex(q => q.id === session.selectedQuestionId);
    if (selectedIdx >= 0 && hit.questionIndex > selectedIdx && !unreadQuestionIds.includes(hit.question.id)) {
      unreadQuestionIds = [...unreadQuestionIds, hit.question.id];
    }
  }

  return {
    ...session,
    updatedAt: now,
    dialogueState: nextDialogueState,
    questions,
    unreadQuestionIds
  };
}

export function selectQuestion(session, questionId) {
  if (!session.questions.some(q => q.id === questionId)) return session;
  const idx = session.questions.findIndex(q => q.id === questionId);
  const isLatest = idx === session.questions.length - 1;
  const unreadQuestionIds = isLatest
    ? []
    : (session.unreadQuestionIds || []).filter(id => id !== questionId);
  return {
    ...session,
    selectedQuestionId: questionId,
    unreadQuestionIds
  };
}

export function selectAttempt(session, questionId, attemptId) {
  const idx = session.questions.findIndex(q => q.id === questionId);
  if (idx < 0) return session;
  const q = session.questions[idx];
  if (!q.attempts.some(a => a.id === attemptId)) return session;
  const questions = session.questions.slice();
  questions[idx] = { ...q, activeAttemptId: attemptId };
  return { ...session, questions };
}

export function jumpToLatestQuestion(session) {
  if (!session.questions.length) return session;
  return {
    ...session,
    selectedQuestionId: session.questions[session.questions.length - 1].id,
    unreadQuestionIds: []
  };
}

export function countNewerQuestions(session) {
  return (session.unreadQuestionIds || []).length;
}

export function mergeQuestions(session, sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return session;
  const srcIdx = session.questions.findIndex(q => q.id === sourceId);
  const dstIdx = session.questions.findIndex(q => q.id === targetId);
  if (srcIdx < 0 || dstIdx < 0) return session;

  const firstIdx = Math.min(srcIdx, dstIdx);
  const secondIdx = Math.max(srcIdx, dstIdx);
  const first = session.questions[firstIdx];
  const second = session.questions[secondIdx];
  const now = Date.now();

  const mergedPrompt = `${first.prompt}\n${second.prompt}`.trim();
  const sourceSegmentIds = [...new Set([...(first.sourceSegmentIds || []), ...(second.sourceSegmentIds || [])])];
  const mergedFromOrdinals = [
    ...(first.mergedFromOrdinals?.length ? first.mergedFromOrdinals : [first.ordinal]),
    ...(second.mergedFromOrdinals?.length ? second.mergedFromOrdinals : [second.ordinal])
  ];

  // Keep target question's identity & history, updated with combined prompt
  const target = session.questions[dstIdx];
  const merged = {
    ...target,
    prompt: mergedPrompt,
    sourceSegmentIds,
    mergedFromOrdinals,
    updatedAt: now
  };

  const remaining = session.questions
    .filter(q => q.id !== sourceId)
    .map(q => (q.id === targetId ? merged : q))
    .map((q, i) => ({ ...q, ordinal: i + 1 }));

  return {
    ...session,
    updatedAt: now,
    questions: remaining,
    selectedQuestionId: merged.id,
    unreadQuestionIds: (session.unreadQuestionIds || []).filter(id => id !== sourceId && id !== targetId)
  };
}

export function setAttemptTranslation(session, questionId, attemptId, { translation, error = '' }) {
  const qi = session.questions.findIndex(q => q.id === questionId);
  if (qi < 0) return session;
  const q = session.questions[qi];
  const ai = q.attempts.findIndex(a => a.id === attemptId);
  if (ai < 0) return session;
  const nextAttempts = q.attempts.slice();
  nextAttempts[ai] = {
    ...q.attempts[ai],
    translation: translation !== undefined ? String(translation) : q.attempts[ai].translation,
    translationError: String(error || '')
  };
  const questions = session.questions.slice();
  questions[qi] = { ...q, attempts: nextAttempts };
  return { ...session, questions };
}

export function setSegmentTranslation(session, segmentId, { translation, error = '' }) {
  const idx = session.segments.findIndex(s => s.id === segmentId);
  if (idx < 0) return session;
  const segments = session.segments.slice();
  segments[idx] = {
    ...segments[idx],
    translation: translation !== undefined ? String(translation) : segments[idx].translation,
    translationError: String(error || '')
  };
  return { ...session, segments };
}

export function computePrimaryButtonState(draftText, selectedQuestion) {
  if (String(draftText || '').trim().length > 0) {
    return { action: 'send', label: '发送', disabled: false };
  }
  const active = getActiveAttempt(selectedQuestion);
  if (active && active.status === 'streaming') {
    return { action: 'stop', label: '停止生成', disabled: false };
  }
  if (selectedQuestion) {
    return { action: 'regenerate', label: '重新生成', disabled: false };
  }
  return { action: 'disabled', label: '发送', disabled: true };
}

export function buildLlmHistory(session, { excludeQuestionId = null, maxTurns = 6 } = {}) {
  const pairs = [];
  for (const q of session.questions) {
    if (excludeQuestionId && q.id === excludeQuestionId) continue;
    const active = getActiveAttempt(q);
    // Exclude cancelled, error, streaming, and interrupted attempts from LLM context.
    if (!active || active.status !== 'done' || !active.text.trim()) continue;
    pairs.push(
      { role: 'user', content: q.prompt },
      { role: 'assistant', content: active.text.trim() }
    );
  }
  return pairs.slice(-maxTurns * 2);
}

export function projectLegacyTurns(session) {
  return (session.questions || []).map(q => {
    const active = getActiveAttempt(q);
    return {
      id: active?.requestId || q.id,
      kind: q.kind,
      label: q.prompt,
      text: active?.text || '',
      status: active?.status || 'done',
      error: active?.error || '',
      evidence: active?.evidence || [],
      citations: active?.citations || [],
      unknownFacts: active?.unknownFacts || [],
      privateNotes: active?.privateNotes || [],
      diagnostics: active?.diagnostics || [],
      modelResults: active?.modelResults || [],
      images: active?.images || []
    };
  });
}

export function serializeSessionsForDisk(sessions, currentId) {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    currentId: currentId ?? null,
    sessions: sessions.map(s => {
      const { unreadQuestionIds, ...rest } = s;
      return {
        ...rest,
        turns: projectLegacyTurns(s)
      };
    })
  };
}
