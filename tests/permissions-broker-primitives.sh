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

echo "PASS"
