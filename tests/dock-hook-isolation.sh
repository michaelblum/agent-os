#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 - "$ROOT" <<'PY'
import json
import os
import pathlib
import sys

root = pathlib.Path(sys.argv[1])

for retired in (
    root / ".docks" / "hooks",
    root / ".docks" / "harness" / "goal-pause-control.sh",
    root / ".docks" / "harness" / "human-needed-surface.sh",
    root / ".docks" / "harness" / "dev-build-checkpoint.sh",
    root / ".docks" / "harness" / "dev-build-checkpoint-contract.sh",
    root / ".docks" / "harness" / "pre-tool-use-runner.sh",
    root / ".docks" / "harness" / "post-tool-use-runner.sh",
    root / ".docks" / "harness" / "session-pickup",
    root / "scripts" / "dock-session-pickup",
    root / "tests" / "dock-session-pickup.sh",
):
    if retired.exists():
        raise SystemExit(f"FAIL: retired dock helper still exists: {retired}")

for role in ("gdi", "operator"):
    for retired in (
        root / ".docks" / role / ".codex" / "config.toml",
        root / ".docks" / role / ".codex" / "hooks.json",
        root / ".docks" / role / "hooks" / "stop.sh",
        root / ".docks" / role / "hooks" / "pre-tool-use.sh",
        root / ".docks" / role / "hooks" / "post-tool-use.sh",
        root / ".docks" / role / "README.md",
    ):
        if retired.exists():
            raise SystemExit(f"FAIL: standalone {role} Codex entry file still exists: {retired}")

runner = root / ".docks" / "harness" / "dock-hook-runner.sh"
provider_input_control = root / ".docks" / "harness" / "provider-input-control.sh"
pty_input_control = root / ".docks" / "harness" / "pty-input-control.sh"
for label, path in (
    ("Foreman hook runner", runner),
    ("legacy provider input control helper", provider_input_control),
    ("legacy PTY input control helper", pty_input_control),
):
    if not path.exists():
        raise SystemExit(f"FAIL: missing {label}: {path}")
    if not os.access(path, os.X_OK):
        raise SystemExit(f"FAIL: {label} is not executable: {path}")

runner_text = runner.read_text()
for required in (
    ".agents/hooks/session-common.sh",
    "aos_run_hook_command_bounded",
    "run_optional_hook \"pre-stop\"",
    "run_optional_hook \"post-stop\"",
    "say --voice-slot",
    "subagent-voices.json",
    "hook_json_value agent_type",
):
    if required not in runner_text:
        raise SystemExit(f"FAIL: Foreman hook runner missing {required!r}")
for forbidden in (
    "gdi_binary_change_forbidden",
    "repo_binary_build",
    "tcc_permission_reset",
    "dev-build-checkpoint",
    "human-needed-surface",
    "goal-pause-control",
    "permissions reset-runtime --mode repo",
    "ready --post-permission",
    "x-apple.systempreferences",
    "aos_resolve_session_id",
    "voice bind",
    "voice final-response",
):
    if forbidden in runner_text:
        raise SystemExit(f"FAIL: Foreman hook runner still contains retired automation token {forbidden!r}")

defaults = json.loads((root / ".docks" / "dock-defaults.json").read_text())
if defaults.get("voice") != {
    "enabled": True,
    "language": "en",
    "gender": "female",
    "quality_tiers": ["premium", "enhanced"],
}:
    raise SystemExit(f"FAIL: shared dock voice defaults mismatch: {defaults}")

for role in ("foreman", "gdi", "operator"):
    dock_config = json.loads((root / ".docks" / role / "dock.json").read_text())
    if dock_config.get("name") != role or dock_config.get("role") != role:
        raise SystemExit(f"FAIL: {role} dock.json does not preserve dock-local identity: {dock_config}")
    if dock_config.get("harness") != "codex":
        raise SystemExit(f"FAIL: {role} dock.json harness should be codex: {dock_config}")
    if dock_config.get("hook_timeout_seconds") != 8:
        raise SystemExit(f"FAIL: {role} dock.json should bound AOS calls to 8 seconds: {dock_config}")

foreman_hooks_path = root / ".docks" / "foreman" / ".codex" / "hooks.json"
payload = json.loads(foreman_hooks_path.read_text())
hook_names = set(payload.get("hooks", {}).keys())
expected_hook_names = {"Stop", "SubagentStart", "SubagentStop"}
if hook_names != expected_hook_names:
    raise SystemExit(f"FAIL: Foreman hooks mismatch: got {sorted(hook_names)} expected {sorted(expected_hook_names)}")

