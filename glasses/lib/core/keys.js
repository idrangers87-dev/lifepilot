// 자동 복사본 — 원본: RokidAI/agent/lib (수정은 원본에서 하고 tools/sync-lifepilot-core.mjs 실행)
// 키 코드 → 의미 동작 매핑. 모드는 의미 이름(confirm/back/next/prev)만 쓴다.
// 문서(aiui-dev events.md)로 확인된 것은 Rokid Glasses(1세대 단색)뿐이다.
// Glasses 2·컬러 모델은 키 코드가 미확인이므로 실기에서 확인한 뒤 표를 추가한다.

export const KEYMAPS = {
  'rokid-glasses': {
    confirm: ['Enter', 'GlobalHook'], // 템플 버튼 확인 / 템플 터치
    back: ['Backspace'],
    next: ['ArrowDown'],
    prev: ['ArrowUp'],
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
