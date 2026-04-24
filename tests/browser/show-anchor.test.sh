#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"
tmproot="/tmp/aos-show-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"
trap 'rm -rf "$tmproot"' EXIT

# Seed a local browser session (registered but NOT actually attached — the
# daemon is not involved in anchor resolution, only in show create).
./aos browser _registry add --id=sess --mode=attach --attach-kind=extension --browser-window-id=88888 >/dev/null

# Case 1: mutual exclusion with --anchor-window
if out=$(./aos show create --id demo --anchor-browser "browser:sess/e1" --anchor-window 12345 --html "<div/>" 2>&1); then
    echo "FAIL mutual-excl: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "INVALID_ARG" || { echo "FAIL mutual-excl code: $out" >&2; exit 1; }

# Case 2: headless-session rejection (seed a headless entry and ensure we see BROWSER_HEADLESS)
./aos browser _registry add --id=headless --mode=launched --headless=true >/dev/null
if out=$(./aos show create --id demo-headless --anchor-browser "browser:headless/e1" --html "<div/>" 2>&1); then
    echo "FAIL headless: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "BROWSER_HEADLESS" || { echo "FAIL headless code: $out" >&2; exit 1; }

# Case 3: unknown session → NOT_FOUND
if out=$(./aos show create --id demo-missing --anchor-browser "browser:nope/e1" --html "<div/>" 2>&1); then
    echo "FAIL unknown: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "NOT_FOUND" || { echo "FAIL unknown code: $out" >&2; exit 1; }

echo "PASS"
