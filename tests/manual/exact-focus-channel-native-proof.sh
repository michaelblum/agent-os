#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/tests/manual/exact-focus-channel-native-proof.swift"
DRIVER="$ROOT/tests/manual/exact-focus-channel-native-proof.mjs"
MODE="${1:-}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-exact-focus-native-proof.XXXXXX")"
BINARY="$TMP_ROOT/exact-focus-channel-native-proof"
SUPERVISOR_PID=""
SUPERVISOR_READY_FILE=""
SUPERVISOR_SEQUENCE=0
SUPERVISOR_HANDSHAKE_FAILED=0
SUPERVISOR_SELFTEST_READY_DELAY_MS=0
SUPERVISOR_SELFTEST_PRE_RECORD_DELAY_MS=0
SUPERVISOR_SELFTEST_SIGNAL_PRE_RECORD=0
SUPERVISOR_SELFTEST_FINAL_REAP_DELAY_MS=0
SUPERVISOR_SELFTEST_SIGNAL_FINAL_REAP=0
SUPERVISOR_SELFTEST_DESCENDANT_PID_FILE=""
SUPERVISOR_SELFTEST_SIGNAL_SENDER_PID=""
SUPERVISOR_POST_SPAWN_FILE=""
SUPERVISOR_FINAL_REAP_FILE=""
SUPERVISOR_FINAL_REAP_COMPLETE_FILE=""
SUPERVISOR_SELFTEST_SIGNAL_RECEIPT_FILE=""
GROUP_PID_FILE="$TMP_ROOT/active-process-group.pid"
LIVE_CLEANUP_ARMED=0
COMMAND_ADMISSION_AMBIGUOUS=0
CHANNEL_ID="aos-exact-native-${TMP_ROOT##*.}"
NEGATIVE_CHANNEL_ID="${CHANNEL_ID}-negative"
FIXTURE_PID_FILE="$TMP_ROOT/fixture.pid"
DAEMON_IDENTITY_FILE="$TMP_ROOT/daemon-identity.json"
DRIVER_STDOUT="$TMP_ROOT/driver.stdout"
DRIVER_STDERR="$TMP_ROOT/driver.stderr"
PROGRESS_FILE="$TMP_ROOT/progress.json"
SANITIZED_PROGRESS_RECEIPT='{"progress_receipt_valid":false,"progress_ordinal":null,"last_started_stage":"unknown","last_completed_stage":"unknown","progress_elapsed_ms":null}'
PROGRESS_SANITIZER_EXTRA_ARGS=()
RECOVERY_ROOT_RETAINED=0
POST_CLEANUP_PIXELS_PERSISTED=0
SELFTEST_UNRELATED_GROUP_PID=""
SELFTEST_UNRELATED_GROUP_TOKEN=""
CLEANUP_HAS_RUN=0
typeset -r AOS_COMMAND_TIMEOUT_MS=10000
typeset -r CAPTURE_COMMAND_TIMEOUT_MS=30000
typeset -r LOCAL_COMMAND_TIMEOUT_MS=10000
typeset -r PROGRESS_SANITIZER_TIMEOUT_MS=2000
typeset -r SUPERVISOR_START_TIMEOUT_HUNDREDTHS=600
# The Node supervisor owns 4 seconds of TERM retirement plus 3 seconds of KILL
# verification. Ten seconds prevents the shell from preempting that reap.
typeset -r SUPERVISOR_STOP_TERM_GRACE_HUNDREDTHS=1000
typeset -r SUPERVISOR_STOP_POLL_HUNDREDTHS=5
# Exact branch count: strictFocusEntries is two status/service pairs around one
# focus list (5 AOS calls). For N present owned channels, every removal attempt
# can reach the settled third scan and still continue if a channel reappears:
# R(N) = 3 * (15 + N) = 45 + 3N.
typeset -r STRICT_FOCUS_ENTRIES_AOS_COMMANDS=5
typeset -r OWNED_CHANNEL_IDS_MAX=2
typeset -r CHANNEL_CLEANUP_MAX_ATTEMPTS=3
typeset -r CHANNEL_CLEANUP_STRICT_SCANS_PER_ATTEMPT=3
typeset -r CHANNEL_CLEANUP_R1_AOS_COMMANDS=$((
  CHANNEL_CLEANUP_MAX_ATTEMPTS
  * (CHANNEL_CLEANUP_STRICT_SCANS_PER_ATTEMPT * STRICT_FOCUS_ENTRIES_AOS_COMMANDS + 1)
))
typeset -r CHANNEL_CLEANUP_R2_AOS_COMMANDS=$((
  CHANNEL_CLEANUP_MAX_ATTEMPTS
  * (CHANNEL_CLEANUP_STRICT_SCANS_PER_ATTEMPT * STRICT_FOCUS_ENTRIES_AOS_COMMANDS
    + OWNED_CHANNEL_IDS_MAX)
))
typeset -r POST_CLEANUP_ATTESTATION_AOS_COMMANDS=9
# Exact standalone cleanup is R(2) + 9 = 60; the 60-call ceiling is exact.
typeset -r EXACT_CLEANUP_MAX_AOS_COMMANDS=$((
  CHANNEL_CLEANUP_R2_AOS_COMMANDS + POST_CLEANUP_ATTESTATION_AOS_COMMANDS
))
typeset -r CLEANUP_MAX_AOS_COMMANDS=60
# Exact worst late failure + catch is 38 + R(1) + R(1) + 9 = 143. Retain the
# stricter 149-call review ceiling and include eight local commands because a
# late catch can repeat the two git provenance helpers.
typeset -r LIVE_PRE_CLEANUP_AOS_COMMANDS=38
typeset -r EXACT_LIVE_FAILURE_CATCH_MAX_AOS_COMMANDS=$((
  LIVE_PRE_CLEANUP_AOS_COMMANDS
  + CHANNEL_CLEANUP_R1_AOS_COMMANDS
  + CHANNEL_CLEANUP_R1_AOS_COMMANDS
  + POST_CLEANUP_ATTESTATION_AOS_COMMANDS
))
typeset -r LIVE_MAX_NON_CAPTURE_AOS_COMMANDS=149
typeset -r LIVE_MAX_CAPTURE_COMMANDS=3
typeset -r LIVE_MAX_LOCAL_COMMANDS=8
typeset -r LIVE_EXPLICIT_WAIT_AND_TEARDOWN_MS=60000
typeset -r LIVE_PROOF_TIMEOUT_MS=$((
  LIVE_MAX_NON_CAPTURE_AOS_COMMANDS * AOS_COMMAND_TIMEOUT_MS
  + LIVE_MAX_CAPTURE_COMMANDS * CAPTURE_COMMAND_TIMEOUT_MS
  + LIVE_MAX_LOCAL_COMMANDS * LOCAL_COMMAND_TIMEOUT_MS
  + LIVE_EXPLICIT_WAIT_AND_TEARDOWN_MS
))
# Standalone cleanup uses its exact 60-call ceiling, two local helpers,
# and 30 seconds for settling, fixture teardown, and the bounded sanitizer.
typeset -r CLEANUP_MAX_LOCAL_COMMANDS=2
typeset -r CLEANUP_SETTLE_TEARDOWN_AND_SANITIZER_MS=30000
typeset -r CHANNEL_CLEANUP_TIMEOUT_MS=$((
  CLEANUP_MAX_AOS_COMMANDS * AOS_COMMAND_TIMEOUT_MS
  + CLEANUP_MAX_LOCAL_COMMANDS * LOCAL_COMMAND_TIMEOUT_MS
  + CLEANUP_SETTLE_TEARDOWN_AND_SANITIZER_MS
))
# Progress is validated independently but must never saturate below the outer
# 1,720,000ms supervisor deadline, including its failure/catch envelope.
typeset -r PROGRESS_RECEIPT_MAX_ELAPSED_MS=1800000

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

