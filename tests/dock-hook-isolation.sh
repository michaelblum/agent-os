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
post_tool_runner = root / ".docks" / "harness" / "post-tool-use-runner.sh"
goal_pause_control = root / ".docks" / "harness" / "goal-pause-control.sh"
provider_input_control = root / ".docks" / "harness" / "provider-input-control.sh"
defaults_path = root / ".docks" / "dock-defaults.json"
if not runner.exists():
    raise SystemExit("FAIL: missing shared dock hook runner")
if not os.access(runner, os.X_OK):
    raise SystemExit("FAIL: shared dock hook runner is not executable")
if not post_tool_runner.exists():
    raise SystemExit("FAIL: missing shared post-tool-use runner")
if not os.access(post_tool_runner, os.X_OK):
    raise SystemExit("FAIL: shared post-tool-use runner is not executable")
if not goal_pause_control.exists():
    raise SystemExit("FAIL: missing shared goal-pause control helper")
if not os.access(goal_pause_control, os.X_OK):
    raise SystemExit("FAIL: shared goal-pause control helper is not executable")
if not provider_input_control.exists():
    raise SystemExit("FAIL: missing shared provider input control helper")
if not os.access(provider_input_control, os.X_OK):
    raise SystemExit("FAIL: shared provider input control helper is not executable")
if not defaults_path.exists():
    raise SystemExit("FAIL: missing shared dock defaults")
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
    "stop-condition.sh",
    "say --voice-slot",
    "dock-defaults.json",
    "voice.quality_tiers",
):
    if required not in runner_text:
        raise SystemExit(f"FAIL: shared dock runner missing {required!r}")
if "Handoff on clipboard!" in runner_text:
    raise SystemExit("FAIL: shared dock runner still uses clipboard-themed stop notice")
if "voice final-response" in runner_text:
    raise SystemExit("FAIL: shared dock runner must not call voice final-response for Stop notices")
if "aos_resolve_session_id" in runner_text:
    raise SystemExit("FAIL: shared dock runner must not require a resolved session id")
if "voice bind" in runner_text:
    raise SystemExit("FAIL: shared dock runner must not bind voices for Stop notices")
post_tool_runner_text = post_tool_runner.read_text()
for required in (
    "goal_pause_required: repo-mode AOS permission repair",
    "goal-pause-control.sh",
    "human-needed-surface.sh",
    "stop-condition.sh",
    "/goal pause",
):
    if required not in post_tool_runner_text:
        raise SystemExit(f"FAIL: post-tool-use runner missing {required!r}")
for forbidden in ("ready --post-permission --json", "ready --repair", "permissions reset-runtime", "git status", "AOS_BIN"):
    if forbidden in post_tool_runner_text:
        raise SystemExit(f"FAIL: post-tool-use runner must not run redundant ritual command {forbidden!r}")

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
    hook_names = set(payload.get("hooks", {}).keys())
    if hook_names != {"Stop", "PostToolUse"}:
        raise SystemExit(f"FAIL: {role} hooks should only declare Stop and PostToolUse, got {sorted(hook_names)}")
    if not any(expected_stop in command for command in commands):
        raise SystemExit(f"FAIL: {role} hooks do not use isolated stop script: {commands}")
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
    if "voice_slot_execution" in voice:
        raise SystemExit(f"FAIL: {role} voice_slot execution should no longer be pending: {dock_config}")

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
    if "AOS_DOCK_ROLE=" in script or ".docks/hooks/" in script:
        raise SystemExit(f"FAIL: {role} stop.sh still contains dock hook routing")
    if "python3" in script or "resolve_session_id()" in script:
        raise SystemExit(f"FAIL: {role} stop.sh still has duplicated session-id parsing")
    post_tool_script_path = root / ".docks" / role / "hooks" / "post-tool-use.sh"
    if not os.access(post_tool_script_path, os.X_OK):
        raise SystemExit(f"FAIL: {role} post-tool-use.sh is not executable")
    post_tool_script = post_tool_script_path.read_text()
    if ".docks/harness/post-tool-use-runner.sh" not in post_tool_script:
        raise SystemExit(f"FAIL: {role} post-tool-use.sh is not a shared harness wrapper")

