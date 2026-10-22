// 상태 머신 IDLE → ANALYZING → GUIDING → DONE (가이드 "상태 머신" 표).
// 순수 함수: (현재 상태, 입력) → { next, effects }. 부수효과는 컨트롤러가 effects를 보고 실행한다.

export const IDLE = 'IDLE';
export const ANALYZING = 'ANALYZING';
export const GUIDING = 'GUIDING';
export const DONE = 'DONE';

export function initialState() {
  return {
    state: IDLE,
    sub: null, // GUIDING 하위 상태: step | recapture | clarify | safety | error
    response: null, // 마지막 StepResponse
    error: null, // { code, retryable }
    detailOpen: false,
    help: false,
    lastRequest: null, // 오류 시 재시도할 analyze 요청
  };
}

const analyze = (utterance, userReply = '') => ({ type: 'analyze', utterance, userReply });

/**
 * @param {ReturnType<typeof initialState>} st
 * @param {string} intent matchIntent 결과
 * @param {{goal?: string}} extra
 */
export function onIntent(st, intent, extra = {}) {
  const base = { ...st, help: false };
  if (intent === 'debug') return { next: st, effects: [{ type: 'toggleDebug' }] };

  if (st.state === IDLE) {
    if (intent === 'start') {
      return { next: { ...base, state: ANALYZING }, effects: [{ type: 'newSession', goal: extra.goal || '' }, analyze('start')] };
    }
    if (intent === 'help') return { next: { ...base, help: true }, effects: [{ type: 'render' }, { type: 'speak', what: 'help' }] };
    return { next: base, effects: [{ type: 'render' }, { type: 'speak', what: 'idleUnknown' }] };
  }

  if (st.state === ANALYZING) {
    if (intent === 'stop') return { next: { ...base, state: DONE }, effects: [{ type: 'cancelAnalyze' }, { type: 'summary' }] };
    return { next: st, effects: [] }; // 분석 중에는 다른 입력을 무시한다
  }

  if (st.state === DONE) {
    return { next: initialState(), effects: [{ type: 'endSession' }, { type: 'render' }] };
  }

  // GUIDING
  const sub = st.sub;
  const toAnalyze = (req) => ({ next: { ...base, state: ANALYZING, detailOpen: false }, effects: [req] });
  const hint = { next: base, effects: [{ type: 'render' }, { type: 'speak', what: 'unknown' }] };

  switch (intent) {
    case 'start':
      return { next: { ...base, state: ANALYZING, detailOpen: false }, effects: [{ type: 'newSession', goal: extra.goal || '' }, analyze('start')] };
    case 'next':
      if (sub === 'step' || sub === 'safety') return toAnalyze(analyze('next'));
      if (sub === 'recapture') return toAnalyze(analyze('recapture'));
      if (sub === 'error') return toAnalyze(st.lastRequest || analyze('recapture'));
      return { next: base, effects: [{ type: 'render' }, { type: 'speak', what: 'clarifyHint' }] };
    case 'recapture':
      return toAnalyze(analyze('recapture'));
    case 'repeat':
      return { next: base, effects: [{ type: 'render' }, { type: 'speak', what: 'current' }] };
    case 'detail':
      if ((sub === 'step' || sub === 'safety') && st.response && st.response.detail) {
        return { next: { ...base, detailOpen: true }, effects: [{ type: 'render' }] };
      }
      return { next: base, effects: [{ type: 'render' }, { type: 'speak', what: 'current' }] };
    case 'yes':
      if (sub === 'clarify') return toAnalyze(analyze('', 'yes'));
      if (sub === 'error') return toAnalyze(st.lastRequest || analyze('recapture'));
      return hint;
    case 'no':
      if (sub === 'clarify') return toAnalyze(analyze('', 'no'));
      if (sub === 'error') return { next: initialState(), effects: [{ type: 'endSession' }, { type: 'render' }] };
      return hint;
    case 'back':
      return toAnalyze(analyze('back'));
    case 'stop':
      return { next: { ...base, state: DONE }, effects: [{ type: 'summary' }] };
    case 'help':
      return { next: { ...base, help: true }, effects: [{ type: 'render' }, { type: 'speak', what: 'help' }] };
    default:
      return hint;
  }
}

/** 서버 응답 도착 */
export function onResult(st, response, request) {
  if (st.state !== ANALYZING) return { next: st, effects: [] }; // 취소된 뒤 늦게 온 응답
  if (response.kind === 'done') {
    return { next: { ...st, state: DONE, response, sub: null, lastRequest: request }, effects: [{ type: 'summary', response }] };
  }
  return {
    next: { ...st, state: GUIDING, sub: response.kind, response, error: null, detailOpen: false, lastRequest: request },
    effects: [{ type: 'render' }, { type: 'speak', what: 'current' }],
  };
}

/** 캡처·네트워크·서버 오류 */
export function onError(st, error, request) {
  if (st.state !== ANALYZING) return { next: st, effects: [] };
  return {
    next: { ...st, state: GUIDING, sub: 'error', error, lastRequest: request },
    effects: [{ type: 'render' }, { type: 'speak', what: 'error' }],
  };
}