finish_selftest_supervisor_signal_sender() {
  [[ -n "$SUPERVISOR_SELFTEST_SIGNAL_SENDER_PID" ]] || return 0
  local sender_status=0
  wait "$SUPERVISOR_SELFTEST_SIGNAL_SENDER_PID" || sender_status="$?"
  SUPERVISOR_SELFTEST_SIGNAL_SENDER_PID=""
  (( sender_status == 0 ))
}

run_supervised_to_files() {
  local timeout_ms="$1"
  local stdout_file="$2"
  local stderr_file="$3"
  shift 3
  [[ ! -e "$GROUP_PID_FILE" && -z "$SUPERVISOR_PID" && -z "$SUPERVISOR_READY_FILE" ]] || return 125
  (( SUPERVISOR_SEQUENCE += 1 ))
  SUPERVISOR_READY_FILE="$TMP_ROOT/supervisor-ready-$SUPERVISOR_SEQUENCE"
  [[ ! -e "$SUPERVISOR_READY_FILE" ]] || {
    SUPERVISOR_HANDSHAKE_FAILED=1
    return 125
  }
  local supervisor_arguments=(
    --supervise-command
    --owner-pid "$$"
    --group-pid-file "$GROUP_PID_FILE"
    --ready-file "$SUPERVISOR_READY_FILE"
    --timeout-ms "$timeout_ms"
  )
  if (( SUPERVISOR_SELFTEST_READY_DELAY_MS > 0 )); then
    supervisor_arguments+=(--self-test-ready-delay-ms "$SUPERVISOR_SELFTEST_READY_DELAY_MS")
  fi
  if (( SUPERVISOR_SELFTEST_PRE_RECORD_DELAY_MS > 0 )); then
    SUPERVISOR_POST_SPAWN_FILE="$TMP_ROOT/supervisor-post-spawn-$SUPERVISOR_SEQUENCE"
    supervisor_arguments+=(
      --self-test-post-spawn-pre-record-delay-ms "$SUPERVISOR_SELFTEST_PRE_RECORD_DELAY_MS"
      --self-test-post-spawn-file "$SUPERVISOR_POST_SPAWN_FILE"
    )
  fi
  if (( SUPERVISOR_SELFTEST_FINAL_REAP_DELAY_MS > 0 )); then
    SUPERVISOR_FINAL_REAP_FILE="$TMP_ROOT/supervisor-final-reap-$SUPERVISOR_SEQUENCE"
    SUPERVISOR_FINAL_REAP_COMPLETE_FILE="$TMP_ROOT/supervisor-final-reap-complete-$SUPERVISOR_SEQUENCE"
    supervisor_arguments+=(
      --self-test-final-reap-delay-ms "$SUPERVISOR_SELFTEST_FINAL_REAP_DELAY_MS"
      --self-test-final-reap-file "$SUPERVISOR_FINAL_REAP_FILE"
      --self-test-final-reap-complete-file "$SUPERVISOR_FINAL_REAP_COMPLETE_FILE"
    )
  fi
  AOS_DISABLE_DAEMON_AUTOSTART=1 \
  AOS_ALLOW_DAEMON_AUTOSTART=0 \
    /usr/bin/env node "$DRIVER" \
      "${supervisor_arguments[@]}" \
      -- "$@" \
      >"$stdout_file" 2>"$stderr_file" &
  SUPERVISOR_PID="$!"
  local supervised_pid="$SUPERVISOR_PID"
  if (( SUPERVISOR_SELFTEST_SIGNAL_PRE_RECORD == 1 )); then
    /bin/zsh -c '
      zmodload zsh/zselect
      integer attempt=0
      while (( attempt < 400 )); do
        if [[ -f "$1" && -f "$2" ]]; then
          /bin/kill -TERM "$3" || exit 1
          zselect -t 5 || true
          /bin/kill -TERM "$3" || exit 1
          print -r -- sent-twice > "$4"
          chmod 600 "$4"
          exit 0
        fi
        zselect -t 1 || true
        (( attempt += 1 ))
      done
      exit 1
    ' pre-record-signal \
      "$SUPERVISOR_POST_SPAWN_FILE" \
      "$SUPERVISOR_SELFTEST_DESCENDANT_PID_FILE" \
      "$supervised_pid" \
      "$SUPERVISOR_SELFTEST_SIGNAL_RECEIPT_FILE" &
    SUPERVISOR_SELFTEST_SIGNAL_SENDER_PID="$!"
  elif (( SUPERVISOR_SELFTEST_SIGNAL_FINAL_REAP == 1 )); then
    /bin/zsh -c '
      zmodload zsh/zselect
      integer attempt=0
      while (( attempt < 400 )); do
        if [[ -f "$1" && -f "$2" ]]; then
          descendant_pid="$(tr -d "[:space:]" < "$2")"
          [[ "$descendant_pid" == <-> ]] || exit 1
          /bin/kill -0 "$descendant_pid" || exit 1
          /bin/kill -TERM "$3" || exit 1
          zselect -t 5 || true
          /bin/kill -TERM "$3" || exit 1
          zselect -t 5 || true
          /bin/kill -0 "$descendant_pid" || exit 1
          print -r -- descendant-live-after-two-terms-final-reap > "$4"
          chmod 600 "$4"
          exit 0
        fi
        zselect -t 1 || true
        (( attempt += 1 ))
      done
      exit 1
    ' final-reap-signal \
      "$SUPERVISOR_FINAL_REAP_FILE" \
      "$SUPERVISOR_SELFTEST_DESCENDANT_PID_FILE" \
      "$supervised_pid" \
      "$SUPERVISOR_SELFTEST_SIGNAL_RECEIPT_FILE" &
    SUPERVISOR_SELFTEST_SIGNAL_SENDER_PID="$!"
  fi
  local ready_attempt=0
  while [[ ! -e "$SUPERVISOR_READY_FILE" ]] \
    && kill -0 "$supervised_pid" 2>/dev/null \
    && (( ready_attempt < SUPERVISOR_START_TIMEOUT_HUNDREDTHS )); do
    pause_hundredths 1
    (( ready_attempt += 1 ))
  done
  local ready_pid=""
  local ready_mode=""
  local ready_size=""
  if [[ -f "$SUPERVISOR_READY_FILE" && ! -L "$SUPERVISOR_READY_FILE" ]]; then
    ready_mode="$(/usr/bin/stat -f '%Lp' "$SUPERVISOR_READY_FILE" 2>/dev/null || true)"
    ready_size="$(/usr/bin/stat -f '%z' "$SUPERVISOR_READY_FILE" 2>/dev/null || true)"
    ready_pid="$(<"$SUPERVISOR_READY_FILE")"
  fi
  if [[ "$ready_pid" != "$supervised_pid" \
    || "$ready_pid" != <-> \
    || "$ready_mode" != "600" \
    || "$ready_size" != <-> ]] \
    || (( ready_size < 2 || ready_size > 32 )); then
    SUPERVISOR_HANDSHAKE_FAILED=1
    stop_supervisor "$supervised_pid" || return 125
    stop_owned_group || return 125
    [[ ! -e "$GROUP_PID_FILE" ]] || return 125
    wait "$supervised_pid" 2>/dev/null || true
    finish_selftest_supervisor_signal_sender || SUPERVISOR_HANDSHAKE_FAILED=1
    SUPERVISOR_PID=""
    return 125
  fi
  local child_status=0
  local wait_status=0
  local wait_interruptions=0
  while true; do
    wait_status=0
    wait "$supervised_pid" || wait_status="$?"
    if ! kill -0 "$supervised_pid" 2>/dev/null; then
      child_status="$wait_status"
      break
    fi
    # A shell signal can interrupt wait even while cleanup has INT/TERM ignored.
    # Keep ownership until the bounded supervisor exits; repeated interruption
    # fails closed by stopping and reaping that exact supervisor.
    (( wait_interruptions += 1 ))
    if (( wait_interruptions >= 8 )); then
      stop_supervisor "$supervised_pid" || return 125
      child_status=125
      break
    fi
  done
  if kill -0 "$supervised_pid" 2>/dev/null; then
    stop_supervisor "$supervised_pid" || return 125
    child_status=125
  fi
  wait "$supervised_pid" 2>/dev/null || true
  stop_owned_group || return 125
  [[ ! -e "$GROUP_PID_FILE" ]] || return 125
  rm -f "$SUPERVISOR_READY_FILE" || return 125
  finish_selftest_supervisor_signal_sender || return 125
  SUPERVISOR_READY_FILE=""
  SUPERVISOR_POST_SPAWN_FILE=""
  SUPERVISOR_PID=""
  return "$child_status"
}