foreman_agents = (root / ".docks" / "foreman" / "AGENTS.md").read_text()
def has_exact_name(path):
    try:
        return path.name in os.listdir(path.parent)
    except FileNotFoundError:
        return False

legacy_skill_paths = []
for skill_dir in (root / ".docks").glob("*/skills/*"):
    if skill_dir.is_dir() and "skill.md" in os.listdir(skill_dir):
        legacy_skill_paths.append(str((skill_dir / "skill.md").relative_to(root)))
legacy_skill_paths.sort()
if legacy_skill_paths:
    raise SystemExit(f"FAIL: dock-local skills must use SKILL.md, found legacy paths: {legacy_skill_paths}")
for foreman_handoff_skill_path in (
    root / ".docks" / "foreman" / "skills" / "session-handoff" / "skill.md",
    root / ".docks" / "foreman" / "skills" / "session-handoff" / "SKILL.md",
):
    if has_exact_name(foreman_handoff_skill_path):
        raise SystemExit("FAIL: Foreman session-handoff must not be a routable skill")
foreman_transfer_skill_path = root / ".docks" / "foreman" / "skills" / "session-transfer" / "SKILL.md"
if not has_exact_name(foreman_transfer_skill_path):
    raise SystemExit("FAIL: Foreman session-transfer skill is missing")
foreman_transfer_skill = foreman_transfer_skill_path.read_text()
if "name: foreman-session-transfer" not in foreman_transfer_skill:
    raise SystemExit("FAIL: Foreman transfer skill uses the wrong name")
if "only routable Foreman transfer skill" not in foreman_transfer_skill:
    raise SystemExit("FAIL: Foreman transfer skill must state it is the sole routing entrypoint")
if "successor handoffs are the Foreman" not in foreman_transfer_skill:
    raise SystemExit("FAIL: Foreman transfer skill must route successor handoffs through the Foreman reference")
if (root / ".docks" / "foreman" / "skills" / "retirement-handoff").exists():
    raise SystemExit("FAIL: retired Foreman retirement-handoff skill path still exists")
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
clipboard_log="$TMPDIR_ROOT/clipboard.log"
mkdir -p "$fake_bin"
cat >"$fake_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'PHASE:%s ARGV:%s\n' "${AOS_DOCK_PHASE:-unknown}" "$*" >>"$AOS_FAKE_LOG"
if [[ "$*" == *"voice final-response"* ]]; then
  payload="$(cat || true)"
  printf 'STDIN:%s\n' "$payload" >>"$AOS_FAKE_LOG"
fi
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
if payload.get("continue") is not True:
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
if payload.get("continue") is not True:
    raise SystemExit(f"FAIL: expected no-session Stop hook success JSON, got {payload}")
PY
done

for notice in 'GDI finished.' 'Foreman finished.' 'Operator finished.'; do
  grep -q "$notice" "$log_file"
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
if grep -q 'Handoff on clipboard!' "$log_file"; then
  echo "FAIL: stop hooks must use neutral stop notices, not clipboard-themed notices" >&2
  exit 1
fi
if grep -q 'ARGV:voice bind' "$log_file"; then
  echo "FAIL: Stop hook path must not call voice bind for normal stop speech" >&2
  exit 1
fi
if grep -q 'ARGV:voice final-response' "$log_file"; then
  echo "FAIL: Stop hook path must not call voice final-response for normal stop speech" >&2
  exit 1
fi
if grep -q 'Do not speak this tail' "$log_file"; then
  echo "FAIL: stop hooks must not pass the assistant tail to voice final-response" >&2
  exit 1
fi

