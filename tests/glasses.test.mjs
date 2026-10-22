// LifePilot 안경 로직 테스트 (Node 내장 test runner). 런타임 API는 가짜로 주입한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchIntent, goalFrom } from '../glasses/lib/intent.js';
import { initialState, onIntent, onResult, onError, IDLE, ANALYZING, GUIDING, DONE } from '../glasses/lib/state.js';
import { render, speechFor } from '../glasses/lib/format.js';
import { createApi, ApiError } from '../glasses/lib/api.js';
import { createController } from '../glasses/lib/controller.js';
import { AssistantError, ERR } from '../glasses/lib/core/errors.js';

// ---------- 의도 ----------

test('의도: 가이드의 명령 사전(대표 + 변형)', () => {
  const table = {
    start: ['이거 어떻게 해', '이거 뭐야 어떻게 해', '도와줘', '세탁기 고치는 거 도와줘', '조립 도와줘'],
    next: ['다음', '됐어', '했어', '다음 단계', '완료'],
    recapture: ['찍어', '다시 봐줘', '다시 찍어'],
    repeat: ['다시', '뭐라고', '한 번 더'],
    detail: ['자세히', '더 설명해줘', '왜'],
    yes: ['응', '맞아', '네', '그래'],
    no: ['아니', '아니야', '틀렸어'],
    stop: ['그만', '끝', '종료', '나가'],
    back: ['이전', '전 단계', '되돌려'],
    help: ['뭐라고 말해야 해', '명령어 알려줘'],
  };
  for (const [intent, phrases] of Object.entries(table)) {
    for (const p of phrases) assert.equal(matchIntent(p), intent, p);
  }
  assert.equal(matchIntent('오늘 날씨 어때'), 'unknown');
  assert.equal(matchIntent(''), 'unknown');
});

test('의도: 시작 발화에서 목표 추출', () => {
  assert.equal(goalFrom('세탁기 고치는 거 도와줘'), '세탁기 고치기');
  assert.equal(goalFrom('책상 조립하는 거 도와줘'), '책상 조립');
  assert.equal(goalFrom('이거 어떻게 해'), '');
});

// ---------- 상태 머신 ----------

const resp = (kind, extra = {}) => ({
  kind, stepIndex: 0, estimatedTotal: 3, lens: ['커버를 열어'], speech: '커버를 열어.', detail: '왜냐하면', safetyNote: '',
  confidence: 0.9, observed: [], recaptureHint: kind === 'recapture' ? '가까이' : '', question: kind === 'clarify' ? '맞아?' : '', goal: '', ...extra,
});

function guiding(sub, response = resp(sub)) {
  return { ...initialState(), state: GUIDING, sub, response, lastRequest: { type: 'analyze', utterance: 'start', userReply: '' } };
}

test('상태 머신: 가이드 전이표', () => {
  let r = onIntent(initialState(), 'start', { goal: '세탁기' });
  assert.equal(r.next.state, ANALYZING);
  assert.deepEqual(r.effects.map((e) => e.type), ['newSession', 'analyze']);

  const analyzing = r.next;
  assert.equal(onResult(analyzing, resp('step')).next.sub, 'step');
  assert.equal(onResult(analyzing, resp('recapture')).next.sub, 'recapture');
  assert.equal(onResult(analyzing, resp('clarify')).next.sub, 'clarify');
  assert.equal(onResult(analyzing, resp('safety')).next.sub, 'safety');
  assert.equal(onResult(analyzing, resp('done')).next.state, DONE);
  assert.equal(onError(analyzing, { code: 'timeout' }).next.sub, 'error');
  assert.deepEqual(onIntent(analyzing, 'next').effects, []); // 분석 중 입력 무시

  assert.equal(onIntent(guiding('step'), 'next').effects[0].utterance, 'next');
  assert.equal(onIntent(guiding('recapture'), 'next').effects[0].utterance, 'recapture');
  assert.equal(onIntent(guiding('step'), 'recapture').effects[0].utterance, 'recapture');
  assert.equal(onIntent(guiding('step'), 'repeat').next.state, GUIDING);
  assert.equal(onIntent(guiding('step'), 'detail').next.detailOpen, true);
  assert.equal(onIntent(guiding('clarify'), 'yes').effects[0].userReply, 'yes');
  assert.equal(onIntent(guiding('clarify'), 'no').effects[0].userReply, 'no');
  assert.equal(onIntent(guiding('clarify'), 'next').next.state, GUIDING); // 질문엔 응/아니가 필요
  assert.equal(onIntent(guiding('step'), 'back').effects[0].utterance, 'back');
  assert.equal(onIntent(guiding('step'), 'stop').next.state, DONE);
  assert.equal(onIntent({ ...initialState(), state: DONE }, 'next').next.state, IDLE);

  const err = { ...guiding('error'), error: { code: 'timeout' } };
  assert.deepEqual(onIntent(err, 'yes').effects[0], err.lastRequest); // 같은 요청 재시도
  assert.equal(onIntent(err, 'no').next.state, IDLE);
});

