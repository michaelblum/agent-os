#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export AOS_PLAYWRIGHT_CLI="$FIX/playwright-cli"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"

# Non-browser target errors
if out=$(./aos do fill 500,300 "hello" 2>&1); then
    echo "FAIL non-browser: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "BROWSER_ONLY" || { echo "FAIL non-browser code: $out" >&2; exit 1; }

# Browser target succeeds
out=$(./aos do fill "browser:todo/e21" "hello world" 2>&1)
echo "$out" | grep -q "fake fill invoked: -s=todo fill e21 hello world" \
    || { echo "FAIL browser: $out" >&2; exit 1; }

# Direct browser fill preserves state-id provenance in the action evidence
out=$(./aos do fill "browser:todo/e21" "hello world" --state-id see_fill123 2>&1)
echo "$out" | grep -q '"state_id":"see_fill123"' \
    || { echo "FAIL browser state id: $out" >&2; exit 1; }

# Missing text errors
if out=$(./aos do fill "browser:todo/e21" 2>&1); then
    if echo "$out" | grep -q '"status":"success"'; then
        echo "FAIL missing text: expected error" >&2; exit 1
    fi
fi

if out=$(./aos do fill "browser:todo/e21" "hello" unexpected 2>&1); then
    echo "FAIL extra positional: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -Eq '"code"[[:space:]]*:[[:space:]]*"UNKNOWN_ARG"' \
    || { echo "FAIL extra positional code: $out" >&2; exit 1; }

# Missing ref errors cleanly (fill requires a ref to know which element)
if out=$(./aos do fill "browser:todo" "hello" 2>&1); then
    if echo "$out" | grep -q '"status":"success"'; then
        echo "FAIL missing ref: expected error" >&2; exit 1
    fi
fi

echo "PASS"