condition_dir="$TMPDIR_ROOT/conditions"
PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" AOS_DOCK_STOP_CONDITION_DIR="$condition_dir" ".docks/harness/stop-condition.sh" write "$ROOT" gdi tcc_permission_reset 60
tcc_out="$(printf '%s' "$payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" AOS_DOCK_STOP_CONDITION_DIR="$condition_dir" bash ".docks/gdi/hooks/stop.sh")"
python3 - "$tcc_out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
if payload.get("continue") is not True:
    raise SystemExit(f"FAIL: expected TCC Stop hook success JSON, got {payload}")
message = payload.get("systemMessage", "")
for required in (
    "GDI stopped for repo-mode AOS permission repair.",
    "./aos permissions setup --once",
    "Accessibility/Input Monitoring",
    "ready",
    "./aos ready --post-permission",
    "/goal resume",
):
    if required not in message:
        raise SystemExit(f"FAIL: TCC Stop systemMessage missing {required!r}: {message!r}")
PY
grep -q 'ARGV:say --voice-slot 2 --language en --quality-tier premium --quality-tier enhanced --gender female GDI needs TCC reset.' "$log_file" || {
  echo "FAIL: missing condition-specific GDI TCC stop notice" >&2
  cat "$log_file" >&2
  exit 1
}

normal_after_tcc_out="$(printf '%s' "$payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" AOS_DOCK_STOP_CONDITION_DIR="$condition_dir" bash ".docks/gdi/hooks/stop.sh")"
python3 - "$normal_after_tcc_out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: consumed TCC marker should return to normal Stop JSON, got {payload}")
PY
if [[ -d "$condition_dir" ]] && find "$condition_dir" -type f | grep -q .; then
  echo "FAIL: consumed TCC stop condition left marker files behind" >&2
  find "$condition_dir" -type f >&2
  exit 1
fi

expired_dir="$TMPDIR_ROOT/expired-conditions"
AOS_DOCK_STOP_CONDITION_DIR="$expired_dir" ".docks/harness/stop-condition.sh" write "$ROOT" gdi tcc_permission_reset 0
sleep 1
expired_out="$(printf '%s' "$payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" AOS_DOCK_STOP_CONDITION_DIR="$expired_dir" bash ".docks/gdi/hooks/stop.sh")"
python3 - "$expired_out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: expired TCC marker should not affect Stop JSON, got {payload}")
PY

post_tool_log="$TMPDIR_ROOT/post-tool-aos.log"
tmux_log="$TMPDIR_ROOT/tmux.log"
open_log="$TMPDIR_ROOT/open.log"
post_tool_condition_dir="$TMPDIR_ROOT/post-tool-conditions"
post_tool_aos="$TMPDIR_ROOT/post-tool-aos"
cat >"$post_tool_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'POST_TOOL_AOS:%s\n' "$*" >>"$AOS_FAKE_LOG"
exit 1
SH
chmod +x "$post_tool_aos"
fake_open="$TMPDIR_ROOT/open"
cat >"$fake_open" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'OPEN:%s\n' "$*" >>"$AOS_FAKE_OPEN_LOG"
SH
chmod +x "$fake_open"
cat >"$fake_bin/tmux" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'TMUX:%s\n' "$*" >>"$AOS_FAKE_TMUX_LOG"
SH
chmod +x "$fake_bin/tmux"

PATH="$fake_bin:$PATH" AOS_FAKE_TMUX_LOG="$tmux_log" ".docks/harness/provider-input-control.sh" send "%42" "/goal test clean input"
grep -q 'TMUX:send-keys -t %42 C-u' "$tmux_log" || {
  echo "FAIL: provider input helper should clear current input line before sending text" >&2
  cat "$tmux_log" >&2
  exit 1
}
grep -q 'TMUX:send-keys -t %42 -l /goal test clean input' "$tmux_log" || {
  echo "FAIL: provider input helper should send literal text through tmux" >&2
  cat "$tmux_log" >&2
  exit 1
}
grep -q 'TMUX:send-keys -t %42 Enter' "$tmux_log" || {
  echo "FAIL: provider input helper should submit with Enter after sending text" >&2
  cat "$tmux_log" >&2
  exit 1
}
: >"$tmux_log"

