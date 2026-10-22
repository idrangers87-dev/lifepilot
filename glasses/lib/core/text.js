// 자동 복사본 — 원본: RokidAI/agent/lib (수정은 원본에서 하고 tools/sync-lifepilot-core.mjs 실행)
// 렌즈 표시용 텍스트 유틸. 480x352 단색 녹색 화면에서 한 줄 글자 수를 제한한다.
// 실제 렌즈 가독성은 실기에서 다시 정한다(가이드북 3단계).

export const LINE_CHARS = {
  caption: 18, // 통역 자막 (22px)
  body: 26, // 일반 응답 (14px)
  prompter: 14, // 프롬프터 기본 (26px)
};

/** 공백 기준으로 줄을 나누고, 공백 없는 긴 덩어리는 글자 수로 자른다. */
export function wrapLines(text, maxChars) {
  const limit = Math.max(4, maxChars | 0);
  const lines = [];
  const paragraphs = String(text || '').split(/\n+/);
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = '';
    for (let word of words) {
      while (word.length > limit) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(word.slice(0, limit));
        word = word.slice(limit);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= limit) line += ' ' + word;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** 원고를 문장 단위로 나눈 뒤 프롬프터 줄로 만든다. */
export function scriptToLines(script, maxChars = LINE_CHARS.prompter) {
  const sentences = String(script || '')
    .replace(/\r/g, '')
    .replace(/([.!?。])\s+/g, '$1\n')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lines = [];
  for (const sentence of sentences) lines.push(...wrapLines(sentence, maxChars));
  return lines;
}

/** 음성 응답은 렌즈보다 짧게: 첫 문장(또는 maxChars)까지만. */
export function shortSpoken(text, maxChars = 60) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const first = clean.replace(/([.!?。])\s/, '$1\n').split('\n')[0] || clean;
  return first.length > maxChars ? first.slice(0, maxChars) : first;
}

/** 렌즈 첫 화면용: 앞의 n줄만. 나머지가 있으면 more=true. */
export function firstLines(text, maxChars, n) {
  const lines = wrapLines(text, maxChars);
  return { lines: lines.slice(0, n), more: lines.length > n, all: lines };
}

/** LLM 응답에서 JSON 객체를 뽑는다. 코드펜스나 앞뒤 설명이 섞여도 처리한다. */
export function extractJson(text) {
  const raw = String(text || '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}
