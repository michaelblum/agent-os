#!/usr/bin/env bash
set -euo pipefail

tmproot="/tmp/aos-reg-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"
trap 'rm -rf "$tmproot"' EXIT

# Case 1: list on empty returns []
out=$(./aos browser _registry list)
[[ "$out" == "[]" ]] || { echo "FAIL case 1: $out" >&2; exit 1; }

# Case 2: add and list
./aos browser _registry add --id=sess-a --mode=attach --attach-kind=extension --browser-window-id=12345 >/dev/null
./aos browser _registry add --id=sess-b --mode=launched --headless=false >/dev/null
out=$(./aos browser _registry list)
echo "$out" | jq -e 'length == 2' >/dev/null || { echo "FAIL case 2 count: $out" >&2; exit 1; }
echo "$out" | jq -e '.[] | select(.id == "sess-a").mode == "attach"' >/dev/null \
    || { echo "FAIL case 2 mode: $out" >&2; exit 1; }
echo "$out" | jq -e '.[] | select(.id == "sess-a").browser_window_id == 12345' >/dev/null \
    || { echo "FAIL case 2 win: $out" >&2; exit 1; }

# Case 3: find-by-id
out=$(./aos browser _registry find --id=sess-b)
echo "$out" | jq -e '.mode == "launched"' >/dev/null || { echo "FAIL case 3: $out" >&2; exit 1; }

# Case 4: remove
./aos browser _registry remove --id=sess-a >/dev/null
out=$(./aos browser _registry list)
echo "$out" | jq -e 'length == 1' >/dev/null || { echo "FAIL case 4: $out" >&2; exit 1; }
echo "$out" | jq -e '.[0].id == "sess-b"' >/dev/null || { echo "FAIL case 4 id: $out" >&2; exit 1; }

# Case 5: duplicate add returns DUPLICATE_ID error
if err=$(./aos browser _registry add --id=sess-b --mode=launched 2>&1 >/dev/null); then
    echo "FAIL case 5: duplicate add should error" >&2; exit 1
fi
echo "$err" | grep -q '"code"[[:space:]]*:[[:space:]]*"DUPLICATE_ID"' \
    || { echo "FAIL case 5 error code: $err" >&2; exit 1; }

# Case 6: remove nonexistent id returns NOT_FOUND
if err=$(./aos browser _registry remove --id=does-not-exist 2>&1 >/dev/null); then
    echo "FAIL case 6: remove missing id should error" >&2; exit 1
fi
echo "$err" | grep -q '"code"[[:space:]]*:[[:space:]]*"NOT_FOUND"' \
    || { echo "FAIL case 6 error code: $err" >&2; exit 1; }

# Case 7: list rejects extra args
if err=$(./aos browser _registry list extra 2>&1 >/dev/null); then
    echo "FAIL case 7: list extra arg should error" >&2; exit 1
fi
echo "$err" | grep -q '"code"[[:space:]]*:[[:space:]]*"UNKNOWN_ARG"' \
    || { echo "FAIL case 7 error code: $err" >&2; exit 1; }

# Case 8: add rejects unknown flags before mutation
if err=$(./aos browser _registry add --id=sess-c --mode=launched --bogus=true 2>&1 >/dev/null); then
    echo "FAIL case 8: add unknown flag should error" >&2; exit 1
fi
echo "$err" | grep -q '"code"[[:space:]]*:[[:space:]]*"UNKNOWN_FLAG"' \
    || { echo "FAIL case 8 error code: $err" >&2; exit 1; }

# Case 9: find rejects extra args
if err=$(./aos browser _registry find --id=sess-b extra 2>&1 >/dev/null); then
    echo "FAIL case 9: find extra arg should error" >&2; exit 1
fi
echo "$err" | grep -q '"code"[[:space:]]*:[[:space:]]*"UNKNOWN_ARG"' \
    || { echo "FAIL case 9 error code: $err" >&2; exit 1; }

echo "PASS"
