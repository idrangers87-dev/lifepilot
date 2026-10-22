"""비전 모델 호출. 제공자 교체는 이 파일만 바꾸면 된다.

AnthropicProvider 설정 (환경 변수)
  ANTHROPIC_API_KEY        Anthropic API 키 (또는 `ant auth login` 프로필)
  LIFEPILOT_MODEL          기본 claude-opus-5-5
  LIFEPILOT_EFFORT         기본 low  (지연 목표 5초. 품질이 부족하면 medium)
  LIFEPILOT_MAX_TOKENS     기본 4000 (사고 토큰도 이 한도를 함께 쓰므로 400처럼 작게 두지 않는다)
  LIFEPILOT_TIMEOUT_S      기본 12
  LIFEPILOT_FALLBACKS      default | off  (거절 시 서버 측 대체 모델. 지원 모델에서만 켜진다)

가이드 원안과 다른 점: 최신 Claude 모델은 temperature를 받지 않고(400 오류),
사고 과정을 끌 수 없어 effort로 깊이를 조절한다. JSON 형식은 구조화 출력으로 강제한다.
"""

import json
import os

from schema import INTENT_JSON_SCHEMA, STEP_JSON_SCHEMA

FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}
PROMPT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts", "step-guide.md")


class ProviderError(Exception):
    """모델 호출 실패. retryable이면 안경이 '다시 시도'를 제안한다."""

    def __init__(self, message, retryable=True, code="model_unavailable"):
        super().__init__(message)
        self.retryable = retryable
        self.code = code


def load_prompt(path=PROMPT_PATH):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


class AnthropicProvider:
    def __init__(self, system_prompt=None):
        import anthropic  # 테스트(FakeProvider)에서는 SDK 없이도 돌도록 지연 import

        self.anthropic = anthropic
        self.model = os.environ.get("LIFEPILOT_MODEL", "claude-opus-5-5")
        self.effort = os.environ.get("LIFEPILOT_EFFORT", "low")
        self.max_tokens = int(os.environ.get("LIFEPILOT_MAX_TOKENS", "4000"))
        timeout = float(os.environ.get("LIFEPILOT_TIMEOUT_S", "12"))
        fallbacks = os.environ.get("LIFEPILOT_FALLBACKS", "default")
        self.use_fallbacks = fallbacks == "default" and self.model in FALLBACK_MODELS
        self.system_prompt = system_prompt or load_prompt()
        # 재시도는 서버 로직이 한 번만 한다(지연 목표 때문에 SDK 자동 재시도는 끈다).
        self.client = anthropic.Anthropic(timeout=timeout, max_retries=0)

    def _create(self, content, schema, system):
        kwargs = dict(
            model=self.model,
            max_tokens=self.max_tokens,
            system=system,
            output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
            messages=[{"role": "user", "content": content}],
        )
        a = self.anthropic
        try:
            if self.use_fallbacks:
                response = self.client.beta.messages.create(
                    betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs
                )
            else:
                response = self.client.messages.create(**kwargs)
        except a.APITimeoutError as e:
            raise ProviderError("timeout: %s" % e, retryable=True, code="timeout")
        except a.RateLimitError as e:
            raise ProviderError("rate limited: %s" % e, retryable=True)
        except (a.AuthenticationError, a.PermissionDeniedError, a.NotFoundError, a.BadRequestError) as e:
            raise ProviderError("request rejected: %s" % e, retryable=False)
        except a.APIStatusError as e:
            raise ProviderError("api error %s" % e.status_code, retryable=e.status_code >= 500)
        except a.APIConnectionError as e:
            raise ProviderError("connection error: %s" % e, retryable=True)

        if response.stop_reason == "refusal":
            raise ProviderError("model refused", retryable=False, code="refusal")
        if response.stop_reason == "max_tokens":
            raise ProviderError("output cut at max_tokens", retryable=True)
        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            return json.loads(text)
        except ValueError:
            raise ProviderError("model did not return JSON", retryable=True)

    def analyze(self, image_bytes, media_type, context, feedback=None):
        import base64

        text = "Context JSON:\n" + json.dumps(context, ensure_ascii=False)
        if feedback:
            text += "\n\nYour previous answer failed validation: %s\nReturn a corrected answer." % feedback
        content = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": base64.standard_b64encode(image_bytes).decode("ascii")},
            },
            {"type": "text", "text": text},
        ]
        return self._create(content, STEP_JSON_SCHEMA, self.system_prompt)

    def classify_intent(self, text):
        system = (
            "Classify a short Korean voice command from a user being guided through a hands-on task on smart glasses. "
            "Intents: start (asks how to do something), next (finished the step), recapture (look again / take a photo), "
            "repeat (say it again), detail (explain more), yes, no, stop (end), back (previous step), help (what can I say), "
            "unknown (anything else)."
        )
        result = self._create([{"type": "text", "text": text}], INTENT_JSON_SCHEMA, system)
        return result.get("intent", "unknown") if isinstance(result, dict) else "unknown"


class FakeProvider:
    """테스트·오프라인 시연용. responses는 dict, 예외, 또는 (image, context) -> dict 함수의 목록."""

    def __init__(self, responses=None, intents=None):
        self.responses = list(responses or [])
        self.intents = dict(intents or {})
        self.calls = []

    def analyze(self, image_bytes, media_type, context, feedback=None):
        self.calls.append({"media_type": media_type, "context": context, "feedback": feedback, "bytes": len(image_bytes)})
        if not self.responses:
            raise ProviderError("no fake response left")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item(image_bytes, context) if callable(item) else item

    def classify_intent(self, text):
        if text in self.intents:
            value = self.intents[text]
            if isinstance(value, Exception):
                raise value
            return value
        return "unknown"
