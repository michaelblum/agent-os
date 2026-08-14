#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-request-client-autostart-disabled"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
export AOS_DISABLE_DAEMON_AUTOSTART=1
TELL_STDOUT="$ROOT/tell.stdout"
TELL_STDERR="$ROOT/tell.stderr"
FOCUS_STDOUT="$ROOT/focus.stdout"
FOCUS_STDERR="$ROOT/focus.stderr"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

if ./aos tell --who >"$TELL_STDOUT" 2>"$TELL_STDERR"; then
  echo "FAIL: request client unexpectedly succeeded with daemon auto-start disabled"
  exit 1
fi

sleep 0.5
if [[ -e "$(aos_test_socket_path "$ROOT")" ]] || aos_test_socket_reachable "$ROOT"; then
  echo "FAIL: disabled auto-start still created an isolated daemon socket"
  exit 1
fi

if ! grep -q "AOS_DISABLE_DAEMON_AUTOSTART" "$TELL_STDERR"; then
  echo "FAIL: disabled auto-start diagnostic did not mention AOS_DISABLE_DAEMON_AUTOSTART"
  cat "$TELL_STDERR"
  exit 1
fi

if ./aos focus create --id no-autostart --window 1 \
  >"$FOCUS_STDOUT" \
  2>"$FOCUS_STDERR"; then
  echo "FAIL: focus unexpectedly succeeded with daemon auto-start disabled"
  exit 1
fi

sleep 0.5
if [[ -e "$(aos_test_socket_path "$ROOT")" ]] || aos_test_socket_reachable "$ROOT"; then
  echo "FAIL: disabled focus auto-start still created an isolated daemon socket"
  exit 1
fi

if ! grep -q "AOS_DISABLE_DAEMON_AUTOSTART" "$FOCUS_STDERR"; then
  echo "FAIL: disabled focus auto-start diagnostic did not mention AOS_DISABLE_DAEMON_AUTOSTART"
  cat "$FOCUS_STDERR"
  exit 1
fi

echo "PASS"
