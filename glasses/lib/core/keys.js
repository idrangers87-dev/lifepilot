// 자동 복사본 — 원본: RokidAI/agent/lib (수정은 원본에서 하고 tools/sync-lifepilot-core.mjs 실행)
// 키 코드 → 의미 동작 매핑. 모드는 의미 이름(confirm/back/next/prev)만 쓴다.
//
// AIUI Studio 시뮬레이터(2026-10)에서 확인한 템플 입력:
//   모든 템플 동작은 먼저 GlobalHook이 오고, 이어서 동작별 키가 온다.
//   탭 → Enter, 더블 탭 → Backspace(뒤로), 앞으로 스와이프 → ArrowUp, 뒤로 스와이프 → ArrowDown
// 그래서 GlobalHook은 동작에 매핑하지 않는다(매핑하면 모든 제스처가 '확인'으로 한 번 더 처리된다).
// events.md도 "버튼 동작을 구분하려면 GlobalHook 대신 Enter/Backspace를 쓰라"고 한다.
// 실기(Glasses 1·2)의 키 코드는 아직 미확인이므로 실기 확인 후 표를 추가한다.

export const KEYMAPS = {
  'rokid-glasses': {
    confirm: ['Enter'], // 템플 탭
    back: ['Backspace'], // 템플 더블 탭
    next: ['ArrowDown'], // 뒤로 스와이프
    prev: ['ArrowUp'], // 앞으로 스와이프
  },
};

export const DEFAULT_DEVICE = 'rokid-glasses';

/** @returns {'confirm'|'back'|'next'|'prev'|null} */
export function keyAction(code, keymap = KEYMAPS[DEFAULT_DEVICE]) {
  for (const action of Object.keys(keymap)) {
    if (keymap[action].includes(code)) return action;
  }
  return null;
}
