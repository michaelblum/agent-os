#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"
tmproot="/tmp/aos-anchor-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"
trap 'rm -rf "$tmproot"' EXIT

# Seed a registry entry marked as headless (browser_window_id=null)
./aos browser _registry add --id=headless-sess --mode=launched --headless=true >/dev/null

# Case 1: headless session returns BROWSER_HEADLESS
if out=$(./aos browser _resolve-anchor "browser:headless-sess/e1" 2>&1); then
    echo "FAIL headless: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "BROWSER_HEADLESS" || { echo "FAIL headless code: $out" >&2; exit 1; }

# Case 2: non-registered session returns NOT_FOUND
if out=$(./aos browser _resolve-anchor "browser:no-such/e1" 2>&1); then
    echo "FAIL not-found: expected error" >&2; exit 1
fi
echo "$out" | grep -q "NOT_FOUND" || { echo "FAIL not-found code: $out" >&2; exit 1; }

# Case 3: local session with winID → static offset (rect from fake eval)
./aos browser _registry add --id=local-sess --mode=attach --attach-kind=extension --browser-window-id=99999 >/dev/null
out=$(./aos browser _resolve-anchor "browser:local-sess/e2" 2>&1)
echo "$out" | jq -e '.anchor_window == 99999' >/dev/null \
    || { echo "FAIL local anchor_window: $out" >&2; exit 1; }
echo "$out" | jq -e '.offset | length == 4' >/dev/null \
    || { echo "FAIL local offset: $out" >&2; exit 1; }

# Case 4: no ref on target → whole-window anchor (offset = [0,0,0,0])
out=$(./aos browser _resolve-anchor "browser:local-sess" 2>&1)
echo "$out" | jq -e '.anchor_window == 99999' >/dev/null \
    || { echo "FAIL no-ref anchor_window: $out" >&2; exit 1; }
echo "$out" | jq -e '.offset == [0,0,0,0]' >/dev/null \
    || { echo "FAIL no-ref offset: $out" >&2; exit 1; }

echo "PASS"
