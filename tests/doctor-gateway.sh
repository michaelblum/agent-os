#!/usr/bin/env bash
set -euo pipefail

export AOS_STATE_ROOT="$(mktemp -d -t aos-doctor-gateway)"
export AOS_RUNTIME_MODE=repo
trap 'rm -rf "$AOS_STATE_ROOT"' EXIT

# Snapshot pre-existing real state, to assert it is not touched.
LEGACY="$HOME/.config/aos-gateway"
LEGACY_BEFORE=""
if [[ -d "$LEGACY" ]]; then
  LEGACY_BEFORE="$(ls -la "$LEGACY")"
fi

echo "== bare ./aos doctor --json still works =="
./aos doctor --json | jq 'has("status") and has("runtime") and has("permissions")' | grep -q true

echo "== ./aos doctor gateway --json shape =="
RC=0
OUT="$(./aos doctor gateway --json)" || RC=$?
# Under an empty isolated root the reporter correctly exits 1 (warnings:
# no gateway running). 0 = healthy, 1 = warnings, 2 = hard error.
[[ "$RC" -eq 0 || "$RC" -eq 1 ]] || { echo "unexpected exit $RC from doctor gateway"; exit "$RC"; }
echo "$OUT" | jq . > /dev/null           # parses as JSON
echo "$OUT" | jq -e '.mode == "repo"' > /dev/null
echo "$OUT" | jq -e '.state_root == env.AOS_STATE_ROOT' > /dev/null
echo "$OUT" | jq -e '.processes.mcp.pidfile | has("path")' > /dev/null
echo "$OUT" | jq -e '.processes.broker.pidfile | has("path")' > /dev/null

echo "== --quick omits db details =="
RC=0
QOUT="$(./aos doctor gateway --quick --json)" || RC=$?
[[ "$RC" -eq 0 || "$RC" -eq 1 ]] || { echo "unexpected exit $RC from doctor gateway --quick"; exit "$RC"; }
echo "$QOUT" | jq -e '.db | has("integrity") | not' > /dev/null

echo "== sandbox safety: real legacy dir untouched =="
if [[ -n "$LEGACY_BEFORE" ]]; then
  LEGACY_AFTER="$(ls -la "$LEGACY")"
  [[ "$LEGACY_BEFORE" == "$LEGACY_AFTER" ]] || { echo "LEGACY state mutated under isolated root!"; exit 1; }
fi

echo "OK"
