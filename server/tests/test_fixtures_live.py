"""실제 모델로 픽스처 사진을 돌려 kind를 확인한다(가이드 5장 테스트).

ANTHROPIC_API_KEY(또는 ant 프로필)가 없거나 사진이 없으면 건너뛴다. 실행:
  set LIFEPILOT_LIVE=1 && .venv\\Scripts\\python -m unittest tests.test_fixtures_live -v
모델 응답은 비결정적이므로 kind만 단언하고 문구는 단언하지 않는다. 10장 중 8장 이상 일치하면 통과.
"""

import base64
import json
import os
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
FIXTURES = os.path.join(HERE, "fixtures")


@unittest.skipUnless(os.environ.get("LIFEPILOT_LIVE") == "1", "set LIFEPILOT_LIVE=1 to call the real model")
class LiveFixtureTest(unittest.TestCase):
    def test_expected_kinds(self):
        from app import LifePilot
        from session import MemorySessionStore
        from vision import AnthropicProvider

        with open(os.path.join(FIXTURES, "expected.json"), encoding="utf-8") as f:
            expected = json.load(f)
        present = {name: kinds for name, kinds in expected.items() if os.path.exists(os.path.join(FIXTURES, name))}
        if not present:
            self.skipTest("no fixture photos in tests/fixtures (see README.md)")

        app = LifePilot(AnthropicProvider(), MemorySessionStore())
        hits, rows = 0, []
        for name, kinds in present.items():
            ext = name.rsplit(".", 1)[-1].lower()
            mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[ext]
            with open(os.path.join(FIXTURES, name), "rb") as f:
                data_url = "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))
            sid = app.create_session({})[1]["sessionId"]
            started = time.time()
            status, r = app.analyze({"sessionId": sid, "image": data_url, "utterance": "start"})
            elapsed = time.time() - started
            ok = status == 200 and r["kind"] in kinds
            hits += ok
            rows.append("%-28s expected=%-20s got=%-10s %.1fs %s" % (name, "/".join(kinds), r.get("kind"), elapsed, "OK" if ok else "MISS"))
            self.assertLess(elapsed, 10, name)
        print("\n" + "\n".join(rows))
        self.assertGreaterEqual(hits, int(len(present) * 0.8), "kind match below 80%")


if __name__ == "__main__":
    unittest.main()
