#!/usr/bin/env bash
set -euo pipefail

phase="${1:-}"
dock="${2:-}"

if [[ "$phase" != "stop" && "$phase" != "subagent-start" && "$phase" != "subagent-stop" ]]; then
  echo "FAIL: usage: dock-hook-runner.sh stop|subagent-start|subagent-stop <dock>" >&2
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

source "$REPO_ROOT/.agents/hooks/session-common.sh"

if [[ ! -f "$DOCK_CONFIG" ]]; then
  echo "FAIL: missing dock config: $DOCK_CONFIG" >&2
  exit 2
fi

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

hook_json_value() {
  local field="$1" fallback="${2:-}"
  python3 - "$HOOK_INPUT" "$field" "$fallback" <<'PY'
import json
import sys

raw, field, fallback = sys.argv[1:]
try:
    payload = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError:
    print(fallback)
    raise SystemExit(0)
value = payload.get(field, fallback)
if value is None:
    value = fallback
print(str(value))
PY
}

# Read voice config for an arbitrary role from subagent-voices.json.
# Usage: subagent_voice_field <role> <field> <fallback>
subagent_voice_field() {
  local role="$1" field="$2" fallback="${3:-}"
  local voices_file="$REPO_ROOT/.docks/foreman/subagent-voices.json"
  python3 - "$voices_file" "$role" "$field" "$fallback" <<'PY'
import json, sys
voices_file, role, field, fallback = sys.argv[1:]
try:
    data = json.load(open(voices_file, encoding="utf-8"))
except FileNotFoundError:
    print(fallback)
    raise SystemExit(0)
entry = data.get(role) or data.get("_fallback") or {}
val = entry.get(field, fallback)
if isinstance(val, bool):
    print("true" if val else "false")
elif val is None:
    print(fallback)
else:
    print(str(val))
PY
}

