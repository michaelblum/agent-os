#!/bin/bash
# Shared session identity helpers for provider hooks and local scripts.

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

aos_session_state_dir() {
  local dir="${AOS_SESSION_STATE_DIR:-$(aos_session_runtime_state_dir)/coordination/session-state}"
  mkdir -p "$dir"
  printf '%s\n' "$dir"
}

aos_session_bootstrap_dir() {
  local dir="${AOS_SESSION_BOOTSTRAP_DIR:-$(aos_session_runtime_state_dir)/coordination/bootstrap}"
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

aos_resolve_session_id() {
  local hook_input="${1:-}"
  local session_id=""
  session_id="$(aos_resolve_session_id_from_input "$hook_input")"
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

aos_session_name_file() {
  local session_id="$1"
  printf '%s/name-%s\n' "$(aos_session_state_dir)" "$(aos_sanitize_token "$session_id")"
}

aos_session_cursor_file() {
  local session_key="$1"
  printf '%s/cursor-%s\n' "$(aos_session_state_dir)" "$(aos_sanitize_token "$session_key")"
}

aos_session_bootstrap_payload_file() {
  local session_name="$1"
  printf '%s/payload-%s.json\n' "$(aos_session_bootstrap_dir)" "$(aos_sanitize_token "$session_name")"
}

aos_session_bootstrap_launcher_file() {
  local session_name="$1"
  printf '%s/launch-%s\n' "$(aos_session_bootstrap_dir)" "$(aos_sanitize_token "$session_name")"
}

aos_prune_session_bootstrap_dir() {
  local dir
  dir="$(aos_session_bootstrap_dir)"
  find "$dir" -type f -mtime +1 -delete 2>/dev/null || true
}

aos_default_session_name() {
  local session_id="${1:-}"
  local harness="${2:-unknown}"
  local prefix short

  prefix="$(aos_sanitize_token "$harness")"
  if [[ -n "$session_id" ]]; then
    short="$(aos_sanitize_token "$session_id" | cut -c1-12)"
  else
    short="$(python3 -c 'import uuid; print(uuid.uuid4().hex[:12])')"
  fi
  printf '%s\n' "${prefix}-${short}"
}

aos_session_channel() {
  local session_id="${1:-}"
  local session_name="${2:-}"
  if [[ -n "$session_id" ]]; then
    printf '%s\n' "$session_id"
    return
  fi
  printf '%s\n' "$session_name"
}

aos_resolve_session_name() {
  local session_id="${1:-}"
  local harness="${2:-unknown}"
  local name_file

  if [[ -n "$session_id" ]]; then
    name_file="$(aos_session_name_file "$session_id")"
    if [[ -f "$name_file" ]]; then
      local stored_name
      stored_name="$(tr -d '\n' < "$name_file" 2>/dev/null || true)"
      if [[ -n "$stored_name" ]]; then
        printf '%s\n' "$stored_name"
        return
      fi
    fi
  fi

  if [[ -n "${AOS_SESSION_NAME:-}" ]]; then
    printf '%s\n' "$AOS_SESSION_NAME"
    return
  fi

  aos_default_session_name "$session_id" "$harness"
}

aos_session_name_source() {
  local session_id="${1:-}"
  if [[ -n "$session_id" ]] && [[ -f "$(aos_session_name_file "$session_id")" ]]; then
    printf 'override\n'
    return
  fi
  if [[ -n "${AOS_SESSION_NAME:-}" ]]; then
    printf 'env\n'
    return
  fi
  printf 'generated\n'
}

aos_write_session_name_override() {
  local session_id="$1"
  local name="$2"
  local name_file

  if [[ -z "$session_id" ]]; then
    return 1
  fi

  name_file="$(aos_session_name_file "$session_id")"
  printf '%s\n' "$name" > "${name_file}.tmp"
  mv "${name_file}.tmp" "$name_file"
}

aos_refresh_session_registration() {
  local session_id="${1:-}"
  local session_name="${2:-}"
  local session_role="${3:-worker}"
  local session_harness="${4:-unknown}"
  local aos_bin="${5:-}"

  [[ -n "$aos_bin" ]] || return 1
  [[ -x "$aos_bin" ]] || return 1

  if [[ -n "$session_id" ]]; then
    "$aos_bin" tell --register --session-id "$session_id" --name "$session_name" --role "$session_role" --harness "$session_harness" >/dev/null 2>&1
    return $?
  fi

  if [[ -n "$session_name" ]]; then
    "$aos_bin" tell --register "$session_name" --role "$session_role" --harness "$session_harness" >/dev/null 2>&1
    return $?
  fi

  return 1
}
