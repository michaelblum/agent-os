#!/usr/bin/env bash
# Characterization test: macOS --xray --label path must keep working after
# AXElementJSON.bounds becomes optional.
set -euo pipefail

OUT="/tmp/aos-xray-label-regression.png"
rm -f "$OUT"

./aos see capture user_active --xray --label --out "$OUT" >/dev/null

if [[ ! -s "$OUT" ]]; then
  echo "FAIL: expected $OUT to exist and be non-empty" >&2
  exit 1
fi

# Label overlay implies buildAnnotations was called successfully
file "$OUT" | grep -q "PNG image" || { echo "FAIL: output is not a PNG" >&2; exit 1; }

echo "PASS"
