#!/usr/bin/env bash
set -e
# Format: x,y,w,h (integers, comma-separated)
OUT=$(./aos runtime display-union)
echo "$OUT" | grep -qE '^-?[0-9]+,-?[0-9]+,[0-9]+,[0-9]+$' || { echo "FAIL: $OUT"; exit 1; }
echo "PASS"
