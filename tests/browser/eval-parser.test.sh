#!/usr/bin/env bash
# Exercises the ### Result / ### Error envelope parsing in
# src/browser/eval-result-parser.swift and the requireSuccess() guard
# in src/browser/browser-adapter.swift. These matter because real
# @playwright/cli emits its eval output and some error states in
# markdown-wrapped stdout while still exiting 0.
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"
tmproot="/tmp/aos-eval-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"
trap 'rm -rf "$tmproot"' EXIT

./aos browser _registry add --id=sess --mode=attach --attach-kind=extension --browser-window-id=12345 >/dev/null

# Case 1: default eval mode (### Result + plain object) — primary path.
unset FAKE_PWCLI_EVAL_MODE
out=$(./aos browser _resolve-anchor "browser:sess/e1")
echo "$out" | jq -e '.anchor_window == 12345' >/dev/null \
    || { echo "FAIL case 1 anchor_window: $out" >&2; exit 1; }
echo "$out" | jq -e '.offset == [100, 200, 300, 40]' >/dev/null \
    || { echo "FAIL case 1 offset: $out" >&2; exit 1; }

# Case 2: eval emits "### Error" on stdout at exit 0 — anchor resolver must
# still return ANCHOR_EVAL_FAILED (boundsViaEval returns nil, which the
# resolver surfaces).
export FAKE_PWCLI_EVAL_MODE="error"
if out=$(./aos browser _resolve-anchor "browser:sess/e1" 2>&1); then
    echo "FAIL case 2: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "ANCHOR_EVAL_FAILED" || { echo "FAIL case 2 code: $out" >&2; exit 1; }

# Case 3: do verb emits "### Error" at exit 0 — dispatcher must surface as
# PLAYWRIGHT_CLI_FAILED rather than status:"success".
unset FAKE_PWCLI_EVAL_MODE
export FAKE_PWCLI_ERROR_VERB="click"
export FAKE_PWCLI_ERROR_MSG="page: Access to file URL blocked"
if out=$(./aos do click "browser:sess/e1" 2>&1); then
    echo "FAIL case 3: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "PLAYWRIGHT_CLI_FAILED" || { echo "FAIL case 3 code: $out" >&2; exit 1; }
echo "$out" | grep -q "Access to file URL blocked" || { echo "FAIL case 3 msg: $out" >&2; exit 1; }

echo "PASS"
