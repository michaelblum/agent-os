#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 - "$ROOT" <<'PY'
import json
import os
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
canonical_roles = ("architect", "implementer", "reviewer", "explorer", "validator", "operator", "steward")
retired_roles = ("gdi", "github-steward")

for retired in (
    root / ".docks" / "gdi" / ".codex" / "config.toml",
    root / ".docks" / "gdi" / ".codex" / "hooks.json",
    root / ".docks" / "operator" / ".codex" / "config.toml",
    root / ".docks" / "operator" / ".codex" / "hooks.json",
):
    if retired.exists():
        raise SystemExit(f"FAIL: retired standalone dock Codex entry still exists: {retired}")

for role in retired_roles:
    if (root / ".codex" / "agents" / f"{role}.toml").exists():
        raise SystemExit(f"FAIL: retired native agent still exists: {role}")

root_config = (root / ".codex" / "config.toml").read_text()
foreman_config = (root / ".docks" / "foreman" / ".codex" / "config.toml").read_text()
for label, text in (("repo Codex config", root_config), ("Foreman Codex config", foreman_config)):
    if "multi_agent_v2 = true" not in text:
        raise SystemExit(f"FAIL: {label} must enable multi_agent_v2")
    for forbidden in ("goals = true", "multi_agent = true", "max_threads", "[agents.gdi]", "[agents.github-steward]"):
        if forbidden in text:
            raise SystemExit(f"FAIL: {label} still contains retired token {forbidden!r}")

for role in canonical_roles:
    repo_line = f'config_file = "agents/{role}.toml"'
    foreman_line = f'config_file = "../../../.codex/agents/{role}.toml"'
    if f"[agents.{role}]" not in root_config or repo_line not in root_config:
        raise SystemExit(f"FAIL: repo Codex config does not register {role}")
    if f"[agents.{role}]" not in foreman_config or foreman_line not in foreman_config:
        raise SystemExit(f"FAIL: Foreman Codex config does not register {role}")
    agent_path = root / ".codex" / "agents" / f"{role}.toml"
    text = agent_path.read_text()
    for required in (f'name = "{role}"', "model", "model_reasoning_effort", "developer_instructions"):
        if required not in text:
            raise SystemExit(f"FAIL: {role} TOML missing {required!r}")

foreman_agents = (root / ".docks" / "foreman" / "AGENTS.md").read_text()
for required in (
    "spawn_agent",
    "structured `agent_type`",
    "Prompt text is not role selection",
    "subagent-runtime blocker",
    "diagnostic/readback helper",
):
    if required not in foreman_agents:
        raise SystemExit(f"FAIL: Foreman AGENTS missing native-dispatch boundary token {required!r}")
for forbidden in (
    "agent_type=gdi",
    "github-steward",
    "foreman-session-transfer",
    "inbound-contract",
    "clipboard dispatch",
    "/goal",
    "Run `./aos dev subagent plan",
):
    if forbidden in foreman_agents:
        raise SystemExit(f"FAIL: Foreman AGENTS still contains retired token {forbidden!r}")

runner = root / ".docks" / "harness" / "dock-hook-runner.sh"
runner_text = runner.read_text()
for required in (
    "pre_tool_use_spawn_guard",
    "subagent_role_guard",
    "payload.get(\"agent_type\")",
    "say --voice-slot",
    "subagent-voices.json",
):
    if required not in runner_text:
        raise SystemExit(f"FAIL: Foreman hook runner missing {required!r}")

voices = json.loads((root / ".docks" / "foreman" / "subagent-voices.json").read_text())
slots = {}
for role in ("foreman", *canonical_roles):
    slot = voices.get(role, {}).get("voice_slot")
    if not isinstance(slot, int):
        raise SystemExit(f"FAIL: missing voice slot for {role}")
    if slot in slots:
        raise SystemExit(f"FAIL: voice slot {slot} reused by {role} and {slots[slot]}")
    slots[slot] = role
PY

