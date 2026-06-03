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
shared = root / ".docks" / "hooks"
if shared.exists():
    raise SystemExit(f"FAIL: shared dock hook directory must stay deleted: {shared}")

runner = root / ".docks" / "harness" / "dock-hook-runner.sh"
pre_tool_runner = root / ".docks" / "harness" / "pre-tool-use-runner.sh"
post_tool_runner = root / ".docks" / "harness" / "post-tool-use-runner.sh"
provider_input_control = root / ".docks" / "harness" / "provider-input-control.sh"
pty_input_control = root / ".docks" / "harness" / "pty-input-control.sh"
defaults_path = root / ".docks" / "dock-defaults.json"

for label, path in (
    ("shared dock hook runner", runner),
    ("shared pre-tool-use runner", pre_tool_runner),
    ("shared post-tool-use runner", post_tool_runner),
    ("shared provider input control helper", provider_input_control),
    ("shared PTY input control helper", pty_input_control),
):
    if not path.exists():
        raise SystemExit(f"FAIL: missing {label}: {path}")
    if not os.access(path, os.X_OK):
        raise SystemExit(f"FAIL: {label} is not executable: {path}")

for retired in (
    root / ".docks" / "harness" / "goal-pause-control.sh",
    root / ".docks" / "harness" / "human-needed-surface.sh",
    root / ".docks" / "harness" / "dev-build-checkpoint.sh",
    root / ".docks" / "harness" / "dev-build-checkpoint-contract.sh",
):
    if retired.exists():
        raise SystemExit(f"FAIL: retired hook helper still exists: {retired}")

defaults = json.loads(defaults_path.read_text())
if defaults.get("voice") != {
    "enabled": True,
    "language": "en",
    "gender": "female",
    "quality_tiers": ["premium", "enhanced"],
}:
    raise SystemExit(f"FAIL: shared dock voice defaults mismatch: {defaults}")

runner_text = runner.read_text()
for required in (
    ".agents/hooks/session-common.sh",
    "aos_run_hook_command_bounded",
    "run_optional_hook \"pre-stop\"",
    "run_optional_hook \"post-stop\"",
    "say --voice-slot",
    "dock-defaults.json",
    "voice.quality_tiers",
):
    if required not in runner_text:
        raise SystemExit(f"FAIL: shared dock runner missing {required!r}")

pre_tool_runner_text = pre_tool_runner.read_text()
post_tool_runner_text = post_tool_runner.read_text()
for label, text in (
    ("shared dock runner", runner_text),
    ("pre-tool-use runner", pre_tool_runner_text),
    ("post-tool-use runner", post_tool_runner_text),
):
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
    ):
        if forbidden in text:
            raise SystemExit(f"FAIL: {label} still contains hook automation token {forbidden!r}")

for label, text in (
    ("pre-tool-use runner", pre_tool_runner_text),
    ("post-tool-use runner", post_tool_runner_text),
):
    if 'printf \'{"continue":true}\\n\'' not in text and 'printf \'{"continue":true}' not in text:
        raise SystemExit(f"FAIL: {label} should be an inert pass-through")

if "Handoff on clipboard!" in runner_text:
    raise SystemExit("FAIL: shared dock runner still uses clipboard-themed stop notice")
if "voice final-response" in runner_text:
    raise SystemExit("FAIL: shared dock runner must not call voice final-response for Stop notices")
if "aos_resolve_session_id" in runner_text:
    raise SystemExit("FAIL: shared dock runner must not require a resolved session id")
if "voice bind" in runner_text:
    raise SystemExit("FAIL: shared dock runner must not bind voices for Stop notices")

expected = {
    "foreman": {
        "gender": "male",
        "voice_slot": 1,
        "stop_notice": "Foreman finished.",
        "requires_goal_prefix": False,
    },
    "gdi": {
        "gender": "female",
        "voice_slot": 2,
        "stop_notice": "GDI finished.",
        "requires_goal_prefix": False,
    },
    "operator": {
        "gender": "female",
        "voice_slot": 3,
        "stop_notice": "Operator finished.",
        "requires_goal_prefix": False,
    },
}

