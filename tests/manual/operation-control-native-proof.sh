#!/bin/zsh
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-}"
DRIVER="$ROOT/tests/manual/operation-control-native-proof.mjs"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-operation-control-native-proof.XXXXXX")"
SUMMARY_PATH="$TMP_ROOT/summary.json"
RUNTIME_REVISION="$(git -C "$ROOT" rev-parse HEAD)"
STATUS=1
LOCK_DIR="/private/tmp/aos-operation-control-native-proof.${UID}.lock"
LOCK_HELD=0
DRIVER_PID=0
INTERRUPTION_SIGNAL=""
FINALIZING_SUCCESS=0

cleanup_root() {
  if [[ -d "$TMP_ROOT" ]]; then
    rm -rf "$TMP_ROOT"
  fi
}

release_lock() {
  if (( LOCK_HELD == 1 )) && [[ -d "$LOCK_DIR" && ! -L "$LOCK_DIR" ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
  LOCK_HELD=0
}

retain_content_free_summary() {
  cleanup_root || return 1
  mkdir -m 700 "$TMP_ROOT" || return 1
  if [[ "$MODE" == "--self-test" \
    && "${AOS_OPERATION_CONTROL_NATIVE_PROOF_TEST_RETENTION_RACE:-0}" == "1" ]]; then
    /usr/bin/env node -e '
      const fs = require("node:fs");
      const fd = fs.openSync(process.argv[1], "wx", 0o600);
      try { fs.writeFileSync(fd, "race-sentinel\n"); } finally { fs.closeSync(fd); }
    ' "$SUMMARY_PATH" || return 1
  fi
  /usr/bin/env node -e '
    const fs = require("node:fs");
    const [summaryPath, summary] = process.argv.slice(1);
    const fd = fs.openSync(summaryPath, "wx", 0o600);
    try {
      fs.writeFileSync(fd, `${summary}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  ' "$SUMMARY_PATH" "$SUMMARY" || return 1
  [[ "$(find "$TMP_ROOT" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" == "1" ]] \
    && [[ -f "$SUMMARY_PATH" && ! -L "$SUMMARY_PATH" ]] \
    && [[ "$(stat -f '%Lp' "$SUMMARY_PATH")" == "600" ]]
}

forward_signal() {
  local signal="$1"
  [[ -n "$INTERRUPTION_SIGNAL" ]] || INTERRUPTION_SIGNAL="$signal"
  if (( DRIVER_PID > 0 )) && kill -0 "$DRIVER_PID" 2>/dev/null; then
    kill -s "$signal" "$DRIVER_PID" 2>/dev/null || true
  elif (( FINALIZING_SUCCESS == 1 )); then
    exit 1
  fi
}

maybe_inject_offline_signal() {
  local phase="$1"
  if [[ "$MODE" == "--self-test" \
    && "${AOS_OPERATION_CONTROL_NATIVE_PROOF_TEST_SIGNAL_PHASE:-}" == "$phase" ]]; then
    kill -TERM "$$"
  fi
}

run_driver() {
  if [[ -n "$INTERRUPTION_SIGNAL" ]]; then
    STATUS=1
    return 1
  fi
  /usr/bin/env node "$@" &
  DRIVER_PID="$!"
  if [[ -n "$INTERRUPTION_SIGNAL" ]]; then
    kill -s "$INTERRUPTION_SIGNAL" "$DRIVER_PID" 2>/dev/null || true
  fi
  maybe_inject_offline_signal inflight
  local wait_status=1
  while true; do
    wait "$DRIVER_PID"
    wait_status="$?"
    if ! kill -0 "$DRIVER_PID" 2>/dev/null; then
      break
    fi
  done
  DRIVER_PID=0
  if [[ -n "$INTERRUPTION_SIGNAL" ]]; then
    STATUS=1
  else
    STATUS="$wait_status"
  fi
}

trap release_lock EXIT
trap 'forward_signal HUP' HUP
trap 'forward_signal INT' INT
trap 'forward_signal TERM' TERM

fail_admission() {
  print -u2 -- "$1"
  cleanup_root
  exit 2
}

[[ "$RUNTIME_REVISION" =~ '^[0-9a-f]{40}$' ]] \
  || fail_admission "operation-control native proof could not resolve the source revision"
[[ -d "$TMP_ROOT" && ! -L "$TMP_ROOT" ]] \
  || fail_admission "operation-control native proof could not create a private root"
[[ "$(stat -f '%Lp' "$TMP_ROOT")" == "700" ]] \
  || fail_admission "operation-control native proof root is not owner-only"

case "$MODE" in
  --self-test)
    maybe_inject_offline_signal prelaunch
    if [[ -n "$INTERRUPTION_SIGNAL" ]]; then
      cleanup_root
      exit 1
    fi
    set +e
    run_driver "$DRIVER" \
      --supervise \
      --mode self-test \
      --aos "$TMP_ROOT/unavailable-aos" \
      --root "$ROOT" \
      --temp-root "$TMP_ROOT" \
      --runtime-revision "$RUNTIME_REVISION" \
      --summary "$SUMMARY_PATH"
    set -e
    ;;
  --run)
    [[ -z "${AOS_OPERATION_CONTROL_NATIVE_PROOF_TEST_SIGNAL_PHASE:-}" \
      && -z "${AOS_OPERATION_CONTROL_NATIVE_PROOF_TEST_RETENTION_RACE:-}" ]] \
      || fail_admission "refusing live operation proof with an offline test seam"
    [[ "${AOS_OPERATION_CONTROL_NATIVE_PROOF_OK:-0}" == "1" ]] \
      || fail_admission "refusing live operation proof without AOS_OPERATION_CONTROL_NATIVE_PROOF_OK=1"
    [[ "${AOS_OPERATION_CONTROL_SAFE_CHECKPOINT:-}" == "parked-and-verified" ]] \
      || fail_admission "refusing live operation proof without the parked-and-verified checkpoint"
    for key in AOS_STATE_ROOT AOS_RUNTIME_MODE AOS_PATH AOS_SOCKET_PATH \
      AOS_BYPASS_PERMISSIONS_SETUP AOS_TEST_ASSUME_PERMISSIONS_GRANTED; do
      (( ${+parameters[$key]} == 0 )) \
        || fail_admission "refusing live operation proof with an ambient AOS runtime override"
    done
    mkdir "$LOCK_DIR" 2>/dev/null \
      || fail_admission "another operation-control native proof may already be running"
    LOCK_HELD=1
    export AOS_OPERATION_CONTROL_PROOF_LOCK_DIR="$LOCK_DIR"
    [[ -f "$ROOT/aos" && ! -L "$ROOT/aos" && -x "$ROOT/aos" ]] \
      || fail_admission "repo AOS binary is unavailable or not a regular executable"
    git -C "$ROOT" diff --quiet \
      || fail_admission "tracked worktree changes must be committed before live proof"
    git -C "$ROOT" diff --cached --quiet \
      || fail_admission "staged changes must be committed before live proof"
    export AOS_DISABLE_DAEMON_AUTOSTART=1
    export AOS_ALLOW_DAEMON_AUTOSTART=0
    set +e
    run_driver "$DRIVER" \
      --supervise \
      --mode run \
      --aos "$ROOT/aos" \
      --root "$ROOT" \
      --temp-root "$TMP_ROOT" \
      --runtime-revision "$RUNTIME_REVISION" \
      --summary "$SUMMARY_PATH"
    set -e
    ;;
  *)
    fail_admission "usage: tests/manual/operation-control-native-proof.sh --self-test|--run"
    ;;
esac

maybe_inject_offline_signal postdriver

[[ -f "$SUMMARY_PATH" && ! -L "$SUMMARY_PATH" ]] \
  || fail_admission "operation-control native proof did not publish a summary"
SUMMARY="$(<"$SUMMARY_PATH")"
FINALIZING_SUCCESS=1

if [[ -n "$INTERRUPTION_SIGNAL" ]]; then
  STATUS=1
  SUMMARY="$(/usr/bin/env node -e '
    const value = JSON.parse(process.argv[1]);
    value.status = "failed";
    value.failure_code = `PROOF_INTERRUPTED_${process.argv[2]}`;
    value.final.cleanup_complete = false;
    value.final.recovery_root_retained = true;
    process.stdout.write(JSON.stringify(value));
  ' "$SUMMARY" "$INTERRUPTION_SIGNAL")"
fi

if [[ "$STATUS" == "0" ]]; then
  if cleanup_root && [[ ! -e "$TMP_ROOT" ]]; then
    maybe_inject_offline_signal prepublish
    print -r -- "$SUMMARY"
    exit "$STATUS"
  fi
  SUMMARY="$(/usr/bin/env node -e '
    const value = JSON.parse(process.argv[1]);
    value.status = "failed";
    value.failure_code = "PROOF_ROOT_CLEANUP_FAILED";
    value.final.cleanup_complete = false;
    value.final.recovery_root_retained = true;
    process.stdout.write(JSON.stringify(value));
  ' "$SUMMARY")"
  print -r -- "$SUMMARY"
  exit 1
fi

if ! retain_content_free_summary; then
  cleanup_root || true
  print -u2 -- "operation-control native proof could not retain a content-free recovery summary"
  print -r -- "$SUMMARY"
  exit 1
fi
print -u2 -- "operation-control native proof retained a content-free private recovery summary after a failed or ambiguous run"
print -r -- "$SUMMARY"
exit "$STATUS"
