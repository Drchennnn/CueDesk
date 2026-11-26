/**
 * Real-time Interview Turn Policy, Lossless Turn Aggregator, Question Revision &
 * Speaker-Echo Text Deduplication.
 *
 * Pure JS (zero React/DOM dependencies) so every timing branch & edge case is
 * deterministically unit-testable.
 */

const BACKCHANNEL = /^(?:(?:好|好的|嗯|嗯嗯|哦|哦哦|行|可以|对|对的|是的|没错|明白|明白了|了解|了解了|清楚|知道了|收到|没事|没关系|谢谢|辛苦|继续|请继续|你继续|你说|请说|来|那行|挺好|很好|不错|ok|okay|yeah|yep|yes|right|sure|got it|i see|makes sense|uh-huh|mm-hmm|thank you|thanks)[，,。.!！?？\s]*)+$/i;

const QUESTION_SIGNAL = /[?？]|^(?:你|你们|请问|能|能否|可以|能不能|怎么|如何|为什么|为啥|啥|什么|哪个|哪些|是否|有没有|是不是|讲|讲讲|聊聊|说说|介绍|解释|描述|举例|对比|区别|设计|实现|写一个|优化|排查|tell me|how |what |why |when |where |which |can you|could you|would you|do you|did you|have you|explain|describe|walk me through|design )|(?:为什么|为何|怎么|如何|区别|原理|优缺点|怎么实现|怎么设计|怎么排查|怎么优化|介绍一下|讲一下|说一下|聊一下|举个例子|吗|呢)[。.!！?？\s]*$/i;

const TRAILING_INCOMPLETE = /(?:然后|并且|而且|但是|不过|因为|所以|比如|比如说|比方说|例如|就是|也就是说|或者|或者说|以及|关于|对于|针对|如果|假如|假设|还是|这个|那个|呃|额|嗯|and|but|or|because|so|like|about|regarding|if)[，,、…\s]*$/i;

