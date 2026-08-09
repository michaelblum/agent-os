#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/tests/manual/exact-focus-channel-native-proof.swift"
DRIVER="$ROOT/tests/manual/exact-focus-channel-native-proof.mjs"
MODE="${1:-}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-exact-focus-native-proof.XXXXXX")"
BINARY="$TMP_ROOT/exact-focus-channel-native-proof"
SUPERVISOR_PID=""
GROUP_PID_FILE="$TMP_ROOT/active-process-group.pid"
LIVE_CLEANUP_ARMED=0
CHANNEL_ID="aos-exact-native-${TMP_ROOT##*.}"
NEGATIVE_CHANNEL_ID="${CHANNEL_ID}-negative"
FIXTURE_PID_FILE="$TMP_ROOT/fixture.pid"
DAEMON_IDENTITY_FILE="$TMP_ROOT/daemon-identity.json"
DRIVER_STDOUT="$TMP_ROOT/driver.stdout"
DRIVER_STDERR="$TMP_ROOT/driver.stderr"
RECOVERY_ROOT_RETAINED=0
POST_CLEANUP_PIXELS_PERSISTED=0
SELFTEST_UNRELATED_GROUP_PID=""
SELFTEST_UNRELATED_GROUP_TOKEN=""

pause_hundredths() {
  zmodload zsh/zselect
  zselect -t "$1" || true
}

stop_owned_pid() {
  local pid="$1"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null || true
  local attempt=0
  while kill -0 "$pid" 2>/dev/null && (( attempt < 8 )); do
    pause_hundredths 5
    (( attempt += 1 ))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  attempt=0
  while kill -0 "$pid" 2>/dev/null && (( attempt < 20 )); do
    pause_hundredths 2
    (( attempt += 1 ))
  done
  wait "$pid" 2>/dev/null || true
  ! kill -0 "$pid" 2>/dev/null
}

active_group_pid() {
  [[ -f "$GROUP_PID_FILE" ]] || return 1
  local pgid token
  read -r pgid token < "$GROUP_PID_FILE" || return 2
  [[ "$pgid" == <-> ]] || return 2
  [[ "$token" =~ '^[0-9a-f]{32}$' ]] || return 2
  local actual_pgid command
  actual_pgid="$(ps -p "$pgid" -o pgid= 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ -n "$actual_pgid" && "$actual_pgid" != "$pgid" ]]; then
    return 2
  fi
  if [[ -z "$actual_pgid" ]]; then
    if ! /bin/kill -0 -"$pgid" 2>/dev/null; then
      rm -f "$GROUP_PID_FILE"
      return 1
    fi
    return 2
  fi
  command="$(ps -ww -p "$pgid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"$DRIVER --owned-group-wrapper --ownership-token $token --"* ]] || return 2
  print -r -- "$pgid"
}

group_exists() {
  local pgid="$1"
  /bin/kill -0 -"$pgid" 2>/dev/null
}

stop_owned_group() {
  [[ -f "$GROUP_PID_FILE" ]] || return 0
  local pgid group_lookup_status=0
  pgid="$(active_group_pid 2>/dev/null)" || group_lookup_status="$?"
  if (( group_lookup_status == 1 )) && [[ ! -e "$GROUP_PID_FILE" ]]; then
    return 0
  fi
  (( group_lookup_status == 0 )) || return 1
  /bin/kill -TERM -"$pgid" 2>/dev/null || true
  local attempt=0
  while group_exists "$pgid" && (( attempt < 80 )); do
    pause_hundredths 5
    (( attempt += 1 ))
  done
  if group_exists "$pgid"; then
    /bin/kill -KILL -"$pgid" 2>/dev/null || true
  fi
  attempt=0
  while group_exists "$pgid" && (( attempt < 60 )); do
    pause_hundredths 2
    (( attempt += 1 ))
  done
  if group_exists "$pgid"; then
    return 1
  fi
  rm -f "$GROUP_PID_FILE"
}

