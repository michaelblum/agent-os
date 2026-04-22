#!/usr/bin/env bash
set -euo pipefail

REFERENCE="tests/fixtures/doctor-before.json"
[[ -f "$REFERENCE" ]] || { echo "missing $REFERENCE — capture from main before landing this PR"; exit 1; }

CURRENT="$(mktemp)"
trap 'rm -f "$CURRENT"' EXIT

./aos doctor --json > "$CURRENT"

# Normalize array indices to `[]` so state-dependent array length
# (e.g. `notes` with fewer entries on healthier hosts) does not look
# like a schema regression.  We are asserting key shape, not cardinality.
NORMALIZE='paths(scalars) | map(if type == "number" then "[]" else . end) | join(".")'
BEFORE="$(jq -S "$NORMALIZE" "$REFERENCE" | sort -u)"
AFTER="$(jq -S "$NORMALIZE" "$CURRENT" | sort -u)"

# Every path present before must still be present. New paths OK (additive).
MISSING="$(comm -23 <(echo "$BEFORE") <(echo "$AFTER") || true)"
if [[ -n "$MISSING" ]]; then
  echo "REGRESSION: missing paths in ./aos doctor --json output:"
  echo "$MISSING"
  exit 1
fi
echo "OK"