post_payload='{"tool_name":"exec_command","tool_input":{"cmd":"./aos dev build"},"tool_response":{"exit_code":0,"output":"Build succeeded"}}'
tcc_post_out="$(printf '%s' "$post_payload" | PATH="$fake_bin:$PATH" TMUX_PANE="%42" AOS_FAKE_TMUX_LOG="$tmux_log" AOS_DOCK_AOS_BIN="$post_tool_aos" AOS_FAKE_LOG="$post_tool_log" AOS_DOCK_OPEN_BIN="$fake_open" AOS_FAKE_OPEN_LOG="$open_log" AOS_DOCK_STOP_CONDITION_DIR="$post_tool_condition_dir" bash ".docks/gdi/hooks/post-tool-use.sh")"
python3 - "$tcc_post_out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload.get("continue") is not True:
    raise SystemExit(f"FAIL: dev-build post-tool hook should continue with systemMessage, got {payload}")
message = payload.get("systemMessage", "")
for required in (
    "goal_pause_required: repo-mode AOS permission repair",
    "/goal pause",
    "./aos permissions setup --once",
    "./aos ready --post-permission",
    "Do not run ready/repair/status/helper loops",
):
    if required not in message:
        raise SystemExit(f"FAIL: dev-build post-tool hook systemMessage missing {required!r}: {message!r}")
PY
grep -q 'POST_TOOL_AOS:show create --id aos-human-needed-gdi-tcc_permission_reset' "$post_tool_log" || {
  echo "FAIL: successful dev build hook should show the human-needed canvas" >&2
  cat "$post_tool_log" >&2
  exit 1
}
if grep -q 'ready\|permissions reset-runtime\|git status' "$post_tool_log"; then
  echo "FAIL: successful dev build hook should not run readiness or repair ritual" >&2
  cat "$post_tool_log" >&2
  exit 1
fi
grep -q 'OPEN:x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility' "$open_log" || {
  echo "FAIL: successful dev build hook should open Accessibility settings" >&2
  cat "$open_log" >&2
  exit 1
}
grep -q 'OPEN:x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent' "$open_log" || {
  echo "FAIL: successful dev build hook should open Input Monitoring settings" >&2
  cat "$open_log" >&2
  exit 1
}
grep -q 'OPEN:x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture' "$open_log" || {
  echo "FAIL: successful dev build hook should open Screen Recording settings" >&2
  cat "$open_log" >&2
  exit 1
}
grep -q 'TMUX:send-keys -t %42 -l /goal pause' "$tmux_log" || {
  echo "FAIL: successful GDI dev build hook should inject /goal pause into tmux pane" >&2
  cat "$tmux_log" >&2
  exit 1
}
grep -q 'TMUX:send-keys -t %42 Enter' "$tmux_log" || {
  echo "FAIL: successful GDI dev build hook should submit /goal pause with Enter" >&2
  cat "$tmux_log" >&2
  exit 1
}
post_tcc_stop_out="$(printf '%s' "$payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" AOS_DOCK_STOP_CONDITION_DIR="$post_tool_condition_dir" bash ".docks/gdi/hooks/stop.sh")"
python3 - "$post_tcc_stop_out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
message = payload.get("systemMessage", "")
if "GDI stopped for repo-mode AOS permission repair." not in message:
    raise SystemExit(f"FAIL: post-tool marker should feed Stop TCC notice, got {payload}")
PY