stop_supervisor() {
  local pid="$1"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null || true
  local attempt=0
  while kill -0 "$pid" 2>/dev/null \
    && (( attempt * SUPERVISOR_STOP_POLL_HUNDREDTHS < SUPERVISOR_STOP_TERM_GRACE_HUNDREDTHS )); do
    pause_hundredths "$SUPERVISOR_STOP_POLL_HUNDREDTHS"
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
  local sender_failed=0
  if [[ -n "$SUPERVISOR_SELFTEST_SIGNAL_SENDER_PID" ]]; then
    finish_selftest_supervisor_signal_sender || sender_failed=1
  fi
  stop_owned_group || true
  stop_supervisor "$SUPERVISOR_PID" || true
  stop_owned_group || true
  local failed="$sender_failed"
  if [[ -n "$SUPERVISOR_PID" ]] && kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
    failed=1
  fi
  if [[ -e "$GROUP_PID_FILE" ]]; then
    failed=1
  fi
  if (( failed == 0 )); then
    if [[ -n "$SUPERVISOR_READY_FILE" ]]; then
      rm -f "$SUPERVISOR_READY_FILE" || failed=1
    fi
  fi
  if (( failed == 0 )); then
    SUPERVISOR_READY_FILE=""
    SUPERVISOR_POST_SPAWN_FILE=""
    SUPERVISOR_PID=""
  fi
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
  run_supervised_to_files "$CHANNEL_CLEANUP_TIMEOUT_MS" "$cleanup_stdout" "$cleanup_stderr" \
    /usr/bin/env node "$DRIVER" \
      --cleanup-only \
      --aos "$ROOT/aos" \
      --root "$ROOT" \
      --channel "$CHANNEL_ID" \
      --negative-channel "$NEGATIVE_CHANNEL_ID" \
      --identity "$DAEMON_IDENTITY_FILE" \
      --unrelated-digests "$TMP_ROOT/unrelated-channel-digests.json"
}

capture_sanitized_progress() {
  local sanitizer_stdout="$TMP_ROOT/progress-sanitizer.stdout"
  local sanitizer_stderr="$TMP_ROOT/progress-sanitizer.stderr"
  local sanitizer_status=0
  local candidate_size=""
  SANITIZED_PROGRESS_RECEIPT='{"progress_receipt_valid":false,"progress_ordinal":null,"last_started_stage":"unknown","last_completed_stage":"unknown","progress_elapsed_ms":null}'
  run_supervised_to_files \
    "$PROGRESS_SANITIZER_TIMEOUT_MS" \
    "$sanitizer_stdout" \
    "$sanitizer_stderr" \
    /usr/bin/env node "$DRIVER" \
      --sanitize-progress-receipt \
      "${PROGRESS_SANITIZER_EXTRA_ARGS[@]}" \
      --path "$PROGRESS_FILE" || sanitizer_status="$?"
  # A sanitizer error or timeout is content-free unknown after its group was
  # reaped. An unresolved ownership record retains the root instead.
  [[ ! -e "$GROUP_PID_FILE" ]] || return 1
  [[ -z "$SUPERVISOR_PID" && -z "$SUPERVISOR_READY_FILE" ]] || return 1
  (( SUPERVISOR_HANDSHAKE_FAILED == 0 )) || return 1
  (( sanitizer_status == 0 )) || return 0
  [[ -f "$sanitizer_stdout" && ! -L "$sanitizer_stdout" ]] || return 0
  candidate_size="$(/usr/bin/stat -f '%z' "$sanitizer_stdout" 2>/dev/null || true)"
  [[ "$candidate_size" == <-> ]] || return 0
  (( candidate_size >= 1 && candidate_size <= 1024 )) || return 0
  local candidate="$(<"$sanitizer_stdout")"
  if [[ -n "$candidate" ]]; then
    SANITIZED_PROGRESS_RECEIPT="$candidate"
  fi
}

