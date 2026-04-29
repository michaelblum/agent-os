#!/bin/bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

SESSION_JSON="$(cat || true)"

# Snapshot the actual Claude Code statusLine stdin for schema inspection.
# The schema is not fully documented; keep a current copy so we can verify
# which fields really arrive (e.g., reasoning effort, output style).
printf '%s' "$SESSION_JSON" > /tmp/claude-statusline-input.json 2>/dev/null || true

if [ -x "./aos" ]; then
  STATUS_JSON="$(./aos status --json 2>/dev/null || true)"
else
  STATUS_JSON=""
fi

SESSION_JSON="$SESSION_JSON" STATUS_JSON="$STATUS_JSON" python3 - <<'PY'
import json
import os


ROOT = os.getcwd()


def load(name):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def load_file(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except Exception:
        return {}


def nested_get(obj, *path):
    cur = obj
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def sanitize_token(value: str) -> str:
    cleaned = []
    for ch in value or "":
        if ch.isalnum() or ch in "._:-":
            cleaned.append(ch)
        else:
            cleaned.append("-")
    token = "".join(cleaned).strip("-")
    return token or "session"


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


REPO_SETTINGS = load_file(os.path.join(ROOT, ".claude", "settings.json"))
RUNTIME_SETTINGS = load_file(os.path.join(ROOT, ".runtime", "claude", "settings.json"))


def compact_output_style(session) -> str:
    name = nested_get(session, "output_style", "name")
    if isinstance(name, str):
        lowered = name.strip().lower()
        if lowered and lowered != "default":
            return name.strip()
    return ""


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


def session_state_dir(status):
    state_root = os.environ.get("AOS_STATE_ROOT", os.path.expanduser("~/.config/aos"))
    mode = nested_get(status, "identity", "mode") or os.environ.get("AOS_RUNTIME_MODE") or "repo"
    return os.path.join(state_root, mode, "coordination", "session-state")


def compaction_badge(session, status):
    session_id = session.get("session_id")
    if not isinstance(session_id, str) or not session_id:
        return ""
    path = os.path.join(session_state_dir(status), f"compact-{sanitize_token(session_id)}")
    try:
        with open(path) as fh:
            count = int((fh.read() or "0").strip())
    except Exception:
        return ""
    if count <= 0:
        return ""
    return "C" if count == 1 else f"C{count}"


session = load("SESSION_JSON")
status = load("STATUS_JSON")

model_name = session.get("model", {}).get("display_name") or session.get("model", {}).get("id") or ""
model = compact_model(model_name)
style = compact_output_style(session)
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
badge = compaction_badge(session, status)
segments = [model]
if style:
    segments.append(style)
segments.append(ctx_segment)
line1 = " | ".join(segments)
if badge:
    line1 = f"{line1} {badge}"

git = status.get("git", {})
branch = git.get("branch") or "?"
dirty = git.get("dirty_files", "?")
ahead = git.get("ahead_of_origin_main", 0)
ahead = git.get("ahead_of_upstream", ahead)
health = status.get("status") or "aos?"
line2 = f"{branch} | d{dirty} | {health} | +{ahead}"

print(line1)
print(line2)
PY
