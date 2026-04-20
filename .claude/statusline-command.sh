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
        return "model?"
    cleaned = name.replace("Claude ", "").replace(" claude", "").replace(" ", "")
    cleaned = cleaned.replace("[1m]", "").replace("[1M]", "")
    if cleaned.startswith("Opus"):
        return cleaned
    if cleaned.startswith("Sonnet"):
        return cleaned
    if cleaned.startswith("Haiku"):
        return cleaned
    return cleaned


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
            return cur
    env_effort = os.environ.get("CLAUDE_CODE_EFFORT_LEVEL", "")
    return env_effort if env_effort else "effort?"


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


def ctx_color(used):
    if used is None:
        return ""
    try:
        used = float(used)
    except Exception:
        return ""
    if used >= 75:
        return "\033[31m"
    if used >= 50:
        return "\033[33m"
    return ""


def ctx_bar(used):
    if used is None:
        return "░░░░░░░░░░"
    try:
        used = float(used)
    except Exception:
        return "░░░░░░░░░░"
    used = max(0.0, min(100.0, used))
    filled = int(used // 10)
    if used >= 100:
        filled = 10
    return ("█" * filled) + ("░" * (10 - filled))


session = load("SESSION_JSON")
status = load("STATUS_JSON")

model = compact_model(session.get("model", {}).get("display_name") or session.get("model", {}).get("id") or "")
effort = compact_effort(session)
ctx = session.get("context_window", {}) if isinstance(session.get("context_window", {}), dict) else {}
used = ctx.get("used_percentage")
left = ctx.get("remaining_percentage")
size = compact_ctx_size(ctx.get("context_window_size"))
bar = ctx_bar(used)
used_s = f"{int(float(used))}%" if used is not None else "--%"
left_s = f"{int(float(left))}%" if left is not None else "--%"
color = ctx_color(used)
reset = "\033[0m" if color else ""
ctx_segment = f"{color}ctx {used_s} {bar} {left_s} {size}{reset}"
line1 = f"{model} | {effort} | {ctx_segment}"

git = status.get("git", {})
branch = git.get("branch") or "?"
dirty = git.get("dirty_files", "?")
ahead = git.get("ahead_of_origin_main", 0)
health = status.get("status") or "aos?"
line2 = f"{branch} | d{dirty} | {health} | +{ahead}"

print(line1)
print(line2)
PY
