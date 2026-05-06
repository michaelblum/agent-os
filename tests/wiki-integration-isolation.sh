#!/usr/bin/env bash
# Regression guard: wiki-integration.sh must not target live repo wiki state.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

canonicalize_path() {
  python3 - "$1" <<'PY'
import pathlib
import sys

print(pathlib.Path(sys.argv[1]).expanduser().resolve(strict=False))
PY
}

snapshot_wiki() {
  local wiki_dir="$1"
  if [[ ! -d "$wiki_dir" ]]; then
    printf '__missing__\n'
    return 0
  fi

  find "$wiki_dir" -type f -print 2>/dev/null | LC_ALL=C sort | while IFS= read -r path; do
    stat -f '%N %z %m' "$path"
  done
}

CANONICAL_STATE_ROOT="$(canonicalize_path "$HOME/.config/aos")"
CANONICAL_WIKI_DIR="$(canonicalize_path "$CANONICAL_STATE_ROOT/repo/wiki")"
BEFORE="$(snapshot_wiki "$CANONICAL_WIKI_DIR")"

set +e
OUTPUT="$(AOS_STATE_ROOT="$CANONICAL_STATE_ROOT" bash "$HERE/wiki-integration.sh" 2>&1)"
STATUS=$?
set -e

AFTER="$(snapshot_wiki "$CANONICAL_WIKI_DIR")"

if [[ "$STATUS" -eq 0 ]]; then
  echo "FAIL: wiki-integration.sh succeeded against canonical repo state"
  echo "$OUTPUT"
  exit 1
fi

if ! grep -q "refusing to run destructive wiki integration test" <<<"$OUTPUT"; then
  echo "FAIL: wiki-integration.sh did not report the live-state refusal"
  echo "$OUTPUT"
  exit 1
fi

if [[ "$BEFORE" != "$AFTER" ]]; then
  echo "FAIL: live repo wiki changed during isolation guard check"
  exit 1
fi

echo "PASS: wiki-integration.sh refuses canonical repo wiki state"
