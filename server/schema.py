"""StepResponse 스키마.

두 단계로 보장한다.
1. 모델 호출 시 구조화 출력(output_config.format=json_schema)으로 JSON 구조를 강제한다.
2. 글자 수·값 범위처럼 JSON 스키마로 강제하기 어려운 규칙은 normalize_step()에서 검사한다.
   - 고칠 수 있는 위반(14자 넘는 줄 다시 나누기, 긴 speech를 첫 문장으로 줄이기 등)은 서버가 고친다.
   - 고칠 수 없는 위반(종류에 필요한 필드 없음, 다시 나눠도 3줄 초과)은 오류로 돌려 모델에 한 번 재요청한다.
"""

import re

KINDS = ("step", "recapture", "clarify", "done", "safety")

LENS_MAX_CHARS = 14
LENS_MAX_LINES = 3
SPEECH_MAX = 60
DETAIL_MAX = 300
SHORT_MAX = 40  # safetyNote, recaptureHint, question
GOAL_MAX = 60
OBSERVED_MAX = 6

# 모델 구조화 출력용 JSON 스키마. 모든 필드를 required로 두고, 해당 없으면 ""/[]를 쓰게 한다.
STEP_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": list(KINDS)},
        "stepIndex": {"type": "integer"},
        "estimatedTotal": {"type": "integer"},
        "lens": {"type": "array", "items": {"type": "string"}},
        "speech": {"type": "string"},
        "detail": {"type": "string"},
        "safetyNote": {"type": "string"},
        "confidence": {"type": "number"},
        "observed": {"type": "array", "items": {"type": "string"}},
        "recaptureHint": {"type": "string"},
        "question": {"type": "string"},
        "goal": {"type": "string"},
    },
    "required": [
        "kind", "stepIndex", "estimatedTotal", "lens", "speech", "detail", "safetyNote",
        "confidence", "observed", "recaptureHint", "question", "goal",
    ],
    "additionalProperties": False,
}

INTENTS = ("start", "next", "recapture", "repeat", "detail", "yes", "no", "stop", "back", "help", "unknown")

INTENT_JSON_SCHEMA = {
    "type": "object",
    "properties": {"intent": {"type": "string", "enum": list(INTENTS)}},
    "required": ["intent"],
    "additionalProperties": False,
}

# 모델이 끝내 규칙을 지키지 못할 때 안경에 보내는 안전한 기본 응답
SAFE_RECAPTURE = {
    "kind": "recapture",
    "stepIndex": 0,
    "estimatedTotal": 1,
    "lens": ["잘 안 보여", "다시 찍어줘"],
    "speech": "잘 안 보여. 다시 찍어줘.",
    "detail": "",
    "safetyNote": "",
    "confidence": 0.0,
    "observed": [],
    "recaptureHint": "다시 찍어줘",
    "question": "",
    "goal": "",
}


def wrap_line(text, limit=LENS_MAX_CHARS):
    """공백 기준으로 limit 글자 이하 줄로 나눈다. 공백 없는 긴 덩어리는 글자 수로 자른다."""
    lines, line = [], ""
    for word in str(text).split():
        while len(word) > limit:
            if line:
                lines.append(line)
                line = ""
            lines.append(word[:limit])
            word = word[limit:]
        if not line:
            line = word
        elif len(line) + 1 + len(word) <= limit:
            line += " " + word
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def _first_sentence(text):
    m = re.match(r"^(.+?[.!?。])(\s|$)", text)
    return m.group(1) if m else text


def normalize_step(raw, step_index=None):
    """모델 출력(dict)을 검사·정리한다. 반환: (step 또는 None, 오류 목록, 경고 목록)."""
    errors, warnings = [], []
    if not isinstance(raw, dict):
        return None, ["response is not a JSON object"], warnings

    kind = raw.get("kind")
    if kind not in KINDS:
        errors.append("kind must be one of %s" % ", ".join(KINDS))

    lens_in = [l for l in (_text(x) for x in (raw.get("lens") or [])) if l]
    lens = lens_in
    if any(len(l) > LENS_MAX_CHARS for l in lens_in):
        lens = []
        for l in lens_in:
            lens.extend(wrap_line(l))
        warnings.append("lens re-wrapped to %d chars" % LENS_MAX_CHARS)
    if not lens:
        errors.append("lens must have at least 1 line")
    elif len(lens) > LENS_MAX_LINES:
        errors.append("lens must fit in %d lines of %d characters (got %d lines)" % (LENS_MAX_LINES, LENS_MAX_CHARS, len(lens)))

    speech = _text(raw.get("speech"))
    if len(speech) > SPEECH_MAX:
        speech = _first_sentence(speech)
        warnings.append("speech shortened to first sentence")
    if not speech:
        errors.append("speech is required")
    elif len(speech) > SPEECH_MAX:
        errors.append("speech must be one sentence of at most %d characters" % SPEECH_MAX)

    detail = _text(raw.get("detail"))
    if len(detail) > DETAIL_MAX:
        detail = detail[:DETAIL_MAX]
        warnings.append("detail truncated")

    short = {}
    for key in ("safetyNote", "recaptureHint", "question"):
        short[key] = _text(raw.get(key))
        if len(short[key]) > SHORT_MAX:
            errors.append("%s must be at most %d characters" % (key, SHORT_MAX))
    goal = _text(raw.get("goal"))[:GOAL_MAX]

    if kind == "recapture" and not short["recaptureHint"]:
        errors.append("recapture requires recaptureHint")
    if kind == "clarify" and not short["question"]:
        errors.append("clarify requires question")
    if kind == "safety" and not short["safetyNote"]:
        errors.append("safety requires safetyNote")

    try:
        confidence = float(raw.get("confidence"))
    except (TypeError, ValueError):
        confidence = 0.0
        warnings.append("confidence missing")
    confidence = max(0.0, min(1.0, confidence))

    observed = [o for o in (_text(x) for x in (raw.get("observed") or [])) if o][:OBSERVED_MAX]

    try:
        model_index = int(raw.get("stepIndex"))
    except (TypeError, ValueError):
        model_index = 0
    index = step_index if step_index is not None else max(0, model_index)
    try:
        total = int(raw.get("estimatedTotal"))
    except (TypeError, ValueError):
        total = index + 1
    total = max(index + 1, min(20, max(1, total)))

    if errors:
        return None, errors, warnings
    return {
        "kind": kind,
        "stepIndex": index,
        "estimatedTotal": total,
        "lens": lens,
        "speech": speech,
        "detail": detail,
        "safetyNote": short["safetyNote"],
        "confidence": confidence,
        "observed": observed,
        "recaptureHint": short["recaptureHint"],
        "question": short["question"],
        "goal": goal,
    }, [], warnings
