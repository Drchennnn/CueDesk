const BACKCHANNEL = /^(?:(?:好|好的|嗯|嗯嗯|哦|哦哦|行|可以|对|对的|是的|没错|明白|明白了|了解|了解了|清楚|知道了|收到|没事|没关系|谢谢|辛苦|继续|请继续|你继续|你说|请说|来|那行|挺好|很好|不错|ok|okay|yeah|yep|yes|right|sure|got it|i see|makes sense|uh-huh|mm-hmm|thank you|thanks)[，,。.!！?？\s]*)+$/i;

const QUESTION_SIGNAL = /[?？]|^(?:你|你们|请问|能|能否|可以|能不能|怎么|如何|为什么|为啥|啥|什么|哪个|哪些|是否|有没有|是不是|讲|讲讲|聊聊|说说|介绍|解释|描述|举例|对比|区别|如果|假设|假如|设计|实现|写一个|优化|排查|tell me|how |what |why |when |where |which |can you|could you|would you|do you|did you|have you|explain|describe|walk me through|design )/i;

const TRAILING_INCOMPLETE = /(?:然后|并且|而且|但是|不过|因为|所以|比如|比如说|就是|也就是说|或者|以及|关于|对于|针对|如果|假如|假设|这个|那个|呃|额|嗯|and|but|or|because|so|like|about|regarding|if)[，,\s]*$/i;

export function classifyTurn(text) {
  const t = String(text || '').trim();
  if (!t) return { action: 'ignore', reason: '空文本' };
  if (t.length <= 18 && BACKCHANNEL.test(t)) {
    return { action: 'ignore', reason: '简短确认或寒暄' };
  }
  if (t.length < 4 && !/[?？]/.test(t)) {
    return { action: 'wait', reason: '片段过短，等待继续表述' };
  }
  if (TRAILING_INCOMPLETE.test(t) && !/[?？。.!！]$/.test(t)) {
    return { action: 'wait', reason: '句尾尚未说完' };
  }
  if (QUESTION_SIGNAL.test(t) || t.length >= 12) {
    return { action: 'answer', reason: '完整提问或可回应话轮' };
  }
  return { action: 'wait', reason: '等待更多上下文' };
}

export function isLikelyQuestion(text) {
  return classifyTurn(text).action === 'answer';
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
  let combined = nextSegments.map(s => s.text).join(' ').trim();
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
 * MeetingCopilot's current backends (Whisper / FunASR / Cloud ASR / Realtime WS)
 * emit partial + final segments only, so same-question revision stays disabled
 * unless a backend explicitly advertises `supportsRevision: true`.
 */
export function resolveAsrCapabilities(asrInfo) {
  return {
    supportsPartial: true,
    supportsFinal: true,
    supportsRevision: Boolean(asrInfo?.supportsRevision === true)
  };
}
