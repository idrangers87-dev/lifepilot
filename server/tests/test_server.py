"""서버 단위·통합 테스트 (모델 호출 없음, FakeProvider 사용)."""

import base64
import io
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image  # noqa: E402

from app import LifePilot, create_server, local_intent  # noqa: E402
from safety import GuardError, Limits, apply_safety, decode_image, filter_banned, resize_for_model  # noqa: E402
from schema import normalize_step, wrap_line  # noqa: E402
from session import MemorySessionStore, new_session  # noqa: E402
from vision import FakeProvider, ProviderError  # noqa: E402


def image_data_url(fmt="JPEG", size=(3024, 4032), color=(120, 120, 120)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format=fmt)
    mime = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[fmt]
    return "data:%s;base64,%s" % (mime, base64.b64encode(buf.getvalue()).decode("ascii"))


def step(kind="step", lens=None, **extra):
    base = {
        "kind": kind, "stepIndex": 0, "estimatedTotal": 3, "lens": lens or ["커버를 열어"],
        "speech": "하단 왼쪽 커버를 열어.", "detail": "", "safetyNote": "", "confidence": 0.9,
        "observed": ["세탁기", "E4"], "recaptureHint": "", "question": "", "goal": "",
    }
    base.update(extra)
    return base


IMG = image_data_url(size=(400, 300))


class SchemaTest(unittest.TestCase):
    def test_valid_step(self):
        s, errors, warnings = normalize_step(step(), step_index=2)
        self.assertEqual(errors, [])
        self.assertEqual(s["stepIndex"], 2)  # 서버가 단계 번호를 정한다
        self.assertGreaterEqual(s["estimatedTotal"], 3)

    def test_long_lens_is_rewrapped(self):
        s, errors, warnings = normalize_step(step(lens=["필터를 반시계 방향으로 두 바퀴 돌려 빼"]))
        self.assertEqual(errors, [])
        self.assertTrue(all(len(l) <= 14 for l in s["lens"]))
        self.assertIn("lens re-wrapped to 14 chars", warnings)

    def test_too_much_text_is_error(self):
        _, errors, _ = normalize_step(step(lens=["가나다라마바사아자차카타파하 " * 4]))
        self.assertTrue(any("3 lines" in e for e in errors))

    def test_kind_requirements(self):
        self.assertTrue(normalize_step(step(kind="recapture"))[1])
        self.assertTrue(normalize_step(step(kind="clarify"))[1])
        self.assertTrue(normalize_step(step(kind="safety"))[1])
        self.assertFalse(normalize_step(step(kind="clarify", question="E4로 보이는데 맞아?"))[1])
        self.assertTrue(normalize_step(step(kind="oops"))[1])

    def test_long_speech_takes_first_sentence(self):
        long_speech = "필터를 반시계로 돌려 빼. 물이 나올 수 있으니 수건을 아래에 미리 깔아 두고 아주 천천히 조금씩 돌려야 해."
        self.assertGreater(len(long_speech), 60)
        s, errors, _ = normalize_step(step(speech=long_speech))
        self.assertEqual(errors, [])
        self.assertEqual(s["speech"], "필터를 반시계로 돌려 빼.")

    def test_wrap_line(self):
        self.assertEqual(wrap_line("가나다라마바사아자차카타파하거너", 14), ["가나다라마바사아자차카타파하", "거너"])


