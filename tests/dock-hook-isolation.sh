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
defaults_path = root / ".docks" / "dock-defaults.json"
if not runner.exists():
    raise SystemExit("FAIL: missing shared dock hook runner")
if not os.access(runner, os.X_OK):
    raise SystemExit("FAIL: shared dock hook runner is not executable")
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
    "aos_resolve_session_id",
    "aos_run_hook_command_bounded",
    "pre-$phase",
    "post-$phase",
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
        "requires_goal_prefix": True,
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
    expected_start = f".docks/{role}/hooks/session-start.sh"
    expected_stop = f".docks/{role}/hooks/stop.sh"
    if not any(expected_start in command for command in commands):
        raise SystemExit(f"FAIL: {role} hooks do not use isolated session-start script: {commands}")
    if not any(expected_stop in command for command in commands):
        raise SystemExit(f"FAIL: {role} hooks do not use isolated stop script: {commands}")
    if any(".docks/hooks/" in command or "AOS_DOCK_ROLE=" in command for command in commands):
        raise SystemExit(f"FAIL: {role} hooks still route through shared dock behavior: {commands}")
    for matcher in payload.get("hooks", {}).values():
        for entry in matcher:
            for hook in entry.get("hooks", []):
                timeout = hook.get("timeout")
                if not isinstance(timeout, int) or timeout > 5:
                    raise SystemExit(f"FAIL: {role} hook timeout is not bounded tightly: {hook}")

    dock_config = json.loads((root / ".docks" / role / "dock.json").read_text())
    if dock_config.get("name") != role or dock_config.get("role") != role:
        raise SystemExit(f"FAIL: {role} dock.json does not preserve dock-local identity: {dock_config}")
    if dock_config.get("harness") != "codex":
        raise SystemExit(f"FAIL: {role} dock.json harness should be codex: {dock_config}")
    if dock_config.get("hook_timeout_seconds") != 3:
        raise SystemExit(f"FAIL: {role} dock.json should bound AOS calls to 3 seconds: {dock_config}")
    if dock_config.get("stop_notice") != expected[role]["stop_notice"]:
        raise SystemExit(f"FAIL: {role} stop notice mismatch: {dock_config}")
    if dock_config.get("handoff", {}).get("requires_goal_prefix") is not expected[role]["requires_goal_prefix"]:
        raise SystemExit(f"FAIL: {role} GDI-only /goal metadata mismatch: {dock_config}")
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

    for script_name in ("session-start.sh", "stop.sh"):
        script_path = root / ".docks" / role / "hooks" / script_name
        if not os.access(script_path, os.X_OK):
            raise SystemExit(f"FAIL: {role} {script_name} is not executable")
        script = script_path.read_text()
        if ".docks/harness/dock-hook-runner.sh" not in script:
            raise SystemExit(f"FAIL: {role} {script_name} is not a shared harness wrapper")
        if "exec " not in script:
            raise SystemExit(f"FAIL: {role} {script_name} should exec the shared harness")
        if ".agents/hooks/session-common.sh" in script or "aos_resolve_session_id" in script:
            raise SystemExit(f"FAIL: {role} {script_name} still duplicates shared harness mechanics")
        if "AOS_DOCK_ROLE=" in script or ".docks/hooks/" in script:
            raise SystemExit(f"FAIL: {role} {script_name} still contains dock hook routing")
        if "python3" in script or "resolve_session_id()" in script:
            raise SystemExit(f"FAIL: {role} {script_name} still has duplicated session-id parsing")
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
  out="$(printf '%s' "$payload" | AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" bash ".docks/$role/hooks/session-start.sh")"
  python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload.get("continue") is not True:
    raise SystemExit(f"FAIL: expected SessionStart hook success JSON, got {payload}")
PY

  out="$(printf '%s' "$payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" AOS_FAKE_CLIPBOARD_LOG="$clipboard_log" AOS_FAKE_CLIPBOARD_ROLE="$role" bash ".docks/$role/hooks/stop.sh")"
  python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload.get("continue") is not True:
    raise SystemExit(f"FAIL: expected Stop hook success JSON, got {payload}")
PY
done

for notice in 'GDI finished.' 'Foreman finished.' 'Operator finished.'; do
  grep -q "$notice" "$log_file"
done
for expected in \
  'PHASE:stop ARGV:say --voice-slot 1 --language en --quality-tier premium --quality-tier enhanced --gender male Foreman finished.' \
  'PHASE:stop ARGV:say --voice-slot 2 --language en --quality-tier premium --quality-tier enhanced --gender female GDI finished.' \
  'PHASE:stop ARGV:say --voice-slot 3 --language en --quality-tier premium --quality-tier enhanced --gender female Operator finished.'; do
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
if grep -q 'PHASE:stop ARGV:voice bind' "$log_file"; then
  echo "FAIL: Stop hook path must not call voice bind for normal stop speech" >&2
  exit 1
fi
if grep -q 'PHASE:stop ARGV:voice final-response' "$log_file"; then
  echo "FAIL: Stop hook path must not call voice final-response for normal stop speech" >&2
  exit 1
fi
if grep -q 'Do not speak this tail' "$log_file"; then
  echo "FAIL: stop hooks must not pass the assistant tail to voice final-response" >&2
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
out="$(printf '%s' "$payload" | AOS_DOCK_AOS_BIN="$slow_aos" AOS_DOCK_HOOK_TIMEOUT_SECONDS=1 bash ".docks/gdi/hooks/session-start.sh")"
elapsed="$SECONDS"
python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload.get("continue") is not True:
    raise SystemExit(f"FAIL: expected bounded fake-AOS hook success JSON, got {payload}")
PY
if (( elapsed > 6 )); then
  echo "FAIL: bounded fake-AOS hook took too long: ${elapsed}s" >&2
  exit 1
fi

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

python3 - "$ROOT/.docks/README.md" "$ROOT/docs/recipes/codex-dock-session-profiles.md" <<'PY'
import pathlib
import sys

dock_readme = pathlib.Path(sys.argv[1]).read_text()
recipe = pathlib.Path(sys.argv[2]).read_text()
if "## Canonical Docks" not in dock_readme or "`operator/` is the Operator" not in dock_readme:
    raise SystemExit("FAIL: .docks/README.md canonical dock list does not include Operator")
if ".docks/harness/dock-hook-runner.sh" not in dock_readme:
    raise SystemExit("FAIL: .docks/README.md does not document the shared dock harness")
if "voice.voice_slot" not in dock_readme or "aos say --voice-slot" not in dock_readme:
    raise SystemExit("FAIL: .docks/README.md does not document active voice_slot stop speech")
if "## Current Docks" not in recipe or ".docks/operator/" not in recipe or "Operator is a docked role" not in recipe:
    raise SystemExit("FAIL: codex dock recipe does not document Operator as a current dock role")
for label, text in ((".docks/README.md", dock_readme), ("codex-dock-session-profiles.md", recipe)):
    if "not a Workflow" not in text and "not a workflow" not in text:
        raise SystemExit(f"FAIL: {label} does not preserve dock-not-workflow boundary language")
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