for role in ("gdi", "foreman", "operator"):
    hooks_path = root / ".docks" / role / ".codex" / "hooks.json"
    payload = json.loads(hooks_path.read_text())
    commands = [
        hook.get("command", "")
        for entries in payload.get("hooks", {}).values()
        for matcher in entries
        for hook in matcher.get("hooks", [])
    ]
    expected_stop = f".docks/{role}/hooks/stop.sh"
    expected_post_tool = f".docks/{role}/hooks/post-tool-use.sh"
    expected_pre_tool = f".docks/{role}/hooks/pre-tool-use.sh"
    hook_names = set(payload.get("hooks", {}).keys())
    expected_hook_names = {"Stop", "PostToolUse"}
    if role == "gdi":
        expected_hook_names.add("PreToolUse")
    if hook_names != expected_hook_names:
        raise SystemExit(f"FAIL: {role} hooks mismatch: got {sorted(hook_names)} expected {sorted(expected_hook_names)}")
    if not any(expected_stop in command for command in commands):
        raise SystemExit(f"FAIL: {role} hooks do not use isolated stop script: {commands}")
    if role == "gdi" and not any(expected_pre_tool in command for command in commands):
        raise SystemExit(f"FAIL: {role} hooks do not use isolated pre-tool-use script: {commands}")
    if not any(expected_post_tool in command for command in commands):
        raise SystemExit(f"FAIL: {role} hooks do not use isolated post-tool-use script: {commands}")
    if any("session-start.sh" in command for command in commands):
        raise SystemExit(f"FAIL: {role} hooks must not require startup hooks: {commands}")
    if any(".docks/hooks/" in command or "AOS_DOCK_ROLE=" in command for command in commands):
        raise SystemExit(f"FAIL: {role} hooks still route through shared dock behavior: {commands}")
    for matcher in payload.get("hooks", {}).values():
        for entry in matcher:
            for hook in entry.get("hooks", []):
                timeout = hook.get("timeout")
                if not isinstance(timeout, int) or timeout > 10:
                    raise SystemExit(f"FAIL: {role} hook timeout is not bounded tightly: {hook}")

    dock_config = json.loads((root / ".docks" / role / "dock.json").read_text())
    if dock_config.get("name") != role or dock_config.get("role") != role:
        raise SystemExit(f"FAIL: {role} dock.json does not preserve dock-local identity: {dock_config}")
    if dock_config.get("harness") != "codex":
        raise SystemExit(f"FAIL: {role} dock.json harness should be codex: {dock_config}")
    if dock_config.get("hook_timeout_seconds") != 8:
        raise SystemExit(f"FAIL: {role} dock.json should bound AOS calls to 8 seconds: {dock_config}")
    if dock_config.get("stop_notice") != expected[role]["stop_notice"]:
        raise SystemExit(f"FAIL: {role} stop notice mismatch: {dock_config}")
    if dock_config.get("handoff", {}).get("requires_goal_prefix") is not expected[role]["requires_goal_prefix"]:
        raise SystemExit(f"FAIL: {role} goal-prefix metadata mismatch: {dock_config}")
    voice = dock_config.get("voice", {})
    configured_gender = voice.get("gender")
    effective_gender = configured_gender if configured_gender is not None else defaults["voice"].get("gender")
    if effective_gender != expected[role]["gender"]:
        raise SystemExit(f"FAIL: {role} voice gender mismatch: {dock_config}")
    if "quality_tier" in voice or "quality_tiers" in voice or "language" in voice or "enabled" in voice:
        raise SystemExit(f"FAIL: {role} dock.json should inherit shared voice defaults instead of duplicating them: {dock_config}")
    if voice.get("voice_slot") != expected[role]["voice_slot"]:
        raise SystemExit(f"FAIL: {role} numeric voice_slot metadata mismatch: {dock_config}")

    start_script_path = root / ".docks" / role / "hooks" / "session-start.sh"
    if start_script_path.exists():
        raise SystemExit(f"FAIL: {role} must not restore a session-start hook")

    script_path = root / ".docks" / role / "hooks" / "stop.sh"
    if not os.access(script_path, os.X_OK):
        raise SystemExit(f"FAIL: {role} stop.sh is not executable")
    script = script_path.read_text()
    if ".docks/harness/dock-hook-runner.sh" not in script:
        raise SystemExit(f"FAIL: {role} stop.sh is not a shared harness wrapper")
    if "exec " not in script:
        raise SystemExit(f"FAIL: {role} stop.sh should exec the shared harness")
    if ".agents/hooks/session-common.sh" in script or "aos_resolve_session_id" in script:
        raise SystemExit(f"FAIL: {role} stop.sh still duplicates shared harness mechanics")

    post_tool_script_path = root / ".docks" / role / "hooks" / "post-tool-use.sh"
    if not os.access(post_tool_script_path, os.X_OK):
        raise SystemExit(f"FAIL: {role} post-tool-use.sh is not executable")
    if ".docks/harness/post-tool-use-runner.sh" not in post_tool_script_path.read_text():
        raise SystemExit(f"FAIL: {role} post-tool-use.sh is not a shared harness wrapper")
    pre_tool_script_path = root / ".docks" / role / "hooks" / "pre-tool-use.sh"
    if role == "gdi":
        if not os.access(pre_tool_script_path, os.X_OK):
            raise SystemExit(f"FAIL: {role} pre-tool-use.sh is not executable")
        if ".docks/harness/pre-tool-use-runner.sh" not in pre_tool_script_path.read_text():
            raise SystemExit(f"FAIL: {role} pre-tool-use.sh is not a shared harness wrapper")
    elif pre_tool_script_path.exists():
        raise SystemExit(f"FAIL: {role} should not have a pre-tool-use hook")