class SafetyTest(unittest.TestCase):
    def test_image_types_and_resize(self):
        for fmt in ("JPEG", "PNG", "WEBP"):
            raw, mime = decode_image(image_data_url(fmt, size=(3024, 4032)))
            out, out_mime, size = resize_for_model(raw)
            self.assertEqual(out_mime, "image/jpeg")
            self.assertEqual(max(size), 1024)

    def test_rejects_bad_images(self):
        for bad in ("", "hello", "data:image/gif;base64,R0lGOD", "data:image/jpeg;base64,"):
            with self.assertRaises(GuardError):
                raw, _ = decode_image(bad)
                resize_for_model(raw)
        with self.assertRaises(GuardError):
            resize_for_model(b"not an image")

    def test_banned_medical_instruction(self):
        s, hit = filter_banned(normalize_step(step(lens=["하루 2정씩", "복용해"], speech="하루 두 번 2정씩 먹어."))[0])
        self.assertTrue(hit)
        self.assertNotIn("복용해", s["lens"])

    def test_safety_persists_and_keyword_guard(self):
        session = new_session()
        first = apply_safety(normalize_step(step(kind="safety", safetyNote="전원 먼저 끄기"))[0], session)
        self.assertEqual(first["safetyNote"], "전원 먼저 끄기")
        later = apply_safety(normalize_step(step())[0], session)
        self.assertEqual(later["safetyNote"], "전원 먼저 끄기")

        other = new_session()
        guarded = apply_safety(normalize_step(step(observed=["콘센트", "드라이버"]))[0], other)
        self.assertEqual(guarded["safetyNote"], "전원 먼저 끄기")

    def test_limits(self):
        limits = Limits(per_session=2, per_day=3, today=lambda: "d1")
        a, b = new_session(), new_session()
        self.assertTrue(limits.check_and_count(a))
        self.assertTrue(limits.check_and_count(a))
        self.assertFalse(limits.check_and_count(a))  # 세션 한도
        self.assertTrue(limits.check_and_count(b))
        self.assertFalse(limits.check_and_count(b))  # 하루 한도


class SessionTest(unittest.TestCase):
    def test_ttl(self):
        now = [1000.0]
        store = MemorySessionStore(ttl_s=60, clock=lambda: now[0])
        s = store.create("세탁기")
        now[0] += 30
        self.assertIsNotNone(store.get(s["id"]))
        now[0] += 61
        self.assertIsNone(store.get(s["id"]))


