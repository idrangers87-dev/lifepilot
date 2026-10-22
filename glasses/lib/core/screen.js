// 자동 복사본 — 원본: RokidAI/agent/lib (수정은 원본에서 하고 tools/sync-lifepilot-core.mjs 실행)
// 공통 화면 스키마. 모든 모드는 자기 상태를 블록 목록으로 바꾸는 render()만 제공하고,
// 페이지 템플릿은 블록 종류별 스타일 하나로 모든 모드를 그린다(모드 추가 시 템플릿 수정 불필요).
//
// 블록 종류 (단색 녹색: 위계는 크기·굵기·밝기로만)
//   headline  22px 100%   가장 중요한 한 줄 (답, 번역 자막)
//   strong    16px 100%   강조 문장
//   body      14px 72%    일반 본문
//   caption   10px 48%    라벨·메타
//   dim       12px 48%    보조 설명
//   faint     14px 24%    지나간 줄·비활성
//   guess     13px 48% 기울임  추측(확실하지 않음)
//   question  16px 100% 테두리  사용자 답이 필요한 질문
//   warn      14px 100% "!" 접두  오류·주의
// 선택 필드 style: 인라인 스타일 문자열(프롬프터 글자 크기 등). 없으면 ''.

export const KINDS = ['headline', 'strong', 'body', 'caption', 'dim', 'faint', 'guess', 'question', 'warn'];

export function b(kind, text, style = '') {
  return { kind, text: text == null ? '' : String(text), style };
}

/** 여러 줄을 같은 종류 블록으로. prefix는 각 줄 앞에 붙는다. */
export function many(kind, lines, prefix = '') {
  return (lines || []).filter((l) => l != null && String(l) !== '').map((l) => b(kind, prefix + l));
}

/** 빈 블록을 버리고 템플릿 ink:key용 id를 붙인다. */
export function finalize(blocks) {
  return (blocks || [])
    .filter((x) => x && x.text !== '' && KINDS.includes(x.kind))
    .map((x, i) => ({
      id: String(i),
      kind: x.kind,
      // 색으로 상태를 구분할 수 없으므로 경고는 기호로도 표시한다.
      text: x.kind === 'warn' ? `! ${x.text}` : x.text,
      style: x.style || '',
    }));
}
