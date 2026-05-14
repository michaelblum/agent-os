#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage:
  bash tests/manual/tcc-reset-agent-user-path.sh --dry-run
  AOS_RUN_DISRUPTIVE_TCC_TEST=1 bash tests/manual/tcc-reset-agent-user-path.sh

This is a manual agent/user path test for repo-mode macOS TCC recovery.

Default full mode is intentionally disruptive:
  - stops the repo-mode daemon
  - attempts a targeted repo-mode AOS TCC reset
  - may require AOS macOS re-approval prompts

Safety gates:
  - full mode skips unless AOS_RUN_DISRUPTIVE_TCC_TEST=1 is set
  - emergency service-wide reset skips unless AOS_ALLOW_EMERGENCY_TCC_SERVICE_RESET=1 is set
  - every mutating step requires an interactive typed confirmation

Options:
  --dry-run   Verify the agent/user contract without mutating TCC
  --help      Show this help

Artifacts:
  Written to AOS_TCC_TEST_ARTIFACT_DIR when set, otherwise a temp directory.
EOF
}

DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
ARTIFACT_DIR="${AOS_TCC_TEST_ARTIFACT_DIR:-${TMPDIR:-/tmp}/aos-tcc-reset-agent-user-path-${STAMP}-$$}"
mkdir -p "$ARTIFACT_DIR"
TRANSCRIPT="$ARTIFACT_DIR/transcript.md"

append_transcript() {
  printf '%s\n\n' "$1" >> "$TRANSCRIPT"
}

capture_json() {
  local name="$1"
  shift
  local out="$ARTIFACT_DIR/${name}.json"
  local err="$ARTIFACT_DIR/${name}.stderr"
  local exit_file="$ARTIFACT_DIR/${name}.exit"

  append_transcript "### command: $*"
  set +e
  "$@" >"$out" 2>"$err"
  local rc=$?
  set -e
  printf '%s\n' "$rc" >"$exit_file"
  if [[ ! -s "$out" ]]; then
    printf '{}\n' >"$out"
  fi
  append_transcript "exit: $rc"
}

stop_repo_daemon() {
  ./aos service stop --mode repo >/dev/null 2>&1 || true
}

cleanup() {
  if [[ "${AOS_TCC_TEST_KEEP_DAEMON:-0}" != "1" ]]; then
    stop_repo_daemon
  fi
}

require_tty() {
  if [[ ! -t 0 ]]; then
    echo "FAIL: full TCC agent/user test requires an interactive terminal." >&2
    exit 1
  fi
}

require_phrase() {
  local prompt="$1"
  local expected="$2"
  local response
  printf '%s\n> ' "$prompt"
  IFS= read -r response
  append_transcript "human response: $response"
  if [[ "$response" != "$expected" ]]; then
    echo "ABORT: confirmation phrase did not match." >&2
    exit 2
  fi
}

write_agent_message() {
  local mode="$1"
  local message_file="$ARTIFACT_DIR/agent-message.txt"
  cat >"$message_file" <<'EOF'
Agent message under test:

AOS repo-mode permissions look stale or missing. I will use the safe runtime
reset path instead of asking you to remove rows in System Settings by hand.

1. I will stop the repo-mode daemon and verify it is no longer running.
2. I will run `./aos permissions reset-runtime --mode repo`.
3. If that targeted reset cannot address the bare repo binary, I will stop and
   report the blocker. Service-wide TCC reset is break-glass only and requires
   Michael to explicitly ask for emergency recovery.
4. After the reset, I will run `./aos permissions setup --once`.
5. When you finish the macOS prompts and say `ready`, I will run
   `./aos ready --post-permission`.

I will not open Settings for you, run repeated repair loops, or ask you to
remove an active daemon from Input Monitoring.
EOF
  append_transcript "## agent message (${mode})"
  append_transcript "$(cat "$message_file")"
  cat "$message_file"
}

validate_dry_run() {
  python3 - "$ARTIFACT_DIR/reset-runtime-dry-run.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text())
if data.get("dry_run") is not True:
    raise SystemExit("reset-runtime dry-run did not report dry_run=true")
if data.get("mode") != "repo":
    raise SystemExit("reset-runtime dry-run did not target repo mode")
if data.get("service_stop", {}).get("status") != "planned":
    raise SystemExit("dry-run did not plan daemon stop")
actions = data.get("next_actions") or []
commands = [action.get("command") for action in actions]
if "./aos permissions setup --once" not in commands:
    raise SystemExit("dry-run omitted permissions setup next_action")
if "./aos ready --post-permission" not in commands:
    raise SystemExit("dry-run omitted post-permission ready next_action")
if data.get("service_resets", []) != []:
    raise SystemExit(f"normal dry-run unexpectedly advertised service resets: {data.get('service_resets')}")
if data.get("tcc_reset", {}).get("status") != "unavailable":
    raise SystemExit(f"dry-run did not classify bare repo targeted reset as unavailable: {data.get('tcc_reset')}")
if not any("emergency-only" in note for note in data.get("notes", [])):
    raise SystemExit("dry-run did not label service-wide reset as emergency-only")
print("PASS: dry-run reset-runtime contract is intact")
PY
}

