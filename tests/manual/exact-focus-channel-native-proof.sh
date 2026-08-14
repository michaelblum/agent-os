#!/bin/zsh
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/tests/manual/exact-focus-channel-native-proof.swift"
CHECKPOINT_SOURCE="$ROOT/tests/lib/exact-focus-channel-geometry-checkpoint.swift"
PRIVATE_RECORDS_SOURCE="$ROOT/tests/lib/exact-focus-channel-private-records.swift"
DRIVER="$ROOT/tests/manual/exact-focus-channel-native-proof.mjs"
SUPERVISION_NODE_SOURCE="$ROOT/tests/lib/exact-focus-channel-supervision.mjs"
SUPERVISION_SELF_TEST_SOURCE="$ROOT/tests/lib/exact-focus-channel-supervision-self-test.mjs"
SUPERVISION_PROTOCOL_SOURCE="$ROOT/tests/lib/exact-focus-channel-supervision-protocol.mjs"
PROOF_CONTRACT_SOURCE="$ROOT/tests/lib/exact-focus-channel-proof-contract.mjs"
SUPERVISION_SHELL_SOURCE="$ROOT/tests/lib/exact-focus-channel-supervision.zsh"
SUPERVISION_SCENARIO_SOURCE="$ROOT/tests/lib/exact-focus-channel-supervision-scenarios.zsh"
MODE="${1:-}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-exact-focus-native-proof.XXXXXX")"
BINARY="$TMP_ROOT/exact-focus-channel-native-proof"
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
# Exact worst late failure + catch is 40 + R(1) + R(1) + 9 = 145. The retained
# 149-call review ceiling leaves four calls of margin after the pre-close target
# refresh and its single public focus-list observation; eight local commands
# cover repeated git provenance helpers.
typeset -r LIVE_PRE_CLEANUP_AOS_COMMANDS=40
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
typeset -r LIVE_FIXTURE_GEOMETRY_CHECKPOINT_WAITS=4
typeset -r LIVE_FIXTURE_GEOMETRY_CHECKPOINT_WAIT_MS=2000
# Four 2,000ms fixture checkpoint waits plus 1,000ms of polling and scheduler
# allowance conservatively reserve 9,000ms.
typeset -r LIVE_FIXTURE_GEOMETRY_CHECKPOINT_TOTAL_MS=9000
typeset -r LIVE_PROOF_TIMEOUT_MS=$((
  LIVE_MAX_NON_CAPTURE_AOS_COMMANDS * AOS_COMMAND_TIMEOUT_MS
  + LIVE_MAX_CAPTURE_COMMANDS * CAPTURE_COMMAND_TIMEOUT_MS
  + LIVE_MAX_LOCAL_COMMANDS * LOCAL_COMMAND_TIMEOUT_MS
  + LIVE_EXPLICIT_WAIT_AND_TEARDOWN_MS
  + LIVE_FIXTURE_GEOMETRY_CHECKPOINT_TOTAL_MS
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
# 1,729,000ms supervisor deadline, including its failure/catch envelope.
typeset -r PROGRESS_RECEIPT_MAX_ELAPSED_MS=1800000
. "$SUPERVISION_SHELL_SOURCE"
exact_focus_supervision_init \
  "$SUPERVISION_NODE_SOURCE" "$SUPERVISION_SELF_TEST_SOURCE" \
  "$SUPERVISION_PROTOCOL_SOURCE" "$PROOF_CONTRACT_SOURCE" \
  "$TMP_ROOT" "$TMP_ROOT/active-process-group.pid" \
  "$DRIVER_STDOUT" "$DRIVER_STDERR"
stop_owned_pid() {
  local pid="$1"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null || true
  local attempt=0
  while kill -0 "$pid" 2>/dev/null && (( attempt < 8 )); do
    exact_focus_supervision_pause 5
    (( attempt += 1 ))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  attempt=0
  while kill -0 "$pid" 2>/dev/null && (( attempt < 20 )); do
    exact_focus_supervision_pause 2
    (( attempt += 1 ))
  done
  wait "$pid" 2>/dev/null || true
  ! kill -0 "$pid" 2>/dev/null
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
  exact_focus_supervision_command_has_ownership_token "$command" "$token" || return 1
  /bin/kill -TERM -"$pid" 2>/dev/null || true
  local attempt=0
  while /bin/kill -0 -"$pid" 2>/dev/null && (( attempt < 40 )); do
    exact_focus_supervision_pause 2
    (( attempt += 1 ))
  done
  if /bin/kill -0 -"$pid" 2>/dev/null; then
    /bin/kill -KILL -"$pid" 2>/dev/null || true
  fi
  attempt=0
  while /bin/kill -0 -"$pid" 2>/dev/null && (( attempt < 60 )); do
    exact_focus_supervision_pause 2
    (( attempt += 1 ))
  done
  if /bin/kill -0 -"$pid" 2>/dev/null; then
    return 1
  fi
  SELFTEST_UNRELATED_GROUP_PID=""
  SELFTEST_UNRELATED_GROUP_TOKEN=""
}
stop_owned_fixture() {
  [[ -e "$FIXTURE_PID_FILE" || -L "$FIXTURE_PID_FILE" ]] || return 0
  local pid token owner_record
  owner_record="$(/usr/bin/env node "$SUPERVISION_PROTOCOL_SOURCE" --read-owner-record \
    "$FIXTURE_PID_FILE" 2>/dev/null)" || return 1
  read -r pid token <<< "$owner_record" || return 1
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  local command
  command="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == "$BINARY"* ]] || return 1
  exact_focus_supervision_command_has_ownership_token "$command" "$token" || return 1
  stop_owned_pid "$pid"
}
run_channel_cleanup() {
  [[ -f "$DAEMON_IDENTITY_FILE" ]] || return 1
  local cleanup_stdout="$TMP_ROOT/cleanup.stdout"
  local cleanup_stderr="$TMP_ROOT/cleanup.stderr"
  exact_focus_supervision_run_to_files "$CHANNEL_CLEANUP_TIMEOUT_MS" "$cleanup_stdout" "$cleanup_stderr" \
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
  exact_focus_supervision_run_to_files \
    "$PROGRESS_SANITIZER_TIMEOUT_MS" \
    "$sanitizer_stdout" \
    "$sanitizer_stderr" \
    /usr/bin/env node "$PROOF_CONTRACT_SOURCE" \
      --sanitize-progress-receipt \
      "${PROGRESS_SANITIZER_EXTRA_ARGS[@]}" \
      --path "$PROGRESS_FILE" || sanitizer_status="$?"
  # A sanitizer error or timeout is content-free unknown after its group was
  # reaped. An unresolved ownership record retains the root instead.
  [[ ! -e "$EFCS_GROUP_PID_FILE" ]] || return 1
  [[ -z "$EFCS_PID" && -z "$EFCS_READY_FILE" ]] || return 1
  (( EFCS_HANDSHAKE_FAILED == 0 )) || return 1
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
  local cleanup_failed="$EFCS_HANDSHAKE_FAILED"
  stop_selftest_unrelated_group || cleanup_failed=1
  local execution_quiescent=0
  if exact_focus_supervision_quiesce; then
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
  exact_focus_supervision_run_to_files 30000 "$compile_stdout" "$compile_stderr" \
    swiftc \
    -parse-as-library \
    -module-cache-path "$TMP_ROOT/module-cache" \
    -framework AppKit \
    -framework ImageIO \
    "$CHECKPOINT_SOURCE" \
    "$PRIVATE_RECORDS_SOURCE" \
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
  /usr/bin/env node "$PROOF_CONTRACT_SOURCE" --fallback-driver-summary "$command_status"
}
validated_summary() {
  local candidate="$1"
  /usr/bin/env node "$PROOF_CONTRACT_SOURCE" --validate-driver-summary "$candidate"
}
summary_admission_is_nonambiguous() {
  local candidate="$1"
  /usr/bin/env node "$PROOF_CONTRACT_SOURCE" \
    --summary-admission-is-nonambiguous "$candidate"
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
  if ! merged="$(/usr/bin/env node "$PROOF_CONTRACT_SOURCE" \
    --merge-sanitized-progress "$SUMMARY" "$SANITIZED_PROGRESS_RECEIPT" \
    "$PROGRESS_RECEIPT_MAX_ELAPSED_MS" 2>/dev/null)"; then
    return 1
  fi
  SUMMARY="$merged"
}
apply_post_cleanup_outcome() {
  local finalized="" invalid_summary="" summary_status=0
  invalid_summary="$(/usr/bin/env node "$PROOF_CONTRACT_SOURCE" \
    --final-output-invalid-fallback \
    "$POST_CLEANUP_PIXELS_PERSISTED" "$RECOVERY_ROOT_RETAINED")" || return 1
  if ! finalized="$(/usr/bin/env node "$PROOF_CONTRACT_SOURCE" --finalize-proof-summary \
    "$SUMMARY" "$POST_CLEANUP_PIXELS_PERSISTED" "$RECOVERY_ROOT_RETAINED" "$STATUS")"; then
    SUMMARY="$invalid_summary"
    SUMMARY_STATUS=failed
    (( STATUS != 0 )) || STATUS=1
    return 0
  fi
  SUMMARY="$finalized"
  SUMMARY_STATUS="$(/usr/bin/env node "$PROOF_CONTRACT_SOURCE" \
    --final-output-status "$SUMMARY")" || summary_status="$?"
  if (( summary_status > 1 )); then
    SUMMARY="$invalid_summary"
    SUMMARY_STATUS=failed
    (( STATUS != 0 )) || STATUS=1
    return 0
  fi
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
    exact_focus_supervision_run_to_files 30000 "$TYPECHECK_STDOUT" "$TYPECHECK_STDERR" \
      swiftc \
        -typecheck \
        -parse-as-library \
        -module-cache-path "$TMP_ROOT/module-cache" \
        -framework AppKit \
        -framework ImageIO \
        "$CHECKPOINT_SOURCE" \
        "$PRIVATE_RECORDS_SOURCE" \
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
    exact_focus_supervision_run_to_files 10000 "$ANALYZER_STDOUT" "$ANALYZER_STDERR" \
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
    exact_focus_supervision_run_driver "$LIVE_PROOF_TIMEOUT_MS" \
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
  --final-output-missing-cleanup-self-test)
    SUMMARY='{"status":"passed"}'
    STATUS=0
    apply_post_cleanup_outcome
    trap - EXIT
    trap '' INT TERM
    rm -rf "$TMP_ROOT"
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
  --progress-sanitizer-timeout-self-test)
    PROGRESS_SANITIZER_EXTRA_ARGS=(--self-test-delay-ms 5000)
    SUMMARY='{"cleanup_complete":true,"sanitizer_timeout_bounded":true,"status":"passed"}'
    STATUS=0
    trap - EXIT
    trap '' INT TERM
    cleanup
    apply_post_cleanup_outcome
    if [[ -e "$TMP_ROOT" ]] || ! /usr/bin/env node "$PROOF_CONTRACT_SOURCE" \
      --summary-matches "$SUMMARY" \
      '{"progress_receipt_valid":false,"last_started_stage":"unknown","last_completed_stage":"unknown"}'; then
      print -r -- '{"sanitizer_timeout_bounded":false,"status":"failed"}'
      exit 1
    fi
    print -r -- "$SUMMARY"
    ;;
  --cleanup-signal-self-test)
    PROGRESS_TEMP_FILE="$TMP_ROOT/.progress-self-test.tmp"
    print -r -- '{"schema":"aos.exact-focus-channel-native-progress.v2","ordinal":1,"last_started_stage":"runtime_preflight","last_completed_stage":null,"elapsed_ms":7}' > "$PROGRESS_TEMP_FILE"
    chmod 600 "$PROGRESS_TEMP_FILE"
    mv "$PROGRESS_TEMP_FILE" "$PROGRESS_FILE"
    SUMMARY='{"cleanup_complete":true,"cleanup_signal_deferred":true,"status":"passed"}'
    STATUS=0
    trap - EXIT
    trap '' INT TERM
    /bin/zsh -c '
      zmodload zsh/zselect
      integer attempt=0
      while (( attempt < 400 )); do
        if [[ -f "$2" && ! -L "$2" ]]; then
          mode="$(/usr/bin/stat -f "%Lp" "$2" 2>/dev/null || true)"
          [[ "$mode" == 600 ]] || exit 1
          /bin/kill -TERM "$1"
          exit "$?"
        fi
        zselect -t 1 || true
        (( attempt += 1 ))
      done
      exit 1
    ' cleanup-signal-sender "$$" "$TMP_ROOT/progress-sanitizer.stdout" &
    CLEANUP_SIGNAL_SENDER_PID="$!"
    cleanup
    SIGNAL_SENDER_STATUS=0
    wait "$CLEANUP_SIGNAL_SENDER_PID" || SIGNAL_SENDER_STATUS="$?"
    apply_post_cleanup_outcome
    if (( SIGNAL_SENDER_STATUS != 0 )); then
      print -r -- '{"error_code":"CLEANUP_SIGNAL_SENDER_FAILED","status":"failed"}'
      exit 1
    fi
    if [[ -e "$TMP_ROOT" ]]; then
      print -r -- '{"error_code":"CLEANUP_SIGNAL_ROOT_RETAINED","status":"failed"}'
      exit 1
    fi
    if ! /usr/bin/env node "$PROOF_CONTRACT_SOURCE" --summary-matches "$SUMMARY" \
      '{"status":"passed","cleanup_signal_deferred":true,"progress_receipt_valid":true,"last_started_stage":"runtime_preflight","last_completed_stage":null}'; then
      print -r -- '{"error_code":"CLEANUP_SIGNAL_RECEIPT_INVALID","status":"failed"}'
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
    EMPTY_PADDING_SOURCE=""; PADDING="${(l:4096::x:)EMPTY_PADDING_SOURCE}"
    FIXTURE_SIGNAL_FILE="$TMP_ROOT/fixture-owner.signal"; FIXTURE_EXPECTED_FILE="$TMP_ROOT/fixture-owner.expected"; FIXTURE_SYMLINK_TARGET="$TMP_ROOT/fixture-owner.target"
    FIXTURE_SELFTEST_FAILED=0
    rm -f -- "$FIXTURE_PID_FILE" "$FIXTURE_SIGNAL_FILE" \
      "$FIXTURE_EXPECTED_FILE" "$FIXTURE_SYMLINK_TARGET"
    stop_owned_fixture || FIXTURE_SELFTEST_FAILED=1
    /bin/zsh -c "trap 'print -r -- term >| \"$FIXTURE_SIGNAL_FILE\"' TERM; zmodload zsh/zselect; while true; do zselect -t 100 || true; done" \
      "$PADDING" --ownership-token "$TOKEN" &
    OWNED_PID="$!"
    print -r -- "$OWNED_PID $TOKEN" > "$FIXTURE_EXPECTED_FILE"; chmod 600 "$FIXTURE_EXPECTED_FILE"
    print -r -- invalid > "$FIXTURE_PID_FILE"; chmod 600 "$FIXTURE_PID_FILE"
    if stop_owned_fixture || ! kill -0 "$OWNED_PID" 2>/dev/null \
      || [[ -e "$FIXTURE_SIGNAL_FILE" || -L "$FIXTURE_SIGNAL_FILE" ]] \
      || [[ ! -f "$FIXTURE_PID_FILE" || -L "$FIXTURE_PID_FILE" ]] \
      || [[ "$(/usr/bin/stat -f '%Lp' "$FIXTURE_PID_FILE")" != 600 ]] \
      || ! /usr/bin/cmp -s "$FIXTURE_PID_FILE" <(print -r -- invalid); then FIXTURE_SELFTEST_FAILED=1; fi
    /bin/cp "$FIXTURE_EXPECTED_FILE" "$FIXTURE_PID_FILE"; chmod 644 "$FIXTURE_PID_FILE"
    if stop_owned_fixture || ! kill -0 "$OWNED_PID" 2>/dev/null \
      || [[ -e "$FIXTURE_SIGNAL_FILE" || -L "$FIXTURE_SIGNAL_FILE" ]] \
      || [[ "$(/usr/bin/stat -f '%Lp' "$FIXTURE_PID_FILE")" != 644 ]] \
      || ! /usr/bin/cmp -s "$FIXTURE_PID_FILE" "$FIXTURE_EXPECTED_FILE"; then FIXTURE_SELFTEST_FAILED=1; fi
    /bin/mv "$FIXTURE_PID_FILE" "$FIXTURE_SYMLINK_TARGET"
    /bin/ln -s "$FIXTURE_SYMLINK_TARGET" "$FIXTURE_PID_FILE"
    if stop_owned_fixture || ! kill -0 "$OWNED_PID" 2>/dev/null \
      || [[ -e "$FIXTURE_SIGNAL_FILE" || -L "$FIXTURE_SIGNAL_FILE" ]] \
      || [[ ! -L "$FIXTURE_PID_FILE" || "$(readlink "$FIXTURE_PID_FILE")" != "$FIXTURE_SYMLINK_TARGET" ]] \
      || ! /usr/bin/cmp -s "$FIXTURE_SYMLINK_TARGET" "$FIXTURE_EXPECTED_FILE"; then FIXTURE_SELFTEST_FAILED=1; fi
    rm -f -- "$FIXTURE_PID_FILE"; /bin/cp "$FIXTURE_EXPECTED_FILE" "$FIXTURE_PID_FILE"
    if ! stop_owned_fixture || kill -0 "$OWNED_PID" 2>/dev/null; then FIXTURE_SELFTEST_FAILED=1; fi
    stop_owned_pid "$OWNED_PID" || FIXTURE_SELFTEST_FAILED=1
    rm -f -- "$FIXTURE_PID_FILE" "$FIXTURE_SIGNAL_FILE" \
      "$FIXTURE_EXPECTED_FILE" "$FIXTURE_SYMLINK_TARGET"
    if (( FIXTURE_SELFTEST_FAILED == 1 )); then
      print -r -- '{"fixture_owner_absence_safe":false,"fixture_owner_rejections_safe":false,"long_argv_fixture_reaped":false,"status":"failed"}'; exit 1
    fi
    print -r -- '{"fixture_owner_absence_safe":true,"fixture_owner_rejections_safe":true,"long_argv_fixture_reaped":true,"status":"passed"}'
    ;;
  --pidfile-reuse-self-test)
    STALE_TOKEN="0123456789abcdef0123456789abcdef"
    print -r -- "999999 $STALE_TOKEN" > "$EFCS_GROUP_PID_FILE"
    set +e
    exact_focus_supervision_run_driver 50 /bin/sleep 10
    STATUS="$?"
    set -e
    RECORDED_OWNER="$(/usr/bin/env node "$SUPERVISION_PROTOCOL_SOURCE" --read-owner-record "$EFCS_GROUP_PID_FILE" 2>/dev/null || true)"; read -r RECORDED_PID RECORDED_TOKEN <<< "$RECORDED_OWNER" || true
    if (( STATUS != 125 )) || [[ "$RECORDED_PID" != "999999" || "$RECORDED_TOKEN" != "$STALE_TOKEN" ]]; then
      print -r -- '{"live_unrelated_group_preserved":false,"unresolved_group_record_preserved":false,"status":"failed"}'
      exit 1
    fi
    rm -f "$EFCS_GROUP_PID_FILE"
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
    print -r -- "$SELFTEST_UNRELATED_GROUP_PID $STALE_TOKEN" > "$EFCS_GROUP_PID_FILE"
    set +e
    exact_focus_supervision_stop_group
    OWNERSHIP_STATUS="$?"
    set -e
    RECORDED_OWNER="$(/usr/bin/env node "$SUPERVISION_PROTOCOL_SOURCE" --read-owner-record "$EFCS_GROUP_PID_FILE" 2>/dev/null || true)"; read -r RECORDED_PID RECORDED_TOKEN <<< "$RECORDED_OWNER" || true
    if (( OWNERSHIP_STATUS == 0 )) \
      || [[ "$RECORDED_PID" != "$SELFTEST_UNRELATED_GROUP_PID" || "$RECORDED_TOKEN" != "$STALE_TOKEN" ]] \
      || ! kill -0 "$SELFTEST_UNRELATED_GROUP_PID" 2>/dev/null; then
      rm -f "$EFCS_GROUP_PID_FILE"
      stop_selftest_unrelated_group || true
      print -r -- '{"live_unrelated_group_preserved":false,"unresolved_group_record_preserved":true,"status":"failed"}'
      exit 1
    fi
    rm -f "$EFCS_GROUP_PID_FILE"
    stop_selftest_unrelated_group
    print -r -- '{"live_unrelated_group_preserved":true,"unresolved_group_record_preserved":true,"status":"passed"}'
    ;;
  --postflight-cleanup-failure-self-test)
    SUMMARY="$(typed_failure_summary 124)"
    STATUS=124
    POST_CLEANUP_PIXELS_PERSISTED=0
    RECOVERY_ROOT_RETAINED=0
    apply_post_cleanup_outcome
    if (( STATUS != 124 )) || ! /usr/bin/env node "$PROOF_CONTRACT_SOURCE" \
      --summary-matches "$SUMMARY" \
      '{"status":"failed","error_code":"PROOF_TIMEOUT","cleanup_complete":false}'; then
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
      if ! /usr/bin/env node "$PROOF_CONTRACT_SOURCE" --summary-matches "$SUMMARY" \
        "{\"status\":\"failed\",\"error_code\":\"$EXPECTED_FAILURE_CODE\",\"cleanup_complete\":false}"; then
        print -r -- '{"cleanup_failure_forced_failure":false,"status":"failed"}'
        exit 1
      fi
    done
    SUMMARY='{"cleanup_complete":true,"pixels_persisted":false,"status":"passed"}'
    STATUS=0
    POST_CLEANUP_PIXELS_PERSISTED=0
    RECOVERY_ROOT_RETAINED=1
    apply_post_cleanup_outcome
    if (( STATUS != 1 )) || ! /usr/bin/env node "$PROOF_CONTRACT_SOURCE" \
      --summary-matches "$SUMMARY" \
      '{"status":"failed","error_code":"POSTFLIGHT_CLEANUP_INCOMPLETE","cleanup_complete":false,"recovery_root_retained":true}'; then
      print -r -- '{"cleanup_failure_forced_failure":false,"status":"failed"}'
      exit 1
    fi
    SUMMARY='{"cleanup_complete":true,"status":"passed"}'
    STATUS=125
    POST_CLEANUP_PIXELS_PERSISTED=0
    RECOVERY_ROOT_RETAINED=0
    apply_post_cleanup_outcome
    if (( STATUS != 125 )) || ! /usr/bin/env node "$PROOF_CONTRACT_SOURCE" \
      --summary-matches "$SUMMARY" \
      '{"status":"failed","error_code":"PROOF_SUPERVISION_FAILED","cleanup_complete":true}'; then
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
    if ! /usr/bin/env node "$PROOF_CONTRACT_SOURCE" --summary-matches "$SUMMARY" \
      '{"progress_receipt_valid":false,"progress_ordinal":null,"last_started_stage":"unknown","last_completed_stage":"unknown"}'; then
      print -r -- '{"shell_progress_transition_coherence":false,"status":"failed"}'
      exit 1
    fi
    SUMMARY='{"status":"failed"}'
    SANITIZED_PROGRESS_RECEIPT='{"progress_receipt_valid":true,"progress_ordinal":3,"last_started_stage":"unrelated_channel_snapshot","last_completed_stage":"runtime_preflight","progress_elapsed_ms":5}'
    merge_sanitized_progress
    if ! /usr/bin/env node "$PROOF_CONTRACT_SOURCE" --summary-matches "$SUMMARY" \
      '{"progress_receipt_valid":true,"progress_ordinal":3,"last_started_stage":"unrelated_channel_snapshot","last_completed_stage":"runtime_preflight"}'; then
      print -r -- '{"shell_progress_transition_coherence":false,"status":"failed"}'
      exit 1
    fi
    unset SUMMARY
    print -r -- '{"shell_progress_transition_coherence":true,"status":"passed"}'
    ;;
  --ambiguous-admission-cleanup-self-test)
    VALID_NONAMBIGUOUS_DRIVER_FAILURE='{"channel_removed":false,"cleanup_complete":false,"command_admission_ambiguous":false,"command_error_code":null,"direct_capture_ready_preserved":false,"error_code":"SELF_TEST_FAILURE","fixture_process_reaped":false,"fixture_windows_removed":false,"microphone_requested":false,"pixels_persisted":false,"raw_capture_logged":false,"runtime_provenance_preserved":false,"shared_daemon_preserved":false,"status":"failed","unrelated_channel_stable_fields_preserved":false}'
    VALID_AMBIGUOUS_DRIVER_FAILURE='{"channel_removed":false,"cleanup_complete":false,"command_admission_ambiguous":true,"command_error_code":"INTERNAL","direct_capture_ready_preserved":false,"error_code":"SELF_TEST_FAILURE","fixture_process_reaped":false,"fixture_windows_removed":false,"microphone_requested":false,"pixels_persisted":false,"raw_capture_logged":false,"runtime_provenance_preserved":false,"shared_daemon_preserved":false,"status":"failed","unrelated_channel_stable_fields_preserved":false}'
    adopt_driver_summary \
      "$VALID_NONAMBIGUOUS_DRIVER_FAILURE" 1
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
      "$VALID_AMBIGUOUS_DRIVER_FAILURE" 1
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
      || ! /usr/bin/env node "$PROOF_CONTRACT_SOURCE" --summary-matches "$SUMMARY" \
        '{"status":"failed","cleanup_complete":false,"command_admission_ambiguous":true,"recovery_root_retained":true,"pixels_persisted":false}'; then
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
    . "$SUPERVISION_SCENARIO_SOURCE"
    if ! exact_focus_supervision_scenario_supports "$MODE"; then
      print -u2 "usage: $0 --typecheck"
      print -u2 "       $0 --analyzer-self-test"
      print -u2 "       AOS_EXACT_FOCUS_CHANNEL_NATIVE_PROOF_OK=1 $0 --run"
      exit 2
    fi
    exact_focus_supervision_scenario_init
    set +e
    exact_focus_supervision_run_scenario "$MODE"
    SCENARIO_STATUS="$?"
    set -e
    if (( SCENARIO_STATUS != 0 )); then
      print -r -- "$EFCS_SCENARIO_ERROR"
      exit 1
    fi
    SUMMARY="$EFCS_SCENARIO_SUMMARY"
    STATUS="$EFCS_SCENARIO_EXIT_STATUS"
    if [[ "$EFCS_SCENARIO_CLEANUP_MODE" == remove ]]; then
      trap - EXIT
      trap "" INT TERM
      cleanup
      apply_post_cleanup_outcome
      if [[ -e "$TMP_ROOT" ]]; then
        print -r -- "{\"error_code\":\"SUPERVISION_CLEANUP_ROOT_RETAINED\",\"status\":\"failed\"}"
        exit 1
      fi
    elif [[ "$EFCS_SCENARIO_CLEANUP_MODE" == retain_then_remove ]]; then
      trap - EXIT
      trap "" INT TERM
      cleanup
      if (( RECOVERY_ROOT_RETAINED != 1 )) || [[ ! -d "$TMP_ROOT" ]]; then
        print -r -- "{\"error_code\":\"SUPERVISION_RECOVERY_ROOT_INVALID\",\"status\":\"failed\"}"
        exit 1
      fi
      if [[ ! -d "$TMP_ROOT" || -L "$TMP_ROOT" || "${TMP_ROOT:t}" != aos-exact-focus-native-proof.?????? ]] || ! rm -rf -- "$TMP_ROOT" || [[ -e "$TMP_ROOT" || -L "$TMP_ROOT" ]]; then
        print -r -- "{\"error_code\":\"SUPERVISION_CLEANUP_ROOT_RETAINED\",\"status\":\"failed\"}"
        exit 1
      fi
      SUMMARY="$EFCS_SCENARIO_SUMMARY"
    fi
    print -r -- "$SUMMARY"
    exit "$STATUS"
    ;;
esac
