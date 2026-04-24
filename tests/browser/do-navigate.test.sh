#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"

# Non-browser target errors
if out=$(./aos do navigate "main" "https://example.com" 2>&1); then
    if echo "$out" | grep -q '"status":"success"'; then
        echo "FAIL non-browser: expected error" >&2; exit 1
    fi
fi
echo "$out" | grep -q "BROWSER_ONLY" || { echo "FAIL non-browser code: $out" >&2; exit 1; }

# Browser target succeeds
out=$(./aos do navigate "browser:todo" "https://example.com" 2>&1)
stdout=$(echo "$out" | jq -r '.result.stdout')
echo "$stdout" | grep -q "fake goto invoked: -s=todo goto https://example.com" \
    || { echo "FAIL: $out" >&2; exit 1; }

# Missing url errors
if out=$(./aos do navigate "browser:todo" 2>&1); then
    if echo "$out" | grep -q '"status":"success"'; then
        echo "FAIL missing url: expected error" >&2; exit 1
    fi
fi

echo "PASS"
