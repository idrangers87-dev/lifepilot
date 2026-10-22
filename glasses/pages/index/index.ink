<script def>
{
  "navigationBarTitleText": "LifePilot",
  "description": "눈앞의 일을 한 단계씩 안내한다. 홈·안내·완료 화면을 한 페이지에서 그린다."
}
</script>

<script setup>
import { CONFIG } from '../../lib/config.js';
import { createController } from '../../lib/controller.js';
import { createApi } from '../../lib/api.js';
import { prepareImage } from '../../lib/image.js';
import { captureStill } from '../../lib/core/camera.js';
import { createListener, isRecognitionSupported, speak } from '../../lib/core/speech.js';

function storage() {
  return {
    get(key) {
      try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(`lifepilot.${key}`) : null;
      } catch (_) {
        return null;
      }
    },
    set(key, value) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(`lifepilot.${key}`, String(value));
      } catch (_) {}
    },
  };
}

export default {
  data: {
    state: 'IDLE',
    screen: [],
    listening: false,
    debug: { open: false, state: 'IDLE', lastIntent: '-', lastKind: '-', latencyMs: 0, clientLatencyMs: 0, warnings: [] },
  },

  onLoad() {
    const page = this;
    const listener = isRecognitionSupported()
      ? createListener({
          onStart() {
            page.setData({ listening: true });
            if (page.controller) page.controller.log('asr started');
          },
          onResult(text) {
            page.setData({ listening: false });
            if (page.controller) page.controller.handleUtterance(text);
          },
          onError(err) {
            page.setData({ listening: false });
            if (page.controller) page.controller.onListenError(err);
          },
          onEnd() {
            page.setData({ listening: false });
          },
        })
      : null;

    this.controller = createController({
      setData: (patch) => this.setData(patch),
      config: CONFIG,
      deps: {
        api: createApi(CONFIG, (url, options) => fetch(url, options)),
        captureStill,
        prepareImage,
        speak,
        listener,
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id),
        now: () => Date.now(),
        storage: storage(),
        log: (message) => console.log(message),
      },
    });
    this.controller.start();
  },

  onUnload() {
    if (this.controller) this.controller.dispose();
    this.controller = null;
  },

  onVoiceWakeup(event) {
    if (!this.controller) return;
    this.controller.log(`wakeup ${(event && event.keyword) || ''}`);
    this.controller.listen();
  },

  // 템플 동작마다 먼저 오는 GlobalHook은 lib/core/keys.js 표에 없어 무시되고,
  // 이어서 오는 Enter(탭)·Backspace(더블 탭)·ArrowUp/Down(스와이프)으로 동작을 구분한다.
  onKeyUp(event) {
    if (!event || !this.controller) return;
    if (this.controller.handleKey(event.code)) event.preventDefault();
  },

  tapListen() {
    if (this.controller) this.controller.listen();
  },
};
</script>

<page>
  <view class="screen" bindtap="tapListen">
    <view class="body">
      <text class="b b-{{item.kind}}" style="{{item.style}}" ink:for="{{screen}}" ink:key="id">{{item.text}}</text>
    </view>
    <text class="listening" ink:if="{{listening}}">● 듣는 중</text>
    <view class="debug" ink:if="{{debug.open}}">
      <text class="mono">state: {{debug.state}}</text>
      <text class="mono">intent: {{debug.lastIntent}}</text>
      <text class="mono">kind: {{debug.lastKind}} · server {{debug.latencyMs}}ms · total {{debug.clientLatencyMs}}ms</text>
      <text class="mono" ink:for="{{debug.warnings}}" ink:key="*this">! {{item}}</text>
    </view>
  </view>
</page>

<style>
/* 단색 녹색(monochrome-green.md), 480x352 기준. 위계는 크기·굵기·밝기로만. */
.screen {
  width: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  box-sizing: border-box;
  background: #000000;
  color: rgba(64, 255, 94, 0.72);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

.b {
  font-size: 16px;
  line-height: 24px;
  color: rgba(64, 255, 94, 0.72);
}

.b-headline {
  font-size: 26px;
  line-height: 34px;
  font-weight: 500;
  color: #40ff5e;
}

/* 동작 첫 줄·안전 문구: 굵게, 100% */
.b-strong {
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  color: #40ff5e;
}

/* 보조 줄: 약 70% */
.b-body {
  font-size: 20px;
  line-height: 28px;
  color: rgba(64, 255, 94, 0.72);
}

.b-caption {
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.05em;
  color: rgba(64, 255, 94, 0.48);
}

.b-dim {
  font-size: 13px;
  line-height: 19px;
  color: rgba(64, 255, 94, 0.48);
}

.b-faint {
  font-size: 14px;
  color: rgba(64, 255, 94, 0.24);
}

.b-guess {
  font-size: 14px;
  font-style: italic;
  color: rgba(64, 255, 94, 0.48);
}

.b-question {
  font-size: 22px;
  line-height: 30px;
  font-weight: 600;
  color: #40ff5e;
  padding: 8px 10px;
  border: 1px solid rgba(64, 255, 94, 0.72);
  border-radius: 4px;
}

.b-warn {
  font-size: 22px;
  line-height: 30px;
  font-weight: 600;
  color: #40ff5e;
}

.listening {
  font-size: 12px;
  color: #40ff5e;
}

.debug {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
  padding: 8px;
  border: 1px dashed rgba(64, 255, 94, 0.48);
  border-radius: 2px;
}

.mono {
  font-size: 11px;
  font-family: monospace;
  color: rgba(64, 255, 94, 0.72);
}
</style>