commands = [
    hook.get("command", "")
    for entries in payload.get("hooks", {}).values()
    for matcher in entries
    for hook in matcher.get("hooks", [])
]
for expected in (
    ".docks/foreman/hooks/stop.sh",
    ".docks/foreman/hooks/subagent-start.sh",
    ".docks/foreman/hooks/subagent-stop.sh",
):
    if not any(expected in command for command in commands):
        raise SystemExit(f"FAIL: Foreman hooks do not use isolated script {expected}: {commands}")
if any("pre-tool-use" in command or "post-tool-use" in command for command in commands):
    raise SystemExit(f"FAIL: Foreman must not install per-tool hooks: {commands}")
if any(".docks/hooks/" in command or "AOS_DOCK_ROLE=" in command for command in commands):
    raise SystemExit(f"FAIL: Foreman hooks still route through shared dock behavior: {commands}")
for matcher in payload.get("hooks", {}).values():
    for entry in matcher:
        for hook in entry.get("hooks", []):
            timeout = hook.get("timeout")
            command = hook.get("command", "")
            max_timeout = 15 if "subagent-" in command else 10
            if not isinstance(timeout, int) or timeout > max_timeout:
                raise SystemExit(f"FAIL: Foreman hook timeout is not bounded tightly: {hook}")

for script_name in ("stop.sh", "subagent-start.sh", "subagent-stop.sh"):
    script_path = root / ".docks" / "foreman" / "hooks" / script_name
    if not os.access(script_path, os.X_OK):
        raise SystemExit(f"FAIL: Foreman {script_name} is not executable")
    script = script_path.read_text()
    if ".docks/harness/dock-hook-runner.sh" not in script:
        raise SystemExit(f"FAIL: Foreman {script_name} is not a shared harness wrapper")
    if "exec " not in script:
        raise SystemExit(f"FAIL: Foreman {script_name} should exec the shared harness")

foreman_config = (root / ".docks" / "foreman" / ".codex" / "config.toml").read_text()
for role in ("gdi", "operator", "explorer"):
    role_header = f"[agents.{role}]"
    config_line = f'config_file = "agents/{role}.toml"'
    if role_header not in foreman_config:
        raise SystemExit(f"FAIL: Foreman subagent config missing {role_header}")
    if config_line not in foreman_config:
        raise SystemExit(f"FAIL: Foreman subagent config missing {config_line}")
    if f'{role} = "agents/{role}.toml"' in foreman_config or f'{role}      = "agents/{role}.toml"' in foreman_config:
        raise SystemExit(f"FAIL: Foreman subagent config reintroduced string-map entry for {role}")

    agent_path = root / ".docks" / "foreman" / ".codex" / "agents" / f"{role}.toml"
    agent_text = agent_path.read_text()
    for required in (
        f'name = "{role}"',
        "description = ",
        "model = ",
        "model_reasoning_effort = ",
        "developer_instructions = ",
    ):
        if required not in agent_text:
            raise SystemExit(f"FAIL: {role} subagent TOML missing {required!r}")
    if "prompt = " in agent_text:
        raise SystemExit(f"FAIL: {role} subagent TOML reintroduced deprecated prompt field")
    if 'model = "gpt-5.5"' in agent_text and 'model_reasoning_effort = "xhigh"' in agent_text:
        raise SystemExit(f"FAIL: {role} subagent TOML inherits Foreman's expensive model/effort posture")

foreman_agents = (root / ".docks" / "foreman" / "AGENTS.md").read_text()
foreman_subagents = (root / ".docks" / "foreman" / "SUBAGENTS.md").read_text()
gdi_agents = (root / ".docks" / "gdi" / "AGENTS.md").read_text()
explorer_agent = (root / ".docks" / "foreman" / ".codex" / "agents" / "explorer.toml").read_text()
foreman_transfer_skill = (root / ".docks" / "foreman" / "skills" / "session-transfer" / "SKILL.md").read_text()
if "name: foreman-session-transfer" not in foreman_transfer_skill:
    raise SystemExit("FAIL: Foreman transfer skill uses the wrong name")
for label, text in (("Foreman AGENTS", foreman_agents), ("Foreman transfer skill", foreman_transfer_skill)):
    legacy_command_token = "/" + "goal"
    for forbidden in (f"receives a `{legacy_command_token}", "`attn: GDI,", "attn: GDI, follow"):
        if forbidden in text:
            raise SystemExit(f"FAIL: {label} reintroduced command/addressee ceremony: {forbidden}")