validate_ready_agent_path() {
  set +e
  python3 - "$ARTIFACT_DIR/ready-before.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text())
if data.get("ready") is True:
    print("SKIP_READY_TRUE")
    raise SystemExit(10)

actions = data.get("next_actions") or []
commands = [action.get("command") for action in actions]
if any(action.get("type") == "open_settings" for action in actions):
    raise SystemExit("ready output still suggests opening Settings")
if "./aos permissions reset-runtime --mode repo" not in commands:
    raise SystemExit("ready output omitted permissions reset-runtime next_action")
if "./aos permissions setup --once" not in commands:
    raise SystemExit("ready output omitted permissions setup next_action")
if "./aos ready --post-permission" not in commands:
    raise SystemExit("ready output omitted ready post-permission next_action")

reset_index = commands.index("./aos permissions reset-runtime --mode repo")
setup_index = commands.index("./aos permissions setup --once")
post_index = commands.index("./aos ready --post-permission")
if not reset_index < setup_index < post_index:
    raise SystemExit(f"unsafe next_action order: {commands}")

diagnosis = data.get("diagnosis")
if diagnosis and diagnosis != "daemon_tcc_grant_stale_or_missing":
    raise SystemExit(f"unexpected readiness diagnosis: {diagnosis}")
print("PASS: ready output uses safe agent/user reset handoff")
PY
  local rc=$?
  set -e
  if [[ "$rc" -eq 10 ]]; then
    echo "SKIP: ./aos ready reported ready=true; no stale TCC handoff to exercise."
    exit 0
  fi
  if [[ "$rc" -ne 0 ]]; then
    exit "$rc"
  fi
}

classify_targeted_reset() {
  python3 - "$ARTIFACT_DIR/reset-targeted.json" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
if data.get("status") == "ok":
    print("TARGETED_OK")
    raise SystemExit(0)

service_stop = data.get("service_stop", {})
if service_stop.get("status") != "ok":
    raise SystemExit(f"targeted reset failed before safe daemon stop: {service_stop}")

tcc_reset = data.get("tcc_reset", {})
if tcc_reset.get("status") == "unavailable":
    print("TARGETED_UNAVAILABLE")
    raise SystemExit(0)
if tcc_reset.get("status") == "failed":
    print("TARGETED_FAILED")
    raise SystemExit(0)

raise SystemExit(f"targeted reset failed without expected stopped-daemon contract: {data}")
PY
}

validate_emergency_reset() {
  python3 - "$ARTIFACT_DIR/reset-emergency.json" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
if data.get("status") != "ok":
    raise SystemExit(f"emergency reset did not report ok: {data}")
services = data.get("service_resets") or []
if not services:
    raise SystemExit("emergency reset did not report service reset results")
failed = [item for item in services if item.get("status") != "ok"]
if failed:
    raise SystemExit(f"emergency reset reported failed services: {failed}")
if data.get("service_stop", {}).get("status") != "ok":
    raise SystemExit("emergency reset did not stop daemon first")
print("PASS: emergency service-wide reset completed after explicit authorization")
PY
}

validate_ready_after() {
  python3 - "$ARTIFACT_DIR/ready-after.json" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
if data.get("ready") is not True:
    raise SystemExit(f"post-permission readiness did not pass: {data}")
print("PASS: ./aos ready --post-permission reported ready=true")
PY
}

echo "Artifacts: $ARTIFACT_DIR"
printf '# AOS TCC Reset Agent/User Path\n\n' >"$TRANSCRIPT"

if [[ "$DRY_RUN" -eq 1 ]]; then
  write_agent_message "dry-run"
  capture_json reset-runtime-dry-run ./aos permissions reset-runtime --mode repo --dry-run --json
  validate_dry_run
  echo "PASS: non-disruptive agent/user TCC reset preview completed"
  exit 0
fi

if [[ "${AOS_RUN_DISRUPTIVE_TCC_TEST:-0}" != "1" ]]; then
  echo "SKIP: set AOS_RUN_DISRUPTIVE_TCC_TEST=1 to run the disruptive manual test."
  echo "Use --dry-run for the non-mutating contract check."
  exit 0
fi

require_tty
trap cleanup EXIT

cat <<'EOF'
WARNING: this test may reset repo-mode AOS TCC decisions and trigger macOS
privacy prompts. The normal path does not reset TCC services for other apps.
EOF
if [[ "${AOS_ALLOW_EMERGENCY_TCC_SERVICE_RESET:-0}" == "1" ]]; then
  cat <<'EOF'
EMERGENCY WARNING: AOS_ALLOW_EMERGENCY_TCC_SERVICE_RESET=1 is set. If targeted
reset fails and you confirm the emergency phrase, this test may reset
Accessibility, ListenEvent, and PostEvent decisions for other apps.
EOF
fi

require_phrase "Type RUN AOS TCC AGENT USER TEST to continue." "RUN AOS TCC AGENT USER TEST"

capture_json ready-before ./aos ready --json
validate_ready_agent_path
write_agent_message "full"
require_phrase "Type confirmed to let the agent run the safe targeted reset now." "confirmed"

capture_json reset-targeted ./aos permissions reset-runtime --mode repo --json
targeted_state="$(classify_targeted_reset)"
echo "$targeted_state"

if [[ "$targeted_state" == "TARGETED_FAILED" ]]; then
  if [[ "${AOS_ALLOW_EMERGENCY_TCC_SERVICE_RESET:-0}" != "1" ]]; then
    cat <<'EOF'
PASS: targeted reset stopped the daemon and reported the targeted-reset blocker.
Emergency service-wide reset was not requested, so the test stopped before any
TCC mutation that could affect other apps.
EOF
    exit 0
  fi
  require_phrase "Type EMERGENCY RESET OTHER APPS to run the service-wide TCC reset." "EMERGENCY RESET OTHER APPS"
  capture_json reset-emergency ./aos permissions reset-runtime --mode repo --allow-service-reset --emergency-ack-other-apps --json
  validate_emergency_reset
fi

./aos permissions setup --once
require_phrase "After completing the macOS prompts, type ready to run the post-permission check." "ready"
capture_json ready-after ./aos ready --post-permission --json
validate_ready_after

echo "PASS: disruptive agent/user TCC reset path completed"