TMPDIR_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-dock-hook-isolation.XXXXXX")"
auth_state_dir=".runtime/dev/foreman-subagent-authorization"
auth_session_id="dock-hook-test-subagent-auth"
auth_marker="$auth_state_dir/$auth_session_id.json"
rm -f "$auth_marker"
trap 'rm -rf "$TMPDIR_ROOT"; rm -f "$auth_marker"' EXIT

fake_aos="$TMPDIR_ROOT/aos"
fake_bin="$TMPDIR_ROOT/bin"
log_file="$TMPDIR_ROOT/aos.log"
mkdir -p "$fake_bin"

cat >"$fake_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'ARGV:%s\n' "$*" >>"$AOS_FAKE_LOG"
exit 0
SH
chmod +x "$fake_aos"

authorized_prompt_payload='{"session_id":"dock-hook-test-subagent-auth","hook_event_name":"UserPromptSubmit","prompt":"authorize registered Foreman subagents for this session"}'
out="$(printf '%s' "$authorized_prompt_payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" bash ".docks/foreman/hooks/user-prompt-submit.sh")"
python3 - "$out" "$auth_marker" <<'PY'
import json
import pathlib
import sys
payload = json.loads(sys.argv[1])
marker = pathlib.Path(sys.argv[2])
hook_output = payload.get("hookSpecificOutput", {})
if hook_output.get("hookEventName") != "UserPromptSubmit":
    raise SystemExit(f"FAIL: expected UserPromptSubmit context, got {payload}")
if not marker.exists():
    raise SystemExit("FAIL: authorization marker was not created")
PY
grep -q 'ARGV:say --voice-slot 1 .*Foreman ready.' "$log_file" || {
  echo "FAIL: missing Foreman start voice call" >&2
  cat "$log_file" >&2
  exit 1
}

missing_agent_type_spawn_payload='{"tool_name":"spawn_agent","tool_input":{"prompt":"Read-only helper task. Do not edit files."}}'
out="$(printf '%s' "$missing_agent_type_spawn_payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" bash ".docks/foreman/hooks/pre-tool-use.sh")"
python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
hook_output = payload.get("hookSpecificOutput", {})
if hook_output.get("permissionDecision") != "deny":
    raise SystemExit(f"FAIL: expected missing-agent_type spawn deny, got {payload}")
if "missing confirmed agent_type binding" not in hook_output.get("permissionDecisionReason", ""):
    raise SystemExit(f"FAIL: expected missing-agent_type reason, got {payload}")
PY

steward_spawn_payload='{"tool_name":"spawn_agent","tool_input":{"agent_type":"steward","prompt":"Return GitHub hygiene facts only."}}'
out="$(printf '%s' "$steward_spawn_payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" bash ".docks/foreman/hooks/pre-tool-use.sh")"
if [[ -n "$out" ]]; then
  echo "FAIL: expected explicit steward spawn to pass without JSON, got $out" >&2
  exit 1
fi

: >"$log_file"
subagent_start_payload='{"turn_id":"turn-1","agent_id":"agent-1","agent_type":"explorer","permission_mode":"danger-full-access"}'
subagent_stop_payload='{"turn_id":"turn-1","agent_id":"agent-1","agent_type":"explorer","last_assistant_message":"Explorer completed."}'
for hook_script in ".docks/foreman/hooks/subagent-start.sh" ".docks/foreman/hooks/subagent-stop.sh"; do
  if [[ "$hook_script" == *start* ]]; then
    payload="$subagent_start_payload"
  else
    payload="$subagent_stop_payload"
  fi
  out="$(printf '%s' "$payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" bash "$hook_script")"
  python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: expected subagent hook success, got {payload}")
PY
done
for expected in \
  'ARGV:say --voice-slot 1 ' \
  'ARGV:say --voice-slot 7 '; do
  grep -q "$expected" "$log_file" || {
    echo "FAIL: missing subagent voice call containing $expected" >&2
    cat "$log_file" >&2
    exit 1
  }
done

echo "PASS: dock hook isolation"
