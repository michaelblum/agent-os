#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 - "$ROOT" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
canonical_roles = ("architect", "implementer", "reviewer", "explorer", "validator", "operator", "steward", "historian")

for retired in (
    root / ".docks" / "gdi" / ".codex" / "config.toml",
    root / ".docks" / "gdi" / ".codex" / "hooks.json",
    root / ".docks" / "operator" / ".codex" / "config.toml",
    root / ".docks" / "operator" / ".codex" / "hooks.json",
):
    if retired.exists():
        raise SystemExit(f"FAIL: retired standalone dock Codex entry still exists: {retired}")

repo_agents = root / ".codex" / "agents"
if repo_agents.exists() and any(repo_agents.glob("*.toml")):
    raise SystemExit("FAIL: repo-root .codex/agents TOMLs must not exist as active Codex registrations")

for role in canonical_roles:
    agent_path = root / "ai-agents" / "providers" / "codex" / f"{role}.toml"
    text = agent_path.read_text()
    for required in (f'name = "{role}"', "model", "model_reasoning_effort", "developer_instructions"):
        if required not in text:
            raise SystemExit(f"FAIL: provider role TOML {role} missing {required!r}")

root_config = (root / ".codex" / "config.toml").read_text()
foreman_config = (root / ".docks" / "foreman" / ".codex" / "config.toml").read_text()
for label, text in (("repo Codex config", root_config), ("Foreman Codex config", foreman_config)):
    for forbidden in ("multi_agent_v2", "[agents", "config_file", ".codex/agents", "goals = true", "multi_agent = true", "max_threads"):
        if forbidden in text:
            raise SystemExit(f"FAIL: {label} still contains retired native-agent token {forbidden!r}")

foreman_agents = (root / ".docks" / "foreman" / "AGENTS.md").read_text()
for required in (
    "docs/adr/0016-aos-owned-agent-execution.md",
    "docs/adr/0017-retire-codex-native-custom-agents.md",
    "Native Codex custom-agent registration is disabled",
    "provider-sdk",
    "./aos dev agents",
    "ai-agents/providers/codex/*.toml",
):
    if required not in foreman_agents:
        raise SystemExit(f"FAIL: Foreman AGENTS missing AOS-owned runner token {required!r}")
for forbidden in (
    "spawn_agent",
    "task_name",
    "`agent_type` must match",
    "multi_agent_v2",
    "clipboard dispatch",
    "/goal",
    "Default to Foreman-orchestrated direct subagents",
):
    if forbidden in foreman_agents:
        raise SystemExit(f"FAIL: Foreman AGENTS still contains retired native-agent token {forbidden!r}")

docks_readme = (root / ".docks" / "README.md").read_text()
for required in (
    "A dock is a named runtime launch envelope",
    ".docks/foreman/` is the only current named dock",
    "Future docks are allowed",
    "GDI is superseded by Implementer",
    "Implementer is not\ncentered on Codex `/goal`",
):
    if required not in docks_readme:
        raise SystemExit(f"FAIL: dock README missing dock-model token {required!r}")

profile_readme = (root / ".docks" / "profiles" / "README.md").read_text()
for required in (
    "Dock = named runtime launch envelope",
    "Foreman is the only\n  current named dock",
    "AOS-owned runner only; native Codex subagents disabled",
    "docs/adr/0016-aos-owned-agent-execution.md",
    "encrypted tool registration",
    "provider SDK and configured proxy",
    "remain retired unless",
):
    if required not in profile_readme:
        raise SystemExit(f"FAIL: dock profile README missing {required!r}")

runner_text = (root / ".docks" / "harness" / "dock-hook-runner.sh").read_text()
for required in (
    "pre_tool_use_spawn_guard",
    "subagent_role_guard",
    "Native Codex custom-agent tools are retired",
    "Native Codex subagent start",
    "f\"{label} is retired",
    "say --voice-slot",
    "subagent-voices.json",
):
    if required not in runner_text:
        raise SystemExit(f"FAIL: Foreman hook runner missing {required!r}")
for forbidden in (
    "multi_agent_v2 spawn shape",
    "missing v2 task_name",
    "repo-root native agent config",
    ".codex\" / \"agents",
):
    if forbidden in runner_text:
        raise SystemExit(f"FAIL: Foreman hook runner still validates retired native-agent contract {forbidden!r}")

