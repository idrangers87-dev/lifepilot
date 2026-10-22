// 자동 복사본 — 원본: RokidAI/agent/lib (수정은 원본에서 하고 tools/sync-lifepilot-core.mjs 실행)
// 음성 입력(ASR)·출력(TTS). 문서: aiui-dev/references/apis/ai.md
// 발화 단위(turn-based)로만 듣는다. 지속 청취는 구현하지 않는다.

import wx from 'wx';

export function isRecognitionSupported() {
  return typeof SpeechRecognition !== 'undefined';
}

/**
 * 한 번 듣고 최종 결과를 콜백으로 준다.
 * @param {{onStart?: Function, onResult: (text: string) => void, onError: (err: any) => void, onEnd?: Function}} handlers
 */
export function createListener(handlers) {
  let recognition = null;
  let gotResult = false;

  function build(lang) {
    const r = new SpeechRecognition();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onstart = () => handlers.onStart && handlers.onStart();
    r.onresult = (event) => {
      const results = event && event.results;
      const parts = [];
      if (results && typeof results.length === 'number') {
        for (let i = 0; i < results.length; i += 1) {
          const alt = results[i] && results[i][0];
          if (alt && alt.transcript) parts.push(alt.transcript);
        }
      }
      const text = parts.join(' ').trim();
      if (text) {
        gotResult = true;
        handlers.onResult(text);
      }
    };
    r.onnomatch = () => {};
    r.onerror = (event) => {
      gotResult = true; // 오류를 보고했으니 "인식 못 함"을 중복 보고하지 않는다.
      handlers.onError({ message: `${(event && event.error) || 'error'}: ${(event && event.message) || ''}` });
    };
    r.onend = () => {
      if (!gotResult) handlers.onError({ message: 'nomatch', nomatch: true });
      if (handlers.onEnd) handlers.onEnd();
    };
    return r;
  }

  return {
    /** 반드시 사용자 상호작용(키·웨이크업·탭) 처리 중에 호출한다. */
    start(lang) {
      if (!isRecognitionSupported()) throw new Error('SpeechRecognition unavailable');
      this.abort();
      gotResult = false;
      recognition = build(lang);
      recognition.start();
    },
    stop() {
      if (recognition) {
        try {
          recognition.stop();
        } catch (_) {}
      }
    },
    abort() {
      if (recognition) {
        try {
          recognition.abort();
        } catch (_) {}
      }
      recognition = null;
    },
  };
}

/** 공유 플레이어로 바로 읽는다. 'immediate'는 이전 발화를 끊는다. */
export function speak(text, mode = 'immediate') {
  const clean = String(text || '').trim();
  if (!clean) return false;
  try {
    if (typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
      speechSynthesis.speak(new SpeechSynthesisUtterance(clean), mode);
      return true;
    }
    if (wx && wx.speech && typeof wx.speech.playTTS === 'function') {
      return wx.speech.playTTS(clean) !== '';
    }
  } catch (_) {}
  return false;
}
