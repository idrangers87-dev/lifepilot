// LifePilot 컨트롤러: 발화·키 → 의도 → 상태 머신 → 효과(촬영·서버 호출·표시·음성) 실행.
// 런타임 API는 모두 deps로 주입받아 Node 테스트에서 가짜로 바꿀 수 있다.

import { matchIntent, goalFrom } from './intent.js';
import { initialState, onIntent, onResult, onError, IDLE, ANALYZING, GUIDING, DONE } from './state.js';
import { render, speechFor } from './format.js';
import { keyAction } from './core/keys.js';
import { toAssistantError } from './core/errors.js';
import { ApiError } from './api.js';

const CAPTURE_CODES = {
  NEEDS_TAP: 'needs_tap',
  PERMISSION: 'camera_permission',
  UNAVAILABLE: 'camera_unavailable',
  UNCLEAR: 'bad_image',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
};

/** 어떤 예외든 strings.js errors 키를 가진 {code, retryable}로 바꾼다. */
export function toUiError(error) {
  if (error instanceof ApiError) {
    const code = error.code === 'session' ? 'unknown' : error.code;
    return { code, retryable: !!error.retryable };
  }
  const e = toAssistantError(error);
  return { code: CAPTURE_CODES[e.code] || 'unknown', retryable: true };
}

/**
 * @param {{
 *   setData: (patch: object) => void,
 *   config: object,
 *   deps: { api, captureStill, prepareImage, speak, listener, setTimeout, clearTimeout, now, storage: {get, set} },
 * }} options
 */