// ---------- 표시 ----------

test('표시: 안전 문구가 먼저, 동작은 두 줄로 줄이고 70%', () => {
  const st = guiding('safety', resp('safety', { safetyNote: '전원 먼저 끄기', lens: ['전원 플러그 뽑기', '벽 쪽 콘센트', '세 번째 줄'] }));
  const { blocks } = render(st, { goal: '세탁기 배수 오류 해결' });
  assert.equal(blocks[0].text, '세탁기 배수 오 · 1/3');
  assert.deepEqual([blocks[1].kind, blocks[1].text], ['strong', '⚠ 전원 먼저 끄기']);
  assert.deepEqual(blocks.slice(2, 4).map((x) => x.kind), ['body', 'body']);
  assert.ok(!blocks.some((x) => x.text === '세 번째 줄'));
  assert.equal(blocks.at(-1).text, '다음 · 다시 · 자세히');
});

test('표시: 14자 넘는 줄은 경고 후 14자만', () => {
  const { blocks, warnings } = render(guiding('step', resp('step', { lens: ['필터를 반시계 방향으로 돌려 빼'] })));
  assert.equal(warnings.length, 1);
  assert.ok(blocks.every((x) => x.kind !== 'strong' || x.text.length <= 14));
});

test('표시: 하위 상태별 힌트, 상세는 요청 시에만, 음성엔 상세 없음', () => {
  assert.equal(render(guiding('recapture')).blocks.at(-1).text, '찍어');
  assert.equal(render(guiding('clarify')).blocks.at(-1).text, '응 · 아니');
  assert.ok(render(guiding('clarify')).blocks.some((x) => x.kind === 'question'));
  const step = guiding('step');
  assert.ok(!render(step).blocks.some((x) => x.text === '왜냐하면'));
  assert.ok(render({ ...step, detailOpen: true }).blocks.some((x) => x.text === '왜냐하면'));
  assert.equal(speechFor({ ...step, detailOpen: true }, 'current'), '커버를 열어.');
  const err = render({ ...guiding('error'), error: { code: 'needs_tap' } }).blocks;
  assert.equal(err.at(-1).text, '버튼 눌러 촬영');
});

// ---------- API 클라이언트 ----------

function fakeServer(analyzeQueue, extra = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const path = url.replace('http://srv', '');
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ path, method: options.method, body, headers: options.headers });
    const reply = (status, data) => ({ status, json: async () => data });
    if (path === '/session') return reply(200, { sessionId: `s${requests.filter((r) => r.path === '/session').length}`, goal: body.goal || null });
    if (path === '/analyze') {
      const next = analyzeQueue.shift();
      if (!next) return reply(502, { error: 'model_unavailable', retryable: true });
      if (next instanceof Error) throw next;
      if (next.status) return reply(next.status, next.data);
      return reply(200, { latencyMs: 1200, ...next });
    }
    if (path === '/intent') return reply(200, { intent: (extra.intents || {})[body.text] || 'unknown' });
    if (path.startsWith('/session/')) return reply(200, { stepCount: extra.stepCount ?? 2 });
    return reply(404, { error: 'not_found' });
  };
  return { fetchImpl, requests };
}

const CONFIG = { serverBaseUrl: 'http://srv', serverToken: 'tok', requestTimeoutMs: 50, intentTimeoutMs: 50, mockKind: '', asrLang: 'ko-KR', slowAfterMs: 3000, doneToHomeMs: 3000 };

test('API: 토큰 헤더, 재시도 가능한 오류는 1회 재시도, 오류 정규화', async () => {
  const { fetchImpl, requests } = fakeServer([{ status: 502, data: { error: 'model_unavailable', retryable: true } }, resp('step')]);
  const api = createApi(CONFIG, fetchImpl);
  const r = await api.analyze({ sessionId: 's1', image: 'data:image/jpeg;base64,AA' });
  assert.equal(r.kind, 'step');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers['X-LifePilot-Token'], 'tok');

  const api2 = createApi(CONFIG, fakeServer([{ status: 415, data: { error: 'unsupported_image' } }]).fetchImpl);
  await assert.rejects(api2.analyze({}), (e) => e instanceof ApiError && e.code === 'bad_image' && !e.retryable);

  const hang = createApi(CONFIG, () => new Promise(() => {}));
  await assert.rejects(hang.analyze({}), (e) => e.code === 'timeout');

  const none = createApi({ ...CONFIG, serverBaseUrl: '' }, fetchImpl);
  await assert.rejects(none.session(''), (e) => e.code === 'not_configured');
});

