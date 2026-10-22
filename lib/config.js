// 안경 설정. 이 파일은 AIX 패키지로 배포되므로 모델 API 키는 절대 넣지 않는다.

export const CONFIG = {
  // 프록시 서버 주소 (HTTPS 권장. 개발 중에는 ngrok·Cloudflare Tunnel 주소)
  serverBaseUrl: '',
  // 서버의 LIFEPILOT_TOKEN과 같은 값(개인 프록시 접근용, 모델 키 아님)
  serverToken: '',
  requestTimeoutMs: 12000,
  intentTimeoutMs: 4000,
  captureTimeoutMs: 15000, // 촬영(시뮬레이터에서는 확인 창 포함) 제한
  prepareTimeoutMs: 5000, // 안경에서 이미지 축소 제한(넘으면 원본 전송)
  // 안경에서 Canvas로 이미지를 줄일지. Studio 시뮬레이터(1.2.0)에서 축소 중 런타임이 멈춰
  // 기본은 끄고 원본을 보내 서버(Pillow)가 줄인다. 실기에서 업로드가 느리면 켜서 시험한다.
  resizeOnDevice: false,
  // 서버 없이 화면·상태 흐름을 확인하는 목업: '' | 'scenario' | 'step' | 'recapture' | 'clarify' | 'safety' | 'done' | 'error'
  mockKind: '',
  asrLang: 'ko-KR',
  slowAfterMs: 3000,
  doneToHomeMs: 3000,
  debug: false,
};