: >"$post_tool_log"
: >"$tmux_log"
: >"$open_log"
ready_post_payload='{"tool_name":"exec_command","tool_input":{"cmd":"./aos ready --post-permission"},"tool_response":{"exit_code":0,"output":"ready=true mode=repo daemon=reachable tap=active"}}'
ready_post_out="$(printf '%s' "$ready_post_payload" | PATH="$fake_bin:$PATH" TMUX_PANE="%42" AOS_FAKE_TMUX_LOG="$tmux_log" AOS_DOCK_GOAL_PAUSE_DELAY_SECONDS=0 AOS_DOCK_AOS_BIN="$post_tool_aos" AOS_FAKE_LOG="$post_tool_log" AOS_DOCK_OPEN_BIN="$fake_open" AOS_FAKE_OPEN_LOG="$open_log" AOS_DOCK_STOP_CONDITION_DIR="$post_tool_condition_dir" bash ".docks/gdi/hooks/post-tool-use.sh")"
python3 - "$ready_post_out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: post-permission ready hook should continue quietly, got {payload}")
PY
grep -q 'POST_TOOL_AOS:show remove --id aos-human-needed-gdi-tcc_permission_reset' "$post_tool_log" || {
  echo "FAIL: post-permission ready hook should clear the human-needed canvas" >&2
  cat "$post_tool_log" >&2
  exit 1
}
if [[ -s "$tmux_log" || -s "$open_log" ]]; then
  echo "FAIL: post-permission ready hook should not inject tmux input or reopen settings" >&2
  cat "$tmux_log" "$open_log" >&2
  exit 1
fi

: >"$post_tool_log"
: >"$tmux_log"
: >"$open_log"
failed_payload='{"tool_name":"exec_command","tool_input":{"cmd":"./aos dev build"},"tool_response":{"exit_code":1,"output":"compile failed"}}'
failed_post_out="$(printf '%s' "$failed_payload" | PATH="$fake_bin:$PATH" TMUX_PANE="%42" AOS_FAKE_TMUX_LOG="$tmux_log" AOS_DOCK_GOAL_PAUSE_DELAY_SECONDS=0 AOS_DOCK_AOS_BIN="$post_tool_aos" AOS_FAKE_LOG="$post_tool_log" AOS_DOCK_OPEN_BIN="$fake_open" AOS_FAKE_OPEN_LOG="$open_log" AOS_DOCK_STOP_CONDITION_DIR="$post_tool_condition_dir" bash ".docks/gdi/hooks/post-tool-use.sh")"
python3 - "$failed_post_out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: failed build post-tool hook should not synthesize TCC pause, got {payload}")
PY
if [[ -s "$post_tool_log" ]]; then
  echo "FAIL: failed dev build should not trigger post-tool pause guard" >&2
  cat "$post_tool_log" >&2
  exit 1
fi
if [[ -s "$tmux_log" || -s "$open_log" ]]; then
  echo "FAIL: failed dev build should not inject /goal pause or open settings" >&2
  cat "$tmux_log" "$open_log" >&2
  exit 1
fi

: >"$post_tool_log"
: >"$tmux_log"
: >"$open_log"
non_build_payload='{"tool_name":"exec_command","tool_input":{"cmd":"./aos ready"},"tool_response":{"exit_code":0}}'
non_build_out="$(printf '%s' "$non_build_payload" | PATH="$fake_bin:$PATH" TMUX_PANE="%42" AOS_FAKE_TMUX_LOG="$tmux_log" AOS_DOCK_GOAL_PAUSE_DELAY_SECONDS=0 AOS_DOCK_AOS_BIN="$post_tool_aos" AOS_FAKE_LOG="$post_tool_log" AOS_DOCK_OPEN_BIN="$fake_open" AOS_FAKE_OPEN_LOG="$open_log" AOS_DOCK_STOP_CONDITION_DIR="$post_tool_condition_dir" bash ".docks/gdi/hooks/post-tool-use.sh")"
python3 - "$non_build_out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload != {"continue": True}:
    raise SystemExit(f"FAIL: non-build post-tool hook should continue quietly, got {payload}")
PY
if [[ -s "$post_tool_log" ]]; then
  echo "FAIL: non-build command should not trigger post-tool pause guard" >&2
  cat "$post_tool_log" >&2
  exit 1