// ---------- 컨트롤러: 3분 시연 시나리오 ----------

function setup({ queue = [], extra = {}, config = {}, capture } = {}) {
  const server = fakeServer(queue, extra);
  const data = {};
  const spoken = [];
  const timers = [];
  let clock = 1_000_000;
  const stored = {};
  const captures = [];
  const listenerStarts = [];
  const controller = createController({
    setData: (p) => Object.assign(data, p),
    config: { ...CONFIG, ...config },
    deps: {
      api: createApi({ ...CONFIG, ...config }, server.fetchImpl, () => clock),
      captureStill: capture || (async () => {
        captures.push(1);
        return { dataUrl: 'data:image/webp;base64,UklGRg==', mimeType: 'image/webp', bytes: 4 };
      }),
      prepareImage: async (shot) => ({ dataUrl: shot.dataUrl, resized: false }),
      speak: (t) => spoken.push(t),
      listener: { start: (lang) => listenerStarts.push(lang), abort() {} },
      setTimeout: (fn, ms) => timers.push({ fn, ms }) - 1,
      clearTimeout: (id) => {
        if (timers[id]) timers[id].cleared = true;
      },
      now: () => clock,
      storage: { get: (k) => stored[k] || null, set: (k, v) => (stored[k] = v) },
    },
  });
  controller.start();
  const texts = () => data.screen.map((x) => x.text);
  const advance = (ms) => {
    clock += ms;
  };
  const fire = (ms) => timers.filter((t) => !t.cleared && t.ms === ms).forEach((t) => {
    t.cleared = true;
    t.fn();
  });
  return { controller, data, spoken, server, texts, advance, fire, stored, captures, listenerStarts };
}

test('시나리오: 세탁기 E4 — 되묻기 → 안전 → 단계 → 재촬영 → 완료 요약 → 홈', async () => {
  const t = setup({
    queue: [
      resp('clarify', { lens: ['E4 에러 같아'], question: '배수 오류 해결, 맞아?', goal: '세탁기 배수 오류 해결' }),
      resp('safety', { safetyNote: '전원 먼저 끄기', lens: ['전원 플러그 뽑기'], speech: '먼저 전원 플러그를 뽑아.' }),
      resp('step', { stepIndex: 1, lens: ['필터 커버를 열어'], speech: '하단 왼쪽 필터 커버를 열어.', safetyNote: '전원 먼저 끄기' }),
      resp('recapture', { stepIndex: 2, recaptureHint: '필터를 가까이 들어줘', speech: '잘 안 보여. 필터를 가까이 들어줘.' }),
      resp('step', { stepIndex: 2, lens: ['필터를 헹궈'], speech: '이물질을 빼고 흐르는 물에 헹궈.' }),
    ],
    extra: { stepCount: 3 },
  });
  assert.ok(t.texts().includes('"이거 어떻게 해?"'));

  await t.controller.handleUtterance('이거 어떻게 해?');
  assert.ok(t.texts().includes('배수 오류 해결, 맞아?'));
  await t.controller.handleUtterance('응');
  assert.equal(t.data.screen[1].text, '⚠ 전원 먼저 끄기');
  assert.equal(t.spoken.at(-1), '먼저 전원 플러그를 뽑아.');
  assert.equal(t.data.screen[0].text, '세탁기 배수 오 · 1/3'); // 확인된 목표가 상태줄에

  t.controller.handleKey('Enter'); // 템플 탭 = 다음
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(t.texts().includes('⚠ 전원 먼저 끄기'));
  assert.ok(t.texts().includes('필터 커버를 열어'));

  await t.controller.handleUtterance('다음');
  assert.ok(t.texts().includes('잘 안 보여'));
  assert.ok(t.texts().includes('필터를 가까이 들어줘'));
  await t.controller.handleUtterance('찍어');
  assert.ok(t.texts().includes('필터를 헹궈'));

  t.advance(160_000);
  await t.controller.handleUtterance('그만');
  assert.equal(t.data.state, DONE);
  assert.ok(t.texts().includes('완료 · 3단계 · 2분 40초'));
  assert.equal(t.spoken.at(-1), '완료. 3단계 했어.');
  t.fire(3000);
  assert.equal(t.data.state, IDLE);
  assert.ok(t.texts().includes('최근: 세탁기 배수 오류 '));

  const analyses = t.server.requests.filter((r) => r.path === '/analyze').map((r) => [r.body.utterance, r.body.userReply]);
  assert.deepEqual(analyses, [['start', ''], ['', 'yes'], ['next', ''], ['next', ''], ['recapture', '']]);
  assert.equal(t.captures.length, 5); // 요청 1회 = 캡처 1회
  assert.ok(t.server.requests.every((r) => r.path !== '/analyze' || r.body.image.startsWith('data:image/webp')));
});

