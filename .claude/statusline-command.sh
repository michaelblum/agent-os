#!/bin/bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

SESSION_JSON="$(cat || true)"

if [ -x "./aos" ]; then
  STATUS_JSON="$(./aos status --json 2>/dev/null || true)"
else
  STATUS_JSON=""
fi

SESSION_JSON="$SESSION_JSON" STATUS_JSON="$STATUS_JSON" python3 - <<'PY'
import json
import os


def load(name):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def compact_model(name: str) -> str:
    if not name:
        return "mdl?"
    cleaned = (
        name.replace("Claude ", "")
        .replace(" claude", "")
        .replace(" 1M", "[1m]")
        .replace(" 1m", "[1m]")
        .replace("Sonnet ", "S")
        .replace("Opus ", "O")
        .replace("Haiku ", "H")
    )
    return cleaned.replace(" ", "")


def compact_effort(session):
    for path in (
        ("model", "effort_level"),
        ("model", "effort"),
        ("effort_level",),
        ("effort",),
    ):
        cur = session
        for key in path:
            if not isinstance(cur, dict):
                cur = None
                break
            cur = cur.get(key)
        if isinstance(cur, str) and cur:
            return cur[:3]
    env_effort = os.environ.get("CLAUDE_CODE_EFFORT_LEVEL", "")
    return env_effort[:3] if env_effort else "eff?"


def compact_ctx_size(size):
    if not size:
        return "ctx?"
    try:
        size = int(size)
    except Exception:
        return str(size)
    if size >= 1_000_000:
        if size % 1_000_000 == 0:
            return f"{size // 1_000_000}M"
        return f"{size/1_000_000:.1f}M"
    if size >= 1_000:
        if size % 1_000 == 0:
            return f"{size // 1_000}k"
        return f"{size/1_000:.0f}k"
    return str(size)


session = load("SESSION_JSON")
status = load("STATUS_JSON")

model = compact_model(session.get("model", {}).get("display_name") or session.get("model", {}).get("id") or "")
effort = compact_effort(session)
ctx = session.get("context_window", {}) if isinstance(session.get("context_window", {}), dict) else {}
used = ctx.get("used_percentage")
left = ctx.get("remaining_percentage")
size = compact_ctx_size(ctx.get("context_window_size"))

used_s = f"u{int(float(used))}%" if used is not None else "u--"
left_s = f"l{int(float(left))}%" if left is not None else "l--"
line1 = "|".join([model, effort, used_s, left_s, size])

git = status.get("git", {})
branch = git.get("branch") or "?"
dirty = git.get("dirty_files", "?")
ahead = git.get("ahead_of_origin_main", 0)
health = status.get("status") or "aos?"
line2 = "|".join([branch, f"d{dirty}", health, f"+{ahead}"])

print(line1)
print(line2)
PY
