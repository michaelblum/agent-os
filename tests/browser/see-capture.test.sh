#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
export AOS_STATE_ROOT="$TEST_ROOT/state"
PW_PACKAGE="$TEST_ROOT/runtime/node_modules/@playwright/cli"
mkdir -p "$PW_PACKAGE"
cp "$FIX/playwright-cli" "$PW_PACKAGE/playwright-cli"
printf '%s\n' '{"name":"@playwright/cli","version":"0.1.15"}' > "$PW_PACKAGE/package.json"
export AOS_PLAYWRIGHT_CLI="$PW_PACKAGE/playwright-cli"
export AOS_PATH="$FIX/aos-see-primitive.sh"
export FAKE_PWCLI_VERSION="0.1.15"
export FAKE_PWCLI_MODE="new"

# Case 1: browser target rejects when no session resolvable
unset PLAYWRIGHT_CLI_SESSION
if out=$(node scripts/aos-see-native.mjs capture "browser:" 2>&1); then
    echo "FAIL case 1: expected MISSING_SESSION, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "MISSING_SESSION" || { echo "FAIL case 1 code: $out" >&2; exit 1; }

# Case 2: browser: target screenshots
OUT="/tmp/aos-see-browser-$$.png"
: > "$OUT"
node scripts/aos-see-native.mjs capture "browser:todo" --out "$OUT" >/dev/null
[[ -f "$OUT" ]] || { echo "FAIL case 2: expected $OUT to exist" >&2; exit 1; }
rm -f "$OUT"

# Case 3: browser:<s> --xray returns elements JSON with ref
out=$(node scripts/aos-see-native.mjs capture "browser:todo" --xray 2>&1)
echo "$out" | jq -e '.elements | length > 0' >/dev/null \
    || { echo "FAIL case 3: $out" >&2; exit 1; }
echo "$out" | jq -e '.elements[0].ref != null' >/dev/null \
    || { echo "FAIL case 3 ref: $out" >&2; exit 1; }
echo "$out" | jq -e '.state_id as $state | .elements[0].handle == {
  kind:"observation_ref", backend:"browser", state_id:$state,
  scope:{session:"todo"}, ref:.elements[0].ref
}' >/dev/null || { echo "FAIL case 3 handle: $out" >&2; exit 1; }
echo "$out" | jq -e '.elements[0].bounds == null' >/dev/null \
    || { echo "FAIL case 3 bounds: $out" >&2; exit 1; }

echo "PASS"
