# LifePilot

눈앞의 일을 끝내게 해 주는 Rokid 글래스용 AI입니다. "이거 어떻게 해?"라고 말하면 사진 한 장으로 상황을 보고,
렌즈에 **지금 할 동작 하나**만 띄웁니다. "다음"이라고 하면 다시 찍고 다음 동작을 알려 줍니다.

```
glasses/   AIUI 에이전트 (Studio에서 이 폴더를 import → Package AIX)
server/    프록시 서버 (Python 3.13, anthropic SDK, Pillow) — API 키는 여기에만
tests/     안경 로직 테스트 (Node)
docs/      limitations.md(알려진 제약), checklist.md(시뮬레이터·실기 체크리스트)
```

## 구조

```
안경: 음성/탭 → 의도(로컬 키워드, 실패 시 서버 /intent) → 상태 머신(IDLE·ANALYZING·GUIDING·DONE)
      → 사진 1장(1024px JPEG로 축소 시도) ──POST /analyze──▶ 서버
서버: 세션 이력(텍스트만) + 프롬프트 + 이미지 → Claude(구조화 출력) → 스키마 검사·보정 → 안전 가드 → 응답 1개
안경: 렌즈 2~3줄(한 줄 14자) + 음성 1문장. 이미지는 어디에도 저장하지 않음
```

응답 종류: `step`(동작) · `recapture`(재촬영 지시) · `clarify`(예/아니오 질문) · `safety`(안전 문구 우선) · `done`(완료)

## 서버 실행

```bash
py -3.13 -m venv server/.venv
```

```bash
server/.venv/Scripts/python -m pip install -r server/requirements.txt
```

```bash
server/.venv/Scripts/python server/app.py
```

환경 변수: `ANTHROPIC_API_KEY`(또는 `ant auth login`), `LIFEPILOT_TOKEN`(안경 `lib/config.js`의 `serverToken`과 같게),
`LIFEPILOT_MODEL`(기본 `claude-opus-5-5`), `LIFEPILOT_EFFORT`(기본 `low`), `PORT`(기본 8788).
거절(refusal) 시 서버 측 대체 모델로 다시 시도하는 `fallbacks: "default"`가 지원 모델에서 기본으로 켜져 있습니다(`LIFEPILOT_FALLBACKS=off`로 끔).

안경에서 접속하려면 HTTPS 주소가 필요합니다(개발 중에는 ngrok·Cloudflare Tunnel).

## 테스트

```bash
server/.venv/Scripts/python -m unittest discover -s server/tests
```

```bash
node --test "tests/*.test.mjs"
```

```bash
node tools/validate-agent.mjs glasses
```

## 안경 배포
1. `glasses/lib/config.js`에 `serverBaseUrl`, `serverToken` 입력 (서버 없이 화면만 보려면 `mockKind: 'scenario'`)
2. AIUI Studio → New Agent → Import from GitHub → `https://github.com/idrangers87-dev/lifepilot/tree/aiui`
   - Studio 1.2.0은 `/tree/main/glasses`처럼 **하위 폴더 URL을 브랜치 이름으로 잘못 읽어** 실패한다("GitHub ref not found: main/glasses").
     그래서 `glasses/`를 루트로 올린 `aiui` 브랜치를 따로 두고 그 브랜치를 가져온다.
   - `glasses/`를 고친 뒤 `aiui` 브랜치 갱신:
     `git subtree split --prefix=glasses -b aiui` 후 `git push origin aiui` (이력이 이어지므로 강제 push 불필요)
3. Build & Review에서 Camera·Microphone·Network 권한 선언 → Package AIX
4. Hi Rokid 앱 → Settings → Developer → Update glasses resource package
5. "하이 로키드, 라이프파일럿 열어 줘"

배포할 때마다 `glasses/app.json`의 `version`을 올리세요.

## 3분 시연
세탁기 에러 → "이거 어떻게 해?" → (되묻기 "응") → 안전 문구 → 단계 3개("다음"/템플 탭) →
일부러 흐리게 찍어 재촬영 지시 → "그만" → "완료 · N단계 · 시간". 자세한 기준은 docs/checklist.md.

## 공용 코드
`glasses/lib/core/`는 비서 프로젝트(RokidAI/agent/lib)의 공용 모듈 복사본입니다(오류 분류, 렌즈 텍스트, 화면 블록,
키 매핑, 카메라, 음성). 원본에서 고치고 `node tools/sync-lifepilot-core.mjs`(RokidAI 루트)로 갱신합니다.