cleanup() {
  if (( CLEANUP_HAS_RUN == 1 )); then
    return 0
  fi
  CLEANUP_HAS_RUN=1
  trap - EXIT
  # Cleanup is a bounded critical section. INT/TERM remain ignored through the
  # final typed receipt so no second cleanup or partial root decision can race.
  trap '' INT TERM
  local cleanup_failed="$SUPERVISOR_HANDSHAKE_FAILED"
  stop_selftest_unrelated_group || cleanup_failed=1
  local execution_quiescent=0
  if quiesce_owned_execution; then
    execution_quiescent=1
  else
    cleanup_failed=1
  fi

  if (( execution_quiescent == 1 )); then
    # The receipt is untrusted until the sole owned writer and all of its
    # descendants are proven gone. The sanitizer emits only allowlisted fields.
    capture_sanitized_progress || cleanup_failed=1
    if (( ${+SUMMARY} == 1 )); then
      merge_sanitized_progress || cleanup_failed=1
    fi
    rm -f \
      "$TMP_ROOT/exact-window.png" \
      "$TMP_ROOT/preserved-window.png" \
      "$TMP_ROOT/missing-window.png" || cleanup_failed=1
    if [[ -e "$TMP_ROOT/exact-window.png" || -e "$TMP_ROOT/preserved-window.png" || -e "$TMP_ROOT/missing-window.png" ]]; then
      POST_CLEANUP_PIXELS_PERSISTED=1
      cleanup_failed=1
    fi

    if (( LIVE_CLEANUP_ARMED == 1 )) && [[ -f "$TMP_ROOT/channel-cleanup-armed" ]]; then
      if (( COMMAND_ADMISSION_AMBIGUOUS == 1 )); then
        # A delayed shared-daemon commit cannot be excluded. Preserve the exact
        # recovery marker and never race it with a compensating channel write.
        cleanup_failed=1
      elif [[ ! -x "$ROOT/aos" ]]; then
        cleanup_failed=1
      else
        if run_channel_cleanup; then
          rm -f "$TMP_ROOT/channel-cleanup-armed" || cleanup_failed=1
        else
          cleanup_failed=1
        fi
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
  local command_status="$1"
  if (( command_status == 124 )); then
    print -r -- '{"cleanup_complete":false,"command_admission_ambiguous":true,"command_error_code":null,"error_code":"PROOF_TIMEOUT","microphone_requested":false,"pixels_persisted":false,"raw_capture_logged":false,"status":"failed"}'
  else
    print -r -- '{"cleanup_complete":false,"command_admission_ambiguous":true,"command_error_code":null,"error_code":"NATIVE_PROOF_FAILED","microphone_requested":false,"pixels_persisted":false,"raw_capture_logged":false,"status":"failed"}'
  fi
}

validated_summary() {
  local candidate="$1"
  /usr/bin/env node -e '
    const commandErrorCodes = new Set([
      "CHANNEL_NOT_FOUND",
      "CHANNEL_STALE",
      "DAEMON_UNAVAILABLE",
      "DAEMON_UNREACHABLE",
      "DUPLICATE_ID",
      "INTERNAL",
      "INVALID_DEPTH",
      "NATIVE_AX_ROOT_MISMATCH",
      "WINDOW_NOT_FOUND",
    ]);
    try {
      const value = JSON.parse(process.argv[1]);
      if (!value || typeof value !== "object" || Array.isArray(value)) process.exit(1);
      if (value.status !== "passed" && value.status !== "failed") process.exit(1);
      if (typeof value.command_admission_ambiguous !== "boolean") process.exit(1);
      if (value.command_error_code !== null && !commandErrorCodes.has(value.command_error_code)) {
        process.exit(1);
      }
      if (
        value.status === "passed"
        && (value.command_admission_ambiguous !== false || value.command_error_code !== null)
      ) process.exit(1);
      process.stdout.write(JSON.stringify(value));
    } catch {
      process.exit(1);
    }
  ' "$candidate"
}