foreman_agents = (root / ".docks" / "foreman" / "AGENTS.md").read_text()
foreman_transfer_skill_path = root / ".docks" / "foreman" / "skills" / "session-transfer" / "SKILL.md"
foreman_transfer_skill = foreman_transfer_skill_path.read_text()
if "name: foreman-session-transfer" not in foreman_transfer_skill:
    raise SystemExit("FAIL: Foreman transfer skill uses the wrong name")
if "only routable Foreman transfer skill" not in foreman_transfer_skill:
    raise SystemExit("FAIL: Foreman transfer skill must state it is the sole routing entrypoint")
for label, text in (("Foreman AGENTS", foreman_agents), ("Foreman transfer skill", foreman_transfer_skill)):
    legacy_command_token = "/" + "goal"
    for forbidden in (f"receives a `{legacy_command_token}", "`attn: GDI,", "attn: GDI, follow"):
        if forbidden in text:
            raise SystemExit(f"FAIL: {label} reintroduced command/addressee ceremony: {forbidden}")
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
for role in gdi foreman operator; do
  out="$(printf '%s' "$payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" AOS_FAKE_CLIPBOARD_LOG="$clipboard_log" AOS_FAKE_CLIPBOARD_ROLE="$role" bash ".docks/$role/hooks/stop.sh")"
  python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: expected Stop hook success JSON, got {payload}")
PY
done

payload_without_session='{"last_assistant_message":"No session id should still allow fixed stop notice."}'
for role in gdi foreman operator; do
  out="$(printf '%s' "$payload_without_session" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" AOS_FAKE_CLIPBOARD_LOG="$clipboard_log" AOS_FAKE_CLIPBOARD_ROLE="$role" bash ".docks/$role/hooks/stop.sh")"
  python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: expected no-session Stop hook success JSON, got {payload}")
PY
done