if ".docks/foreman/SUBAGENTS.md#context-firewall" not in foreman_agents:
    raise SystemExit("FAIL: Foreman AGENTS does not reference the subagent context firewall")

for required in (
    "## Context Firewall",
    "Foreman owns the read-first set",
    "known stale pools",
    "Design docs",
    "Explorer performs bounded read-only scans only",
):
    if required not in foreman_subagents:
        raise SystemExit(f"FAIL: Foreman SUBAGENTS missing context-firewall contract token {required!r}")

for required in (
    "Foreman selects the read-first set",
    "accepted issue/PR comments",
    "merged PRs outweigh old issue bodies",
    "conflicting_authority",
):
    if required not in gdi_agents:
        raise SystemExit(f"FAIL: GDI AGENTS missing context-firewall stop token {required!r}")

for required in (
    "Expand beyond Foreman's named paths, symbols, refs, or date bounds",
    "raw counts",
    "Do not interpret, recommend, or decide",
):
    if required not in explorer_agent:
        raise SystemExit(f"FAIL: Explorer adapter missing bounded raw-scan token {required!r}")
PY

TMPDIR_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-dock-hook-isolation.XXXXXX")"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

fake_aos="$TMPDIR_ROOT/aos"
log_file="$TMPDIR_ROOT/aos.log"
fake_bin="$TMPDIR_ROOT/bin"
tmux_log="$TMPDIR_ROOT/tmux.log"
clipboard_log="$TMPDIR_ROOT/clipboard.log"
mkdir -p "$fake_bin"

cat >"$fake_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PHASE:%s ARGV:%s\n' "${AOS_DOCK_PHASE:-unknown}" "$*" >>"$AOS_FAKE_LOG"
exit 0
SH
chmod +x "$fake_aos"

cat >"$fake_bin/pbcopy" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
payload="$(cat || true)"
printf 'CLIPBOARD:%s:%s\n' "${AOS_FAKE_CLIPBOARD_ROLE:-unknown}" "$payload" >>"$AOS_FAKE_CLIPBOARD_LOG"
SH
chmod +x "$fake_bin/pbcopy"

payload='{"session_id":"019d99f3-0001-7000-b000-000000000001","last_assistant_message":"Do not speak this tail.\n\n(on clipboard)"}'
out="$(printf '%s' "$payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" AOS_FAKE_CLIPBOARD_LOG="$clipboard_log" AOS_FAKE_CLIPBOARD_ROLE="foreman" bash ".docks/foreman/hooks/stop.sh")"
python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: expected Foreman Stop hook success JSON, got {payload}")
PY
grep -q 'ARGV:say --voice-slot 1 --language en --quality-tier premium --quality-tier enhanced --gender male Foreman finished.' "$log_file" || {
  echo "FAIL: missing Foreman Stop hook say voice-slot call" >&2
  cat "$log_file" >&2
  exit 1
}
if grep -q 'needs TCC reset\|voice bind\|voice final-response\|Do not speak this tail' "$log_file"; then
  echo "FAIL: Foreman Stop hook should not speak TCC notices, bind voices, or speak assistant tails" >&2
  cat "$log_file" >&2
  exit 1
fi

: >"$log_file"
subagent_start_payload='{"turn_id":"turn-1","agent_id":"agent-1","agent_type":"explorer","permission_mode":"danger-full-access"}'
subagent_stop_payload='{"turn_id":"turn-1","agent_id":"agent-1","agent_type":"explorer","last_assistant_message":"Explorer completed."}'
for hook_script in ".docks/foreman/hooks/subagent-start.sh" ".docks/foreman/hooks/subagent-stop.sh"; do
  if [[ "$hook_script" == *start* ]]; then
    sub_payload="$subagent_start_payload"
  else
    sub_payload="$subagent_stop_payload"
  fi
  out="$(printf '%s' "$sub_payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" bash "$hook_script")"
  python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: expected subagent hook success JSON, got {payload}")
PY
done
for expected in \
  'ARGV:say --voice-slot 1 --language en --quality-tier premium --quality-tier enhanced --gender male Explorer, begin!' \
  'ARGV:say --voice-slot 4 --language en --quality-tier premium --quality-tier enhanced --gender female Explorer ready!' \
  'ARGV:say --voice-slot 4 --language en --quality-tier premium --quality-tier enhanced --gender female Explorer stopped, returning to Foreman.' \
  'ARGV:say --voice-slot 1 --language en --quality-tier premium --quality-tier enhanced --gender male Acknowledged, Explorer!'; do
  grep -q "$expected" "$log_file" || {
    echo "FAIL: missing Subagent hook say voice-slot call: $expected" >&2
    cat "$log_file" >&2
    exit 1
  }
