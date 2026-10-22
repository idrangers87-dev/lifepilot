# 알려진 제약 (Known limitations)

심사 자료의 "알려진 제약" 항목은 이 문서에서 나온다. 숨기지 않고 먼저 적는다.

## 문서로 확인했지만 실기 미검증
| 항목 | 근거 | 확인 방법 / 대체 |
| --- | --- | --- |
| 음성 결과 콜백에서 `takePhoto()` 호출 | wx.md: "requires an interactive call site" | 막히면 "버튼을 눌러 찍어줘" → 템플 탭으로 촬영(구현됨) |
| 카메라 출력 형식 | 공식 scanner 샘플이 WebP를 디코딩 | 서버가 JPEG/PNG/WebP 모두 받음 |
| 안경에서 1024px JPEG로 축소 | canvas.md `convertToBlob`, window.md `createImageBlob`, media.md `createImageBitmap` | 실패하면 원본 전송, 서버가 축소 |
| 한국어 음성 인식 `ko-KR` | ai.md: 언어 지원은 런타임별로 다름 | 시뮬레이터에서 먼저 확인 |
| 한국어 TTS | ai.md: 음성 목록은 중국어·영어, `utterance.lang` 미지원 | 발음 어색하면 렌즈 문구 의존 |
| 키 코드 | Studio 시뮬레이터에서 확인: 모든 템플 동작 앞에 GlobalHook, 이어서 탭=Enter·더블 탭=Backspace·앞 스와이프=ArrowUp·뒤 스와이프=ArrowDown. 실기(Glasses 1·2) 미확인 | lib/core/keys.js 표 추가 |
| 시뮬레이터 음성 입력 | 웨이크업·탭 후 앱 음성 인식은 시작되지만, 확장 프로그램으로 넣은 텍스트는 앱에 전달되지 않았음 | 홈에서 스와이프로 바로 시작(음성 없이) |

## 의도적으로 하지 않는 것
- 연속 영상 분석, 손 추적, 제스처 인식 (요청 1회 = 캡처 1회)
- 제품 DB·가격·재고 조회, 사용자 계정·결제, 다국어 UI
- 긴 문단 음성 낭독 (렌즈 3줄 + 음성 1문장 원칙)

## 서버
- 세션은 메모리 저장: 서버 재시작 시 사라짐. 안경은 `session_not_found`를 받으면 새 세션으로 한 번 재시도한다.
  Agent Store 등록 전 Redis로 교체 필요(`SESSION_STORE`, 인터페이스만 있음).
- 기본 모델 `claude-opus-5-5`, effort `low`. 5초 목표는 실측 전. 느리면 `LIFEPILOT_MODEL`·`LIFEPILOT_EFFORT`로 조정.
- 안경↔서버 인증은 공용 토큰(`LIFEPILOT_TOKEN`)이며 AIX 패키지에 포함된다. 개인·시연용 수준.
- 금칙어 필터는 정규식 기반 최소 목록.

## 가이드 원안과 바꾼 점
| 원안 | 변경 | 이유 |
| --- | --- | --- |
| 화면 640×480 | 480×352 | 공식 디자인 문서 기준 |
| multipart JPEG 업로드, 1.5MB | JSON data URL, JPEG/PNG/WebP, 8MB(서버 축소) | 카메라가 WebP를 줄 수 있음, 표준 라이브러리 파싱 |
| Node.js + Express + zod 서버 | Python 3.13 + http.server + anthropic SDK | 기존 비서 서버 구조 재사용, PC에 Node 미설치 |
| temperature 0.2, max_tokens 400 | effort low, max_tokens 4000, 구조화 출력 | 최신 모델은 temperature 거부·사고 토큰이 한도를 함께 씀 |
| 검증 실패 → 재요청 | 고칠 수 있는 위반(줄 나눔·첫 문장)은 서버가 고치고, 나머지만 재요청 | 지연·비용 절감 |
| pages/index·guide·summary·debug 4개 | 한 페이지 + 상태별 화면 | 페이지 간 상태 전달이 필요 없음 |
| "카메라 API 미지원이 최대 리스크" | 해소: 문서·공식 샘플에 있음 | 남은 리스크는 상호작용 요구(탭 폴백 구현) |