stop_selftest_unrelated_group() {
  local pid="$SELFTEST_UNRELATED_GROUP_PID"
  local token="$SELFTEST_UNRELATED_GROUP_TOKEN"
  [[ "$pid" == <-> ]] || return 0
  if ! kill -0 "$pid" 2>/dev/null; then
    SELFTEST_UNRELATED_GROUP_PID=""
    SELFTEST_UNRELATED_GROUP_TOKEN=""
    return 0
  fi
  local actual_pgid command
  actual_pgid="$(ps -p "$pid" -o pgid= 2>/dev/null | tr -d '[:space:]' || true)"
  command="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$actual_pgid" == "$pid" ]] || return 1
  [[ "$command" == *"--ownership-token $token"* ]] || return 1
  /bin/kill -TERM -"$pid" 2>/dev/null || true
  local attempt=0
  while /bin/kill -0 -"$pid" 2>/dev/null && (( attempt < 40 )); do
    pause_hundredths 2
    (( attempt += 1 ))
  done
  if /bin/kill -0 -"$pid" 2>/dev/null; then
    /bin/kill -KILL -"$pid" 2>/dev/null || true
  fi
  attempt=0
  while /bin/kill -0 -"$pid" 2>/dev/null && (( attempt < 60 )); do
    pause_hundredths 2
    (( attempt += 1 ))
  done
  if /bin/kill -0 -"$pid" 2>/dev/null; then
    return 1
  fi
  SELFTEST_UNRELATED_GROUP_PID=""
  SELFTEST_UNRELATED_GROUP_TOKEN=""
}

stop_owned_fixture() {
  [[ -f "$FIXTURE_PID_FILE" ]] || return 0
  local pid token
  read -r pid token < "$FIXTURE_PID_FILE" || return 1
  [[ "$pid" == <-> ]] || return 1
  [[ "$token" =~ '^[0-9a-f]{32}$' ]] || return 1
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  local command
  command="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == "$BINARY"* ]] || return 1
  [[ "$command" == *"--ownership-token $token"* ]] || return 1
  stop_owned_pid "$pid"
}

run_supervised_to_files() {
  local timeout_ms="$1"
  local stdout_file="$2"
  local stderr_file="$3"
  shift 3
  [[ ! -e "$GROUP_PID_FILE" ]] || return 125
  AOS_DISABLE_DAEMON_AUTOSTART=1 \
  AOS_ALLOW_DAEMON_AUTOSTART=0 \
    /usr/bin/env node "$DRIVER" \
      --supervise-command \
      --owner-pid "$$" \
      --group-pid-file "$GROUP_PID_FILE" \
      --timeout-ms "$timeout_ms" \
      -- "$@" \
      >"$stdout_file" 2>"$stderr_file" &
  SUPERVISOR_PID="$!"
  local child_status=0
  wait "$SUPERVISOR_PID" || child_status="$?"
  SUPERVISOR_PID=""
  stop_owned_group || return 125
  [[ ! -e "$GROUP_PID_FILE" ]] || return 125
  return "$child_status"
}

stop_supervisor() {
  local pid="$1"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null || true
  local attempt=0
  while kill -0 "$pid" 2>/dev/null && (( attempt < 120 )); do
    pause_hundredths 5
    (( attempt += 1 ))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  attempt=0
  while kill -0 "$pid" 2>/dev/null && (( attempt < 60 )); do
    pause_hundredths 2
    (( attempt += 1 ))
  done
  wait "$pid" 2>/dev/null || true
  ! kill -0 "$pid" 2>/dev/null
}

quiesce_owned_execution() {
  stop_owned_group || true
  stop_supervisor "$SUPERVISOR_PID" || true
  stop_owned_group || true
  local failed=0
  if [[ -n "$SUPERVISOR_PID" ]] && kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
    failed=1
  fi
  if [[ -e "$GROUP_PID_FILE" ]]; then
    failed=1
  fi
  SUPERVISOR_PID=""
  (( failed == 0 ))
}

