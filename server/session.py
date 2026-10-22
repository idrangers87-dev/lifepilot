"""과제 세션 저장소. MVP는 메모리, 인터페이스만 맞추면 Redis로 교체할 수 있다(SESSION_STORE=redis).

세션에는 텍스트만 둔다. 이미지는 어디에도 저장하지 않는다.
"""

import threading
import time
import uuid

SESSION_TTL_S = 30 * 60


def new_session(goal=None, now=None):
    now = now if now is not None else time.time()
    return {
        "id": uuid.uuid4().hex[:16],
        "goal": goal or None,
        "proposedGoal": None,  # 모델이 추정한 목표. 사용자가 "응" 하면 goal이 된다
        "createdAt": now,
        "updatedAt": now,
        "steps": [],  # 사용자가 "다음"으로 확인한 단계만: {index, lens, speech, confirmedAt}
        "current": None,  # 마지막으로 안내한 StepResponse
        "lastKind": None,
        "safetyNote": "",  # kind=safety가 한 번이라도 나오면 이후 응답에 유지
        "totalLatencyMs": 0,
        "analyzeCount": 0,
        "done": False,
    }


class MemorySessionStore:
    def __init__(self, ttl_s=SESSION_TTL_S, clock=time.time):
        self.ttl_s = ttl_s
        self.clock = clock
        self.lock = threading.Lock()
        self.items = {}

    def create(self, goal=None):
        session = new_session(goal, self.clock())
        with self.lock:
            self._sweep()
            self.items[session["id"]] = session
        return session

    def get(self, session_id):
        with self.lock:
            self._sweep()
            return self.items.get(session_id)

    def save(self, session):
        session["updatedAt"] = self.clock()
        with self.lock:
            self.items[session["id"]] = session

    def _sweep(self):
        cutoff = self.clock() - self.ttl_s
        for key in [k for k, s in self.items.items() if s["updatedAt"] < cutoff]:
            del self.items[key]


def create_store(kind="memory"):
    if kind == "memory":
        return MemorySessionStore()
    raise ValueError("SESSION_STORE=%s is not implemented yet (memory only)" % kind)