summary_admission_is_nonambiguous() {
  local candidate="$1"
  /usr/bin/env node -e '
    try {
      const value = JSON.parse(process.argv[1]);
      process.exit(value.command_admission_ambiguous === false ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "$candidate"
}

adopt_driver_summary() {
  local candidate="$1"
  local command_status="$2"
  local validated=""
  COMMAND_ADMISSION_AMBIGUOUS=1
  if [[ -n "$candidate" ]] && validated="$(validated_summary "$candidate")"; then
    SUMMARY="$validated"
    if summary_admission_is_nonambiguous "$SUMMARY"; then
      COMMAND_ADMISSION_AMBIGUOUS=0
    fi
  else
    SUMMARY="$(typed_failure_summary "$command_status")"
  fi
}

merge_sanitized_progress() {
  local merged
  if ! merged="$(/usr/bin/env node -e '
    const summary = JSON.parse(process.argv[1]);
    const maxProgressElapsedMs = Number(process.argv[3]);
    const unknownProgress = {
      progress_receipt_valid: false,
      progress_ordinal: null,
      last_started_stage: "unknown",
      last_completed_stage: "unknown",
      progress_elapsed_ms: null,
    };
    const stagesInOrder = [
      "runtime_preflight",
      "unrelated_channel_snapshot",
      "fixture_startup",
      "sibling_subtree_rejection",
      "target_channel_creation",
      "initial_capture",
      "rejected_refresh",
      "preserved_capture",
      "target_close",
      "missing_target_refresh",
      "missing_target_capture",
      "channel_cleanup",
      "fixture_cleanup",
      "postflight_attestation",
    ];
    let progress = unknownProgress;
    try {
      const candidate = JSON.parse(process.argv[2]);
      const exactKeys = [
        "last_completed_stage",
        "last_started_stage",
        "progress_elapsed_ms",
        "progress_ordinal",
        "progress_receipt_valid",
      ];
      const exactShape = candidate
        && typeof candidate === "object"
        && !Array.isArray(candidate)
        && JSON.stringify(Object.keys(candidate).sort()) === JSON.stringify(exactKeys);
      const ordinal = candidate?.progress_ordinal;
      const stageIndex = Number.isSafeInteger(ordinal) ? Math.floor((ordinal - 1) / 2) : -1;
      const expectedStage = stagesInOrder[stageIndex];
      const expectedCompletedStage = ordinal % 2 === 0
        ? expectedStage
        : (stageIndex === 0 ? null : stagesInOrder[stageIndex - 1]);
      const coherentTransition = Number.isSafeInteger(ordinal)
        && ordinal >= 1
        && ordinal <= stagesInOrder.length * 2
        && candidate.last_started_stage === expectedStage
        && candidate.last_completed_stage === expectedCompletedStage;
      const validReceipt = exactShape
        && candidate.progress_receipt_valid === true
        && coherentTransition
        && Number.isSafeInteger(candidate.progress_elapsed_ms)
        && candidate.progress_elapsed_ms >= 0
        && Number.isSafeInteger(maxProgressElapsedMs)
        && candidate.progress_elapsed_ms <= maxProgressElapsedMs;
      const unknownReceipt = exactShape
        && candidate.progress_receipt_valid === false
        && candidate.progress_ordinal === null
        && candidate.last_started_stage === "unknown"
        && candidate.last_completed_stage === "unknown"
        && candidate.progress_elapsed_ms === null;
      if (validReceipt || unknownReceipt) progress = candidate;
    } catch {}
    Object.assign(summary, {
      progress_receipt_valid: progress.progress_receipt_valid,
      last_started_stage: progress.last_started_stage,
      last_completed_stage: progress.last_completed_stage,
      progress_elapsed_ms: progress.progress_elapsed_ms,
    });
    process.stdout.write(JSON.stringify(summary));
  ' "$SUMMARY" "$SANITIZED_PROGRESS_RECEIPT" "$PROGRESS_RECEIPT_MAX_ELAPSED_MS" 2>/dev/null)"; then
    return 1
  fi
  SUMMARY="$merged"
}

apply_post_cleanup_outcome() {
  SUMMARY="$(/usr/bin/env node -e '
    const summary = JSON.parse(process.argv[1]);
    const pixelsPersisted = process.argv[2] === "1";
    const recoveryRootRetained = process.argv[3] === "1";
    const commandStatus = Number(process.argv[4]);
    if (typeof summary.progress_receipt_valid !== "boolean") {
      Object.assign(summary, {
        progress_receipt_valid: false,
        last_started_stage: "unknown",
        last_completed_stage: "unknown",
        progress_elapsed_ms: null,
      });
    }
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
      if (
        summary.status === "passed"
        || typeof summary.error_code !== "string"
        || summary.error_code === "NATIVE_PROOF_FAILED"
      ) {
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
    COMMAND_ADMISSION_AMBIGUOUS=1
    set +e
    run_driver_with_deadline "$LIVE_PROOF_TIMEOUT_MS" \
      /usr/bin/env node "$DRIVER" \
      --aos "$ROOT/aos" \
      --helper "$BINARY" \
      --root "$ROOT" \
      --temp-root "$TMP_ROOT" \
      --progress "$PROGRESS_FILE" \
      --channel "$CHANNEL_ID" \
      --runtime-source-revision "$local_revision"
    STATUS="$?"
    set -e
    SUMMARY="$(tail -n 1 "$DRIVER_STDOUT" 2>/dev/null || true)"
    adopt_driver_summary "$SUMMARY" "$STATUS"
    trap - EXIT
    trap '' INT TERM
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
    # Allow group and grandchild initialization under load while still forcing
    # the deliberately nonterminating tree through timeout cleanup.
    run_driver_with_deadline 1000 \
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
  --progress-timeout-self-test)
    GRANDCHILD_PID_FILE="$TMP_ROOT/progress-grandchild.pid"
    set +e
    # Give progress and grandchild initialization two seconds under load while
    # still forcing the deliberately nonterminating driver through cleanup.
    run_driver_with_deadline 2000 \
      /usr/bin/env node "$DRIVER" \
        --progress-hang-self-test \
        --progress "$PROGRESS_FILE" \
        --pid-file "$GRANDCHILD_PID_FILE"
    STATUS="$?"
    set -e
    GRANDCHILD_PID="$(tr -d '[:space:]' < "$GRANDCHILD_PID_FILE" 2>/dev/null || true)"
    if (( STATUS != 124 )) \
      || [[ "$GRANDCHILD_PID" != <-> ]] \
      || kill -0 "$GRANDCHILD_PID" 2>/dev/null \
      || [[ -e "$GROUP_PID_FILE" ]]; then
      print -r -- '{"cleanup_complete":false,"error_code":"PROGRESS_TIMEOUT_SELF_TEST_FAILED","status":"failed"}'
      exit 1
    fi
    SUMMARY='{"cleanup_complete":true,"error_code":"PROOF_TIMEOUT","microphone_requested":false,"pixels_persisted":false,"raw_capture_logged":false,"status":"failed"}'
    trap - EXIT
    trap '' INT TERM
    cleanup
    apply_post_cleanup_outcome
    if [[ -e "$TMP_ROOT" ]]; then
      print -r -- '{"cleanup_complete":false,"error_code":"PROGRESS_TIMEOUT_SELF_TEST_FAILED","status":"failed"}'
      exit 1
    fi
    print -r -- "$SUMMARY"
    exit "$STATUS"
    ;;
  --run-program-timeout-self-test)
    TIMEOUT_DESCENDANT_PID_FILE="$TMP_ROOT/run-program-timeout-descendant.pid"
    set +e
    run_driver_with_deadline 8000 \
      /usr/bin/env node "$DRIVER" \
        --run-program-timeout-self-test \
        --pid-file "$TIMEOUT_DESCENDANT_PID_FILE"
    COMMAND_STATUS="$?"
    set -e
    TIMEOUT_DESCENDANT_PID="$(tr -d '[:space:]' < "$TIMEOUT_DESCENDANT_PID_FILE" 2>/dev/null || true)"
    RAW_PROGRESS_SENTINEL='RAW_PROGRESS_SENTINEL_MUST_NOT_LEAK'
    if (( COMMAND_STATUS != 1 )) \
      || [[ "$TIMEOUT_DESCENDANT_PID" != <-> ]] \
      || kill -0 "$TIMEOUT_DESCENDANT_PID" 2>/dev/null \
      || [[ -e "$GROUP_PID_FILE" ]] \
      || grep -q -- "$RAW_PROGRESS_SENTINEL" "$DRIVER_STDOUT" "$DRIVER_STDERR" \
      || ! /usr/bin/env node -e '
        const receipt = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
        if (receipt.status !== "failed") process.exit(1);
        if (receipt.error_code !== "COMMAND_TIMEOUT") process.exit(1);
        if (receipt.admission_ambiguous !== true) process.exit(1);
        if (receipt.descendant_live_before_outer_reap !== true) process.exit(1);
      ' "$DRIVER_STDOUT"; then
      print -r -- '{"run_program_timeout_contract":false,"status":"failed"}'
      exit 1
    fi
    SUMMARY='{"cleanup_complete":true,"run_program_timeout_ambiguous":true,"timeout_descendant_reaped":true,"captured_output_reflected":false,"status":"passed"}'
    STATUS=0
    trap - EXIT
    trap '' INT TERM
    cleanup
    apply_post_cleanup_outcome
    if [[ -e "$TMP_ROOT" ]]; then
      print -r -- '{"run_program_timeout_contract":false,"status":"failed"}'
      exit 1
    fi
    print -r -- "$SUMMARY"
    ;;
  --progress-sanitizer-timeout-self-test)
    PROGRESS_SANITIZER_EXTRA_ARGS=(--self-test-delay-ms 5000)
    SUMMARY='{"cleanup_complete":true,"sanitizer_timeout_bounded":true,"status":"passed"}'
    STATUS=0
    trap - EXIT
    trap '' INT TERM
    cleanup
    apply_post_cleanup_outcome
    if [[ -e "$TMP_ROOT" ]] || ! /usr/bin/env node -e '
      const receipt = JSON.parse(process.argv[1]);
      if (receipt.progress_receipt_valid !== false) process.exit(1);
      if (receipt.last_started_stage !== "unknown") process.exit(1);
      if (receipt.last_completed_stage !== "unknown") process.exit(1);
    ' "$SUMMARY"; then
      print -r -- '{"sanitizer_timeout_bounded":false,"status":"failed"}'
      exit 1
    fi
    print -r -- "$SUMMARY"
    ;;
  --supervisor-handshake-delay-self-test)
    SUPERVISOR_SELFTEST_READY_DELAY_MS=8000
    HANDSHAKE_STDOUT="$TMP_ROOT/handshake.stdout"
    HANDSHAKE_STDERR="$TMP_ROOT/handshake.stderr"
    set +e
    run_supervised_to_files 1000 "$HANDSHAKE_STDOUT" "$HANDSHAKE_STDERR" /bin/true
    HANDSHAKE_STATUS="$?"
    set -e
    if (( HANDSHAKE_STATUS != 125 || SUPERVISOR_HANDSHAKE_FAILED != 1 )) \
      || [[ -e "$GROUP_PID_FILE" ]] \
      || [[ -n "$SUPERVISOR_PID" ]]; then
      print -r -- '{"supervisor_start_handshake_fail_closed":false,"status":"failed"}'
      exit 1
    fi
    trap - EXIT
    trap '' INT TERM
    cleanup
    if (( RECOVERY_ROOT_RETAINED != 1 )) || [[ ! -d "$TMP_ROOT" ]]; then
      print -r -- '{"supervisor_start_handshake_fail_closed":false,"status":"failed"}'
      exit 1
    fi
    rm -rf "$TMP_ROOT"
    print -r -- '{"supervisor_start_handshake_fail_closed":true,"status":"passed"}'
    ;;
  --supervisor-pre-record-signal-self-test)
    PRE_RECORD_DESCENDANT_PID_FILE="$TMP_ROOT/pre-record-descendant.pid"
    SUPERVISOR_SELFTEST_DESCENDANT_PID_FILE="$PRE_RECORD_DESCENDANT_PID_FILE"
    SUPERVISOR_SELFTEST_SIGNAL_RECEIPT_FILE="$TMP_ROOT/pre-record-signal-sent"
    SUPERVISOR_SELFTEST_PRE_RECORD_DELAY_MS=1000
    SUPERVISOR_SELFTEST_SIGNAL_PRE_RECORD=1
    set +e
    run_driver_with_deadline 10000 \
      /usr/bin/env node "$DRIVER" \
        --hang-with-grandchild \
        --pid-file "$PRE_RECORD_DESCENDANT_PID_FILE"
    PRE_RECORD_STATUS="$?"
    set -e
    PRE_RECORD_DESCENDANT_PID="$(tr -d '[:space:]' < "$PRE_RECORD_DESCENDANT_PID_FILE" 2>/dev/null || true)"
    PRE_RECORD_GROUP_PID="$(tr -d '[:space:]' < "$SUPERVISOR_POST_SPAWN_FILE" 2>/dev/null || true)"
    PRE_RECORD_SIGNAL_RECEIPT="$(tr -d '[:space:]' < "$SUPERVISOR_SELFTEST_SIGNAL_RECEIPT_FILE" 2>/dev/null || true)"
    if (( PRE_RECORD_STATUS != 125 || SUPERVISOR_HANDSHAKE_FAILED != 1 )) \
      || [[ "$PRE_RECORD_DESCENDANT_PID" != <-> ]] \
      || [[ "$PRE_RECORD_GROUP_PID" != <-> ]] \
      || kill -0 "$PRE_RECORD_DESCENDANT_PID" 2>/dev/null \
      || /bin/kill -0 -"$PRE_RECORD_GROUP_PID" 2>/dev/null \
      || [[ -e "$GROUP_PID_FILE" ]] \
      || [[ -e "$SUPERVISOR_READY_FILE" ]] \
      || [[ "$PRE_RECORD_SIGNAL_RECEIPT" != "sent-twice" ]] \
      || [[ -n "$SUPERVISOR_PID" ]]; then
      print -r -- '{"pre_record_signal_fail_closed":false,"status":"failed"}'
      exit 1
    fi
    trap - EXIT
    trap '' INT TERM
    cleanup
    if (( RECOVERY_ROOT_RETAINED != 1 )) || [[ ! -d "$TMP_ROOT" ]]; then
      print -r -- '{"pre_record_signal_fail_closed":false,"status":"failed"}'
      exit 1
    fi
    rm -rf "$TMP_ROOT"
    print -r -- '{"pre_record_signal_fail_closed":true,"status":"passed"}'
    ;;
  --supervisor-final-reap-signal-self-test)
    FINAL_REAP_DESCENDANT_PID_FILE="$TMP_ROOT/final-reap-descendant.pid"
    FINAL_REAP_SIGNAL_RECEIPT_FILE="$TMP_ROOT/final-reap-signal-sent"
    FINAL_REAP_READY_FILE="$TMP_ROOT/supervisor-ready-$((SUPERVISOR_SEQUENCE + 1))"
    SUPERVISOR_SELFTEST_DESCENDANT_PID_FILE="$FINAL_REAP_DESCENDANT_PID_FILE"
    SUPERVISOR_SELFTEST_SIGNAL_RECEIPT_FILE="$FINAL_REAP_SIGNAL_RECEIPT_FILE"
    SUPERVISOR_SELFTEST_FINAL_REAP_DELAY_MS=1000
    SUPERVISOR_SELFTEST_SIGNAL_FINAL_REAP=1
    set +e
    run_driver_with_deadline 10000 \
      /usr/bin/env node "$DRIVER" \
        --exit-with-term-ignoring-descendant \
        --pid-file "$FINAL_REAP_DESCENDANT_PID_FILE"
    FINAL_REAP_STATUS="$?"
    set -e
    FINAL_REAP_DESCENDANT_PID="$(tr -d '[:space:]' < "$FINAL_REAP_DESCENDANT_PID_FILE" 2>/dev/null || true)"
    FINAL_REAP_GROUP_PID="$(tr -d '[:space:]' < "$SUPERVISOR_FINAL_REAP_FILE" 2>/dev/null || true)"
    FINAL_REAP_COMPLETION="$(tr -d '[:space:]' < "$SUPERVISOR_FINAL_REAP_COMPLETE_FILE" 2>/dev/null || true)"
    FINAL_REAP_SIGNAL_RECEIPT="$(tr -d '[:space:]' < "$FINAL_REAP_SIGNAL_RECEIPT_FILE" 2>/dev/null || true)"
    if (( FINAL_REAP_STATUS != 143 || SUPERVISOR_HANDSHAKE_FAILED != 0 )) \
      || [[ "$FINAL_REAP_DESCENDANT_PID" != <-> ]] \
      || [[ "$FINAL_REAP_GROUP_PID" != <-> ]] \
      || kill -0 "$FINAL_REAP_DESCENDANT_PID" 2>/dev/null \
      || /bin/kill -0 -"$FINAL_REAP_GROUP_PID" 2>/dev/null \
      || [[ -e "$GROUP_PID_FILE" ]] \
      || [[ -e "$FINAL_REAP_READY_FILE" ]] \
      || [[ "$FINAL_REAP_COMPLETION" != "complete" ]] \
      || [[ "$FINAL_REAP_SIGNAL_RECEIPT" != "descendant-live-after-two-terms-final-reap" ]] \
      || [[ -n "$SUPERVISOR_PID" ]]; then
      print -r -- '{"final_reap_signal_idempotent":false,"status":"failed"}'
      exit 1
    fi
    SUPERVISOR_SELFTEST_FINAL_REAP_DELAY_MS=0
    SUPERVISOR_SELFTEST_SIGNAL_FINAL_REAP=0
    SUPERVISOR_SELFTEST_DESCENDANT_PID_FILE=""
    SUPERVISOR_SELFTEST_SIGNAL_RECEIPT_FILE=""
    SUMMARY='{"cleanup_complete":true,"final_reap_signal_idempotent":true,"status":"passed"}'
    STATUS=0
    trap - EXIT
    trap '' INT TERM
    cleanup
    apply_post_cleanup_outcome
    if [[ -e "$TMP_ROOT" ]]; then
      print -r -- '{"final_reap_signal_idempotent":false,"status":"failed"}'
      exit 1
    fi
    print -r -- "$SUMMARY"
    ;;
  --cleanup-signal-self-test)
    PROGRESS_TEMP_FILE="$TMP_ROOT/.progress-self-test.tmp"
    print -r -- '{"schema":"aos.exact-focus-channel-native-progress.v1","ordinal":1,"last_started_stage":"runtime_preflight","last_completed_stage":null,"elapsed_ms":7}' > "$PROGRESS_TEMP_FILE"
    chmod 600 "$PROGRESS_TEMP_FILE"
    mv "$PROGRESS_TEMP_FILE" "$PROGRESS_FILE"
    PROGRESS_SANITIZER_EXTRA_ARGS=(--self-test-delay-ms 400)
    SUMMARY='{"cleanup_complete":true,"cleanup_signal_deferred":true,"status":"passed"}'
    STATUS=0
    /bin/zsh -c '/bin/sleep 0.1; /bin/kill -TERM "$1"' cleanup-signal-sender "$$" &
    CLEANUP_SIGNAL_SENDER_PID="$!"
    trap - EXIT
    trap '' INT TERM
    cleanup
    SIGNAL_SENDER_STATUS=0
    wait "$CLEANUP_SIGNAL_SENDER_PID" || SIGNAL_SENDER_STATUS="$?"
    apply_post_cleanup_outcome
    if (( SIGNAL_SENDER_STATUS != 0 )) \
      || [[ -e "$TMP_ROOT" ]] \
      || ! /usr/bin/env node -e '
        const receipt = JSON.parse(process.argv[1]);
        if (receipt.status !== "passed") process.exit(1);
        if (receipt.cleanup_signal_deferred !== true) process.exit(1);
        if (receipt.progress_receipt_valid !== true) process.exit(1);
        if (receipt.last_started_stage !== "runtime_preflight") process.exit(1);
        if (receipt.last_completed_stage !== null) process.exit(1);
      ' "$SUMMARY"; then
      print -r -- '{"cleanup_signal_deferred":false,"status":"failed"}'
      exit 1
    fi
    print -r -- "$SUMMARY"
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
    SUMMARY="$(typed_failure_summary 124)"
    STATUS=124
    POST_CLEANUP_PIXELS_PERSISTED=0
    RECOVERY_ROOT_RETAINED=0
    apply_post_cleanup_outcome
    if (( STATUS != 124 )) || ! /usr/bin/env node -e '
      const summary = JSON.parse(process.argv[1]);
      if (summary.status !== "failed") process.exit(1);
      if (summary.error_code !== "PROOF_TIMEOUT") process.exit(1);
      if (summary.cleanup_complete !== false) process.exit(1);
    ' "$SUMMARY"; then
      print -r -- '{"cleanup_failure_forced_failure":false,"status":"failed"}'
      exit 1
    fi

    for SELFTEST_FAILURE_CASE in \
      "1:NATIVE_PROOF_FAILED" \
      "125:PROOF_SUPERVISION_FAILED" \
      "130:PROOF_INTERRUPTED" \
      "143:PROOF_TERMINATED"; do
      STATUS="${SELFTEST_FAILURE_CASE%%:*}"
      EXPECTED_FAILURE_CODE="${SELFTEST_FAILURE_CASE#*:}"
      SUMMARY="$(typed_failure_summary "$STATUS")"
      POST_CLEANUP_PIXELS_PERSISTED=0
      RECOVERY_ROOT_RETAINED=0
      apply_post_cleanup_outcome
      if ! /usr/bin/env node -e '
        const summary = JSON.parse(process.argv[1]);
        if (summary.status !== "failed") process.exit(1);
        if (summary.error_code !== process.argv[2]) process.exit(1);
        if (summary.cleanup_complete !== false) process.exit(1);
      ' "$SUMMARY" "$EXPECTED_FAILURE_CODE"; then
        print -r -- '{"cleanup_failure_forced_failure":false,"status":"failed"}'
        exit 1
      fi
    done

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
  --progress-merge-coherence-self-test)
    SUMMARY='{"status":"failed"}'
    SANITIZED_PROGRESS_RECEIPT='{"progress_receipt_valid":true,"progress_ordinal":3,"last_started_stage":"initial_capture","last_completed_stage":null,"progress_elapsed_ms":4}'
    merge_sanitized_progress
    if ! /usr/bin/env node -e '
      const receipt = JSON.parse(process.argv[1]);
      if (receipt.progress_receipt_valid !== false) process.exit(1);
      if (receipt.last_started_stage !== "unknown") process.exit(1);
      if (receipt.last_completed_stage !== "unknown") process.exit(1);
    ' "$SUMMARY"; then
      print -r -- '{"shell_progress_transition_coherence":false,"status":"failed"}'
      exit 1
    fi
    SUMMARY='{"status":"failed"}'
    SANITIZED_PROGRESS_RECEIPT='{"progress_receipt_valid":true,"progress_ordinal":3,"last_started_stage":"unrelated_channel_snapshot","last_completed_stage":"runtime_preflight","progress_elapsed_ms":5}'
    merge_sanitized_progress
    if ! /usr/bin/env node -e '
      const receipt = JSON.parse(process.argv[1]);
      if (receipt.progress_receipt_valid !== true) process.exit(1);
      if (receipt.last_started_stage !== "unrelated_channel_snapshot") process.exit(1);
      if (receipt.last_completed_stage !== "runtime_preflight") process.exit(1);
    ' "$SUMMARY"; then
      print -r -- '{"shell_progress_transition_coherence":false,"status":"failed"}'
      exit 1
    fi
    unset SUMMARY
    print -r -- '{"shell_progress_transition_coherence":true,"status":"passed"}'
    ;;
  --ambiguous-admission-cleanup-self-test)
    adopt_driver_summary \
      '{"command_admission_ambiguous":false,"command_error_code":null,"status":"passed"}' 0
    if (( COMMAND_ADMISSION_AMBIGUOUS != 0 )); then
      print -r -- '{"ambiguous_admission_cleanup_safe":false,"status":"failed"}'
      exit 1
    fi
    adopt_driver_summary '{"status":"failed"}' 1
    if (( COMMAND_ADMISSION_AMBIGUOUS != 1 )); then
      print -r -- '{"ambiguous_admission_cleanup_safe":false,"status":"failed"}'
      exit 1
    fi
    adopt_driver_summary \
      '{"command_admission_ambiguous":"false","command_error_code":null,"status":"failed"}' 1
    if (( COMMAND_ADMISSION_AMBIGUOUS != 1 )); then
      print -r -- '{"ambiguous_admission_cleanup_safe":false,"status":"failed"}'
      exit 1
    fi
    adopt_driver_summary \
      '{"command_admission_ambiguous":true,"command_error_code":"INTERNAL","status":"failed"}' 1
    if (( COMMAND_ADMISSION_AMBIGUOUS != 1 )); then
      print -r -- '{"ambiguous_admission_cleanup_safe":false,"status":"failed"}'
      exit 1
    fi

    ROOT="$TMP_ROOT/fake-repo"
    mkdir -p "$ROOT"
    print -r -- '#!/bin/zsh