class FlowTest(unittest.TestCase):
    def make(self, responses, **limits):
        provider = FakeProvider(responses)
        return LifePilot(provider, MemorySessionStore(), Limits(**limits) if limits else Limits()), provider

    def test_washer_scenario(self):
        app, provider = self.make([
            step(kind="clarify", question="세탁기 배수 오류 해결, 맞아?", goal="세탁기 배수 오류 해결", lens=["E4 에러 같아"]),
            step(kind="safety", safetyNote="전원 먼저 끄기", lens=["전원 플러그 뽑기"]),
            step(lens=["필터 커버를 열어"]),
            step(lens=["필터를 반시계로"]),
            step(kind="done", lens=["완료"], speech="배수 필터 청소 완료."),
        ])
        _, s = app.create_session({})
        sid = s["sessionId"]
        _, r = app.analyze({"sessionId": sid, "image": IMG, "utterance": "start"})
        self.assertEqual(r["kind"], "clarify")
        _, r = app.analyze({"sessionId": sid, "image": IMG, "userReply": "yes"})
        self.assertEqual(r["kind"], "safety")
        self.assertEqual(provider.calls[1]["context"]["goal"], "세탁기 배수 오류 해결")
        _, r = app.analyze({"sessionId": sid, "image": IMG, "utterance": "next"})
        self.assertEqual(r["stepIndex"], 1)
        self.assertEqual(r["safetyNote"], "전원 먼저 끄기")  # 안전 문구 유지
        _, r = app.analyze({"sessionId": sid, "image": IMG, "utterance": "recapture"})
        self.assertEqual(r["stepIndex"], 1)  # 재촬영은 단계를 확정하지 않는다
        _, r = app.analyze({"sessionId": sid, "image": IMG, "utterance": "next"})
        self.assertEqual(r["kind"], "done")
        self.assertEqual(provider.calls[-1]["context"]["completedSteps"], ["전원 플러그 뽑기", "필터를 반시계로"])
        self.assertEqual(provider.calls[-1]["media_type"], "image/jpeg")
        _, summary = app.get_session(sid)
        self.assertEqual(summary["stepCount"], 2)
        self.assertEqual(summary["lastKind"], "done")

    def test_back_pops_confirmed_step(self):
        app, provider = self.make([step(lens=["A 해"]), step(lens=["B 해"]), step(lens=["A 다시"])])
        sid = app.create_session({"goal": "조립"})[1]["sessionId"]
        app.analyze({"sessionId": sid, "image": IMG})
        app.analyze({"sessionId": sid, "image": IMG, "utterance": "next"})
        _, r = app.analyze({"sessionId": sid, "image": IMG, "utterance": "back"})
        self.assertEqual(r["stepIndex"], 0)

    def test_validation_retry_then_fallback(self):
        bad = step(kind="recapture")  # recaptureHint 없음
        app, provider = self.make([bad, step(kind="recapture", recaptureHint="라벨이 보이게 가까이", lens=["가까이 찍어"])])
        sid = app.create_session({})[1]["sessionId"]
        _, r = app.analyze({"sessionId": sid, "image": IMG})
        self.assertEqual(r["kind"], "recapture")
        self.assertIn("recaptureHint", provider.calls[1]["feedback"])

        app2, _ = self.make([bad, bad])
        sid2 = app2.create_session({})[1]["sessionId"]
        _, r2 = app2.analyze({"sessionId": sid2, "image": IMG})
        self.assertEqual(r2["lens"], ["잘 안 보여", "다시 찍어줘"])
        self.assertIn("fallback: validation failed twice", r2["warnings"])

    def test_provider_error_propagates(self):
        app, _ = self.make([ProviderError("down")])
        sid = app.create_session({})[1]["sessionId"]
        with self.assertRaises(ProviderError):
            app.analyze({"sessionId": sid, "image": IMG})

    def test_limit_response(self):
        app, _ = self.make([step(), step()], per_session=1, per_day=10)
        sid = app.create_session({})[1]["sessionId"]
        app.analyze({"sessionId": sid, "image": IMG})
        _, r = app.analyze({"sessionId": sid, "image": IMG})
        self.assertEqual(r["kind"], "done")
        self.assertEqual(r["speech"], "오늘 한도에 닿았어.")

    def test_unknown_session(self):
        app, _ = self.make([])
        status, body = app.analyze({"sessionId": "nope", "image": IMG})
        self.assertEqual(status, 404)

    def test_intent_local_then_model(self):
        app = LifePilot(FakeProvider([], intents={"이제 뭐 하면 돼": "next"}), MemorySessionStore())
        self.assertEqual(app.intent({"text": "다음 단계"})[1], {"intent": "next", "source": "local"})
        self.assertEqual(app.intent({"text": "이제 뭐 하면 돼"})[1]["intent"], "next")
        self.assertEqual(app.intent({"text": "오늘 날씨"})[1]["intent"], "unknown")
        self.assertEqual(local_intent("다시 찍어"), "recapture")
        self.assertEqual(local_intent("다시"), "repeat")


class HttpTest(unittest.TestCase):
    TOKEN = "t"

    def setUp(self):
        self.provider = FakeProvider([step(), ProviderError("down")])
        self.server = create_server(LifePilot(self.provider, MemorySessionStore()), "127.0.0.1", 0, self.TOKEN)
        self.base = "http://127.0.0.1:%d" % self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, method, path, body=None, token=TOKEN):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, method=method)
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("X-LifePilot-Token", token)
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_endpoints(self):
        self.assertEqual(self.call("GET", "/health", token=None)[0], 200)
        self.assertEqual(self.call("POST", "/session", {}, token="wrong")[0], 401)
        status, s = self.call("POST", "/session", {"goal": "세탁기"})
        self.assertEqual(status, 200)
        self.assertIn("latencyMs", s)
        status, r = self.call("POST", "/analyze", {"sessionId": s["sessionId"], "image": image_data_url("WEBP", (2016, 1512))})
        self.assertEqual(status, 200)
        self.assertEqual(r["kind"], "step")
        self.assertIn("latencyMs", r)
        status, r = self.call("POST", "/analyze", {"sessionId": s["sessionId"], "image": IMG})
        self.assertEqual((status, r["error"], r["retryable"]), (502, "model_unavailable", True))
        status, r = self.call("POST", "/analyze", {"sessionId": s["sessionId"], "image": "data:image/gif;base64,AAAA"})
        self.assertEqual(status, 415)
        status, r = self.call("GET", "/session/" + s["sessionId"])
        self.assertEqual(r["goal"], "세탁기")


if __name__ == "__main__":
    unittest.main()
