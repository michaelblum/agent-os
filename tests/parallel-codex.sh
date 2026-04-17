#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-parallel-codex.XXXXXX")"
CLIPBOARD_FILE="$TMP_ROOT/clipboard.txt"
export AOS_STATE_ROOT="$TMP_ROOT/state"
export AOS_CLIPBOARD_FILE="$CLIPBOARD_FILE"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

bash "$ROOT/scripts/parallel-codex" \
  --display-name display-focus \
  --wiki-name wiki-focus >/dev/null

BOOTSTRAP_DIR="$AOS_STATE_ROOT/repo/coordination/bootstrap"
DISPLAY_LAUNCHER="$BOOTSTRAP_DIR/launch-display-focus"
WIKI_LAUNCHER="$BOOTSTRAP_DIR/launch-wiki-focus"

[[ -d "$BOOTSTRAP_DIR" ]] || { echo "FAIL: missing bootstrap dir"; exit 1; }
[[ -x "$DISPLAY_LAUNCHER" ]] || { echo "FAIL: display launcher not executable"; exit 1; }
[[ -x "$WIKI_LAUNCHER" ]] || { echo "FAIL: wiki launcher not executable"; exit 1; }
bash -n "$DISPLAY_LAUNCHER" || { echo "FAIL: display launcher is not valid bash"; exit 1; }
bash -n "$WIKI_LAUNCHER" || { echo "FAIL: wiki launcher is not valid bash"; exit 1; }

EXPECTED_CLIPBOARD="bash $DISPLAY_LAUNCHER"
ACTUAL_CLIPBOARD="$(tr -d '\n' < "$CLIPBOARD_FILE")"
[[ "$ACTUAL_CLIPBOARD" == "$EXPECTED_CLIPBOARD" ]] || {
  echo "FAIL: clipboard mismatch: expected '$EXPECTED_CLIPBOARD', got '$ACTUAL_CLIPBOARD'"
  exit 1
}

grep -q "AOS_SESSION_NAME=\"display-focus\"" "$DISPLAY_LAUNCHER" || {
  echo "FAIL: display launcher missing session name export"
  exit 1
}
grep -q 'rm -f -- "\$0"' "$DISPLAY_LAUNCHER" || {
  echo "FAIL: display launcher is not burn-after-read"
  exit 1
}
grep -q "You are the display-focused session." "$DISPLAY_LAUNCHER" || {
  echo "FAIL: display launcher missing inline brief"
  exit 1
}
grep -q "extended display" "$DISPLAY_LAUNCHER" || {
  echo "FAIL: display launcher missing coordination guidance"
  exit 1
}
grep -q "bash $WIKI_LAUNCHER" "$DISPLAY_LAUNCHER" || {
  echo "FAIL: display launcher does not prime clipboard with wiki launcher"
  exit 1
}
grep -q "AOS_SESSION_NAME=\"wiki-focus\"" "$WIKI_LAUNCHER" || {
  echo "FAIL: wiki launcher missing session name export"
  exit 1
}
grep -q 'rm -f -- "\$0"' "$WIKI_LAUNCHER" || {
  echo "FAIL: wiki launcher is not burn-after-read"
  exit 1
}
grep -q "You are the wiki-focused session." "$WIKI_LAUNCHER" || {
  echo "FAIL: wiki launcher missing inline brief"
  exit 1
}
grep -q "restart the daemon" "$WIKI_LAUNCHER" || {
  echo "FAIL: wiki launcher missing daemon guard"
  exit 1
}
grep -q "bash $DISPLAY_LAUNCHER" "$WIKI_LAUNCHER" || {
  echo "FAIL: wiki launcher does not prime clipboard with display launcher"
  exit 1
}

echo "PASS"