print -r -- invoked > "${0:h}/aos-cleanup-invoked"
exit 1' > "$ROOT/aos"
    chmod 700 "$ROOT/aos"
    print -r -- '{}' > "$DAEMON_IDENTITY_FILE"
    print -r -- '[]' > "$TMP_ROOT/unrelated-channel-digests.json"
    print -r -- 'armed' > "$TMP_ROOT/channel-cleanup-armed"
    print -r -- 'pixel' > "$TMP_ROOT/exact-window.png"
    print -r -- 'pixel' > "$TMP_ROOT/preserved-window.png"
    print -r -- 'pixel' > "$TMP_ROOT/missing-window.png"

    BINARY="/bin/zsh"
    FIXTURE_SELFTEST_TOKEN="0123456789abcdef0123456789abcdef"
    /bin/zsh -c 'trap "" TERM; zmodload zsh/zselect; while true; do zselect -t 100 || true; done' \
      fixture-cleanup-self-test --ownership-token "$FIXTURE_SELFTEST_TOKEN" &
    FIXTURE_SELFTEST_PID="$!"
    print -r -- "$FIXTURE_SELFTEST_PID $FIXTURE_SELFTEST_TOKEN" > "$FIXTURE_PID_FILE"

    LIVE_CLEANUP_ARMED=1
    STATUS=1
    trap - EXIT
    trap '' INT TERM
    cleanup
    apply_post_cleanup_outcome
    if [[ -e "$ROOT/aos-cleanup-invoked" ]] \
      || [[ -e "$TMP_ROOT/exact-window.png" ]] \
      || [[ -e "$TMP_ROOT/preserved-window.png" ]] \
      || [[ -e "$TMP_ROOT/missing-window.png" ]] \
      || kill -0 "$FIXTURE_SELFTEST_PID" 2>/dev/null \
      || [[ ! -f "$TMP_ROOT/channel-cleanup-armed" ]] \
      || (( RECOVERY_ROOT_RETAINED != 1 )) \
      || ! /usr/bin/env node -e '
        const summary = JSON.parse(process.argv[1]);
        if (summary.status !== "failed") process.exit(1);
        if (summary.cleanup_complete !== false) process.exit(1);
        if (summary.command_admission_ambiguous !== true) process.exit(1);
        if (summary.recovery_root_retained !== true) process.exit(1);
        if (summary.pixels_persisted !== false) process.exit(1);
      ' "$SUMMARY"; then
      rm -rf "$TMP_ROOT"
      print -r -- '{"ambiguous_admission_cleanup_safe":false,"status":"failed"}'
      exit 1
    fi
    rm -rf "$TMP_ROOT"
    print -r -- '{"ambiguous_admission_cleanup_safe":true,"status":"passed"}'
    ;;
  --missing-aos-cleanup-self-test)
    ROOT="$TMP_ROOT/repo-without-aos"
    mkdir -p "$ROOT"
    print -r -- 'armed' > "$TMP_ROOT/channel-cleanup-armed"
    LIVE_CLEANUP_ARMED=1
    trap - EXIT
    trap '' INT TERM
    cleanup
    if (( RECOVERY_ROOT_RETAINED != 1 )) || [[ ! -d "$TMP_ROOT" ]]; then
      print -r -- '{"missing_aos_cleanup_retained_root":false,"status":"failed"}'
      exit 1
    fi
    rm -rf "$TMP_ROOT"
    print -r -- '{"missing_aos_cleanup_retained_root":true,"status":"passed"}'
    ;;
  *)
    print -u2 "usage: $0 --typecheck"
    print -u2 "       $0 --analyzer-self-test"
    print -u2 "       AOS_EXACT_FOCUS_CHANNEL_NATIVE_PROOF_OK=1 $0 --run"
    exit 2
    ;;
esac