run_driver_with_deadline() {
  local timeout_ms="$1"
  shift
  run_supervised_to_files "$timeout_ms" "$DRIVER_STDOUT" "$DRIVER_STDERR" "$@"
}

run_channel_cleanup() {
  [[ -f "$DAEMON_IDENTITY_FILE" ]] || return 1
  local cleanup_stdout="$TMP_ROOT/cleanup.stdout"
  local cleanup_stderr="$TMP_ROOT/cleanup.stderr"
  run_supervised_to_files 20000 "$cleanup_stdout" "$cleanup_stderr" \
    /usr/bin/env node "$DRIVER" \
      --cleanup-only \
      --aos "$ROOT/aos" \
      --root "$ROOT" \
      --channel "$CHANNEL_ID" \
      --negative-channel "$NEGATIVE_CHANNEL_ID" \
      --identity "$DAEMON_IDENTITY_FILE" \
      --unrelated-digests "$TMP_ROOT/unrelated-channel-digests.json"
}

cleanup() {
  trap - EXIT INT TERM
  local cleanup_failed=0
  stop_selftest_unrelated_group || cleanup_failed=1
  local execution_quiescent=0
  if quiesce_owned_execution; then
    execution_quiescent=1
  else
    cleanup_failed=1
  fi

  if (( execution_quiescent == 1 )); then
    rm -f \
      "$TMP_ROOT/exact-window.png" \
      "$TMP_ROOT/preserved-window.png" \
      "$TMP_ROOT/missing-window.png" || cleanup_failed=1
    if [[ -e "$TMP_ROOT/exact-window.png" || -e "$TMP_ROOT/preserved-window.png" || -e "$TMP_ROOT/missing-window.png" ]]; then
      POST_CLEANUP_PIXELS_PERSISTED=1
      cleanup_failed=1
    fi

    if (( LIVE_CLEANUP_ARMED == 1 )) && [[ -f "$TMP_ROOT/channel-cleanup-armed" ]] && [[ -x "$ROOT/aos" ]]; then
      if run_channel_cleanup; then
        rm -f "$TMP_ROOT/channel-cleanup-armed" || cleanup_failed=1
      else
        cleanup_failed=1
      fi
    fi

    stop_owned_fixture || cleanup_failed=1
  else
    POST_CLEANUP_PIXELS_PERSISTED=1
  fi

  if (( cleanup_failed == 1 )); then
    RECOVERY_ROOT_RETAINED=1
    print -u2 -- "native proof cleanup is incomplete; retained recovery root: $TMP_ROOT"
  else
    if ! rm -rf "$TMP_ROOT"; then
      cleanup_failed=1
      RECOVERY_ROOT_RETAINED=1
      print -u2 -- "native proof cleanup is incomplete; retained recovery root: $TMP_ROOT"
    fi
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

compile_helper() {
  local compile_stdout="$TMP_ROOT/compile.stdout"
  local compile_stderr="$TMP_ROOT/compile.stderr"
  local compile_status=0
  run_supervised_to_files 30000 "$compile_stdout" "$compile_stderr" \
    swiftc \
    -parse-as-library \
    -module-cache-path "$TMP_ROOT/module-cache" \
    -framework AppKit \
    -framework ImageIO \
    "$SOURCE" \
    -o "$BINARY" || compile_status="$?"
  if (( compile_status != 0 )); then
    [[ ! -s "$compile_stdout" ]] || cat "$compile_stdout"
    [[ ! -s "$compile_stderr" ]] || cat "$compile_stderr" >&2
    return "$compile_status"
  fi
}

typed_failure_summary() {
  local status="$1"
  if (( status == 124 )); then
    print -r -- '{"cleanup_complete":false,"error_code":"PROOF_TIMEOUT","microphone_requested":false,"pixels_persisted":false,"raw_capture_logged":false,"status":"failed"}'
  else
    print -r -- '{"cleanup_complete":false,"error_code":"NATIVE_PROOF_FAILED","microphone_requested":false,"pixels_persisted":false,"raw_capture_logged":false,"status":"failed"}'
  fi
}

validated_summary() {
  local candidate="$1"
  /usr/bin/env node -e '
    try {
      const value = JSON.parse(process.argv[1]);
      if (!value || typeof value !== "object" || Array.isArray(value)) process.exit(1);
      if (value.status !== "passed" && value.status !== "failed") process.exit(1);
      process.stdout.write(JSON.stringify(value));
    } catch {
      process.exit(1);
    }
  ' "$candidate"
}

apply_post_cleanup_outcome() {
  SUMMARY="$(/usr/bin/env node -e '
    const summary = JSON.parse(process.argv[1]);
    const pixelsPersisted = process.argv[2] === "1";
    const recoveryRootRetained = process.argv[3] === "1";
    const commandStatus = Number(process.argv[4]);
    summary.pixels_persisted = pixelsPersisted;
    summary.recovery_root_retained = recoveryRootRetained;
    if (pixelsPersisted || recoveryRootRetained) {
      summary.status = "failed";
      summary.error_code = "POSTFLIGHT_CLEANUP_INCOMPLETE";
      summary.cleanup_complete = false;
    } else if (commandStatus !== 0) {
      const supervisorCodes = new Map([
        [124, "PROOF_TIMEOUT"],
        [125, "PROOF_SUPERVISION_FAILED"],
        [130, "PROOF_INTERRUPTED"],
        [143, "PROOF_TERMINATED"],
      ]);
      if (summary.status === "passed" || typeof summary.error_code !== "string") {
        summary.error_code = supervisorCodes.get(commandStatus) || "NATIVE_PROOF_FAILED";
      }
      summary.status = "failed";
    }
    process.stdout.write(JSON.stringify(summary));
  ' "$SUMMARY" "$POST_CLEANUP_PIXELS_PERSISTED" "$RECOVERY_ROOT_RETAINED" "$STATUS")"
  SUMMARY_STATUS="$(/usr/bin/env node -e '
    const summary = JSON.parse(process.argv[1]);
    process.stdout.write(summary.status === "passed" ? "passed" : "failed");
  ' "$SUMMARY")"
  if [[ "$SUMMARY_STATUS" == "failed" ]] && (( STATUS == 0 )); then
    STATUS=1
  fi
}

revision_is_valid() {
  [[ "$1" =~ '^[0-9a-f]{40}$' ]]
}

generate_snapshot_key() {
  /usr/bin/env node -e '
    const { randomBytes } = require("node:crypto");
    process.stdout.write(randomBytes(32).toString("hex"));
  '
}

case "$MODE" in
  --typecheck)
    TYPECHECK_STDOUT="$TMP_ROOT/typecheck.stdout"
    TYPECHECK_STDERR="$TMP_ROOT/typecheck.stderr"
    TYPECHECK_STATUS=0
    run_supervised_to_files 30000 "$TYPECHECK_STDOUT" "$TYPECHECK_STDERR" \
      swiftc \
        -typecheck \
        -parse-as-library \
        -module-cache-path "$TMP_ROOT/module-cache" \
        -framework AppKit \
        -framework ImageIO \
        "$SOURCE" || TYPECHECK_STATUS="$?"
    [[ ! -s "$TYPECHECK_STDOUT" ]] || cat "$TYPECHECK_STDOUT"
    [[ ! -s "$TYPECHECK_STDERR" ]] || cat "$TYPECHECK_STDERR" >&2
    exit "$TYPECHECK_STATUS"
    ;;
  --analyzer-self-test)
    compile_helper
    ANALYZER_STDOUT="$TMP_ROOT/analyzer.stdout"
    ANALYZER_STDERR="$TMP_ROOT/analyzer.stderr"
    ANALYZER_STATUS=0
    run_supervised_to_files 10000 "$ANALYZER_STDOUT" "$ANALYZER_STDERR" \
      "$BINARY" --analyzer-self-test || ANALYZER_STATUS="$?"
    [[ ! -s "$ANALYZER_STDOUT" ]] || cat "$ANALYZER_STDOUT"
    [[ ! -s "$ANALYZER_STDERR" ]] || cat "$ANALYZER_STDERR" >&2
    exit "$ANALYZER_STATUS"
    ;;
  --run)
    if [[ "${AOS_EXACT_FOCUS_CHANNEL_NATIVE_PROOF_OK:-0}" != "1" ]]; then
      print -u2 "refusing live focus/capture proof without AOS_EXACT_FOCUS_CHANNEL_NATIVE_PROOF_OK=1"
      exit 2
    fi
    if [[ ! -x "$ROOT/aos" ]]; then
      print -u2 "repo AOS binary is unavailable"
      exit 2
    fi
    export AOS_EXACT_FOCUS_CHANNEL_SNAPSHOT_KEY="$(generate_snapshot_key)"
    if [[ ! "$AOS_EXACT_FOCUS_CHANNEL_SNAPSHOT_KEY" =~ '^[0-9a-f]{64}$' ]]; then
      print -u2 "could not create the ephemeral channel-snapshot key"
      exit 2
    fi
    local_revision="$(git -C "$ROOT" rev-parse HEAD)"
    if ! revision_is_valid "$local_revision"; then
      print -u2 "runtime source revision is unavailable"
      exit 2
    fi
    compile_helper
    LIVE_CLEANUP_ARMED=1
    set +e
    run_driver_with_deadline 45000 \
      /usr/bin/env node "$DRIVER" \
      --aos "$ROOT/aos" \
      --helper "$BINARY" \
      --root "$ROOT" \
      --temp-root "$TMP_ROOT" \
      --channel "$CHANNEL_ID" \
      --runtime-source-revision "$local_revision"
    STATUS="$?"
    set -e
    SUMMARY="$(tail -n 1 "$DRIVER_STDOUT" 2>/dev/null || true)"
    if [[ -z "$SUMMARY" ]] || ! SUMMARY="$(validated_summary "$SUMMARY")"; then
      SUMMARY="$(typed_failure_summary "$STATUS")"
    fi
    cleanup
    apply_post_cleanup_outcome
    unset AOS_EXACT_FOCUS_CHANNEL_SNAPSHOT_KEY
    print -r -- "$SUMMARY"
    exit "$STATUS"
    ;;
  --runner-preflight-self-test)
    if ! revision_is_valid "0123456789abcdef0123456789abcdef01234567"; then
      print -r -- '{"revision_preflight":false,"status":"failed"}'
      exit 1
    fi
    if revision_is_valid "not-a-revision"; then
      print -r -- '{"revision_preflight":false,"status":"failed"}'
      exit 1
    fi
    print -r -- '{"revision_preflight":true,"status":"passed"}'
    ;;
  --snapshot-key-self-test)
    SNAPSHOT_KEY_SELF_TEST_ONE="$(generate_snapshot_key)"
    SNAPSHOT_KEY_SELF_TEST_TWO="$(generate_snapshot_key)"
    if [[ ! "$SNAPSHOT_KEY_SELF_TEST_ONE" =~ '^[0-9a-f]{64}$' ]] \
      || [[ ! "$SNAPSHOT_KEY_SELF_TEST_TWO" =~ '^[0-9a-f]{64}$' ]] \
      || [[ "$SNAPSHOT_KEY_SELF_TEST_ONE" == "$SNAPSHOT_KEY_SELF_TEST_TWO" ]]; then
      print -r -- '{"ephemeral_snapshot_key":false,"status":"failed"}'
      exit 1
    fi
    print -r -- '{"ephemeral_snapshot_key":true,"status":"passed"}'
    ;;
  --timeout-self-test)
    set +e
    run_driver_with_deadline 50 /bin/sleep 10
    STATUS="$?"
    set -e
    if (( STATUS != 124 )); then
      print -r -- '{"owned_process_group_reaped":false,"status":"failed"}'
      exit 1
    fi
    print -r -- '{"owned_process_group_reaped":true,"status":"passed"}'
    ;;
  --process-tree-self-test)
    GRANDCHILD_PID_FILE="$TMP_ROOT/grandchild.pid"
    set +e
    run_driver_with_deadline 500 \
      /usr/bin/env node "$DRIVER" --hang-with-grandchild --pid-file "$GRANDCHILD_PID_FILE"
    STATUS="$?"
    set -e
    GRANDCHILD_PID="$(tr -d '[:space:]' < "$GRANDCHILD_PID_FILE" 2>/dev/null || true)"
    if (( STATUS != 124 )) || [[ "$GRANDCHILD_PID" != <-> ]] || kill -0 "$GRANDCHILD_PID" 2>/dev/null; then
      print -r -- '{"owned_descendant_reaped":false,"status":"failed"}'
      exit 1
    fi
    print -r -- '{"owned_descendant_reaped":true,"status":"passed"}'
    ;;
  --cleanup-self-test)
    /bin/zsh -c 'trap "" TERM; exec /bin/sleep 10' &
    OWNED_PID="$!"
    stop_owned_pid "$OWNED_PID"
    if kill -0 "$OWNED_PID" 2>/dev/null; then
      print -r -- '{"owned_child_reaped":false,"status":"failed"}'
      exit 1
    fi
    print -r -- '{"owned_child_reaped":true,"status":"passed"}'
    ;;
  --fixture-ownership-self-test)
    BINARY="/bin/zsh"
    TOKEN="0123456789abcdef0123456789abcdef"
    EMPTY_PADDING_SOURCE=""
    PADDING="${(l:4096::x:)EMPTY_PADDING_SOURCE}"
    /bin/zsh -c 'trap "" TERM; zmodload zsh/zselect; while true; do zselect -t 100 || true; done' \
      "$PADDING" --ownership-token "$TOKEN" &
    OWNED_PID="$!"
    print -r -- "$OWNED_PID $TOKEN" > "$FIXTURE_PID_FILE"
    if ! stop_owned_fixture || kill -0 "$OWNED_PID" 2>/dev/null; then
      print -r -- '{"long_argv_fixture_reaped":false,"status":"failed"}'
      exit 1
    fi
    print -r -- '{"long_argv_fixture_reaped":true,"status":"passed"}'
    ;;
  --pidfile-reuse-self-test)
    STALE_TOKEN="0123456789abcdef0123456789abcdef"
    print -r -- "999999 $STALE_TOKEN" > "$GROUP_PID_FILE"
    set +e
    run_driver_with_deadline 50 /bin/sleep 10
    STATUS="$?"
    set -e
    read -r RECORDED_PID RECORDED_TOKEN < "$GROUP_PID_FILE" || true
    if (( STATUS != 125 )) || [[ "$RECORDED_PID" != "999999" || "$RECORDED_TOKEN" != "$STALE_TOKEN" ]]; then
      print -r -- '{"live_unrelated_group_preserved":false,"unresolved_group_record_preserved":false,"status":"failed"}'
      exit 1
    fi
    rm -f "$GROUP_PID_FILE"

    SELFTEST_UNRELATED_GROUP_TOKEN="fedcba9876543210fedcba9876543210"
    SELFTEST_UNRELATED_GROUP_PID="$(/usr/bin/env node -e '
      const { spawn } = require("node:child_process");
      const token = process.argv[1];
      const child = spawn("/bin/zsh", [
        "-c",
        "trap \"\" TERM; zmodload zsh/zselect; while true; do zselect -t 100 || true; done",
        "aos-unrelated-group",
        "--ownership-token",
        token,
      ], { detached: true, stdio: "ignore" });
      child.once("error", () => process.exit(1));
      child.once("spawn", () => {
        process.stdout.write(String(child.pid));
        child.unref();
      });
    ' "$SELFTEST_UNRELATED_GROUP_TOKEN")"
    if [[ "$SELFTEST_UNRELATED_GROUP_PID" != <-> ]]; then
      print -r -- '{"live_unrelated_group_preserved":false,"unresolved_group_record_preserved":true,"status":"failed"}'
      exit 1
    fi
    print -r -- "$SELFTEST_UNRELATED_GROUP_PID $STALE_TOKEN" > "$GROUP_PID_FILE"
    set +e
    stop_owned_group
    OWNERSHIP_STATUS="$?"
    set -e
    read -r RECORDED_PID RECORDED_TOKEN < "$GROUP_PID_FILE" || true
    if (( OWNERSHIP_STATUS == 0 )) \
      || [[ "$RECORDED_PID" != "$SELFTEST_UNRELATED_GROUP_PID" || "$RECORDED_TOKEN" != "$STALE_TOKEN" ]] \
      || ! kill -0 "$SELFTEST_UNRELATED_GROUP_PID" 2>/dev/null; then
      rm -f "$GROUP_PID_FILE"
      stop_selftest_unrelated_group || true
      print -r -- '{"live_unrelated_group_preserved":false,"unresolved_group_record_preserved":true,"status":"failed"}'
      exit 1
    fi
    rm -f "$GROUP_PID_FILE"
    stop_selftest_unrelated_group
    print -r -- '{"live_unrelated_group_preserved":true,"unresolved_group_record_preserved":true,"status":"passed"}'
    ;;
  --postflight-cleanup-failure-self-test)
    SUMMARY='{"cleanup_complete":true,"pixels_persisted":false,"status":"passed"}'
    STATUS=0
    POST_CLEANUP_PIXELS_PERSISTED=0
    RECOVERY_ROOT_RETAINED=1
    apply_post_cleanup_outcome
    if (( STATUS != 1 )) || ! /usr/bin/env node -e '
      const summary = JSON.parse(process.argv[1]);
      if (summary.status !== "failed") process.exit(1);
      if (summary.error_code !== "POSTFLIGHT_CLEANUP_INCOMPLETE") process.exit(1);
      if (summary.cleanup_complete !== false) process.exit(1);
      if (summary.recovery_root_retained !== true) process.exit(1);
    ' "$SUMMARY"; then
      print -r -- '{"cleanup_failure_forced_failure":false,"status":"failed"}'
      exit 1
    fi

    SUMMARY='{"cleanup_complete":true,"status":"passed"}'
    STATUS=125
    POST_CLEANUP_PIXELS_PERSISTED=0
    RECOVERY_ROOT_RETAINED=0
    apply_post_cleanup_outcome
    if (( STATUS != 125 )) || ! /usr/bin/env node -e '
      const summary = JSON.parse(process.argv[1]);
      if (summary.status !== "failed") process.exit(1);
      if (summary.error_code !== "PROOF_SUPERVISION_FAILED") process.exit(1);
      if (summary.cleanup_complete !== true) process.exit(1);
    ' "$SUMMARY"; then
      print -r -- '{"cleanup_failure_forced_failure":false,"status":"failed"}'
      exit 1
    fi

    SUMMARY='{"cleanup_complete":false,"error_code":"NATIVE_PROOF_FAILED","status":"failed"}'
    STATUS=0
    apply_post_cleanup_outcome
    if (( STATUS != 1 )); then
      print -r -- '{"cleanup_failure_forced_failure":false,"status":"failed"}'
      exit 1
    fi
    print -r -- '{"cleanup_failure_forced_failure":true,"status":"passed"}'
    ;;
  *)
    print -u2 "usage: $0 --typecheck"
    print -u2 "       $0 --analyzer-self-test"
    print -u2 "       AOS_EXACT_FOCUS_CHANNEL_NATIVE_PROOF_OK=1 $0 --run"
    exit 2
    ;;
esac
