// 모든 한국어 UI 문구는 여기에만 둔다 (CLAUDE.md 규칙).
// 렌즈 문구는 한 줄 14자 이내, 음성은 한 문장.

export const S = {
  appName: 'LifePilot',

  // 홈
  homePrompt: '"이거 어떻게 해?"',
  homePrompt2: '라고 말해',
  homeRecent: (task) => `최근: ${task}`,
  homeHint: '탭: 말하기 · 스와이프: 바로 시작',

  // 분석 중
  analyzing: '보는 중…',
  analyzingSlow: '조금만 더…',
  speakAnalyzing: '',

  // 안내 하단 힌트
  hintStep: '다음 · 다시 · 자세히',
  hintRecapture: '찍어',
  hintClarify: '응 · 아니',
  hintError: '다시 시도',
  hintTap: '버튼 눌러 촬영',

  // 재촬영
  recaptureTitle: '잘 안 보여',

  // 안전
  safetyPrefix: '⚠ ',

  // 완료
  doneLine: (steps, elapsed) => `완료 · ${steps}단계 · ${elapsed}`,
  doneAsk: '다른 일 도와줄까?',
  speakDone: (steps) => `완료. ${steps}단계 했어.`,
  elapsed: (ms) => {
    const sec = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(sec / 60);
    return m ? `${m}분 ${sec % 60}초` : `${sec}초`;
  },

  // 도움말
  helpTitle: '이렇게 말해',
  helpLines: ['다음 · 다시 · 그만', '찍어 · 자세히 · 이전', '응 · 아니'],
  speakHelp: '다음, 다시, 그만 중에 말해줘.',

  // 알아듣지 못함
  unknownLens: '다음·다시·그만?',
  speakUnknown: '다음, 다시, 그만 중에 말해줘.',
  idleUnknown: '이거 어떻게 해?',
  speakIdleUnknown: '이거 어떻게 해? 라고 말해줘.',

  // 오류 (렌즈 줄, 음성)
  errors: {
    camera_permission: { lens: ['카메라 권한이', '필요해'], speech: '카메라 권한이 필요해.' },
    camera_unavailable: { lens: ['카메라를', '쓸 수 없어'], speech: '카메라를 쓸 수 없어.' },
    needs_tap: { lens: ['버튼을 눌러', '찍어줘'], speech: '버튼을 눌러 찍어줘.' },
    network: { lens: ['연결이 안 돼', '와이파이 확인'], speech: '연결이 안 돼.' },
    timeout: { lens: ['생각이 길어져', '다시 시도?'], speech: '조금 느려. 다시 시도?' },
    model: { lens: ['잠시 후 다시'], speech: '잠시 후 다시 해줘.' },
    limit: { lens: ['오늘 한도에', '닿았어'], speech: '오늘 한도에 닿았어.' },
    auth: { lens: ['서버 인증 실패', '설정 확인'], speech: '서버 설정을 확인해줘.' },
    not_configured: { lens: ['서버 주소가', '설정 안 됐어'], speech: '서버 주소가 설정 안 됐어.' },
    bad_image: { lens: ['사진을 못 읽었어', '다시 찍어줘'], speech: '사진을 못 읽었어. 다시 찍어줘.' },
    unknown: { lens: ['문제가 생겼어', '다시 시도?'], speech: '문제가 생겼어. 다시 시도할까?' },
  },
};
