#!/usr/bin/env bash
set -euo pipefail

ROLE="${AOS_DOCK_ROLE:-dock}"
REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
AOS_BIN="${AOS_DOCK_AOS_BIN:-$REPO_ROOT/aos}"
HOOK_INPUT="$(cat || true)"

# shellcheck source=/dev/null
source "$REPO_ROOT/.agents/hooks/session-common.sh"

SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
MESSAGE="$(python3 - "$HOOK_INPUT" <<'PY'
import json
import pathlib
import sys

raw = sys.argv[1]

def text_from_message(message):
    if isinstance(message, str):
        return message
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                value = item.get("text") or item.get("output_text")
                if value:
                    parts.append(str(value))
        return "".join(parts)
    return ""

try:
    payload = json.loads(raw) if raw else {}
except json.JSONDecodeError:
    payload = {}

for key in ("last_assistant_message", "last_agent_message"):
    value = payload.get(key)
    if value:
        print(str(value).rstrip())
        raise SystemExit(0)

transcript_path = payload.get("transcript_path")
if transcript_path:
    path = pathlib.Path(transcript_path).expanduser()
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        lines = []
    for line in reversed(lines):
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        event_payload = event.get("payload", {})
        if event_payload.get("type") == "task_complete" and event_payload.get("last_agent_message"):
            print(str(event_payload["last_agent_message"]).rstrip())
            raise SystemExit(0)
        if event_payload.get("type") == "message" and event_payload.get("role") == "assistant":
            text = text_from_message(event_payload).rstrip()
            if text:
                print(text)
                raise SystemExit(0)
print("")
PY
)"

if [[ -n "$MESSAGE" && "$(command -v pbcopy || true)" ]]; then
  CLIPBOARD_MESSAGE="$MESSAGE"
  if [[ "$CLIPBOARD_MESSAGE" != *"(on clipboard)" ]]; then
    CLIPBOARD_MESSAGE="${CLIPBOARD_MESSAGE}"$'\n\n'"(on clipboard)"
  fi
  printf '%s' "$CLIPBOARD_MESSAGE" | pbcopy >/dev/null 2>&1 || true
fi

if [[ -n "$SESSION_ID" && -x "$AOS_BIN" ]]; then
  "$AOS_BIN" tell --register --session-id "$SESSION_ID" --name "$ROLE" --role "$ROLE" --harness codex >/dev/null 2>&1 || true
  case "$ROLE" in
    gdi)
      "$AOS_BIN" voice bind --session-id "$SESSION_ID" --quality-tier premium --language en --gender female >/dev/null 2>&1 || true
      ;;
    foreman)
      "$AOS_BIN" voice bind --session-id "$SESSION_ID" --quality-tier premium --language en --gender male >/dev/null 2>&1 || true
      ;;
  esac
  printf '%s' "$HOOK_INPUT" | "$AOS_BIN" voice final-response --harness codex --session-id "$SESSION_ID" >/dev/null 2>&1 || true
fi

printf '{"continue":true}\n'
