#!/usr/bin/env bash
# Exercises src/browser/playwright-version-check.swift via the hidden
# _check-version helper. Uses a fake playwright-cli on $PATH so the test
# doesn't depend on a real Node/@playwright/cli install.
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"

# Case 1: happy path, new-mode CLI at (or above) the pinned minimum.
# Keep this >= kMinPlaywrightCLIVersion in playwright-version-check.swift.
export FAKE_PWCLI_VERSION="0.1.8"
export FAKE_PWCLI_MODE="new"
out=$(./aos browser _check-version 2>&1)
echo "$out" | grep -q '"status":"ok"' || { echo "FAIL case 1: $out" >&2; exit 1; }

# Case 2: old-mode CLI — version too old
export FAKE_PWCLI_VERSION="0.1.1"
export FAKE_PWCLI_MODE="old"
if out=$(./aos browser _check-version 2>&1); then
    echo "FAIL case 2: expected error, got success: $out" >&2
    exit 1
fi
echo "$out" | grep -q "PLAYWRIGHT_CLI_TOO_OLD" || { echo "FAIL case 2: $out" >&2; exit 1; }

# Case 3: binary not found on PATH
unset FAKE_PWCLI_VERSION
unset FAKE_PWCLI_MODE
empty_dir="/tmp/empty-$$"
mkdir -p "$empty_dir"
if out=$(PATH="$empty_dir" ./aos browser _check-version 2>&1); then
    rm -rf "$empty_dir"
    echo "FAIL case 3: expected error, got success: $out" >&2
    exit 1
fi
rm -rf "$empty_dir"
echo "$out" | grep -q "PLAYWRIGHT_CLI_NOT_FOUND" || { echo "FAIL case 3: $out" >&2; exit 1; }

echo "PASS"
