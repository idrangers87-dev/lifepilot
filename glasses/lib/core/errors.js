// 자동 복사본 — 원본: RokidAI/agent/lib (수정은 원본에서 하고 tools/sync-lifepilot-core.mjs 실행)
// 모든 모드가 같은 오류 메시지를 쓰도록 한곳에 모은다.
// lens: 렌즈에 보일 짧은 문구, spoken: 그보다 더 짧은 음성 문구.

export const ERR = {
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  API_LIMIT: 'API_LIMIT',
  PERMISSION: 'PERMISSION',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  UNAVAILABLE: 'UNAVAILABLE',
  NEEDS_TAP: 'NEEDS_TAP',
  UNCLEAR: 'UNCLEAR',
  SERVER: 'SERVER',
  UNKNOWN: 'UNKNOWN',
};

const MESSAGES = {
  NETWORK: { lens: '네트워크 연결 실패 · 연결을 확인하세요', spoken: '네트워크에 연결할 수 없어요.' },
  TIMEOUT: { lens: '응답 시간 초과 · 다시 시도하세요', spoken: '응답이 늦어요. 다시 해 주세요.' },
  API_LIMIT: { lens: '사용량 한도 도달 · 잠시 후 다시', spoken: '사용량 한도예요. 잠시 후 다시 해 주세요.' },
  PERMISSION: { lens: '권한 거부 · 카메라/마이크 권한 확인', spoken: '권한이 없어요.' },
  NOT_CONFIGURED: { lens: '서비스 미연결 · config.js 설정 필요', spoken: '아직 연결되지 않았어요.' },
  UNAVAILABLE: { lens: '이 기기에서 지원하지 않는 기능', spoken: '지원되지 않는 기능이에요.' },
  NEEDS_TAP: { lens: '템플 버튼을 눌러 촬영하세요', spoken: '버튼을 눌러 주세요.' },
  UNCLEAR: { lens: '이미지가 불분명 · 다시 찍어 주세요', spoken: '잘 안 보여요. 다시 찍을게요.' },
  SERVER: { lens: '서버 오류 · 잠시 후 다시', spoken: '서버에 문제가 있어요.' },
  UNKNOWN: { lens: '알 수 없는 오류', spoken: '문제가 생겼어요.' },
};

export class AssistantError extends Error {
  constructor(code, detail = '', extra = {}) {
    super(detail || code);
    this.code = code;
    this.detail = detail;
    Object.assign(this, extra);
  }
}

/** 임의의 예외를 AssistantError 코드로 분류한다. */
export function toAssistantError(error) {
  if (error instanceof AssistantError) return error;
  const message = String((error && (error.message || error.errMsg)) || error || '');
  const lower = message.toLowerCase();
  if (/interact|gesture|gate/.test(lower)) return new AssistantError(ERR.NEEDS_TAP, message);
  if (/permission|denied|notallowed|not allowed|unauthori[sz]ed camera/.test(lower)) {
    return new AssistantError(ERR.PERMISSION, message);
  }
  if (/timeout|timed out/.test(lower)) return new AssistantError(ERR.TIMEOUT, message);
  if (/429|rate limit|quota|limit exceeded/.test(lower)) return new AssistantError(ERR.API_LIMIT, message);
  if (/network|offline|failed to fetch|connection|dns|socket/.test(lower)) {
    return new AssistantError(ERR.NETWORK, message);
  }
  if (/unavailable|not supported|undefined is not/.test(lower)) return new AssistantError(ERR.UNAVAILABLE, message);
  return new AssistantError(ERR.UNKNOWN, message);
}

export function messageFor(errorOrCode) {
  const code = typeof errorOrCode === 'string' ? errorOrCode : toAssistantError(errorOrCode).code;
  return MESSAGES[code] || MESSAGES.UNKNOWN;
}
