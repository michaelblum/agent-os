#!/usr/bin/env bash
set -euo pipefail

phase="${1:-}"
dock="${2:-}"

if [[ "$phase" != "stop" && "$phase" != "user-prompt-submit" && "$phase" != "pre-tool-use" && "$phase" != "subagent-start" && "$phase" != "subagent-stop" ]]; then
  echo "FAIL: usage: dock-hook-runner.sh stop|user-prompt-submit|pre-tool-use|subagent-start|subagent-stop <dock>" >&2
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

subagent_role_guard() {
  local event="${1:-subagent-start}" fallback="${2:-}"
  python3 - "$HOOK_INPUT" "$REPO_ROOT" "$event" "$fallback" <<'PY'
import json
import sys

raw, _repo_root, event, fallback = sys.argv[1:]
try:
    payload = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError:
    payload = {}

role = payload.get("agent_type") or fallback
role = str(role or "").strip()
role_key = role.lower()

def emit(status, normalized_role, message):
    sep = "\x1f"
    label = normalized_role[:1].upper() + normalized_role[1:] if normalized_role else "Subagent"
    print(sep.join([status, normalized_role, label, message]))

label = "Native Codex subagent start" if event == "subagent-start" else "Native Codex subagent stop"
emit(
    "block",
    role_key,
    f"{label} is retired for agent-os. Close any native child thread and use ./aos dev agents with provider-sdk execution.",
)
PY
}

pre_tool_use_spawn_guard() {
  python3 - "$HOOK_INPUT" "$REPO_ROOT" <<'PY'
import json
import pathlib
import re
import sys

raw, repo_root = sys.argv[1:]
try:
    payload = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError:
    payload = {}

def first_string(*values):
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""

def first_dict(*values):
    for value in values:
        if isinstance(value, dict):
            return value
    return {}

tool_obj = payload.get("tool") if isinstance(payload.get("tool"), dict) else {}
tool_name = first_string(
    payload.get("tool_name"),
    payload.get("toolName"),
    payload.get("name"),
    payload.get("recipient_name"),
    payload.get("tool"),
    tool_obj.get("name"),
)
tool_key = tool_name.lower()

tool_input = first_dict(
    payload.get("tool_input"),
    payload.get("toolInput"),
    payload.get("input"),
    payload.get("arguments"),
    payload.get("args"),
    payload.get("parameters"),
)
if not tool_input:
    tool_input = payload

def nested_value(mapping, key):
    if not isinstance(mapping, dict):
        return None
    if key in mapping:
        return mapping.get(key)
    for nested_key in ("tool_input", "toolInput", "input", "arguments", "args", "parameters", "kwargs"):
        nested = mapping.get(nested_key)
        if isinstance(nested, dict) and key in nested:
            return nested.get(key)
    return None

looks_like_spawn = (
    tool_key in {"task", "spawn_agent", "spawnagent", "subagent"}
    or tool_key.endswith(".spawn_agent")
    or ("spawn" in tool_key and "agent" in tool_key)
    or ("subagent" in tool_key)
)

if not looks_like_spawn:
    print("ok\t")
    raise SystemExit(0)

print("block\tNative Codex custom-agent tools are retired for agent-os. Use ./aos dev agents with provider-sdk execution and the configured provider proxy.")
PY
}

user_prompt_submit_session_start() {
  python3 - "$HOOK_INPUT" "$REPO_ROOT" <<'PY'
import hashlib
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

raw, repo_root = sys.argv[1:]
try:
    payload = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError:
    payload = {}

prompt = str(payload.get("prompt") or "")
session_id = str(payload.get("session_id") or "").strip()
transcript_path = str(payload.get("transcript_path") or "").strip()

def session_key():
    value = session_id or transcript_path
    if not value:
        return ""
    if re.fullmatch(r"[A-Za-z0-9_.:-]{1,120}", value):
        return value.replace("/", "_")
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]

key = session_key()
state_dir = pathlib.Path(repo_root) / ".runtime" / "dev" / "foreman-subagent-authorization"
state_file = state_dir / f"{key}.json" if key else None

if state_file and state_file.is_file():
    print(json.dumps({"foremanStart": False}))
    raise SystemExit(0)

