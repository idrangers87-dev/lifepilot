"""비용·안전 가드.

- 이미지: data URL만, JPEG/PNG/WebP 허용(Rokid 카메라가 WebP를 돌려줄 수 있음), 원본 최대 8MB.
  서버에서 긴 변 1024px JPEG로 줄여 모델에 보낸다(비용·지연 감소, EXIF 제거).
- 호출 한도: 세션당 30회, 하루 300회(환경 변수).
- 금칙어: 의료 처치 지시·법률 조언·욕설이 lens/speech에 나오면 일반 안내로 바꾼다.
- 위험 요소: kind=safety가 한 번 나오면 세션 내내 safetyNote 유지.
  모델이 놓쳐도 observed에 전기·불·칼·화학물질이 보이면 서버가 safetyNote를 넣는다(2차 가드).
"""

import base64
import datetime
import io
import re
import threading

ALLOWED_TYPES = ("image/jpeg", "image/png", "image/webp")
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_EDGE = 1024


class GuardError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


def decode_image(data_url):
    """data:image/...;base64,... → (bytes, media_type)."""
    m = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", str(data_url or ""), re.S)
    if not m:
        raise GuardError(400, "bad_image", "image must be a base64 data URL")
    media_type = m.group(1).lower()
    if media_type == "image/jpg":
        media_type = "image/jpeg"
    if media_type not in ALLOWED_TYPES:
        raise GuardError(415, "unsupported_image", "image type %s is not supported" % media_type)
    try:
        raw = base64.b64decode(m.group(2), validate=False)
    except ValueError:
        raise GuardError(400, "bad_image", "invalid base64")
    if not raw:
        raise GuardError(400, "bad_image", "empty image")
    if len(raw) > MAX_IMAGE_BYTES:
        raise GuardError(413, "image_too_large", "image larger than %d bytes" % MAX_IMAGE_BYTES)
    return raw, media_type


def resize_for_model(raw, max_edge=MAX_EDGE):
    """긴 변 max_edge 이하 JPEG로 변환한다. 반환: (bytes, 'image/jpeg', (w, h))."""
    from PIL import Image, ImageOps

    try:
        with Image.open(io.BytesIO(raw)) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            img.thumbnail((max_edge, max_edge))
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=85)
            return out.getvalue(), "image/jpeg", img.size
    except Exception as e:  # 손상·미지원 이미지
        raise GuardError(400, "bad_image", "cannot decode image: %s" % type(e).__name__)


class Limits:
    def __init__(self, per_session=30, per_day=300, today=lambda: datetime.date.today().isoformat()):
        self.per_session = per_session
        self.per_day = per_day
        self.today = today
        self.lock = threading.Lock()
        self.day = None
        self.count = 0

    def check_and_count(self, session):
        """한도 안이면 True를 돌려주고 카운트를 올린다."""
        with self.lock:
            day = self.today()
            if day != self.day:
                self.day, self.count = day, 0
            if self.count >= self.per_day or session["analyzeCount"] >= self.per_session:
                return False
            self.count += 1
            session["analyzeCount"] += 1
            return True


LIMIT_RESPONSE = {
    "kind": "done",
    "lens": ["오늘 한도에", "닿았어"],
    "speech": "오늘 한도에 닿았어.",
    "detail": "",
    "safetyNote": "",
    "confidence": 1.0,
    "observed": [],
    "recaptureHint": "",
    "question": "",
    "goal": "",
}

BANNED = [
    # 의료 처치·복용 지시
    (re.compile(r"(복용|투약|주사|섭취|먹어|드세요|정씩|알씩|mg\s*씩)"), ["라벨만 읽어줄게", "복용은 약사와"], "복용 방법은 약사나 의사와 확인해."),
    # 법률 조언
    (re.compile(r"(소송|고소|법적\s*책임|변호사\s*없이)"), ["법률 판단은", "전문가와 확인"], "법률 문제는 전문가와 확인해."),
    # 욕설(최소 목록)
    (re.compile(r"(씨발|시발|병신|개새)"), ["다시 볼게"], "다시 볼게."),
]


def filter_banned(step):
    text = " ".join(step["lens"]) + " " + step["speech"]
    for pattern, lens, speech in BANNED:
        if pattern.search(text):
            step = dict(step, lens=list(lens), speech=speech, detail="")
            return step, True
    return step, False


HAZARDS = [
    (re.compile(r"콘센트|플러그|전원선|배선|분전|두꺼비집|차단기|전기\s*패널|전선"), "전원 먼저 끄기"),
    (re.compile(r"가스|불꽃|화염|버너|불이\s*켜|기름"), "불·가스 먼저 확인"),
    (re.compile(r"칼날|칼|커터|톱"), "칼날 조심"),
    (re.compile(r"세제|표백|락스|화학|약품|용제"), "환기하고 장갑 껴"),
]


def apply_safety(step, session):
    """safetyNote를 세션에 유지하고, 모델이 놓친 위험 요소를 보완한다."""
    if step["kind"] == "safety" and step["safetyNote"]:
        session["safetyNote"] = step["safetyNote"]
    if not step["safetyNote"] and not session["safetyNote"]:
        seen = " ".join(step["observed"])
        for pattern, note in HAZARDS:
            if pattern.search(seen):
                session["safetyNote"] = note
                break
    if session["safetyNote"] and step["kind"] in ("step", "safety") and not step["safetyNote"]:
        step = dict(step, safetyNote=session["safetyNote"])
    return step