done
if grep -q 'Subagent begin\|Subagent ready\|Subagent stopped' "$log_file"; then
  echo "FAIL: Subagent hooks should use agent_type from hook JSON instead of fallback labels" >&2
  cat "$log_file" >&2
  exit 1
fi

cat >"$fake_bin/tmux" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'TMUX:%s\n' "$*" >>"$AOS_FAKE_TMUX_LOG"
if [[ "${1:-}" == "load-buffer" ]]; then
  stdin="$(cat || true)"
  printf 'TMUX_STDIN:%s\n' "$stdin" >>"$AOS_FAKE_TMUX_LOG"
fi
SH
chmod +x "$fake_bin/tmux"

PATH="$fake_bin:$PATH" AOS_FAKE_TMUX_LOG="$tmux_log" ".docks/harness/provider-input-control.sh" send "%42" "/goal test clean input"
grep -q 'TMUX:send-keys -t %42 C-u' "$tmux_log" || {
  echo "FAIL: provider input helper should clear current input line before sending text" >&2
  cat "$tmux_log" >&2
  exit 1
}
grep -q 'TMUX:load-buffer -b aos-dock-pty-input-' "$tmux_log" || {
  echo "FAIL: provider input helper should load text through a tmux paste buffer" >&2
  cat "$tmux_log" >&2
  exit 1
}
grep -q 'TMUX_STDIN:/goal test clean input' "$tmux_log" || {
  echo "FAIL: provider input helper should load the exact prompt text" >&2
  cat "$tmux_log" >&2
  exit 1
}
grep -q 'TMUX:paste-buffer -d -b aos-dock-pty-input-' "$tmux_log" || {
  echo "FAIL: provider input helper should paste buffered text into tmux" >&2
  cat "$tmux_log" >&2
  exit 1
}

helper_aos="$TMPDIR_ROOT/helper-aos"
cat >"$helper_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'HELPER:%s\n' "$*" >>"$AOS_FAKE_LOG"
exit 0
SH
chmod +x "$helper_aos"
helper_log="$TMPDIR_ROOT/helper.log"
helper_out="$(AOS_DOCK_AOS_BIN="$helper_aos" AOS_FAKE_LOG="$helper_log" AOS_DOCK_STOP_CONDITION_DIR="$TMPDIR_ROOT/helper-conditions" bash ".docks/gdi/scripts/human-needed-tcc-reset")"
python3 - "$helper_out" <<'PY'
import sys
text = sys.argv[1]
for required in (
    "human_needed: accessibility",
    "Return this blocker to Foreman",
    "physically remove and re-add the",
    "Do not run permission reset, Settings-open, rebuild, or readiness-repair loops.",
):
    if required not in text:
        raise SystemExit(f"FAIL: human-needed helper output missing {required!r}:\n{text}")
for forbidden in (
    "./aos permissions reset-runtime --mode repo",
    "./aos ready --post-permission",
):
    if forbidden in text:
        raise SystemExit(f"FAIL: human-needed helper should not print automated recovery command {forbidden!r}:\n{text}")
PY
if [[ -s "$helper_log" ]]; then
  echo "FAIL: human-needed helper should not call AOS" >&2
  cat "$helper_log" >&2
  exit 1
fi

python3 - "$clipboard_log" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
if path.exists() and path.read_text():
    raise SystemExit(
        "FAIL: Stop hooks must not derive clipboard content from final chat text; "
        f"clipboard writes observed: {path.read_text()!r}"
    )
PY

slow_aos="$TMPDIR_ROOT/slow-aos"
cat >"$slow_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
sleep 9
SH
chmod +x "$slow_aos"

SECONDS=0
out="$(printf '%s' "$payload" | AOS_DOCK_AOS_BIN="$slow_aos" AOS_DOCK_HOOK_TIMEOUT_SECONDS=1 bash ".docks/foreman/hooks/stop.sh")"
elapsed="$SECONDS"
python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: slow AOS stop hook should still continue, got {payload}")
PY
if (( elapsed > 4 )); then
  echo "FAIL: Foreman Stop hook did not respect bounded AOS timeout; elapsed=$elapsed" >&2
  exit 1
fi

echo "PASS: dock hook isolation"