voices = json.loads((root / ".docks" / "foreman" / "subagent-voices.json").read_text())
slots = {}
for role in ("foreman", *canonical_roles):
    slot = voices.get(role, {}).get("voice_slot")
    if not isinstance(slot, int):
        raise SystemExit(f"FAIL: missing voice slot for {role}")
    if slot in slots:
        raise SystemExit(f"FAIL: voice slot {slot} reused by {role} and {slots[slot]}")
    slots[slot] = role

active_profile = json.loads((root / ".docks" / "profiles" / "active-profile.json").read_text())
if active_profile.get("header", {}).get("delegation") != "AOS-owned runner only; native Codex subagents disabled":
    raise SystemExit("FAIL: active dock profile header must disable native Codex subagents")
for pack in active_profile.get("profile_packs", []):
    pack_root = root / ".docks" / "profiles" / pack
    if not (pack_root / "profile.md").is_file() or not (pack_root / "profile.json").is_file():
        raise SystemExit(f"FAIL: active dock profile pack missing profile.md/profile.json: {pack}")

one_world_stale = (root / ".docks" / "profiles" / "workstream-one-world" / "stale-sources.md").read_text()
for required in ("entry-point", "transfer-contract", "goal-command", "clipboard-dispatch", "GDI is superseded by Implementer"):
    if required not in one_world_stale:
        raise SystemExit(f"FAIL: stale-source quarantine missing {required!r}")

workflow_readme = (root / "docs" / "dev" / "workflow-profiles" / "README.md").read_text()
if "not the primary session operating model" not in workflow_readme:
    raise SystemExit("FAIL: workflow profile docs must be demoted below dock profiles")
if "entry paths" in workflow_readme:
    raise SystemExit("FAIL: workflow profile docs still use current entry-path framing")
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

authorized_prompt_payload='{"session_id":"dock-hook-test-subagent-auth","hook_event_name":"UserPromptSubmit","prompt":"Run the first real task."}'
out="$(printf '%s' "$authorized_prompt_payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" bash ".docks/foreman/hooks/user-prompt-submit.sh")"
python3 - "$out" "$auth_marker" <<'PY'
import pathlib
import sys
stdout = sys.argv[1]
marker = pathlib.Path(sys.argv[2])
if stdout:
    raise SystemExit(f"FAIL: UserPromptSubmit should be quiet after auto-authorizing, got {stdout!r}")
if not marker.exists():
    raise SystemExit("FAIL: automatic authorization marker was not created")
PY
grep -q 'ARGV:say --voice-slot 1 .*Foreman ready.' "$log_file" || {
  echo "FAIL: missing Foreman start voice call" >&2
  cat "$log_file" >&2
  exit 1
}

spawn_payload='{"tool_name":"multi_agent_v2.spawn_agent","tool_input":{"task_name":"steward_readback","agent_type":"steward","fork_turns":"none","message":"Return GitHub hygiene facts only."}}'
out="$(printf '%s' "$spawn_payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" bash ".docks/foreman/hooks/pre-tool-use.sh")"
python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
hook_output = payload.get("hookSpecificOutput", {})
if hook_output.get("permissionDecision") != "deny":
    raise SystemExit(f"FAIL: expected native spawn deny, got {payload}")
if "Native Codex custom-agent tools are retired" not in hook_output.get("permissionDecisionReason", ""):
    raise SystemExit(f"FAIL: expected retired native-agent reason, got {payload}")
PY

: >"$log_file"
subagent_start_payload='{"turn_id":"turn-1","agent_id":"agent-1","agent_type":"explorer","permission_mode":"danger-full-access"}'
subagent_stop_payload='{"turn_id":"turn-1","agent_id":"agent-1","agent_type":"explorer","last_assistant_message":"Explorer completed."}'
for hook_script in ".docks/foreman/hooks/subagent-start.sh" ".docks/foreman/hooks/subagent-stop.sh"; do
  if [[ "$hook_script" == *start* ]]; then
    payload="$subagent_start_payload"
    expected="Native Codex subagent start is retired"
  else
    payload="$subagent_stop_payload"
    expected="Native Codex subagent stop is retired"
  fi
  out="$(printf '%s' "$payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" bash "$hook_script")"
  python3 - "$out" "$expected" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
expected = sys.argv[2]
if payload.get("continue") is not True:
    raise SystemExit(f"FAIL: expected subagent hook to continue current thread, got {payload}")
if expected not in payload.get("systemMessage", ""):
    raise SystemExit(f"FAIL: expected retired lifecycle message {expected!r}, got {payload}")
PY
done

if [[ -s "$log_file" ]]; then
  echo "FAIL: retired native subagent lifecycle should not speak" >&2
  cat "$log_file" >&2
  exit 1
fi

echo "PASS: dock hook isolation"