test('서버가 done을 주면 완료 요약', async () => {
  const t = setup({ queue: [resp('step'), resp('done', { speech: '배수 필터 청소 완료.' })], extra: { stepCount: 1 } });
  await t.controller.handleUtterance('이거 어떻게 해');
  await t.controller.handleUtterance('다음');
  assert.equal(t.data.state, DONE);
  assert.equal(t.spoken.at(-1), '배수 필터 청소 완료.');
});

test('알 수 없는 발화는 서버 의도 분류, 그래도 모르면 안내', async () => {
  const t = setup({ queue: [resp('step'), resp('step', { stepIndex: 1, lens: ['다음 동작'] })], extra: { intents: { '이제 뭐 하면 돼': 'next' } } });
  await t.controller.handleUtterance('이거 어떻게 해');
  await t.controller.handleUtterance('이제 뭐 하면 돼');
  assert.ok(t.texts().includes('다음 동작'));
  await t.controller.handleUtterance('오늘 날씨 어때');
  assert.equal(t.spoken.at(-1), '다음, 다시, 그만 중에 말해줘.');
});

test('오류: 타임아웃 → 오류 화면 → "응"이면 같은 요청 재시도', async () => {
  const t = setup({ queue: [resp('step'), new Error('timeout'), new Error('timeout'), resp('step', { stepIndex: 1, lens: ['두 번째 동작'] })] });
  await t.controller.handleUtterance('이거 어떻게 해');
  await t.controller.handleUtterance('다음');
  assert.ok(t.texts().includes('! 생각이 길어져'));
  assert.equal(t.spoken.at(-1), '조금 느려. 다시 시도?');
  await t.controller.handleUtterance('응');
  assert.ok(t.texts().includes('두 번째 동작'));
  const last = t.server.requests.filter((r) => r.path === '/analyze').at(-1);
  assert.equal(last.body.utterance, 'next');
});

test('오류: 음성 직후 촬영이 막히면 버튼 안내, 탭으로 촬영', async () => {
  let n = 0;
  const t = setup({
    queue: [resp('step')],
    capture: async () => {
      n += 1;
      if (n === 1) throw new AssistantError(ERR.NEEDS_TAP, 'interaction gate');
      return { dataUrl: 'data:image/jpeg;base64,AA' };
    },
  });
  await t.controller.handleUtterance('이거 어떻게 해');
  assert.ok(t.texts().includes('! 버튼을 눌러'));
  t.controller.handleKey('Enter');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(t.texts().includes('커버를 열어'));
});

test('오류: 카메라 권한 거부면 서버에 보내지 않는다', async () => {
  const t = setup({ capture: async () => { throw new AssistantError(ERR.PERMISSION, 'denied'); } });
  await t.controller.handleUtterance('이거 어떻게 해');
  assert.ok(t.texts().includes('! 카메라 권한이'));
  assert.equal(t.server.requests.filter((r) => r.path === '/analyze').length, 0);
});

test('서버가 세션을 잃으면 새 세션으로 한 번 재시도', async () => {
  const t = setup({ queue: [{ status: 404, data: { error: 'session_not_found' } }, resp('step')] });
  await t.controller.handleUtterance('이거 어떻게 해');
  assert.ok(t.texts().includes('커버를 열어'));
  assert.equal(t.server.requests.filter((r) => r.path === '/session').length, 2);
});

test('서버 주소가 없으면 "설정 안 됐어"', async () => {
  const t = setup({ config: { serverBaseUrl: '' } });
  await t.controller.handleUtterance('이거 어떻게 해');
  assert.ok(t.texts().includes('! 서버 주소가'));
});

