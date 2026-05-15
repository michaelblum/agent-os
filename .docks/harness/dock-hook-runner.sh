#!/usr/bin/env bash
set -euo pipefail

phase="${1:-}"
dock="${2:-}"

if [[ "$phase" != "session-start" && "$phase" != "stop" ]]; then
  echo "FAIL: usage: dock-hook-runner.sh <session-start|stop> <dock>" >&2
  exit 2
fi
if [[ -z "$dock" ]]; then
  echo "FAIL: dock name is required" >&2
  exit 2
fi

REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
AOS_BIN="${AOS_DOCK_AOS_BIN:-$REPO_ROOT/aos}"
DOCK_ROOT="$REPO_ROOT/.docks/$dock"
DOCK_CONFIG="$DOCK_ROOT/dock.json"
DEFAULT_CONFIG="$REPO_ROOT/.docks/dock-defaults.json"
ACTIVE_PROFILE_FILE="$REPO_ROOT/docs/dev/active-profile.json"

source "$REPO_ROOT/.agents/hooks/session-common.sh"

if [[ ! -f "$DOCK_CONFIG" ]]; then
  echo "FAIL: missing dock config: $DOCK_CONFIG" >&2
  exit 2
fi

# Resolve active workflow profile from docs/dev/active-profile.json.
# Falls back to 'hybrid_trunk' only when the active profile file is absent.
resolve_active_profile() {
  python3 - "$ACTIVE_PROFILE_FILE" <<'PY'
import json, sys

active_file = sys.argv[1]

def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

active = load(active_file)
if active.get("active_profile"):
    print(active["active_profile"])
    raise SystemExit(0)

print("hybrid_trunk")
PY
}