for expected in \
  'ARGV:say --voice-slot 1 --language en --quality-tier premium --quality-tier enhanced --gender male Foreman finished.' \
  'ARGV:say --voice-slot 2 --language en --quality-tier premium --quality-tier enhanced --gender female GDI finished.' \
  'ARGV:say --voice-slot 3 --language en --quality-tier premium --quality-tier enhanced --gender female Operator finished.'; do
  grep -q "$expected" "$log_file" || {
    echo "FAIL: missing Stop hook say voice-slot call: $expected" >&2
    cat "$log_file" >&2
    exit 1
  }
done
if grep -q 'needs TCC reset\|voice bind\|voice final-response\|Do not speak this tail' "$log_file"; then
  echo "FAIL: Stop hooks should not speak TCC notices, bind voices, or speak assistant tails" >&2
  cat "$log_file" >&2
  exit 1
fi

condition_dir="$TMPDIR_ROOT/conditions"
AOS_DOCK_STOP_CONDITION_DIR="$condition_dir" ".docks/harness/stop-condition.sh" write "$ROOT" gdi tcc_permission_reset 60
tcc_out="$(printf '%s' "$payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" AOS_DOCK_STOP_CONDITION_DIR="$condition_dir" bash ".docks/gdi/hooks/stop.sh")"
python3 - "$tcc_out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: Stop hook should ignore TCC marker automation, got {payload}")
PY
if grep -q 'GDI needs TCC reset' "$log_file"; then
  echo "FAIL: Stop hook must not convert TCC markers into spoken reset notices" >&2
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

for role in gdi foreman operator; do
  for cmd in './aos dev build' './aos dev build --json' 'bash build.sh --no-restart' 'bash -lc "./aos dev build"'; do
    payload="$(python3 - "$cmd" <<'PY'
import json
import sys
print(json.dumps({"tool_name": "exec_command", "tool_input": {"cmd": sys.argv[1]}}))
PY
)"
    if [[ "$role" == "gdi" ]]; then
      pre_out="$(printf '%s' "$payload" | bash ".docks/gdi/hooks/pre-tool-use.sh")"
      python3 - "$pre_out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: pre-tool hook should pass through build commands, got {payload}")
PY
    fi
    post_log="$TMPDIR_ROOT/post-$role.log"
    open_log="$TMPDIR_ROOT/open-$role.log"
    fake_open="$TMPDIR_ROOT/open-$role"
    cat >"$fake_open" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'OPEN:%s\n' "$*" >>"$AOS_FAKE_OPEN_LOG"
SH
    chmod +x "$fake_open"
    : >"$post_log"
    : >"$open_log"
    post_payload="$(python3 - "$cmd" <<'PY'
import json
import sys
print(json.dumps({
    "tool_name": "exec_command",
    "tool_input": {"cmd": sys.argv[1]},
    "tool_response": {"exit_code": 0, "output": "Build succeeded"}
}))
PY
)"
    post_out="$(printf '%s' "$post_payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$post_log" AOS_DOCK_OPEN_BIN="$fake_open" AOS_FAKE_OPEN_LOG="$open_log" bash ".docks/$role/hooks/post-tool-use.sh")"
    python3 - "$post_out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: post-tool hook should pass through build commands, got {payload}")
PY
    if [[ -s "$post_log" || -s "$open_log" ]]; then
      echo "FAIL: post-tool hook should not call AOS or open Settings for build command" >&2
      cat "$post_log" "$open_log" >&2
      exit 1
    fi
  done
done

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
    "human_needed: TCC reset needed",
    "does not reset TCC",
    "does not reset TCC, open System Settings, write hook",
    "Return this blocker to Foreman",
    "Foreman owns repo-mode binary rebuilds",
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
out="$(printf '%s' "$payload" | AOS_DOCK_AOS_BIN="$slow_aos" AOS_DOCK_HOOK_TIMEOUT_SECONDS=1 bash ".docks/gdi/hooks/stop.sh")"
elapsed="$SECONDS"
python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: slow AOS stop hook should still continue, got {payload}")
PY
if (( elapsed > 4 )); then
  echo "FAIL: Stop hook did not respect bounded AOS timeout; elapsed=$elapsed" >&2
  exit 1
fi

echo "PASS: dock hook isolation"
