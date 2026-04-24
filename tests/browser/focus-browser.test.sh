#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"
tmproot="/tmp/aos-focus-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"
trap 'rm -rf "$tmproot"' EXIT

# Case 1: create attach extension
out=$(./aos focus create --id test-attach --target browser://attach --extension 2>&1)
echo "$out" | grep -q '"status":[[:space:]]*"success"' || { echo "FAIL create: $out" >&2; exit 1; }

# Case 2: list includes browser kind
out=$(./aos focus list)
echo "$out" | jq -e '[.channels[]? // .data.channels[]? | select(.kind == "browser" and .id == "test-attach")] | length == 1' >/dev/null \
    || { echo "FAIL list: $out" >&2; exit 1; }

# Case 3: create launched headed
out=$(./aos focus create --id test-launched --target browser://new 2>&1)
echo "$out" | grep -q '"status":[[:space:]]*"success"' || { echo "FAIL launched: $out" >&2; exit 1; }

# Case 4: remove browser channel
./aos focus remove --id test-attach >/dev/null
out=$(./aos focus list)
echo "$out" | jq -e '[.channels[]? // .data.channels[]? | select(.id == "test-attach")] | length == 0' >/dev/null \
    || { echo "FAIL remove: $out" >&2; exit 1; }

# Case 5: --target and --window mutually exclusive
if ./aos focus create --id oops --target browser://new --window 12345 2>/dev/null; then
    echo "FAIL exclusive: expected error" >&2; exit 1
fi

echo "PASS"
