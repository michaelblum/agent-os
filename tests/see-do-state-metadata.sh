#!/usr/bin/env bash
set -euo pipefail

STATE_ID="see_test000001"

OUT="$(AOS_BYPASS_PREFLIGHT=1 ./aos do click 10,10 --dry-run --state-id "$STATE_ID")"
OUT="$OUT" STATE_ID="$STATE_ID" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["OUT"])
execution = payload.get("execution") or {}
assert payload["status"] == "dry_run", payload
assert payload["backend"] == "cgevent", payload
assert execution["backend"] == "cgevent", payload
assert execution["strategy"] == "dry_run_click", payload
assert execution["fallback_used"] is False, payload
assert execution["state_id"] == os.environ["STATE_ID"], payload
PY

if ! python3 - <<'PY'
import json
import subprocess

perms = json.loads(subprocess.check_output(["./aos", "permissions", "check", "--json"], text=True)).get("permissions", {})
raise SystemExit(0 if perms.get("screen_recording") else 1)
PY
then
  echo "SKIP: see capture state_id requires screen recording"
  exit 0
fi

ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aos-see-do-state.XXXXXX")"
trap 'rm -rf "$ARTIFACT_DIR"' EXIT
PNG_PATH="$ARTIFACT_DIR/capture.png"
JSON_PATH="$ARTIFACT_DIR/capture.json"

AOS_BYPASS_PREFLIGHT=1 ./aos see capture --region 0,0,8,8 --out "$PNG_PATH" > "$JSON_PATH"

python3 - "$JSON_PATH" <<'PY'
import json
import re
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
state_id = payload.get("state_id")
assert re.fullmatch(r"see_[a-z0-9]{12}", state_id or ""), payload
assert payload.get("files"), payload
PY

echo "PASS"
