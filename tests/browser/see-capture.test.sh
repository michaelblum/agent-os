#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"

# Case 1: browser target rejects when no session resolvable
unset PLAYWRIGHT_CLI_SESSION
if out=$(./aos see capture "browser:" 2>&1); then
    echo "FAIL case 1: expected MISSING_SESSION, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "MISSING_SESSION" || { echo "FAIL case 1 code: $out" >&2; exit 1; }

# Case 2: browser: target screenshots
OUT="/tmp/aos-see-browser-$$.png"
: > "$OUT"
./aos see capture "browser:todo" --out "$OUT" >/dev/null
[[ -f "$OUT" ]] || { echo "FAIL case 2: expected $OUT to exist" >&2; exit 1; }
rm -f "$OUT"

# Case 3: browser:<s> --xray returns elements JSON with ref
out=$(./aos see capture "browser:todo" --xray 2>&1)
echo "$out" | jq -e '.elements | length > 0' >/dev/null \
    || { echo "FAIL case 3: $out" >&2; exit 1; }
echo "$out" | jq -e '.elements[0].ref != null' >/dev/null \
    || { echo "FAIL case 3 ref: $out" >&2; exit 1; }
echo "$out" | jq -e '.elements[0].bounds == null' >/dev/null \
    || { echo "FAIL case 3 bounds: $out" >&2; exit 1; }

echo "PASS"
