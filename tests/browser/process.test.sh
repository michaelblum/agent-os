#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.1.8"
export FAKE_PWCLI_MODE="new"

# Case 1: simple verb passthrough
out=$(./aos browser _run --session=todo --verb=attach 2>&1)
echo "$out" | grep -q '"exit_code":0' || { echo "FAIL case 1: $out" >&2; exit 1; }
echo "$out" | grep -q '"stdout":"fake attach invoked:' \
    || { echo "FAIL case 1 stdout: $out" >&2; exit 1; }

# Case 2: --filename allocation sets the filename field
tmp_seen=$(./aos browser _run --session=todo --verb=snapshot --with-filename 2>&1)
echo "$tmp_seen" | grep -q '"filename":"/tmp/aos-pw-' \
    || { echo "FAIL case 2: $tmp_seen" >&2; exit 1; }

# Case 3: nonzero exit captured cleanly (unknown verb per fake shim returns 2)
out=$(./aos browser _run --session=todo --verb=bogus 2>&1 || true)
echo "$out" | grep -q '"exit_code":2' \
    || { echo "FAIL case 3: $out" >&2; exit 1; }

# Case 4: large stdout must not deadlock
out=$(./aos browser _run --session=todo --verb=bigstdout 2>&1)
echo "$out" | grep -q '"exit_code":0' || { echo "FAIL case 4: $out" >&2; exit 1; }
# Verify stdout was captured — length check on the JSON value
stdout_len=$(echo "$out" | jq -r '.stdout | length')
if [[ "$stdout_len" -lt 100000 ]]; then
    echo "FAIL case 4 length: got $stdout_len bytes in stdout, expected >=100KB" >&2
    exit 1
fi

echo "PASS"
