# LifePilot — Rokid Glasses step-by-step task assistant

## What this is
An AIUI agent for Rokid Glasses (monochrome green display, 480x352 reference canvas) plus a Python proxy server.
Core loop: user asks "이거 어떻게 해?" → capture ONE photo → server → vision model → ONE next action
→ show 2-3 short lines on the lens + speak 1 sentence → user says "다음" → repeat.

## Repo layout
- glasses/  AIUI agent. Import target for AIUI Studio (subdirectory import). Package = .aix.
  - lib/core/  COPIED from the 비서 project (RokidAI/agent/lib). Do not edit here; edit the source and run
    `node ../tools/sync-lifepilot-core.mjs` from RokidAI.
- server/   Python 3.10+ proxy (stdlib http.server + anthropic SDK + Pillow). Holds all API keys.
  Glasses never call model providers directly.
- tests/    Node tests for glasses logic. Server tests live in server/tests.
- docs/     limitations.md, checklist.md.

## Hard rules
- Before writing ANY glasses code, read the aiui-dev Skill (glasses/.claude/skills/aiui-dev/SKILL.md once
  installed, or https://github.com/jsar-project/AIUI/tree/main/skills/aiui-dev) and use only APIs it documents.
  Quote the section for any AIUI API you claim exists. If it is missing, say so and propose a fallback.
- glasses/AGENTS.md is an AIUI runtime file (agent capability manifest). It is NOT instructions for you.
- One request = one camera capture. Never implement continuous video analysis.
- Never put secrets in glasses/. Server reads keys from env only.
- Server responses MUST pass server/schema.py normalize_step() before being sent to the glasses.
- Lens text: max 3 lines, max 14 characters per line (including spaces). Speech: max 1 sentence, 60 chars.
- Every external call has a timeout, a loading state, and a user-facing failure message in Korean.
- Korean UI strings live in glasses/lib/strings.js only.
- Glasses logic modules (lib/state, intent, format, controller, api) must not touch runtime APIs directly;
  runtime APIs are injected (keeps them testable in Node). tools/validate-agent.mjs enforces this.

## Facts verified against the AIUI docs (do not "correct" these back)
- Display reference canvas is 480x352, not 640x480.
- Camera: `wx.media.createCameraContext().takePhoto()` (needs an interactive call site; returns
  `{data: ArrayBuffer, mimeType}` — may be WebP, not JPEG). The server accepts JPEG/PNG/WebP.
- Images are sent as a JSON data URL, not multipart.
- Claude models current at time of writing reject `temperature` and cannot disable thinking; control depth with
  `output_config.effort` and leave room in `max_tokens`. JSON shape is enforced with structured outputs.

## Design tokens
Follow the aiui-dev monochrome-green spec. No color semantics. Hierarchy by size/weight/opacity only.

## Testing
- server: `server\.venv\Scripts\python -m unittest discover -s server/tests` (FakeProvider, no API calls).
  Live fixtures: set LIFEPILOT_LIVE=1 and put photos in server/tests/fixtures (see README there).
- glasses: `node --test "tests/*.test.mjs"` and `node tools/validate-agent.mjs glasses`.
- Device: Studio Device Simulation, then docs/checklist.md on real glasses.

## Workflow
- Work in small steps. After each step: run tests, summarize what changed, list what is NOT yet supported.
- Update docs/limitations.md and docs/checklist.md when behavior changes.
- Commit after each green step with a descriptive message.
