// 발화 → 10개 의도. 네트워크 없이 즉시 반응해야 하므로 키워드 규칙으로 먼저 처리한다.
// 매칭되지 않으면 'unknown' → 컨트롤러가 서버 /intent로 한 번 더 물어본다.

export const INTENTS = ['start', 'next', 'recapture', 'repeat', 'detail', 'yes', 'no', 'stop', 'back', 'help'];

export function normalize(text) {
  return String(text || '')
    .replace(/[.,!?~·…"']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 순서가 중요하다: "다시 찍어"(재촬영)를 "다시"(반복)보다, "뭐라고 말해"(도움)를 "뭐라고"(반복)보다 먼저 본다.
const RULES = [
  ['debug', /^디버그/],
  ['stop', /^(그만|끝|종료|나가|그만해|끝내)/],
  ['help', /(뭐라고\s*말해|명령어|도움말|뭐라고\s*해야)/],
  ['recapture', /^(찍어|다시\s*봐|다시\s*찍|사진\s*찍|한\s*장\s*더)/],
  ['back', /^(이전|전\s*단계|되돌려|뒤로|앞\s*단계)/],
  ['next', /^(다음|됐어|했어|완료|다\s*했어|끝났어|오케이)/],
  ['detail', /^(자세히|더\s*설명|왜|설명해)/],
  ['no', /^(아니|아뇨|틀렸|틀려)/],
  ['yes', /^(응|맞아|네|예|그래|좋아|어\s*맞아)(\s|$|요)/],
  ['repeat', /^(다시|뭐라고|한\s*번\s*더|못\s*들었)/],
  ['start', /(어떻게\s*해|도와\s*줘|도와줄래|고치는\s*거|조립|이거\s*뭐야)/],
];

export function matchIntent(text) {
  const t = normalize(text);
  if (!t) return 'unknown';
  for (const [intent, re] of RULES) if (re.test(t)) return intent;
  return 'unknown';
}

/** "세탁기 고치는 거 도와줘" → "세탁기 고치기". 목표가 없으면 ''. */
export function goalFrom(text) {
  const t = normalize(text);
  const m = t.match(/^(.+?)\s*(고치는|조립하는|조립|설정하는|설정|청소하는|청소|연결하는|연결|하는)\s*(거|것)?\s*(좀\s*)?도와/);
  if (!m) return '';
  const verb = { 고치는: '고치기', 조립하는: '조립', 조립: '조립', 설정하는: '설정', 설정: '설정', 청소하는: '청소', 청소: '청소', 연결하는: '연결', 연결: '연결', 하는: '하기' }[m[2]];
  return `${m[1]} ${verb}`.slice(0, 60);
}
