#!/usr/bin/env bash
# Characterization test: macOS-sourced xray elements must not emit a "ref" key,
# and every element must carry numeric bounds. Guards the AXElementJSON
# encoding contract after Task 1 (Playwright browser adapter) made bounds
# optional and added ref. Browser-sourced elements carry ref instead of
# bounds (Task 5/8); macOS-sourced elements must continue to omit ref
# entirely (no "ref": null leakage).
set -euo pipefail

OUT=$(./aos see capture user_active --xray 2>/dev/null)

echo "$OUT" | jq -e '.elements | length > 0' >/dev/null || {
    echo "FAIL: expected at least one xray element" >&2
    exit 1
}

# No macOS-sourced element should emit a "ref" key (null or otherwise).
if echo "$OUT" | jq -e '.elements[] | select(has("ref"))' >/dev/null 2>&1; then
    echo "FAIL: macOS xray elements must not emit a 'ref' key" >&2
    echo "$OUT" | jq '.elements[] | select(has("ref"))' >&2
    exit 1
fi

# Every macOS-sourced element must carry numeric bounds.
echo "$OUT" | jq -e '.elements[0].bounds.x | type == "number"' >/dev/null || {
    echo "FAIL: bounds.x missing or non-numeric on first element" >&2
    echo "$OUT" | jq '.elements[0]' >&2
    exit 1
}

echo "PASS"