dock_json_value() {
  local path="$1"
  local fallback="${2:-}"
  python3 - "$DEFAULT_CONFIG" "$DOCK_CONFIG" "$path" "$fallback" <<'PY'
import json
import sys

default_path, config_path, dotted_path, fallback = sys.argv[1:]

def load(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return {}

def merge(base, override):
    if isinstance(base, dict) and isinstance(override, dict):
        result = dict(base)
        for key, value in override.items():
            result[key] = merge(result.get(key), value)
        return result
    return override if override is not None else base

value = merge(load(default_path), load(config_path))
for part in dotted_path.split("."):
    if isinstance(value, dict) and part in value:
        value = value[part]
    else:
        print(fallback)
        raise SystemExit(0)
if isinstance(value, bool):
    print("true" if value else "false")
elif value is None:
    print(fallback)
else:
    print(str(value))
PY
}

dock_json_array() {
  local path="$1"
  python3 - "$DEFAULT_CONFIG" "$DOCK_CONFIG" "$path" <<'PY'
import json
import sys

default_path, config_path, dotted_path = sys.argv[1:]

def load(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return {}

def merge(base, override):
    if isinstance(base, dict) and isinstance(override, dict):
        result = dict(base)
        for key, value in override.items():
            result[key] = merge(result.get(key), value)
        return result
    return override if override is not None else base

value = merge(load(default_path), load(config_path))
for part in dotted_path.split("."):
    if isinstance(value, dict) and part in value:
        value = value[part]
    else:
        raise SystemExit(0)
if isinstance(value, list):
    for item in value:
        if item is not None and str(item):
            print(str(item))
elif isinstance(value, str):
    for item in value.split(","):
        item = item.strip()
        if item:
            print(item)
PY
}

run_optional_hook() {
  local name="$1"
  local script="$DOCK_ROOT/hooks/$name.sh"
  if [[ -x "$script" ]]; then
    run_command_with_input "$HOOK_INPUT" "$script"
  fi
}

# Fire a per-dock profile hook if it exists.
# Hook path convention: .docks/<dock>/hooks/profile/<profile>-<phase>.sh
run_optional_profile_hook() {
  local profile="$1"
  local hook_phase="$2"
  local script="$DOCK_ROOT/hooks/profile/${profile}-${hook_phase}.sh"
  if [[ -x "$script" ]]; then
    run_visible_command_with_input "$HOOK_INPUT" "$script"
  fi
}

run_aos_bounded() {
  if [[ -x "$AOS_BIN" ]]; then
    aos_run_hook_command_bounded "$hook_timeout" "$@" >/dev/null 2>&1 || true
  fi
}

run_command_with_input() {
  local payload="$1"
  shift
  local payload_file
  payload_file="$(mktemp "${TMPDIR:-/tmp}/aos-dock-hook.XXXXXX")"
  printf '%s' "$payload" >"$payload_file"
  aos_run_hook_command_bounded "$hook_timeout" bash -c 'payload_file="$1"; shift; "$@" < "$payload_file"' bash "$payload_file" "$@" >/dev/null 2>&1 || true
  rm -f "$payload_file"
}

run_visible_command_with_input() {
  local payload="$1"
  shift
  local payload_file
  payload_file="$(mktemp "${TMPDIR:-/tmp}/aos-dock-hook.XXXXXX")"
  printf '%s' "$payload" >"$payload_file"
  aos_run_hook_command_bounded "$hook_timeout" bash -c 'payload_file="$1"; shift; "$@" < "$payload_file"' bash "$payload_file" "$@" || true
  rm -f "$payload_file"
}

HOOK_INPUT="$(cat || true)"
SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
export AOS_DOCK_NAME="$dock"
export AOS_DOCK_PHASE="$phase"
export AOS_DOCK_SESSION_ID="$SESSION_ID"

# Resolve and export active workflow profile so all hooks and scripts can read
# it without re-parsing docs/dev/active-profile.json themselves.
export AOS_ACTIVE_WORKFLOW_PROFILE="$(resolve_active_profile)"

name="$(dock_json_value name "$dock")"
role="$(dock_json_value role "$dock")"
harness="$(dock_json_value harness codex)"
hook_timeout="${AOS_DOCK_HOOK_TIMEOUT_SECONDS:-$(dock_json_value hook_timeout_seconds 3)}"
voice_enabled="$(dock_json_value voice.enabled true)"
voice_language="$(dock_json_value voice.language en)"
voice_gender="$(dock_json_value voice.gender "")"
voice_slot="$(dock_json_value voice.voice_slot "")"
voice_quality_tiers=()
while IFS= read -r tier; do
  voice_quality_tiers+=("$tier")
done < <(dock_json_array voice.quality_tiers)
if [[ "${#voice_quality_tiers[@]}" -eq 0 ]]; then
  while IFS= read -r tier; do
    voice_quality_tiers+=("$tier")
  done < <(dock_json_array voice.quality_tier)
fi
stop_notice="$(dock_json_value events.stop.stop_notice "")"
if [[ -z "$stop_notice" ]]; then
  stop_notice="$(dock_json_value stop_notice "")"
fi
if [[ -z "$stop_notice" ]]; then
  stop_notice="$(dock_json_value voice.stop_notice "$name finished.")"
fi

run_optional_hook "pre-$phase"

if [[ -x "$AOS_BIN" ]]; then
  if [[ -n "$SESSION_ID" ]]; then
    run_aos_bounded "$AOS_BIN" tell --register --session-id "$SESSION_ID" --name "$name" --role "$role" --harness "$harness"

    if [[ "$phase" == "session-start" && "$voice_enabled" == "true" ]]; then
      voice_args=("$AOS_BIN" voice bind --session-id "$SESSION_ID")
      if [[ -n "$voice_language" ]]; then
        voice_args+=(--language "$voice_language")
      fi
      if [[ "${#voice_quality_tiers[@]}" -gt 0 ]]; then
        voice_quality_tier_csv="$(IFS=,; echo "${voice_quality_tiers[*]}")"
        voice_args+=(--quality-tier "$voice_quality_tier_csv")
      fi
      if [[ -n "$voice_gender" ]]; then
        voice_args+=(--gender "$voice_gender")
      fi
      run_aos_bounded "${voice_args[@]}"
    fi
  fi

  if [[ "$phase" == "stop" && "$voice_enabled" == "true" && -n "$voice_slot" ]]; then
    say_args=("$AOS_BIN" say --voice-slot "$voice_slot")
    if [[ -n "$voice_language" ]]; then
      say_args+=(--language "$voice_language")
    fi
    for tier in "${voice_quality_tiers[@]}"; do
      say_args+=(--quality-tier "$tier")
    done
    if [[ -n "$voice_gender" ]]; then
      say_args+=(--gender "$voice_gender")
    fi
    say_args+=("$stop_notice")
    run_aos_bounded "${say_args[@]}"
  fi
fi

# Fire profile-specific hook after main body, before post-phase hook.
# This is where per-role, per-profile automation runs (e.g. git context block
# for GDI under agentic_relay, relay state snapshot for relay under agentic_relay).
run_optional_profile_hook "$AOS_ACTIVE_WORKFLOW_PROFILE" "$phase"

run_optional_hook "post-$phase"

printf '{"continue":true}\n'
