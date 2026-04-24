#!/bin/bash
# Shared helpers for the agent-os provider hooks.
# Hook launchers may run with a cwd outside the repo. Pass the repo root into
# the launcher explicitly (for example via AOS_HOOK_REPO_ROOT or a checked-in
# absolute fallback in .codex/hooks.json) instead of resolving it with a plain
# `git rev-parse --show-toplevel` at launch time.

aos_session_runtime_mode() {
  if [[ -n "${AOS_RUNTIME_MODE:-}" ]]; then
    printf '%s\n' "$AOS_RUNTIME_MODE"
    return
  fi
  if [[ -n "${AOS:-}" ]] && [[ "$AOS" == *".app/Contents/MacOS/"* ]]; then
    printf 'installed\n'
    return
  fi
  printf 'repo\n'
}

aos_session_runtime_state_dir() {
  local root="${AOS_STATE_ROOT:-$HOME/.config/aos}"
  printf '%s/%s\n' "$root" "$(aos_session_runtime_mode)"
}

aos_session_uses_explicit_state_root_override() {
  [[ -n "${AOS_STATE_ROOT:-}" ]] || return 1
  python3 - "$AOS_STATE_ROOT" "$HOME/.config/aos" <<'PY'
import os
import sys

override = os.path.realpath(os.path.expanduser(sys.argv[1]))
default = os.path.realpath(os.path.expanduser(sys.argv[2]))
raise SystemExit(0 if override != default else 1)
PY
}

aos_session_state_dir() {
  local dir="${AOS_SESSION_STATE_DIR:-$(aos_session_runtime_state_dir)/coordination/session-state}"
  mkdir -p "$dir"
  printf '%s\n' "$dir"
}

aos_detect_harness() {
  if [[ -n "${AOS_SESSION_HARNESS:-}" ]]; then
    printf '%s\n' "$AOS_SESSION_HARNESS"
    return
  fi
  if [[ -n "${CODEX_THREAD_ID:-}" ]]; then
    printf 'codex\n'
    return
  fi
  if [[ -n "${CLAUDE_CODE_SSE_PORT:-}" ]]; then
    printf 'claude-code\n'
    return
  fi
  printf 'unknown\n'
}

aos_sanitize_token() {
  local value="${1:-}"
  value="$(printf '%s' "$value" | tr -cs 'A-Za-z0-9._:-' '-')"
  value="${value#-}"
  value="${value%-}"
  if [[ -z "$value" ]]; then
    value="session"
  fi
  printf '%s\n' "$value"
}

aos_resolve_session_id_from_input() {
  local hook_input="${1:-}"
  if [[ -z "$hook_input" ]]; then
    return 0
  fi
  printf '%s' "$hook_input" | python3 -c 'import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
for key in ("session_id", "thread_id"):
    value = payload.get(key)
    if value:
        print(value)
        break
'
}

aos_resolve_session_id_from_transcript_path() {
  local hook_input="${1:-}"
  if [[ -z "$hook_input" ]]; then
    return 0
  fi
  printf '%s' "$hook_input" | python3 -c '
import json, re, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
path = payload.get("transcript_path")
if not path:
    raise SystemExit(0)
matches = re.findall(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", path)
if matches:
    print(matches[-1])
'
}

aos_resolve_session_id() {
  local hook_input="${1:-}"
  local session_id=""
  session_id="$(aos_resolve_session_id_from_input "$hook_input")"
  if [[ -n "$session_id" ]]; then
    printf '%s\n' "$session_id"
    return
  fi
  session_id="$(aos_resolve_session_id_from_transcript_path "$hook_input")"
  if [[ -n "$session_id" ]]; then
    printf '%s\n' "$session_id"
    return
  fi
  if [[ -n "${AOS_SESSION_ID:-}" ]]; then
    printf '%s\n' "$AOS_SESSION_ID"
    return
  fi
  if [[ -n "${CODEX_THREAD_ID:-}" ]]; then
    printf '%s\n' "$CODEX_THREAD_ID"
    return
  fi
}

aos_session_compaction_file() {
  local session_key="$1"
  printf '%s/compact-%s\n' "$(aos_session_state_dir)" "$(aos_sanitize_token "$session_key")"
}

aos_emit_stop_hook_success() {
  local harness="${1:-$(aos_detect_harness)}"
  case "$harness" in
    codex)
      printf '{"continue":true}\n'
      ;;
  esac
}
