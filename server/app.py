"""LifePilot 프록시 서버 (Python 3.10+, 표준 http.server + anthropic SDK + Pillow).

엔드포인트 (모든 응답에 latencyMs 포함)
  GET  /health
  POST /session       {goal?, locale?}                        → {sessionId, goal}
  POST /analyze       {sessionId, image(data URL), utterance?, userReply?} → StepResponse
  POST /intent        {sessionId?, text}                      → {intent}
  GET  /session/<id>                                          → 단계 이력·소요 시간

가이드 원안(multipart JPEG)과 달리 이미지는 JSON 안의 data URL로 받는다.
표준 라이브러리만으로 파싱할 수 있고, 안경 카메라가 WebP를 돌려줘도 그대로 받을 수 있다.

환경 변수: LIFEPILOT_TOKEN(안경 config와 같은 값), PORT(8788), HOST, LIMIT_PER_SESSION(30),
LIMIT_PER_DAY(300), SESSION_STORE(memory), 그 밖의 모델 설정은 vision.py 참고.
"""

import json
import os
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from safety import LIMIT_RESPONSE, GuardError, Limits, apply_safety, decode_image, filter_banned, resize_for_model
from schema import INTENTS, SAFE_RECAPTURE, normalize_step
from session import create_store
from vision import ProviderError

MAX_BODY = 12 * 1024 * 1024

# 네트워크 없이 처리하는 1차 의도 매칭(안경 lib/intent.js와 같은 규칙의 축약판)
LOCAL_INTENTS = [
    ("stop", re.compile(r"^(그만|끝|종료|나가)")),
    ("next", re.compile(r"^(다음|됐어|했어|완료|다음\s*단계)")),
    ("recapture", re.compile(r"^(찍어|다시\s*봐|다시\s*찍)")),
    ("repeat", re.compile(r"^(다시|뭐라고|한\s*번\s*더)")),
    ("detail", re.compile(r"^(자세히|더\s*설명|왜)")),
    ("yes", re.compile(r"^(응|맞아|네|그래)")),
    ("no", re.compile(r"^(아니|틀렸)")),
    ("back", re.compile(r"^(이전|전\s*단계|되돌려)")),
    ("help", re.compile(r"(뭐라고\s*말해|명령어)")),
    ("start", re.compile(r"(어떻게\s*해|도와줘)")),
]


def local_intent(text):
    t = re.sub(r"[\s.,!?~]+", " ", str(text or "")).strip()
    for name, pattern in LOCAL_INTENTS:
        if pattern.search(t):
            return name
    return None


class LifePilot:
    """요청 처리 로직. HTTP와 분리해 테스트에서 직접 호출할 수 있다."""

    def __init__(self, provider, store=None, limits=None):
        self.provider = provider
        self.store = store or create_store(os.environ.get("SESSION_STORE", "memory"))
        self.limits = limits or Limits(
            per_session=int(os.environ.get("LIMIT_PER_SESSION", "30")),
            per_day=int(os.environ.get("LIMIT_PER_DAY", "300")),
        )

    def create_session(self, body):
        goal = str(body.get("goal") or "").strip()[:60] or None
        s = self.store.create(goal)
        return 200, {"sessionId": s["id"], "goal": s["goal"]}

    def get_session(self, session_id):
        s = self.store.get(session_id)
        if not s:
            return 404, {"error": "session_not_found", "retryable": False}
        return 200, {
            "sessionId": s["id"],
            "goal": s["goal"] or s["proposedGoal"],
            "steps": s["steps"],
            "stepCount": len(s["steps"]),
            "elapsedMs": int((s["updatedAt"] - s["createdAt"]) * 1000),
            "lastKind": s["lastKind"],
            "analyzeCount": s["analyzeCount"],
            "totalLatencyMs": s["totalLatencyMs"],
        }

    def _apply_user_signal(self, s, utterance, reply):
        """사용자가 확인한 것만 이력에 반영한다."""
        current = s["current"]
        if utterance == "next" and current and current["kind"] in ("step", "safety"):
            s["steps"].append(
                {"index": len(s["steps"]), "lens": current["lens"], "speech": current["speech"], "confirmedAt": time.time()}
            )
            s["current"] = None
        elif utterance == "back" and s["steps"]:
            s["steps"].pop()
        if reply == "yes" and s["proposedGoal"] and not s["goal"]:
            s["goal"] = s["proposedGoal"]
        elif reply == "no" and not s["goal"]:
            s["proposedGoal"] = None

    def analyze(self, body):
        s = self.store.get(str(body.get("sessionId") or ""))
        if not s:
            return 404, {"error": "session_not_found", "retryable": False}
        utterance = str(body.get("utterance") or "")[:20]
        reply = str(body.get("userReply") or "")[:10]
        raw, _ = decode_image(body.get("image"))  # GuardError → 4xx (한도에 세지 않는다)
        self._apply_user_signal(s, utterance, reply)

        if not self.limits.check_and_count(s):
            self.store.save(s)
            return 200, dict(LIMIT_RESPONSE, stepIndex=len(s["steps"]), estimatedTotal=max(1, len(s["steps"])))

        image, media_type, _size = resize_for_model(raw)
        del raw  # 원본은 즉시 버린다

        context = {
            "goal": s["goal"] or "",
            "proposedGoal": "" if s["goal"] else (s["proposedGoal"] or ""),
            "completedSteps": [" ".join(step["lens"]) for step in s["steps"]],
            "currentStepIndex": len(s["steps"]),
            "utterance": utterance,
            "userReply": reply,
        }
        step = None
        feedback = None
        warnings = []
        for _attempt in range(2):  # 검증 실패 시 한 번만 재요청
            result = self.provider.analyze(image, media_type, context, feedback)  # ProviderError → 502
            step, errors, warnings = normalize_step(result, step_index=len(s["steps"]))
            if step:
                break
            feedback = "; ".join(errors)
        del image
        if not step:
            step = dict(SAFE_RECAPTURE, stepIndex=len(s["steps"]), estimatedTotal=max(1, len(s["steps"]) + 1))
            warnings = warnings + ["fallback: validation failed twice"]

        step, filtered = filter_banned(step)
        step = apply_safety(step, s)
        if step["goal"] and not s["goal"]:
            s["proposedGoal"] = step["goal"]
        s["current"] = step
        s["lastKind"] = step["kind"]
        s["done"] = step["kind"] == "done"
        self.store.save(s)
        out = dict(step)
        if warnings or filtered:
            out["warnings"] = warnings + (["banned phrase replaced"] if filtered else [])
        return 200, out

    def intent(self, body):
        text = str(body.get("text") or "")[:80]
        found = local_intent(text)
        if found:
            return 200, {"intent": found, "source": "local"}
        try:
            value = self.provider.classify_intent(text)
        except ProviderError:
            value = "unknown"
        return 200, {"intent": value if value in INTENTS else "unknown", "source": "model"}