export function createController({ setData, config, deps }) {
  let st = initialState();
  const ctx = { goal: '', proposedGoal: '', sessionId: null, startedAt: 0, confirmed: 0, summary: null, slow: false, recentTask: '' };
  const debug = { open: !!config.debug, state: IDLE, lastIntent: '-', lastKind: '-', latencyMs: 0, clientLatencyMs: 0, warnings: [] };
  let analyzeGen = 0;
  let slowTimer = null;
  let homeTimer = null;

  try {
    ctx.recentTask = deps.storage.get('recentTask') || '';
  } catch (_) {}

  function clear(timer) {
    if (timer !== null) deps.clearTimeout(timer);
    return null;
  }

  function publish() {
    const { blocks, warnings } = render(st, { goal: ctx.goal || ctx.proposedGoal, recentTask: ctx.recentTask, slow: ctx.slow, summary: ctx.summary });
    if (warnings.length) debug.warnings = [...warnings, ...debug.warnings].slice(0, 5);
    debug.state = st.sub ? `${st.state}/${st.sub}` : st.state;
    setData({ screen: blocks, state: st.state, debug: { ...debug } });
  }

  function speak(text) {
    if (text) deps.speak(text);
  }

  function resetSession() {
    ctx.goal = '';
    ctx.proposedGoal = '';
    ctx.sessionId = null;
    ctx.confirmed = 0;
    ctx.summary = null;
    ctx.slow = false;
  }

  async function run(effects) {
    for (const effect of effects) {
      switch (effect.type) {
        case 'render':
          publish();
          break;
        case 'speak':
          speak(speechFor(st, effect.what));
          break;
        case 'newSession':
          resetSession();
          ctx.goal = effect.goal || '';
          ctx.startedAt = deps.now();
          homeTimer = clear(homeTimer);
          break;
        case 'analyze':
          await doAnalyze(effect);
          break;
        case 'cancelAnalyze':
          analyzeGen += 1;
          slowTimer = clear(slowTimer);
          break;
        case 'summary':
          await doSummary(effect.response);
          break;
        case 'endSession':
          homeTimer = clear(homeTimer);
          resetSession();
          break;
        case 'toggleDebug':
          debug.open = !debug.open;
          publish();
          break;
        default:
          break;
      }
    }
  }

  function transition(result) {
    st = result.next;
    return run(result.effects);
  }

  async function ensureSession(force) {
    if (ctx.sessionId && !force) return;
    const s = await deps.api.session(ctx.goal);
    ctx.sessionId = s.sessionId;
  }

  async function doAnalyze(req) {
    const gen = ++analyzeGen;
    const request = { type: 'analyze', utterance: req.utterance || '', userReply: req.userReply || '' };
    ctx.slow = false;
    publish();
    slowTimer = clear(slowTimer);
    slowTimer = deps.setTimeout(() => {
      if (gen === analyzeGen && st.state === ANALYZING) {
        ctx.slow = true;
        publish();
      }
    }, config.slowAfterMs);
    try {
      if (!deps.api.configured()) throw new ApiError('not_configured', false);
      await ensureSession(false);
      let shot = await deps.captureStill(); // 요청 1회 = 캡처 1회
      const image = await deps.prepareImage(shot);
      shot = null;
      const payload = { sessionId: ctx.sessionId, image: image.dataUrl, utterance: request.utterance, userReply: request.userReply };
      let res;
      try {
        res = await deps.api.analyze(payload);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'session') throw error;
        await ensureSession(true); // 서버 재시작 등으로 세션이 사라졌으면 새로 만들어 한 번 더
        res = await deps.api.analyze({ ...payload, sessionId: ctx.sessionId });
      }
      if (gen !== analyzeGen) return; // 취소됨
      slowTimer = clear(slowTimer);
      if (request.userReply === 'yes' && !ctx.goal && ctx.proposedGoal) ctx.goal = ctx.proposedGoal;
      if (res.goal && !ctx.goal) ctx.proposedGoal = res.goal;
      ctx.confirmed = res.stepIndex || 0;
      debug.lastKind = res.kind;
      debug.latencyMs = res.latencyMs || 0;
      debug.clientLatencyMs = res.clientLatencyMs || 0;
      if (Array.isArray(res.warnings) && res.warnings.length) debug.warnings = [...res.warnings, ...debug.warnings].slice(0, 5);
      await transition(onResult(st, res, request));
    } catch (error) {
      if (gen !== analyzeGen) return;
      slowTimer = clear(slowTimer);
      await transition(onError(st, toUiError(error), request));
    }
  }

  async function doSummary(response) {
    slowTimer = clear(slowTimer);
    const remote = await deps.api.summary(ctx.sessionId);
    const steps = remote && typeof remote.stepCount === 'number' ? remote.stepCount : ctx.confirmed;
    ctx.summary = { steps, elapsedMs: deps.now() - ctx.startedAt };
    publish();
    speak(speechFor(st, 'done', { speech: response && response.speech, steps }));
    const task = ctx.goal || ctx.proposedGoal;
    if (task) {
      ctx.recentTask = task;
      try {
        deps.storage.set('recentTask', task);
      } catch (_) {}
    }
    homeTimer = clear(homeTimer);
    homeTimer = deps.setTimeout(() => {
      if (st.state !== DONE) return;
      st = initialState();
      resetSession();
      publish();
    }, config.doneToHomeMs);
  }

  async function handleUtterance(text) {
    let intent = matchIntent(text);
    if (intent === 'unknown' && st.state === GUIDING) {
      const r = await deps.api.intent(ctx.sessionId, text); // 키워드로 못 잡은 것만 서버에 묻는다
      intent = (r && r.intent) || 'unknown';
    }
    debug.lastIntent = `${intent} ← "${String(text).slice(0, 16)}"`;
    if (st.state === DONE) homeTimer = clear(homeTimer);
    return transition(onIntent(st, intent, { goal: intent === 'start' ? goalFrom(text) : '' }));
  }

  /** 반드시 키·웨이크업 처리 중에 호출(ASR 시작은 상호작용 필요). */
  function listen() {
    if (!deps.listener) return;
    try {
      deps.listener.start(config.asrLang);
    } catch (_) {}
  }

  /** @returns {boolean} 페이지가 기본 동작을 막아야 하면 true */
  function handleKey(code) {
    const action = keyAction(code);
    if (!action) return false;
    if (action === 'back') {
      if (debug.open) {
        debug.open = false;
        publish();
        return true;
      }
      if (st.state === IDLE) return false; // 홈에서는 에이전트 닫기
      transition(onIntent(st, st.state === DONE ? 'next' : 'stop'));
      return true;
    }
    if (action === 'confirm') {
      if (st.state === IDLE || st.state === DONE || (st.state === GUIDING && st.sub === 'clarify')) {
        listen();
      } else if (st.state === GUIDING) {
        // 템플 탭 = "다음"(오류면 재시도). 상호작용 중이므로 촬영도 허용된다.
        transition(onIntent(st, st.sub === 'error' ? 'yes' : 'next'));
      }
      return true;
    }
    if (st.state !== GUIDING) return false;
    transition(onIntent(st, action === 'next' ? 'detail' : 'repeat'));
    return true;
  }

  function start() {
    publish();
  }

  function dispose() {
    analyzeGen += 1;
    slowTimer = clear(slowTimer);
    homeTimer = clear(homeTimer);
    if (deps.listener) deps.listener.abort();
  }

  return { start, dispose, handleUtterance, handleKey, listen, _get: () => ({ st, ctx, debug }) };
}