test('분석 중 "그만"이면 늦게 온 응답을 무시', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const t = setup({ capture: async () => { await gate; return { dataUrl: 'data:image/jpeg;base64,AA' }; }, queue: [resp('step')] });
  const pending = t.controller.handleUtterance('이거 어떻게 해');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(t.data.state, ANALYZING);
  await t.controller.handleUtterance('다음'); // 무시
  assert.equal(t.data.state, ANALYZING);
  await t.controller.handleUtterance('그만');
  release();
  await pending;
  assert.equal(t.data.state, DONE);
});

test('3초 넘으면 "조금만 더…"', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const t = setup({ capture: async () => { await gate; return { dataUrl: 'data:image/jpeg;base64,AA' }; }, queue: [resp('step')] });
  const pending = t.controller.handleUtterance('이거 어떻게 해');
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(t.texts().includes('보는 중…'));
  t.fire(3000);
  assert.ok(t.texts().includes('조금만 더…'));
  release();
  await pending;
});

test('서버 응답 줄이 14자를 넘으면 디버그 경고', async () => {
  const t = setup({ queue: [resp('step', { lens: ['필터를 반시계 방향으로 두 바퀴'] })] });
  await t.controller.handleUtterance('이거 어떻게 해');
  assert.equal(t.data.debug.warnings.length, 1);
  assert.equal(t.data.debug.lastKind, 'step');
});

test('목업 모드: 서버 없이 시나리오 흐름 확인', async () => {
  const t = setup({ config: { serverBaseUrl: '', mockKind: 'scenario' } });
  await t.controller.handleUtterance('이거 어떻게 해');
  assert.ok(t.texts().includes('배수 오류 해결, 맞아?'));
  await t.controller.handleUtterance('응');
  assert.ok(t.texts().includes('⚠ 전원 먼저 끄기'));
});

test('음성 인식 시작 실패는 삼키지 않고 디버그 경고와 로그로 남긴다', async () => {
  const logs = [];
  const data = {};
  const controller = createController({
    setData: (p) => Object.assign(data, p),
    config: CONFIG,
    deps: {
      api: createApi(CONFIG, fakeServer([]).fetchImpl),
      listener: { start() { throw Object.assign(new Error('not interactive'), { name: 'InvalidStateError' }); }, abort() {} },
      speak() {},
      setTimeout: () => 0,
      clearTimeout() {},
      now: () => 0,
      storage: { get: () => null, set() {} },
      log: (m) => logs.push(m),
    },
  });
  controller.start();
  controller.handleKey('Enter');
  assert.equal(data.debug.warnings[0], 'asr start failed: InvalidStateError');
  assert.ok(logs.some((l) => l.includes('key Enter → confirm (IDLE)')));
  controller.onListenError({ message: 'permission denied' });
  assert.equal(data.debug.warnings[0], 'asr error: permission denied');
});

test('홈에서 스와이프하면 말 없이 바로 시작(촬영·분석)', async () => {
  for (const code of ['ArrowDown', 'ArrowUp']) {
    const t = setup({ queue: [resp('step', { lens: ['커버를 열어'] })] });
    assert.equal(t.controller.handleKey(code), true);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(t.texts().includes('커버를 열어'), code);
    assert.deepEqual(t.server.requests.filter((r) => r.path === '/analyze').map((r) => r.body.utterance), ['start']);
    assert.deepEqual(t.listenerStarts, []); // 음성 인식은 켜지 않는다
  }
});

test('시뮬레이터 템플 신호: GlobalHook은 무시하고 뒤따르는 키로만 동작', () => {
  const t = setup();
  assert.equal(t.controller.handleKey('GlobalHook'), false);
  assert.deepEqual(t.listenerStarts, []);
  t.controller.handleKey('Enter');
  assert.deepEqual(t.listenerStarts, ['ko-KR']); // 탭 한 번 = 듣기 한 번
});

test('키: 홈에서 뒤로는 기본 동작, 안내 중 뒤로는 종료, 아래=자세히, 위=다시', async () => {
  const t = setup({ queue: [resp('step', { detail: '필터는 왼쪽 아래에 있어' })] });
  assert.equal(t.controller.handleKey('Backspace'), false);
  t.controller.handleKey('Enter');
  assert.deepEqual(t.listenerStarts, ['ko-KR']); // 홈에서 탭 = 말하기
  await t.controller.handleUtterance('이거 어떻게 해');
  t.controller.handleKey('ArrowDown');
  assert.ok(t.texts().includes('필터는 왼쪽 아래에 있어'));
  const before = t.spoken.length;
  t.controller.handleKey('ArrowUp');
  assert.equal(t.spoken.length, before + 1);
  assert.equal(t.controller.handleKey('Backspace'), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(t.data.state, DONE);
});