def make_handler(app, token):
    class Handler(BaseHTTPRequestHandler):
        server_version = "LifePilot/0.1"

        def log_message(self, fmt, *args):  # 본문(이미지)은 로그에 남기지 않는다
            print("[%s] %s" % (self.log_date_time_string(), fmt % args))

        def _send(self, status, payload, started):
            payload = dict(payload, latencyMs=int((time.time() - started) * 1000))
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-LifePilot-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise GuardError(413, "body_too_large", "request body too large")
            raw = self.rfile.read(length) if length else b""
            try:
                data = json.loads(raw.decode("utf-8")) if raw else {}
            except (UnicodeDecodeError, ValueError):
                raise GuardError(400, "bad_json", "invalid JSON")
            if not isinstance(data, dict):
                raise GuardError(400, "bad_json", "JSON object expected")
            return data

        def _route(self, method):
            started = time.time()
            path = urlparse(self.path).path.rstrip("/") or "/"
            if method == "OPTIONS":
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-LifePilot-Token")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.end_headers()
                return
            if path == "/health":
                return self._send(200, {"ok": True}, started)
            if token and self.headers.get("X-LifePilot-Token", "") != token:
                return self._send(401, {"error": "invalid_token", "retryable": False}, started)
            try:
                if path == "/session" and method == "POST":
                    status, payload = app.create_session(self._body())
                elif path == "/analyze" and method == "POST":
                    status, payload = app.analyze(self._body())
                elif path == "/intent" and method == "POST":
                    status, payload = app.intent(self._body())
                elif path.startswith("/session/") and method == "GET":
                    status, payload = app.get_session(path.split("/", 2)[2])
                else:
                    status, payload = 404, {"error": "not_found", "retryable": False}
            except GuardError as e:
                status, payload = e.status, {"error": e.code, "message": str(e), "retryable": False}
            except ProviderError as e:
                # 모든 모델 장애는 한 형식으로: 안경은 이것만 처리하면 된다
                print("provider error: %s" % e)
                status, payload = 502, {"error": "model_unavailable", "retryable": e.retryable}
            except Exception as e:
                print("server error: %s" % type(e).__name__)
                status, payload = 500, {"error": "server_error", "retryable": True}
            self._send(status, payload, started)

        def do_GET(self):
            self._route("GET")

        def do_POST(self):
            self._route("POST")

        def do_OPTIONS(self):
            self._route("OPTIONS")

    return Handler


def create_server(app, host="0.0.0.0", port=8788, token=""):
    return ThreadingHTTPServer((host, port), make_handler(app, token))


def main():
    from vision import AnthropicProvider, FakeProvider

    if os.environ.get("LIFEPILOT_PROVIDER") == "fake":
        provider = FakeProvider([])  # 시뮬레이터 연결 확인용: 모든 analyze가 502
    else:
        provider = AnthropicProvider()
    token = os.environ.get("LIFEPILOT_TOKEN", "")
    server = create_server(LifePilot(provider), os.environ.get("HOST", "0.0.0.0"), int(os.environ.get("PORT", "8788")), token)
    print("LifePilot server on port %d (token %s)" % (server.server_address[1], "set" if token else "NOT set"))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