if state_file:
    state_dir.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps({
        "status": "authorized",
        "session_id": session_id or None,
        "transcript_path": transcript_path or None,
        "authorized_at": datetime.now(timezone.utc).isoformat(),
        "scope": "registered_foreman_subagents",
        "mode": "automatic_foreman_session",
    }, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"foremanStart": True}))
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
# Compatible with bash 3.2+ (no local -n nameref).
speak_slot() {
  local slot="$1" gender="$2" language="$3" text="$5"
  local tiers_name="$4"
  local -a tiers=()
  # Portable array copy: eval expands the named variable's elements into a new array.
  # tiers_name is validated above to contain only [a-zA-Z_][a-zA-Z0-9_]* chars by the
  # call sites (foreman_tiers, sub_tiers, voice_quality_tiers) so eval is safe here.
  eval "tiers=(\"\${${tiers_name}[@]+\${${tiers_name}[@]}}\")" 2>/dev/null || tiers=()
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
hook_continue="true"
system_message=""

if [[ "$phase" == "user-prompt-submit" ]]; then
  session_start_output="$(user_prompt_submit_session_start)"
  should_speak_foreman_start="$(python3 - "$session_start_output" <<'PY'
import json
import sys
try:
    payload = json.loads(sys.argv[1])
except Exception:
    print("false")
    raise SystemExit(0)
print("true" if payload.get("foremanStart") is True else "false")
PY
)"
  if [[ "$should_speak_foreman_start" == "true" && "$voice_enabled" == "true" ]]; then
    foreman_slot="$(dock_json_value voice.voice_slot "")"
    foreman_gender="$(dock_json_value voice.gender "")"
    foreman_language="$(dock_json_value voice.language en)"
    foreman_start_notice="$(dock_json_value events.start.start_notice "")"
    if [[ -z "$foreman_start_notice" ]]; then
      foreman_start_notice="$(dock_json_value start_notice "")"
    fi
    if [[ -z "$foreman_start_notice" ]]; then
      foreman_start_notice="$(dock_json_value voice.start_notice "Foreman ready.")"
    fi
    foreman_tiers=()
    while IFS= read -r tier; do
      foreman_tiers+=("$tier")
    done < <(dock_json_array voice.quality_tiers)
    [[ -n "$foreman_slot" ]] && speak_slot "$foreman_slot" "$foreman_gender" "$foreman_language" foreman_tiers "$foreman_start_notice"
  fi
  exit 0

elif [[ "$phase" == "pre-tool-use" ]]; then
  IFS=$'\t' read -r guard_status guard_message < <(pre_tool_use_spawn_guard)
  if [[ "$guard_status" != "ok" ]]; then
    python3 - "$guard_message" <<'PY'
import json
import sys

message = sys.argv[1]
print(json.dumps({
    "systemMessage": message,
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": message,
    },
}))
PY
    exit 0
  fi
  exit 0

# ─── STOP ──────────────────────────────────────────────────────────────────────
elif [[ "$phase" == "stop" ]]; then
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
  IFS=$'\037' read -r guard_status subagent_name subagent_label guard_message < <(subagent_role_guard subagent-start "${CODEX_SUBAGENT_NAME:-${CODEX_AGENT_NAME:-}}")

  if [[ "$guard_status" != "ok" ]]; then
    system_message="$guard_message Close the already-started subagent; SubagentStart cannot block startup in this Codex release."
  else
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
  fi

# ─── SUBAGENT-STOP ─────────────────────────────────────────────────────────────
elif [[ "$phase" == "subagent-stop" ]]; then
  IFS=$'\037' read -r guard_status subagent_name subagent_label guard_message < <(subagent_role_guard subagent-stop "${CODEX_SUBAGENT_NAME:-${CODEX_AGENT_NAME:-}}")

  if [[ "$guard_status" != "ok" ]]; then
    system_message="$guard_message"
  else
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

fi

if [[ -n "$system_message" || "$hook_continue" != "true" ]]; then
  python3 - "$hook_continue" "$system_message" <<'PY'
import json
import sys

hook_continue = sys.argv[1] == "true"
message = sys.argv[2]
payload = {"continue": hook_continue}
if message:
    payload["systemMessage"] = message
print(json.dumps(payload))
PY
else
  printf '{"continue":true}\n'
fi