subagent_voice_array() {
  local role="$1" field="$2"
  local voices_file="$REPO_ROOT/.docks/foreman/subagent-voices.json"
  python3 - "$voices_file" "$role" "$field" <<'PY'
import json, sys
voices_file, role, field = sys.argv[1:]
try:
    data = json.load(open(voices_file, encoding="utf-8"))
except FileNotFoundError:
    raise SystemExit(0)
entry = data.get(role) or data.get("_fallback") or {}
val = entry.get(field)
if isinstance(val, list):
    for item in val:
        if item:
            print(str(item))
elif isinstance(val, str):
    for item in val.split(","):
        item = item.strip()
        if item:
            print(item)
PY
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

run_optional_hook() {
  local name="$1"
  local script="$DOCK_ROOT/hooks/$name.sh"
  if [[ -x "$script" ]]; then
    run_command_with_input "$HOOK_INPUT" "$script"
  fi
}

run_aos_bounded() {
  if [[ -x "$AOS_BIN" ]]; then
    aos_run_hook_command_bounded "$hook_timeout" "$@" >/dev/null 2>&1 || true
  fi
}

# Build and run an aos say command for a given voice slot.
# Usage: speak_slot <slot> <gender> <language> <tiers_array_nameref> <text>
speak_slot() {
  local slot="$1" gender="$2" language="$3" text="$5"
  local tiers_name="$4"
  local -a tiers=()
  eval "tiers=(\"\${${tiers_name}[@]}\")"
  [[ -z "$slot" ]] && return 0
  local say_args=("$AOS_BIN" say --voice-slot "$slot")
  [[ -n "$language" ]] && say_args+=(--language "$language")
  for tier in "${tiers[@]}"; do
    say_args+=(--quality-tier "$tier")
  done
  [[ -n "$gender" ]] && say_args+=(--gender "$gender")
  say_args+=("$text")
  run_aos_bounded "${say_args[@]}"
}

HOOK_INPUT="$(cat || true)"
hook_timeout="${AOS_DOCK_HOOK_TIMEOUT_SECONDS:-$(dock_json_value hook_timeout_seconds 3)}"
name="$(dock_json_value name "$dock")"
voice_enabled="$(dock_json_value voice.enabled true)"

# ─── STOP ──────────────────────────────────────────────────────────────────────
if [[ "$phase" == "stop" ]]; then
  voice_language="$(dock_json_value voice.language en)"
  voice_gender="$(dock_json_value voice.gender "")"
  voice_slot="$(dock_json_value voice.voice_slot "")"
  stop_notice="${AOS_FOREMAN_DONE:-}"
  if [[ -z "$stop_notice" ]]; then
    stop_notice="$(dock_json_value events.stop.stop_notice "")"
  fi
  if [[ -z "$stop_notice" ]]; then
    stop_notice="$(dock_json_value stop_notice "")"
  fi
  if [[ -z "$stop_notice" ]]; then
    stop_notice="$(dock_json_value voice.stop_notice "$name finished.")"
  fi

  voice_quality_tiers=()
  while IFS= read -r tier; do
    voice_quality_tiers+=("$tier")
  done < <(dock_json_array voice.quality_tiers)
  if [[ "${#voice_quality_tiers[@]}" -eq 0 ]]; then
    while IFS= read -r tier; do
      voice_quality_tiers+=("$tier")
    done < <(dock_json_array voice.quality_tier)
  fi

  run_optional_hook "pre-stop"

  if [[ "$voice_enabled" == "true" && -n "$voice_slot" ]]; then
    speak_slot "$voice_slot" "$voice_gender" "$voice_language" voice_quality_tiers "$stop_notice"
  fi

  run_optional_hook "post-stop"

# ─── SUBAGENT-START ────────────────────────────────────────────────────────────
elif [[ "$phase" == "subagent-start" ]]; then
  subagent_name="$(hook_json_value agent_type "${CODEX_SUBAGENT_NAME:-${CODEX_AGENT_NAME:-}}")"
  if [[ -z "$subagent_name" ]]; then
    subagent_name="subagent"
  fi
  subagent_label="$(echo "${subagent_name:0:1}" | tr '[:lower:]' '[:upper:]')${subagent_name:1}"

  # Foreman voice (from dock.json)
  foreman_slot="$(dock_json_value voice.voice_slot "")"
  foreman_gender="$(dock_json_value voice.gender "")"
  foreman_language="$(dock_json_value voice.language en)"
  foreman_tiers=()
  while IFS= read -r tier; do
    foreman_tiers+=("$tier")
  done < <(dock_json_array voice.quality_tiers)

  # Subagent voice (from subagent-voices.json)
  sub_slot="$(subagent_voice_field "$subagent_name" voice_slot "")"
  sub_gender="$(subagent_voice_field "$subagent_name" gender "")"
  sub_language="$(subagent_voice_field "$subagent_name" language en)"
  sub_tiers=()
  while IFS= read -r tier; do
    sub_tiers+=("$tier")
  done < <(subagent_voice_array "$subagent_name" quality_tiers)

  # Dynamic overrides; fallbacks are imperative command + acknowledgment
  foreman_cmd="${AOS_FOREMAN_CMD:-${subagent_label}, begin!}"
  subagent_ack="${AOS_SUBAGENT_ACK:-${subagent_label} ready!}"

  run_optional_hook "pre-subagent-start"

  if [[ "$voice_enabled" == "true" ]]; then
    [[ -n "$foreman_slot" ]] && speak_slot "$foreman_slot" "$foreman_gender" "$foreman_language" foreman_tiers "$foreman_cmd"
    [[ -n "$sub_slot" ]]     && speak_slot "$sub_slot"     "$sub_gender"     "$sub_language"     sub_tiers     "$subagent_ack"
  fi

  run_optional_hook "post-subagent-start"

# ─── SUBAGENT-STOP ─────────────────────────────────────────────────────────────
elif [[ "$phase" == "subagent-stop" ]]; then
  subagent_name="$(hook_json_value agent_type "${CODEX_SUBAGENT_NAME:-${CODEX_AGENT_NAME:-}}")"
  if [[ -z "$subagent_name" ]]; then
    subagent_name="subagent"
  fi
  subagent_label="$(echo "${subagent_name:0:1}" | tr '[:lower:]' '[:upper:]')${subagent_name:1}"

  # Subagent voice
  sub_slot="$(subagent_voice_field "$subagent_name" voice_slot "")"
  sub_gender="$(subagent_voice_field "$subagent_name" gender "")"
  sub_language="$(subagent_voice_field "$subagent_name" language en)"
  sub_tiers=()
  while IFS= read -r tier; do
    sub_tiers+=("$tier")
  done < <(subagent_voice_array "$subagent_name" quality_tiers)

  # Foreman voice
  foreman_slot="$(dock_json_value voice.voice_slot "")"
  foreman_gender="$(dock_json_value voice.gender "")"
  foreman_language="$(dock_json_value voice.language en)"
  foreman_tiers=()
  while IFS= read -r tier; do
    foreman_tiers+=("$tier")
  done < <(dock_json_array voice.quality_tiers)

  # Dynamic overrides; fallbacks are stop announcement + acknowledgment
  subagent_done="${AOS_SUBAGENT_DONE:-${subagent_label} stopped, returning to Foreman.}"
  foreman_ack="${AOS_FOREMAN_ACK:-Acknowledged, ${subagent_label}!}"

  run_optional_hook "pre-subagent-stop"

  if [[ "$voice_enabled" == "true" ]]; then
    [[ -n "$sub_slot" ]]     && speak_slot "$sub_slot"     "$sub_gender"     "$sub_language"     sub_tiers     "$subagent_done"
    [[ -n "$foreman_slot" ]] && speak_slot "$foreman_slot" "$foreman_gender" "$foreman_language" foreman_tiers "$foreman_ack"
  fi

  run_optional_hook "post-subagent-stop"

fi

system_message=""

if [[ -n "$system_message" ]]; then
  python3 - "$system_message" <<'PY'
import json
import sys

print(json.dumps({"continue": True, "systemMessage": sys.argv[1]}))
PY
else
  printf '{"continue":true}\n'
fi
