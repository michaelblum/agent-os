#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-permissions-broker-primitives"
STATE_ROOT="$(mktemp -d "/tmp/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_TEST_ASSUME_PERMISSIONS_GRANTED=1

MARKER="$STATE_ROOT/repo/permissions-onboarding.json"

cleanup() {
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

FACTS_JSON="$(./aos __permissions facts --json)"
python3 - "$FACTS_JSON" "$ROOT/aos" <<'PY'
import json
import sys

d = json.loads(sys.argv[1])
expected_executable = sys.argv[2]
assert d.get("status") == "ok", d
assert d.get("mode") == "repo", d
permissions = d.get("permissions") or {}
assert permissions == {
    "accessibility": True,
    "screen_recording": True,
    "listen_access": True,
    "post_access": True,
}, d
identity = d.get("identity") or {}
assert identity.get("executable_path") == expected_executable, identity
assert isinstance(identity.get("bundle_path"), str) and identity["bundle_path"], identity
for policy_key in ("ready_for_testing", "ready_source", "requirements", "notes", "next_actions"):
    assert policy_key not in d, (policy_key, d)
PY
echo "PASS: __permissions facts --json"

GET_JSON="$(./aos __permissions setup-marker get --json)"
python3 - "$GET_JSON" "$MARKER" <<'PY'
import json
import sys

d = json.loads(sys.argv[1])
marker = sys.argv[2]
assert d.get("marker_exists") is False, d
assert d.get("marker_path") == marker, d
assert d.get("setup_completed") is False, d
assert "recommended_command" not in d, d
assert "notes" not in d, d
PY
echo "PASS: __permissions setup-marker get --json absent"

WRITE_JSON="$(./aos __permissions setup-marker write --json)"
python3 - "$WRITE_JSON" "$MARKER" <<'PY'
import json
import pathlib
import sys

d = json.loads(sys.argv[1])
marker_path = pathlib.Path(sys.argv[2])
assert d.get("status") == "ok", d
assert d.get("action") == "write", d
marker = d.get("marker") or {}
assert marker.get("marker_exists") is True, marker
assert marker.get("marker_path") == str(marker_path), marker
assert marker.get("setup_completed") is True, marker
assert marker.get("bundle_path") == marker.get("current_bundle_path"), marker
assert marker.get("bundle_matches_current") is True, marker
stored = json.loads(marker_path.read_text(encoding="utf-8"))
assert stored.get("bundle_path") == marker.get("current_bundle_path"), stored
assert stored.get("permissions") == {
    "accessibility": True,
    "screen_recording": True,
    "listen_access": True,
    "post_access": True,
}, stored
PY
echo "PASS: __permissions setup-marker write --json"

GET_AFTER_WRITE_JSON="$(./aos __permissions setup-marker get --json)"
python3 - "$GET_AFTER_WRITE_JSON" <<'PY'
import json
import sys

d = json.loads(sys.argv[1])
assert d.get("marker_exists") is True, d
assert d.get("setup_completed") is True, d
assert d.get("bundle_matches_current") is True, d
assert "recommended_command" not in d, d
assert "notes" not in d, d
PY
echo "PASS: __permissions setup-marker get --json after write"

for prompt in accessibility screen-recording listen-event post-event; do
  PROMPT_JSON="$(./aos __permissions prompt "$prompt" --json)"
  python3 - "$PROMPT_JSON" "$prompt" <<'PY'
import json
import sys

d = json.loads(sys.argv[1])
prompt = sys.argv[2]
ids = {
    "accessibility": "accessibility",
    "screen-recording": "screen_recording",
    "listen-event": "listen_access",
    "post-event": "post_access",
}
assert d.get("status") == "ok", d
assert d.get("permission") == ids[prompt], d
assert d.get("attempted") is False, d
assert "trigger_result" not in d, d
assert d.get("granted") is True, d
assert isinstance(d.get("native_trigger"), str) and d["native_trigger"], d
before = d.get("before") or {}
after = d.get("after") or {}
for permissions in (before, after):
    assert permissions == {
        "accessibility": True,
        "screen_recording": True,
        "listen_access": True,
        "post_access": True,
    }, d
for policy_key in ("notes", "next_actions", "recommended_command", "setup"):
    assert policy_key not in d, (policy_key, d)
PY
done
echo "PASS: __permissions prompt <permission> --json"

RESET_TARGET_JSON="$(./aos __permissions reset-target --mode repo --json)"
python3 - "$RESET_TARGET_JSON" "$ROOT/aos" <<'PY'
import json
import sys

d = json.loads(sys.argv[1])
target = sys.argv[2]
assert d.get("status") == "ok", d
assert d.get("mode") == "repo", d
assert d.get("target_path") == target, d
assert isinstance(d.get("tcc_identifier"), str) and d["tcc_identifier"], d
assert d.get("available") is False, d
assert "bare repo" in (d.get("unavailable_reason") or ""), d
assert d.get("arguments") == ["reset", "All", d["tcc_identifier"]], d
assert d.get("command") == f"tccutil reset All {d['tcc_identifier']}", d
for policy_key in ("service_stop", "service_resets", "next_actions", "fallback", "notes"):
    assert policy_key not in d, (policy_key, d)
PY
echo "PASS: __permissions reset-target --mode repo --json"

set +e
TCC_RESET_JSON="$(./aos __permissions tcc-reset --mode repo --json)"
TCC_RESET_RC=$?
set -e
python3 - "$TCC_RESET_JSON" "$ROOT/aos" <<'PY'
import json
import sys

d = json.loads(sys.argv[1])
target = sys.argv[2]
assert d.get("status") == "degraded", d
assert d.get("mode") == "repo", d
assert d.get("target_path") == target, d
assert isinstance(d.get("tcc_identifier"), str) and d["tcc_identifier"], d
reset = d.get("tcc_reset") or {}
assert reset.get("attempted") is False, d
assert reset.get("status") == "unavailable", d
assert "bare repo" in (reset.get("stderr") or ""), d
assert reset.get("command") == f"tccutil reset All {d['tcc_identifier']}", d
for policy_key in ("service_stop", "service_resets", "next_actions", "fallback", "notes"):
    assert policy_key not in d, (policy_key, d)
PY
if [[ "$TCC_RESET_RC" -eq 0 ]]; then
  echo "FAIL: __permissions tcc-reset --mode repo unexpectedly exited 0 for unavailable bare repo target"
  exit 1
fi
echo "PASS: __permissions tcc-reset --mode repo --json unavailable"

echo "PASS"
