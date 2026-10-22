// 프록시 서버 클라이언트. 타임아웃 12초, 재시도 가능한 오류는 1회 재시도.
// 오류는 { code, retryable, message }로 정규화한다. code는 strings.js의 errors 키와 같다.
// fetchImpl을 주입받아 Node 테스트에서도 돈다(런타임에서는 AIUI fetch).

const MOCK = {
  step: { kind: 'step', lens: ['커버를 열어', '하단 왼쪽'], speech: '하단 왼쪽 커버를 열어.', detail: '배수 필터는 보통 하단 왼쪽 작은 커버 안에 있어.' },
  recapture: { kind: 'recapture', lens: ['가까이 찍어'], speech: '잘 안 보여. 필터를 가까이 들어줘.', recaptureHint: '필터를 가까이 들어줘' },
  clarify: { kind: 'clarify', lens: ['E4 에러 같아'], speech: '세탁기 배수 오류 해결, 맞아?', question: '배수 오류 해결, 맞아?', goal: '세탁기 배수 오류 해결' },
  safety: { kind: 'safety', lens: ['전원 플러그 뽑기'], speech: '먼저 전원 플러그를 뽑아.', safetyNote: '전원 먼저 끄기' },
  done: { kind: 'done', lens: ['완료'], speech: '배수 필터 청소 완료.' },
};
const SCENARIO = ['clarify', 'safety', 'step', 'recapture', 'step', 'done'];

function mockResponse(kind, index) {
  return {
    stepIndex: index,
    estimatedTotal: 4,
    detail: '',
    safetyNote: '',
    confidence: 0.9,
    observed: [],
    recaptureHint: '',
    question: '',
    goal: '',
    ...MOCK[kind],
    latencyMs: 300,
  };
}

export class ApiError extends Error {
  constructor(code, retryable, message) {
    super(message || code);
    this.code = code;
    this.retryable = retryable;
  }
}

/** 임의 예외 → ApiError */
export function normalizeError(error) {
  if (error instanceof ApiError) return error;
  const msg = String((error && (error.message || error.errMsg)) || error || '').toLowerCase();
  if (/timeout/.test(msg)) return new ApiError('timeout', true, msg);
  return new ApiError('network', true, msg);
}

function fromStatus(status, data) {
  const code = data && data.error;
  if (status === 401 || status === 403) return new ApiError('auth', false, code);
  if (status === 404 && code === 'session_not_found') return new ApiError('session', false, code);
  if (status === 413 || status === 415 || code === 'bad_image') return new ApiError('bad_image', false, code);
  if (status === 429) return new ApiError('limit', false, code);
  if (status === 502) return new ApiError('model', !(data && data.retryable === false), code);
  if (status >= 500) return new ApiError('model', true, code);
  return new ApiError('unknown', false, code || `HTTP ${status}`);
}

export function createApi(config, fetchImpl, now = () => Date.now()) {
  const mockState = { index: 0, scenario: 0 };

  function withTimeout(promise, ms) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ApiError('timeout', true, `timeout ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function once(method, path, body, timeoutMs) {
    const headers = { 'Content-Type': 'application/json' };
    if (config.serverToken) headers['X-LifePilot-Token'] = config.serverToken;
    let res;
    try {
      res = await withTimeout(
        fetchImpl(config.serverBaseUrl.replace(/\/+$/, '') + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
        timeoutMs
      );
    } catch (error) {
      throw normalizeError(error);
    }
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (res.status >= 200 && res.status < 300 && data) return data;
    throw fromStatus(res.status, data);
  }

  async function call(method, path, body, timeoutMs = config.requestTimeoutMs) {
    try {
      return await once(method, path, body, timeoutMs);
    } catch (error) {
      if (!error.retryable) throw error;
      return once(method, path, body, timeoutMs); // 1회 재시도
    }
  }

  const mocking = () => !!config.mockKind;
  const configured = () => mocking() || /^https?:\/\//.test(config.serverBaseUrl || '');

  return {
    configured,

    async session(goal) {
      if (mocking()) {
        mockState.index = 0;
        mockState.scenario = 0;
        return { sessionId: 'mock', goal: goal || null };
      }
      if (!configured()) throw new ApiError('not_configured', false);
      return call('POST', '/session', { goal: goal || '', locale: 'ko' });
    },

    /** @param {{sessionId, image, utterance, userReply}} payload image는 data URL */
    async analyze(payload) {
      if (mocking()) {
        if (payload.utterance === 'next') mockState.index += 1;
        if (config.mockKind === 'error') throw new ApiError('model', true, 'mock error');
        const kind = config.mockKind === 'scenario' ? SCENARIO[Math.min(mockState.scenario++, SCENARIO.length - 1)] : config.mockKind;
        return mockResponse(kind, mockState.index);
      }
      if (!configured()) throw new ApiError('not_configured', false);
      const started = now();
      const data = await call('POST', '/analyze', payload);
      return { ...data, clientLatencyMs: now() - started };
    },

    async intent(sessionId, text) {
      if (mocking() || !configured()) return { intent: 'unknown' };
      try {
        return await once('POST', '/intent', { sessionId, text }, config.intentTimeoutMs);
      } catch (_) {
        return { intent: 'unknown' };
      }
    },

    async summary(sessionId) {
      if (mocking() || !configured() || !sessionId) return null;
      try {
        return await once('GET', `/session/${encodeURIComponent(sessionId)}`, undefined, config.intentTimeoutMs);
      } catch (_) {
        return null;
      }
    },
  };
}
