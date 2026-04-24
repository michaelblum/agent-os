#!/usr/bin/env bash
# Exercises src/browser/snapshot-parser.swift via the hidden _parse-snapshot
# helper. Compares parser output for three real playwright-cli snapshots
# against committed golden JSON.
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"

for name in simple nested disabled; do
    md="$FIX/snapshot-$name.md"
    golden="$FIX/snapshot-$name.golden.json"
    [[ -f "$md" ]]     || { echo "missing fixture: $md" >&2; exit 1; }
    [[ -f "$golden" ]] || { echo "missing golden: $golden" >&2; exit 1; }
    actual=$(./aos browser _parse-snapshot "$md")
    if ! diff <(echo "$actual" | jq --sort-keys .) <(jq --sort-keys . "$golden") >/tmp/snap-diff; then
        echo "FAIL case $name:" >&2
        cat /tmp/snap-diff >&2
        exit 1
    fi
done

echo "PASS"