fi
if [[ -s "$tmux_log" || -s "$open_log" ]]; then
  echo "FAIL: non-build command should not inject /goal pause or open settings" >&2
  cat "$tmux_log" "$open_log" >&2
  exit 1
fi

helper_aos="$TMPDIR_ROOT/helper-aos"
cat >"$helper_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'HELPER:%s\n' "$*" >>"$AOS_FAKE_LOG"
if [[ "$1" == "ready" ]]; then
  printf '{"ready":false,"phase":"human_required"}\n'
elif [[ "$1" == "permissions" ]]; then
  printf 'targeted reset unavailable in fake test\n'
fi
SH
chmod +x "$helper_aos"
helper_out="$(AOS_DOCK_AOS_BIN="$helper_aos" AOS_FAKE_LOG="$log_file" AOS_DOCK_STOP_CONDITION_DIR="$TMPDIR_ROOT/helper-conditions" bash ".docks/gdi/scripts/human-needed-tcc-reset")"
python3 - "$helper_out" <<'PY'
import sys

text = sys.argv[1]
for required in (
    "human_needed: repo-mode AOS permission repair",
    "Run: ./aos permissions setup --once",
    "Grant the requested macOS Accessibility/Input Monitoring permission",
    "Return to the session and say: ready",
    "/goal resume",
    "./aos ready --post-permission",
):
    if required not in text:
        raise SystemExit(f"FAIL: human-needed helper output missing {required!r}:\n{text}")
PY
if grep -q 'HELPER:say' "$log_file"; then
  echo "FAIL: human-needed helper should not speak directly; Stop hook owns TCC TTS" >&2
  cat "$log_file" >&2
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
if payload.get("continue") is not True:
    raise SystemExit(f"FAIL: expected bounded fake-AOS stop hook success JSON, got {payload}")
PY
if (( elapsed > 6 )); then
  echo "FAIL: bounded fake-AOS stop hook took too long: ${elapsed}s" >&2
  exit 1
fi

python3 - "$ROOT/.docks/README.md" <<'PY'
import pathlib
import sys

dock_readme = pathlib.Path(sys.argv[1]).read_text()
if "## Canonical Docks" not in dock_readme or "`operator/` is the Operator" not in dock_readme:
    raise SystemExit("FAIL: .docks/README.md canonical dock list does not include Operator")
if ".docks/harness/dock-hook-runner.sh" not in dock_readme:
    raise SystemExit("FAIL: .docks/README.md does not document the shared dock harness")
if "voice.voice_slot" not in dock_readme or "aos say --voice-slot" not in dock_readme:
    raise SystemExit("FAIL: .docks/README.md does not document active voice_slot stop speech")
if "Remote or undocked agents cannot inherit the launch root automatically" not in dock_readme:
    raise SystemExit("FAIL: .docks/README.md does not document remote dock adoption")
if "Docks do not select the active development workflow profile" not in dock_readme:
    raise SystemExit("FAIL: .docks/README.md does not preserve dock/profile separation")
if "not a Workflow" not in dock_readme and "not a workflow" not in dock_readme:
    raise SystemExit("FAIL: .docks/README.md does not preserve dock-not-workflow boundary language")
PY

python3 - "$ROOT/docs/design/work-cards/dock-shared-harness-v0.md" <<'PY'
import pathlib
import sys

text = pathlib.Path(sys.argv[1]).read_text()
for required in (
    ".docks/harness/",
    ".docks/{foreman,gdi,operator}/dock.json",
    "aos say --voice-slot",
    "Foreman finished.",
    "GDI finished.",
    "Operator finished.",
):
    if required not in text:
        raise SystemExit(f"FAIL: work card missing {required!r}")
PY

echo "PASS: dock hooks use the shared harness, validate dock.json, bound AOS calls, leave clipboard handoffs untouched, and speak only neutral stop notices."