const TOPIC_SWITCH_SIGNAL = /^(?:(?:好|好的|那|行|嗯|ok|okay)[，,。\s]*)?(?:下一题|下一个问题|换个话题|换一个话题|不聊这个|先不说这个|接下来问|下面问|再来问|那我们来聊|我们换|next question|moving on|another question|let'?s move on)/i;

export const SEGMENTATION_TIMINGS = Object.freeze({
  fast: Object.freeze({
    tierAMs: 120,
    tierBMs: 480,
    tierCMs: 1200,
    partialExtendMs: 450,
    maxHoldMs: 1500,
    revisionWindowMs: 3200,
    revisionCoalesceMs: 140
  }),
  balanced: Object.freeze({
    tierAMs: 180,
    tierBMs: 620,
    tierCMs: 1500,
    partialExtendMs: 550,
    maxHoldMs: 1800,
    revisionWindowMs: 3500,
    revisionCoalesceMs: 160
  }),
  long: Object.freeze({
    tierAMs: 320,
    tierBMs: 950,
    tierCMs: 2000,
    partialExtendMs: 750,
    maxHoldMs: 2500,
    revisionWindowMs: 4200,
    revisionCoalesceMs: 220
  })
});

export function getSegmentationTimings(mode) {
  const key = String(mode || '').trim().toLowerCase();
  return SEGMENTATION_TIMINGS[key] || SEGMENTATION_TIMINGS.balanced;
}

export function joinTurnPieces(pieces) {
  let out = '';
  for (const raw of pieces || []) {
    const piece = String(raw || '').trim();
    if (!piece) continue;
    if (!out) {
      out = piece;
      continue;
    }
    const prevLast = out[out.length - 1];
    const nextFirst = piece[0];
    const bothAsciiWord = /[A-Za-z0-9]/.test(prevLast) && /[A-Za-z0-9]/.test(nextFirst);
    const endsWithPunct = /[，,。.!！?？；;：:\s]/.test(prevLast);
    if (bothAsciiWord) out += ` ${piece}`;
    else if (endsWithPunct) out += piece;
    else if (/[\u4e00-\u9fff]/.test(prevLast) && /[\u4e00-\u9fff]/.test(nextFirst)) out += `，${piece}`;
    else out += ` ${piece}`;
  }
  return out.trim();
}

export function classifyTurn(text) {
  const t = String(text || '').trim();
  if (!t) return { action: 'ignore', tier: 'D', reason: '空文本' };
  if (t.length <= 18 && BACKCHANNEL.test(t)) {
    return { action: 'ignore', tier: 'D', reason: '简短确认或寒暄' };
  }
  if (t.length < 4 && !/[?？]/.test(t)) {
    return { action: 'wait', tier: 'C', reason: '片段过短，等待继续表述' };
  }
  const hasEndQuestion = /[?？]\s*$/.test(t);
  if (!hasEndQuestion && TRAILING_INCOMPLETE.test(t) && !/[。.!！]\s*$/.test(t)) {
    return { action: 'wait', tier: 'C', reason: '句尾尚未说完' };
  }
  if (QUESTION_SIGNAL.test(t)) {
    return { action: 'answer', tier: 'A', reason: '完整提问或明确指令' };
  }
  if (t.length >= 10) {
    return { action: 'answer', tier: 'B', reason: '较完整陈述，短缓冲等待下文' };
  }
  return { action: 'wait', tier: 'C', reason: '等待更多上下文' };
}

export function isLikelyQuestion(text) {
  return classifyTurn(text).action === 'answer';
}

export function isTopicSwitchSignal(text) {
  return TOPIC_SWITCH_SIGNAL.test(String(text || '').trim());
}

function normalizeForEcho(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s，,。.!！?？、…；;：:""''"''（）()\[\]【】\-—_~`]/g, '');
}

function charBigrams(str) {
  const map = new Map();
  for (let i = 0; i < str.length - 1; i++) {
    const bg = str.slice(i, i + 2);
    map.set(bg, (map.get(bg) || 0) + 1);
  }
  return map;
}

function bigramContainment(shortStr, longStr) {
  if (!shortStr || !longStr) return 0;
  if (longStr.includes(shortStr)) return 1;
  if (shortStr.length < 2 || longStr.length < 2) return shortStr === longStr ? 1 : 0;
  const a = charBigrams(shortStr);
  const b = charBigrams(longStr);
  let overlap = 0;
  let totalA = 0;
  for (const [k, cnt] of a.entries()) {
    totalA += cnt;
    const other = b.get(k) || 0;
    if (other > 0) overlap += Math.min(cnt, other);
  }
  return totalA > 0 ? overlap / totalA : 0;
}

/**
 * Text-level speaker-echo deduplicator:
 * In Windows system-audio mode with external speakers, interviewer speech can
 * leak acoustically into the user's mic ("me" channel) 50ms–2500ms later.
 * Comparing each incoming "me" segment against recent "them" segments within
 * `windowMs` catches leaked speaker echo with zero latency overhead on "them".
 */
export function isEchoOfRecentThem(meText, recentThemSegments = [], nowTs = Date.now(), {
  windowMs = 3500,
  minContainment = 0.65
} = {}) {
  const normMe = normalizeForEcho(meText);
  if (normMe.length < 2) return { isEcho: false, score: 0, matchedSegmentId: null };

  const recent = (Array.isArray(recentThemSegments) ? recentThemSegments : []).filter((seg) => {
    if (!seg || (seg.speaker && seg.speaker !== 'them')) return false;
    const ts = Number(seg.endTs ?? seg.startTs ?? 0);
    return !ts || Math.abs(nowTs - ts) <= windowMs;
  });
  if (!recent.length) return { isEcho: false, score: 0, matchedSegmentId: null };

  // Check individual recent segments plus the concatenation of the last 2–3 them segments
  const candidates = recent.map((s) => ({ id: s.id ?? null, norm: normalizeForEcho(s.text) }));
  if (recent.length >= 2) {
    const tail = recent.slice(-3);
    candidates.push({
      id: tail[tail.length - 1]?.id ?? null,
      norm: tail.map((s) => normalizeForEcho(s.text)).join('')
    });
  }

  let bestScore = 0;
  let bestId = null;
  for (const cand of candidates) {
    if (!cand.norm) continue;
    if (normMe.length <= 3) {
      if (cand.norm === normMe || (cand.norm.length >= normMe.length && cand.norm.endsWith(normMe))) {
        return { isEcho: true, score: 1, matchedSegmentId: cand.id };
      }
      continue;
    }
    const shorter = normMe.length <= cand.norm.length ? normMe : cand.norm;
    const longer = normMe.length <= cand.norm.length ? cand.norm : normMe;
    // Avoid false positive when a 2-char word matches inside a huge sentence
    if (shorter.length < 4) continue;
    const score = bigramContainment(shorter, longer);
    if (score > bestScore) {
      bestScore = score;
      bestId = cand.id;
    }
  }
  return {
    isEcho: bestScore >= minContainment,
    score: Number(bestScore.toFixed(3)),
    matchedSegmentId: bestScore >= minContainment ? bestId : null
  };
}

/**
 * Lossless low-latency Turn Aggregator + Speculative Question Revision.
 *
 * Solves two problems simultaneously:
 * 1. Never drops earlier clauses when an interviewer pauses briefly mid-question.
 * 2. Eliminates redundant 1050ms waiting after cloud ASR already waited 600ms:
 *    - Tier A (explicit question): 120–180ms dispatch
 *    - Tier B (complete statement): 480–620ms short buffer to merge follow-up clause
 *    - Tier C (incomplete fragment): 1200–1500ms buffer
 *    - Tier D (backchannel): ignored without disturbing buffer or revision window
 *    - Speculative Revision: if interviewer appends a qualifier within 3.5s of an
 *      auto-dispatched question (before user speaks and without switching topic),
 *      revises that same question in place instead of creating a fragmented new card.
 */
export function createTurnAggregator({
  getMode = () => 'balanced',
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onDispatch = () => null,
  onRevise = () => {},
  onBufferChange = () => {}
} = {}) {
  let pending = []; // Array<{ id, text, ts }>
  let firstPendingAt = 0;
  let flushTimer = null;
  let flushDeadlineAt = 0;

  let lastDispatched = null; // { questionId, prompt, sourceSegmentIds, at }
  let revPending = []; // Array<{ id, text, ts }>
  let revTimer = null;

  function emitBufferPreview() {
    const pieces = revPending.length ? revPending : pending;
    onBufferChange(joinTurnPieces(pieces.map((p) => p.text)));
  }

  function clearFlushTimer() {
    if (flushTimer !== null) {
      clearTimer(flushTimer);
      flushTimer = null;
      flushDeadlineAt = 0;
    }
  }

  function clearRevTimer() {
    if (revTimer !== null) {
      clearTimer(revTimer);
      revTimer = null;
    }
  }

  function flushNormal() {
    clearFlushTimer();
    if (!pending.length) return;
    const batch = pending.slice();
    pending = [];
    firstPendingAt = 0;
    emitBufferPreview();

    const prompt = joinTurnPieces(batch.map((b) => b.text));
    const verdict = classifyTurn(prompt);
    if (!prompt || verdict.tier === 'D') return;
    // Drop isolated tiny fragments (< 4 chars without question mark) on timeout
    if (verdict.tier === 'C' && prompt.length < 4 && !/[?？]/.test(prompt)) return;

    const sourceSegmentIds = batch.map((b) => b.id).filter((id) => Number.isFinite(Number(id)));
    const dispatchedAt = now();
    const returned = onDispatch({ prompt, sourceSegmentIds, tier: verdict.tier });
    const questionId = typeof returned === 'string' ? returned : (returned?.questionId || null);
    if (questionId) {
      lastDispatched = {
        questionId,
        prompt,
        sourceSegmentIds,
        at: dispatchedAt
      };
    }
  }

  function flushRevision() {
    clearRevTimer();
    if (!revPending.length || !lastDispatched) {
      revPending = [];
      emitBufferPreview();
      return;
    }
    const batch = revPending.slice();
    revPending = [];
    emitBufferPreview();

    const appendedText = joinTurnPieces(batch.map((b) => b.text));
    if (!appendedText) return;
    const addedSegmentIds = batch.map((b) => b.id).filter((id) => Number.isFinite(Number(id)));
    const fullPrompt = joinTurnPieces([lastDispatched.prompt, appendedText]);
    const targetQuestionId = lastDispatched.questionId;

    lastDispatched = {
      questionId: targetQuestionId,
      prompt: fullPrompt,
      sourceSegmentIds: [...new Set([...lastDispatched.sourceSegmentIds, ...addedSegmentIds])],
      at: now()
    };

    onRevise({
      questionId: targetQuestionId,
      appendedText,
      fullPrompt,
      addedSegmentIds
    });
  }

  function scheduleFlush(delayMs) {
    const t = getSegmentationTimings(getMode());
    const currentNow = now();
    const elapsed = firstPendingAt ? Math.max(0, currentNow - firstPendingAt) : 0;
    const remainingCap = Math.max(40, t.maxHoldMs - elapsed);
    const effectiveDelay = Math.min(Math.max(40, delayMs), remainingCap);
    clearFlushTimer();
    flushDeadlineAt = currentNow + effectiveDelay;
    flushTimer = setTimer(flushNormal, effectiveDelay);
  }

  function onSegment({ id = null, text = '', ts = now() } = {}) {
    const clean = String(text || '').trim();
    if (!clean) return;
    const singleVerdict = classifyTurn(clean);
    if (singleVerdict.tier === 'D') {
      // Backchannel ("嗯/好的/明白"): ignore completely without disturbing buffer or revision window.
      return;
    }

    const timings = getSegmentationTimings(getMode());
    const currentNow = now();

    // Speculative Question Revision path:
    // If no normal buffer is active and a fresh auto-dispatched question is within revisionWindowMs
    // and this segment isn't an explicit topic switch, coalesce & revise that same question!
    const inRevisionWindow = Boolean(
      pending.length === 0 &&
      lastDispatched &&
      (currentNow - lastDispatched.at) <= timings.revisionWindowMs &&
      !isTopicSwitchSignal(clean)
    );

    if (inRevisionWindow) {
      revPending.push({ id, text: clean, ts });
      emitBufferPreview();
      const combinedRev = joinTurnPieces(revPending.map((p) => p.text));
      const revVerdict = classifyTurn(combinedRev);
      const revDelay = revVerdict.tier === 'C' ? timings.partialExtendMs : timings.revisionCoalesceMs;
      clearRevTimer();
      revTimer = setTimer(flushRevision, revDelay);
      return;
    }

    // Normal aggregation path: flush any leftover revision first if topic switched
    if (revPending.length > 0) {
      flushRevision();
    }
    if (isTopicSwitchSignal(clean)) {
      lastDispatched = null;
    }

    if (!pending.length) firstPendingAt = currentNow;
    pending.push({ id, text: clean, ts });
    emitBufferPreview();

    const combined = joinTurnPieces(pending.map((p) => p.text));
    const verdict = classifyTurn(combined);
    const targetDelay = verdict.tier === 'A'
      ? timings.tierAMs
      : verdict.tier === 'B'
        ? timings.tierBMs
        : timings.tierCMs;
    scheduleFlush(targetDelay);
  }

  function onPartial(text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    const timings = getSegmentationTimings(getMode());
    const currentNow = now();

    if (revTimer !== null && revPending.length > 0) {
      clearRevTimer();
      revTimer = setTimer(flushRevision, timings.partialExtendMs);
      return;
    }
    if (flushTimer !== null && pending.length > 0) {
      const elapsed = firstPendingAt ? Math.max(0, currentNow - firstPendingAt) : 0;
      if (elapsed < timings.maxHoldMs - 100) {
        const nextRemaining = Math.min(timings.partialExtendMs, timings.maxHoldMs - elapsed);
        if (currentNow + nextRemaining > flushDeadlineAt) {
          scheduleFlush(nextRemaining);
        }
      }
    }
  }

  function onMeSpeech() {
    // Once the candidate starts answering, close the revision window so the interviewer's
    // next remark becomes a fresh follow-up question rather than mutating the answered question.
    if (revPending.length > 0) flushRevision();
    lastDispatched = null;
  }

  function notifyManualQuestion() {
    lastDispatched = null;
  }

  function reset() {
    clearFlushTimer();
    clearRevTimer();
    pending = [];
    firstPendingAt = 0;
    revPending = [];
    lastDispatched = null;
    emitBufferPreview();
  }

  return {
    onSegment,
    onPartial,
    onMeSpeech,
    notifyManualQuestion,
    reset,
    dispose: reset,
    getDebugState: () => ({
      pendingCount: pending.length,
      revPendingCount: revPending.length,
      lastDispatched: lastDispatched ? { ...lastDispatched } : null
    })
  };
}

export function createManualDraftState() {
  return {
    epoch: 1,
    audioSource: 'system',
    segments: [],
    text: '',
    maxChars: 2400
  };
}

export function appendManualDraft(state, segment) {
  const piece = String(segment?.text || '').trim();
  if (!piece) return state;
  const nextSegments = [...state.segments, { id: segment.id ?? null, text: piece, ts: segment.endTs || Date.now() }];
  let combined = joinTurnPieces(nextSegments.map(s => s.text));
  if (combined.length > state.maxChars) {
    combined = combined.slice(combined.length - state.maxChars);
  }
  return {
    ...state,
    segments: nextSegments,
    text: combined
  };
}

export function clearManualDraft(state, { nextAudioSource } = {}) {
  return {
    ...state,
    epoch: state.epoch + 1,
    audioSource: nextAudioSource || state.audioSource,
    segments: [],
    text: ''
  };
}

export function commitManualDraft(state) {
  const prompt = state.text.trim();
  const sourceSegmentIds = state.segments.map(s => s.id).filter(id => Number.isFinite(Number(id)));
  const cleared = clearManualDraft(state);
  return {
    prompt,
    sourceSegmentIds,
    nextState: cleared
  };
}

export function handleAudioSourceSwitch(state, nextAudioSource, policy = 'clear') {
  if (state.audioSource === nextAudioSource) {
    return { switched: false, droppedText: '', nextState: state };
  }
  if (policy === 'keep') {
    return {
      switched: true,
      droppedText: '',
      nextState: { ...state, audioSource: nextAudioSource }
    };
  }
  return {
    switched: true,
    droppedText: state.text,
    nextState: clearManualDraft(state, { nextAudioSource })
  };
}

/**
 * Determine whether the active ASR backend exposes a revision protocol.
 * MeetingCopilot now implements local speculative question revision in TurnAggregator.
 */
export function resolveAsrCapabilities(asrInfo) {
  return {
    supportsPartial: true,
    supportsFinal: true,
    supportsRevision: Boolean(asrInfo?.supportsRevision === true),
    supportsLocalRevision: true
  };
}
