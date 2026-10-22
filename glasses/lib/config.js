// 안경 설정. 이 파일은 AIX 패키지로 배포되므로 모델 API 키는 절대 넣지 않는다.

export const CONFIG = {
  // 프록시 서버 주소 (HTTPS 권장. 개발 중에는 ngrok·Cloudflare Tunnel 주소)
  serverBaseUrl: '',
  // 서버의 LIFEPILOT_TOKEN과 같은 값(개인 프록시 접근용, 모델 키 아님)
  serverToken: '',
  requestTimeoutMs: 12000,
  intentTimeoutMs: 4000,
  // 서버 없이 화면·상태 흐름을 확인하는 목업: '' | 'scenario' | 'step' | 'recapture' | 'clarify' | 'safety' | 'done' | 'error'
  mockKind: '',
  asrLang: 'ko-KR',
  slowAfterMs: 3000,
  doneToHomeMs: 3000,
  debug: false,
};
