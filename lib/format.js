// 상태 → 화면 블록(lib/core/screen.js) + TTS 문자열. 문구는 strings.js에서만 가져온다.
// 렌즈 규칙: 한 줄 14자, 최대 3줄. 넘치면 서버 버그이므로 경고를 남기고 14자까지만 표시한다.

import { b, many, finalize } from './core/screen.js';
import { wrapLines } from './core/text.js';
import { S } from './strings.js';
import { IDLE, ANALYZING, GUIDING, DONE } from './state.js';

export const LENS_MAX = 14;
const DETAIL_CHARS = 26;

/** 14자 규칙 적용. warnings 배열에 넘친 줄을 기록한다. */
export function enforceLens(lines, warnings) {
  return (lines || []).slice(0, 3).map((line) => {
    const s = String(line);
    if (s.length > LENS_MAX) {
      warnings.push(`lens>${LENS_MAX}: ${s}`);
      return s.slice(0, LENS_MAX);
    }
    return s;
  });
}

function statusLine(goal, r) {
  const g = String(goal || r.goal || S.appName).slice(0, 8);
  return `${g} · ${r.stepIndex + 1}/${r.estimatedTotal}`;
}

/**
 * @param {object} st 상태 머신 상태
 * @param {{goal?: string, recentTask?: string, slow?: boolean, summary?: {steps: number, elapsedMs: number}}} ctx
 * @returns {{blocks: object[], warnings: string[]}}
 */
export function render(st, ctx = {}) {
  const warnings = [];
  let blocks;

  if (st.help) {
    blocks = [b('caption', S.appName), b('strong', S.helpTitle), ...many('body', S.helpLines)];
  } else if (st.state === IDLE) {
    blocks = [
      b('caption', S.appName),
      b('strong', S.homePrompt),
      b('body', S.homePrompt2),
      b('dim', ctx.recentTask ? S.homeRecent(String(ctx.recentTask).slice(0, 10)) : S.homeHint),
    ];
  } else if (st.state === ANALYZING) {
    blocks = [b('caption', ctx.goal ? String(ctx.goal).slice(0, 8) : S.appName), b('strong', ctx.slow ? S.analyzingSlow : S.analyzing)];
  } else if (st.state === DONE) {
    const sum = ctx.summary || { steps: 0, elapsedMs: 0 };
    blocks = [b('caption', S.appName), b('strong', S.doneLine(sum.steps, S.elapsed(sum.elapsedMs))), b('body', S.doneAsk)];
  } else if (st.sub === 'error') {
    const code = (st.error && st.error.code) || 'unknown';
    const msg = S.errors[code] || S.errors.unknown;
    blocks = [
      b('caption', S.appName),
      b('warn', msg.lens[0]),
      ...many('body', msg.lens.slice(1)),
      b('dim', code === 'needs_tap' ? S.hintTap : S.hintError),
    ];
  } else {
    const r = st.response;
    const head = b('caption', statusLine(ctx.goal, r));
    if (st.sub === 'recapture') {
      blocks = [head, b('strong', S.recaptureTitle), ...many('body', enforceLens([r.recaptureHint || r.lens[0]], warnings)), b('dim', S.hintRecapture)];
    } else if (st.sub === 'clarify') {
      blocks = [head, ...many('dim', enforceLens(r.lens, warnings).slice(0, 1)), b('question', r.question), b('dim', S.hintClarify)];
    } else {
      // step / safety: 안전 문구가 있으면 맨 위(100%), 동작은 70%로 낮추고 두 줄까지만
      const safety = r.safetyNote ? wrapLines(S.safetyPrefix + r.safetyNote, LENS_MAX + 2).slice(0, 2) : [];
      const lens = enforceLens(r.lens, warnings).slice(0, safety.length ? 2 : 3);
      blocks = [
        head,
        ...many('strong', safety),
        ...(safety.length ? many('body', lens) : [b('strong', lens[0]), ...many('body', lens.slice(1))]),
        ...(st.detailOpen ? many('dim', wrapLines(r.detail, DETAIL_CHARS)) : []),
        b('dim', S.hintStep),
      ];
    }
  }
  return { blocks: finalize(blocks), warnings };
}

/** 말할 문장. 상세 설명(detail)은 읽지 않는다. */
export function speechFor(st, what, ctx = {}) {
  switch (what) {
    case 'current':
      return st.response ? st.response.speech : '';
    case 'error': {
      const code = (st.error && st.error.code) || 'unknown';
      return (S.errors[code] || S.errors.unknown).speech;
    }
    case 'help':
      return S.speakHelp;
    case 'unknown':
      return S.speakUnknown;
    case 'idleUnknown':
      return S.speakIdleUnknown;
    case 'clarifyHint':
      return st.response && st.response.question ? st.response.question : S.speakUnknown;
    case 'done':
      return ctx.speech || S.speakDone(ctx.steps || 0);
    default:
      return '';
  }
}
