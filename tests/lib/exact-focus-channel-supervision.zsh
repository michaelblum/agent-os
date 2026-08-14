# Focused process-group ownership for the exact focus-channel proof. The caller
# supplies every path once; this module neither installs traps nor removes roots.
typeset -gr EFCS_SUPERVISION_SHELL_SOURCE="${(%):-%N}"

exact_focus_supervision_init() {
  (( $# == 8 )) || return 2
  typeset -g EFCS_SUPERVISION_HELPER="$1" EFCS_SELF_TEST_HELPER="$2"
  typeset -g EFCS_SUPERVISION_PROTOCOL="$3" EFCS_PROOF_CONTRACT="$4" EFCS_TMP_ROOT="$5"
  typeset -g EFCS_GROUP_PID_FILE="$6" EFCS_ADMISSION_ACK_FILE="$6.admission-ack"
  typeset -g EFCS_DRIVER_STDOUT="$7" EFCS_DRIVER_STDERR="$8"
  typeset -g EFCS_LAST_SUPERVISOR_DETAIL="" EFCS_LAST_SUPERVISOR_REASON="" EFCS_LAST_SUPERVISOR_STAGE="" EFCS_LAST_SUPERVISOR_STATUS=""
  typeset -g EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL="" EFCS_LAST_SUPERVISOR_CLEANUP_STAGE="" EFCS_LAST_STOPPED_SUPERVISOR_STATUS=""
  typeset -g EFCS_PID="" EFCS_SUPERVISOR_TOKEN="" EFCS_READY_FILE="" EFCS_FAILURE_RECEIPT_FILE="" EFCS_READY_DELAY_ENTERED_FILE=""
  typeset -gi EFCS_SEQUENCE=0 EFCS_HANDSHAKE_FAILED=0 EFCS_FAIL_HANDSHAKE_AFTER_ADMISSION_ACK=0
  typeset -gi EFCS_HANDSHAKE_ABORTED_AFTER_ADMISSION_ACK=0 EFCS_READY_DELAY_MS=0 EFCS_GUARDIAN_RECORD_DELAY_MS=0 EFCS_ADMISSION_ACK_DELAY_MS=0
  typeset -gi EFCS_GUARDIAN_RECORD_PUBLICATION_FAILURE=0 EFCS_GUARDIAN_CRASH_BEFORE_ACK=0
  typeset -gi EFCS_SUPERVISOR_EXIT_BEFORE_GROUP_RECORD=0 EFCS_SUPERVISOR_EXIT_BEFORE_ADMISSION_ACK=0 EFCS_SIGNAL_BEFORE_ADMISSION_ACK=0
  typeset -gi EFCS_THROW_AFTER_READINESS=0 EFCS_GROUP_RECORD_REMOVE_FAILURE=0 EFCS_FIRST_TIER_REAP_FAILURE=0
  typeset -g EFCS_FAILURE_RECEIPT_PUBLICATION_FAILURE=""
  typeset -gi EFCS_LAST_GROUP_REAP_PROVEN=0 EFCS_LAST_LIVE_GUARDIAN_AUTHENTICATED=0 EFCS_OUTER_REAP_RECOVERED=0
  typeset -gi EFCS_FINAL_REAP_DELAY_MS=0 EFCS_SIGNAL_FINAL_REAP=0 EFCS_TIMEOUT_STARTUP_MS=0
  typeset -g EFCS_TIMEOUT_READINESS_FILE="" EFCS_SIGNAL_SENDER_PID="" EFCS_SIGNAL_RECEIPT_FILE="" EFCS_GUARDIAN_IDENTITY_FILE=""
  typeset -gi EFCS_GUARDIAN_IDENTITY_REQUIRED=0 EFCS_GUARDIAN_IDENTITY_PUBLICATION_FAILURE=0 EFCS_CORRUPT_GUARDIAN_IDENTITY=0
  typeset -g EFCS_FINAL_REAP_FILE="" EFCS_FINAL_REAP_COMPLETE_FILE="" EFCS_DESCENDANT_PID_FILE=""
  typeset -gi EFCS_PAYLOAD_OUTCOME_DELAY_MS=0 EFCS_KILL_SUPERVISOR_AFTER_PAYLOAD_OUTCOME=0
  typeset -g EFCS_PAYLOAD_OUTCOME_FILE=""
}
exact_focus_supervision_pause() {
  zmodload zsh/zselect
  zselect -t "$1" || true
}
exact_focus_supervision_process_exists() {
  /bin/kill -0 "$1" 2>/dev/null
}
exact_focus_supervision_process_group_id() { ps -p "$1" -o pgid= 2>/dev/null | tr -d '[:space:]'; }
exact_focus_supervision_process_command() { ps -ww -p "$1" -o command= 2>/dev/null; }
exact_focus_supervision_process_parent_id() { ps -p "$1" -o ppid= 2>/dev/null | tr -d '[:space:]'; }
exact_focus_supervision_send_process_signal() { /bin/kill -"$1" "$2" 2>/dev/null; }
exact_focus_supervision_send_group_signal() { /bin/kill -"$1" -"$2" 2>/dev/null; }
exact_focus_supervision_command_has_ownership_token() {
  (( $# == 2 )) || return 2
  local command="$1" token="$2" pattern
  [[ "$token" =~ '^[0-9a-f]{32}$' ]] || return 2
  pattern="(^|[[:space:]])--ownership-token[[:space:]]${token}([[:space:]]|$)"
  [[ "$command" =~ $pattern ]]
}
exact_focus_supervision_path_is_absent() {
  (( $# == 1 )) || return 2
  [[ ! -e "$1" && ! -L "$1" ]]
}
exact_focus_supervision_owner_projection() {
  local expected="${1:-}" file projection identity=""
  for file in "$EFCS_GROUP_PID_FILE" "$EFCS_ADMISSION_ACK_FILE" \
    "$EFCS_GUARDIAN_IDENTITY_FILE"; do
    [[ -n "$file" ]] || continue
    exact_focus_supervision_path_is_absent "$file" && continue
    projection="$(/usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" \
      --read-owner-record "$file" 2>/dev/null)" || return 1
    [[ -z "$identity" ]] && identity="$projection" || [[ "$projection" == "$identity" ]] || return 1
  done
  [[ -n "$identity" ]] || return 1
  [[ -z "$expected" || "$identity" == "$expected" ]] || return 1
  print -r -- "$identity"
}
exact_focus_supervision_remove_identical_owner_records() {
  (( $# == 1 )) || return 2
  local expected="$1" projection file
  local -a files=("$EFCS_ADMISSION_ACK_FILE" "$EFCS_GROUP_PID_FILE")
  [[ -z "$EFCS_GUARDIAN_IDENTITY_FILE" ]] || files+=("$EFCS_GUARDIAN_IDENTITY_FILE")
  projection="$(exact_focus_supervision_owner_projection "$expected")" || return 1
  [[ "$projection" == "$expected" ]] || return 1
  rm -f -- "${files[@]}" || return 1
  for file in "${files[@]}"; do
    exact_focus_supervision_path_is_absent "$file" || return 1
  done
}
exact_focus_supervision_remove_expected_ready() {
  (( $# == 1 )) || return 2
  exact_focus_supervision_path_is_absent "$EFCS_READY_FILE" && return 0
  local projection
  projection="$(/usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" \
    --read-supervisor-ready "$EFCS_READY_FILE" 2>/dev/null)" || return 1
  [[ "$projection" == "$1" ]] || return 1
  rm -f -- "$EFCS_READY_FILE" || return 1
  exact_focus_supervision_path_is_absent "$EFCS_READY_FILE"
}
exact_focus_supervision_admission_state_is_clear() {
  exact_focus_supervision_path_is_absent "$EFCS_GROUP_PID_FILE" \
    && exact_focus_supervision_path_is_absent "$EFCS_ADMISSION_ACK_FILE" \
    && [[ -z "$EFCS_PID" && -z "$EFCS_SUPERVISOR_TOKEN" && -z "$EFCS_READY_FILE" \
      && -z "$EFCS_FAILURE_RECEIPT_FILE" ]] || return 1
  (( EFCS_GUARDIAN_IDENTITY_REQUIRED == 0 ))
}
exact_focus_supervision_admission_delay_oracle_is_valid() {
  local leader_pid="" token="" owner_record="" marker_mode="" marker_size=""
  [[ -f "$EFCS_GUARDIAN_IDENTITY_FILE" && ! -L "$EFCS_GUARDIAN_IDENTITY_FILE" \
    && -f "$EFCS_ADMISSION_ACK_FILE" && ! -L "$EFCS_ADMISSION_ACK_FILE" \
    && -f "$EFCS_READY_DELAY_ENTERED_FILE" && ! -L "$EFCS_READY_DELAY_ENTERED_FILE" ]] || return 1
  owner_record="$(/usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" --read-owner-record \
    "$EFCS_GUARDIAN_IDENTITY_FILE" 2>/dev/null)" || return 1
  read -r leader_pid token <<< "$owner_record" || return 1
  /usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" --validate-owned-group-record \
    "$EFCS_ADMISSION_ACK_FILE" "$leader_pid" "$token" || return 1
  marker_mode="$(/usr/bin/stat -f '%Lp' "$EFCS_READY_DELAY_ENTERED_FILE" 2>/dev/null || true)"
  marker_size="$(/usr/bin/stat -f '%z' "$EFCS_READY_DELAY_ENTERED_FILE" 2>/dev/null || true)"
  [[ "$marker_mode" == 600 && "$marker_size" == 8 \
    && "$(<"$EFCS_READY_DELAY_ENTERED_FILE")" == entered ]]
}
exact_focus_supervision_owned_group_pid_from_file() {
  (( $# == 2 )) || return 2
  local ownership_file="$1" expected_projection="$2" projection
  [[ -e "$ownership_file" || -L "$ownership_file" ]] || return 1
  local pgid token owner_record actual_pgid command attempt=0
  projection="$(exact_focus_supervision_owner_projection "$expected_projection")" || return 2
  owner_record="$(/usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" --read-owner-record \
    "$ownership_file" 2>/dev/null)" || return 2
  [[ "$owner_record" == "$projection" ]] || return 2
  read -r pgid token <<< "$owner_record" || return 2
  while (( attempt < 20 )); do
    actual_pgid="$(exact_focus_supervision_process_group_id "$pgid" || true)"
    command=""
    if [[ "$actual_pgid" == "$pgid" ]]; then
      command="$(exact_focus_supervision_process_command "$pgid" || true)"
      if [[ "$command" == *"$EFCS_SUPERVISION_HELPER --owned-group-guardian --group-pid-file $EFCS_GROUP_PID_FILE --admission-ack-file $EFCS_ADMISSION_ACK_FILE --supervisor-pid "* ]] \
        && exact_focus_supervision_command_has_ownership_token "$command" "$token"; then
        print -r -- "$pgid"
        return 0
      fi
    fi
    if ! exact_focus_supervision_process_exists "$pgid" \
      && ! exact_focus_supervision_group_exists "$pgid"; then
      return 1
    fi
    exact_focus_supervision_pause 1
    (( attempt += 1 ))
  done
  return 2
}
exact_focus_supervision_group_exists() {
  /bin/kill -0 -"$1" 2>/dev/null
}
exact_focus_supervision_stop_group() {
  EFCS_LAST_GROUP_REAP_PROVEN=0
  EFCS_LAST_LIVE_GUARDIAN_AUTHENTICATED=0
  local ownership_file="" projection="" authenticated=""
  if (( EFCS_GUARDIAN_IDENTITY_REQUIRED == 1 )); then
    exact_focus_supervision_path_is_absent "$EFCS_GUARDIAN_IDENTITY_FILE" && return 1
    ownership_file="$EFCS_GUARDIAN_IDENTITY_FILE"
  elif ! exact_focus_supervision_path_is_absent "$EFCS_GROUP_PID_FILE"; then
    ownership_file="$EFCS_GROUP_PID_FILE"
  elif ! exact_focus_supervision_path_is_absent "$EFCS_ADMISSION_ACK_FILE"; then
    ownership_file="$EFCS_ADMISSION_ACK_FILE"
  elif exact_focus_supervision_path_is_absent "$EFCS_GROUP_PID_FILE" \
    && exact_focus_supervision_path_is_absent "$EFCS_ADMISSION_ACK_FILE" \
    && exact_focus_supervision_path_is_absent "$EFCS_GUARDIAN_IDENTITY_FILE"; then
    return 0
  else
    return 1
  fi
  projection="$(exact_focus_supervision_owner_projection)" || return 1
  local pgid lookup_status=0 attempt=0
  pgid="$(exact_focus_supervision_owned_group_pid_from_file \
    "$ownership_file" "$projection" 2>/dev/null)" \
    || lookup_status="$?"
  if (( lookup_status == 1 )); then
    exact_focus_supervision_remove_identical_owner_records "$projection" || return 1
    EFCS_GUARDIAN_IDENTITY_REQUIRED=0
    EFCS_LAST_GROUP_REAP_PROVEN=1
    return 0
  fi
  (( lookup_status == 0 )) || return 1
  EFCS_LAST_LIVE_GUARDIAN_AUTHENTICATED=1
  authenticated="$(exact_focus_supervision_owned_group_pid_from_file \
    "$ownership_file" "$projection" 2>/dev/null)" || return 1
  [[ "$authenticated" == "$pgid" ]] || return 1
  exact_focus_supervision_send_group_signal TERM "$pgid" || true
  while exact_focus_supervision_group_exists "$pgid" && (( attempt < 80 )); do
    exact_focus_supervision_pause 5
    (( attempt += 1 ))
  done
  if exact_focus_supervision_group_exists "$pgid"; then
    authenticated="$(exact_focus_supervision_owned_group_pid_from_file \
      "$ownership_file" "$projection" 2>/dev/null)" || return 1
    [[ "$authenticated" == "$pgid" ]] || return 1
    exact_focus_supervision_send_group_signal KILL "$pgid" || true
  fi
  attempt=0
  while exact_focus_supervision_group_exists "$pgid" && (( attempt < 60 )); do
    exact_focus_supervision_pause 2
    (( attempt += 1 ))
  done
  exact_focus_supervision_group_exists "$pgid" && return 1
  exact_focus_supervision_remove_identical_owner_records "$projection" || return 1
  EFCS_GUARDIAN_IDENTITY_REQUIRED=0
  EFCS_LAST_GROUP_REAP_PROVEN=1
}
exact_focus_supervision_settle_late_group_record() {
  local attempt=0
  while (( attempt < 1000 )); do
    if ! exact_focus_supervision_path_is_absent "$EFCS_GUARDIAN_IDENTITY_FILE"; then
      exact_focus_supervision_stop_group || return 1
      exact_focus_supervision_path_is_absent "$EFCS_GROUP_PID_FILE" \
        && exact_focus_supervision_path_is_absent "$EFCS_ADMISSION_ACK_FILE" \
        && exact_focus_supervision_path_is_absent "$EFCS_GUARDIAN_IDENTITY_FILE" || return 1
      return 0
    fi
    exact_focus_supervision_pause 1
    (( attempt += 1 ))
  done
  return 1
}
exact_focus_supervision_supervisor_projection_is_valid() {
  (( $# == 9 )) || return 2
  local pid="$1" owner="$2" helper="$3" protocol="$4" parent command
  parent="$(exact_focus_supervision_process_parent_id "$pid" || true)"
  [[ "$parent" == "$owner" ]] || return 1
  command="$(exact_focus_supervision_process_command "$pid" || true)"
  /usr/bin/env node "$protocol" --validate-supervisor-process-identity \
    "$command" "$helper" "$owner" "$5" "$6" "$7" "$8" "$9"
}
exact_focus_supervision_signal_supervisor_if_current() {
  (( $# == 10 )) || return 2
  exact_focus_supervision_supervisor_projection_is_valid "${@:2}" || return 1
  exact_focus_supervision_send_process_signal "$1" "$2"
}
exact_focus_supervision_supervisor_identity_is_valid() {
  [[ -n "$1" && "$EFCS_SUPERVISOR_TOKEN" =~ '^[0-9a-f]{32}$' \
    && -n "$EFCS_READY_FILE" && -n "$EFCS_FAILURE_RECEIPT_FILE" \
    && -n "$EFCS_GUARDIAN_IDENTITY_FILE" ]] || return 1
  exact_focus_supervision_supervisor_projection_is_valid "$1" "$$" \
    "$EFCS_SUPERVISION_HELPER" "$EFCS_SUPERVISION_PROTOCOL" "$EFCS_SUPERVISOR_TOKEN" "$EFCS_GROUP_PID_FILE" \
    "$EFCS_GUARDIAN_IDENTITY_FILE" "$EFCS_READY_FILE" "$EFCS_FAILURE_RECEIPT_FILE"
}
exact_focus_supervision_stop_supervisor() {
  local pid="$1" attempt=0 wait_status=0
  EFCS_LAST_STOPPED_SUPERVISOR_STATUS=""
  [[ -n "$pid" ]] || return 0
  if ! exact_focus_supervision_process_exists "$pid"; then
    wait "$pid" 2>/dev/null || wait_status="$?"
    EFCS_LAST_STOPPED_SUPERVISOR_STATUS="$wait_status"
    return 0
  fi
  exact_focus_supervision_supervisor_identity_is_valid "$pid" || return 1
  exact_focus_supervision_send_process_signal TERM "$pid" || true
  while exact_focus_supervision_process_exists "$pid" && (( attempt < 200 )); do
    exact_focus_supervision_pause 5
    (( attempt += 1 ))
  done
  if exact_focus_supervision_process_exists "$pid"; then
    exact_focus_supervision_supervisor_identity_is_valid "$pid" || return 1
    exact_focus_supervision_send_process_signal KILL "$pid" || true
  fi
  attempt=0
  while exact_focus_supervision_process_exists "$pid" && (( attempt < 60 )); do
    exact_focus_supervision_pause 2
    (( attempt += 1 ))
  done
  wait "$pid" 2>/dev/null || wait_status="$?"
  EFCS_LAST_STOPPED_SUPERVISOR_STATUS="$wait_status"
  ! exact_focus_supervision_process_exists "$pid"
}
exact_focus_supervision_finish_sender() {
  [[ -n "$EFCS_SIGNAL_SENDER_PID" ]] || return 0
  local sender_status=0
  wait "$EFCS_SIGNAL_SENDER_PID" || sender_status="$?"
  EFCS_SIGNAL_SENDER_PID=""
  (( sender_status == 0 ))
}
exact_focus_supervision_set_shell_finalizer_failure() {
  local supervisor_status="$1"
  [[ "$supervisor_status" == <-> ]] || supervisor_status=125
  EFCS_LAST_SUPERVISOR_DETAIL=shell_finalizer_failure
  EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL=""
  EFCS_LAST_SUPERVISOR_CLEANUP_STAGE=""
  EFCS_LAST_SUPERVISOR_REASON=shell_finalizer
  EFCS_LAST_SUPERVISOR_STAGE=shell_finalizer
  EFCS_LAST_SUPERVISOR_STATUS="$supervisor_status"
}
exact_focus_supervision_capture_failure_detail() {
  local receipt_file="$1" expected_status="$2" projection="" repeated="" detail="" reason="" \
    stage="" receipt_status="" cleanup_detail="" cleanup_stage="" extra=""
  projection="$(/usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" \
    --read-supervisor-failure-detail "$receipt_file" 2>/dev/null)" || projection=""
  read -r receipt_status detail stage reason cleanup_detail cleanup_stage extra \
    <<< "$projection" || true
  if [[ "$expected_status" == <-> && "$receipt_status" == "$expected_status" \
    && -n "$detail" && -n "$stage" && -n "$reason" && -z "$extra" \
    && ( "$cleanup_detail" == absent && "$cleanup_stage" == absent \
      || ( "$cleanup_detail" == group_reap_failed \
        && "$cleanup_stage" == final_group_reap ) \
      || ( "$cleanup_detail" == group_record_remove_failed \
        && "$cleanup_stage" == group_record_remove ) ) ]]; then
    EFCS_LAST_SUPERVISOR_DETAIL="$detail"
    EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL=""
    EFCS_LAST_SUPERVISOR_CLEANUP_STAGE=""
    if [[ "$cleanup_detail" != absent ]]; then
      EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL="$cleanup_detail"
      EFCS_LAST_SUPERVISOR_CLEANUP_STAGE="$cleanup_stage"
    fi
    EFCS_LAST_SUPERVISOR_REASON="$reason"
    EFCS_LAST_SUPERVISOR_STAGE="$stage"
    EFCS_LAST_SUPERVISOR_STATUS="$receipt_status"
    repeated="$(/usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" \
      --read-supervisor-failure-detail "$receipt_file" 2>/dev/null)" || return 1
    [[ "$repeated" == "$projection" ]] || return 1
    rm -f -- "$receipt_file" || return 1
    exact_focus_supervision_path_is_absent "$receipt_file" || return 1
    return 0
  fi
  exact_focus_supervision_set_shell_finalizer_failure "$expected_status"
  return 1
}
exact_focus_supervision_resolve_failure_receipt() {
  local receipt_status="$1" allow_absent="${2:-0}"
  [[ -n "$EFCS_FAILURE_RECEIPT_FILE" ]] || return 0
  if [[ -n "$EFCS_FAILURE_RECEIPT_PUBLICATION_FAILURE" ]] \
    && exact_focus_supervision_path_is_absent "$EFCS_FAILURE_RECEIPT_FILE"; then
    exact_focus_supervision_set_shell_finalizer_failure "$receipt_status"
    return 1
  fi
  if (( receipt_status == 0 )); then
    exact_focus_supervision_path_is_absent "$EFCS_FAILURE_RECEIPT_FILE" || return 1
  elif ! exact_focus_supervision_path_is_absent "$EFCS_FAILURE_RECEIPT_FILE"; then
    exact_focus_supervision_capture_failure_detail \
      "$EFCS_FAILURE_RECEIPT_FILE" "$receipt_status" \
      || { exact_focus_supervision_set_shell_finalizer_failure "$receipt_status"; return 1; }
  elif (( allow_absent != 1 )) || [[ -n "$EFCS_FAILURE_RECEIPT_PUBLICATION_FAILURE" ]]; then
    exact_focus_supervision_set_shell_finalizer_failure "$receipt_status"
    return 1
  fi
  EFCS_FAILURE_RECEIPT_FILE=""
}
exact_focus_supervision_reconcile_outer_reap() {
  local child_status="$1"
  REPLY="$child_status"
  EFCS_OUTER_REAP_RECOVERED=0
  if [[ "$child_status" == 125 \
    && "$EFCS_LAST_SUPERVISOR_STATUS" == 125 \
    && "$EFCS_LAST_SUPERVISOR_DETAIL" == group_reap_failed \
    && "$EFCS_LAST_SUPERVISOR_STAGE" == final_group_reap \
    && "$EFCS_LAST_SUPERVISOR_REASON" == timeout ]] \
    && (( EFCS_LAST_GROUP_REAP_PROVEN == 1 )) \
    && exact_focus_supervision_path_is_absent "$EFCS_GROUP_PID_FILE" \
    && exact_focus_supervision_path_is_absent "$EFCS_ADMISSION_ACK_FILE" \
    && { [[ -z "$EFCS_GUARDIAN_IDENTITY_FILE" ]] \
      || exact_focus_supervision_path_is_absent "$EFCS_GUARDIAN_IDENTITY_FILE"; }; then
    REPLY=124
    EFCS_OUTER_REAP_RECOVERED=1
  fi
}
exact_focus_supervision_run_to_files() {
  local timeout_ms="$1" stdout_file="$2" stderr_file="$3"
  shift 3
  exact_focus_supervision_set_shell_finalizer_failure 125
  EFCS_OUTER_REAP_RECOVERED=0
  EFCS_HANDSHAKE_ABORTED_AFTER_ADMISSION_ACK=0
  exact_focus_supervision_admission_state_is_clear || return 125
  [[ ! -e "$stdout_file" && ! -L "$stdout_file" \
    && ! -e "$stderr_file" && ! -L "$stderr_file" ]] || return 125
  /usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" --create-private-output-files \
    "$stdout_file" "$stderr_file" || return 125
  local output_file output_mode output_size output_invalid=0
  for output_file in "$stdout_file" "$stderr_file"; do
    [[ -f "$output_file" && ! -L "$output_file" ]] || output_invalid=1
    output_mode="$(/usr/bin/stat -f '%Lp' "$output_file" 2>/dev/null || true)"
    output_size="$(/usr/bin/stat -f '%z' "$output_file" 2>/dev/null || true)"
    [[ "$output_mode" == 600 && "$output_size" == 0 ]] || output_invalid=1
  done
  if (( output_invalid == 1 )); then
    rm -f "$stdout_file" "$stderr_file"
    return 125
  fi
  (( EFCS_SEQUENCE += 1 ))
  EFCS_READY_FILE="$EFCS_TMP_ROOT/supervisor-ready-$EFCS_SEQUENCE"
  EFCS_GUARDIAN_IDENTITY_FILE="$EFCS_TMP_ROOT/supervisor-guardian-$EFCS_SEQUENCE.identity"
  EFCS_FAILURE_RECEIPT_FILE="$EFCS_TMP_ROOT/supervisor-failure-$EFCS_SEQUENCE.receipt"
  EFCS_GUARDIAN_IDENTITY_REQUIRED=1
  exact_focus_supervision_path_is_absent "$EFCS_READY_FILE" \
    && exact_focus_supervision_path_is_absent "$EFCS_GUARDIAN_IDENTITY_FILE" \
    && exact_focus_supervision_path_is_absent "$EFCS_FAILURE_RECEIPT_FILE" \
    && { [[ -z "$EFCS_READY_DELAY_ENTERED_FILE" ]] \
      || exact_focus_supervision_path_is_absent "$EFCS_READY_DELAY_ENTERED_FILE"; } || {
    EFCS_HANDSHAKE_FAILED=1
    return 125
  }
  EFCS_SUPERVISOR_TOKEN="$(/usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" \
    --generate-supervisor-token 2>/dev/null)" || { EFCS_SUPERVISOR_TOKEN=""; return 125; }
  [[ "$EFCS_SUPERVISOR_TOKEN" =~ '^[0-9a-f]{32}$' ]] \
    || { EFCS_SUPERVISOR_TOKEN=""; return 125; }
  local arguments=(
    --supervise-command
    --owner-pid "$$"
    --supervisor-token "$EFCS_SUPERVISOR_TOKEN"
    --group-pid-file "$EFCS_GROUP_PID_FILE"
    --guardian-identity-file "$EFCS_GUARDIAN_IDENTITY_FILE"
    --ready-file "$EFCS_READY_FILE"
    --failure-receipt-file "$EFCS_FAILURE_RECEIPT_FILE"
    --timeout-ms "$timeout_ms"
  )
  if (( EFCS_READY_DELAY_MS > 0 )); then
    arguments+=(--self-test-ready-delay-ms "$EFCS_READY_DELAY_MS")
    [[ -z "$EFCS_READY_DELAY_ENTERED_FILE" ]] || arguments+=(--self-test-ready-delay-entered-file "$EFCS_READY_DELAY_ENTERED_FILE")
  fi
  if (( EFCS_GUARDIAN_RECORD_DELAY_MS > 0 )); then
    arguments+=(--self-test-guardian-record-delay-ms "$EFCS_GUARDIAN_RECORD_DELAY_MS")
  fi
  if (( EFCS_ADMISSION_ACK_DELAY_MS > 0 )); then
    arguments+=(--self-test-admission-ack-delay-ms "$EFCS_ADMISSION_ACK_DELAY_MS")
  fi
  if (( EFCS_GUARDIAN_RECORD_PUBLICATION_FAILURE == 1 )); then
    arguments+=(--self-test-guardian-record-publication-failure)
  fi
  if (( EFCS_GUARDIAN_IDENTITY_PUBLICATION_FAILURE == 1 )); then
    arguments+=(--self-test-guardian-identity-publication-failure)
  fi
  if (( EFCS_GUARDIAN_CRASH_BEFORE_ACK == 1 )); then
    arguments+=(--self-test-guardian-crash-before-ack)
  fi
  if (( EFCS_SUPERVISOR_EXIT_BEFORE_GROUP_RECORD == 1 )); then
    arguments+=(--self-test-supervisor-exit-before-group-record)
  fi
  if (( EFCS_SUPERVISOR_EXIT_BEFORE_ADMISSION_ACK == 1 )); then
    arguments+=(--self-test-supervisor-exit-before-admission-ack)
  fi
  if (( EFCS_THROW_AFTER_READINESS == 1 )); then
    arguments+=(--self-test-throw-after-readiness)
  fi
  if (( EFCS_GROUP_RECORD_REMOVE_FAILURE == 1 )); then
    arguments+=(--self-test-group-record-remove-failure)
  fi
  if (( EFCS_FIRST_TIER_REAP_FAILURE == 1 )); then
    arguments+=(--self-test-first-tier-reap-failure)
  fi
  if [[ -n "$EFCS_FAILURE_RECEIPT_PUBLICATION_FAILURE" ]]; then
    arguments+=(--self-test-failure-receipt-publication-failure \
      "$EFCS_FAILURE_RECEIPT_PUBLICATION_FAILURE")
  fi
  if (( EFCS_FINAL_REAP_DELAY_MS > 0 )); then
    EFCS_FINAL_REAP_FILE="$EFCS_TMP_ROOT/supervisor-final-reap-$EFCS_SEQUENCE"
    EFCS_FINAL_REAP_COMPLETE_FILE="$EFCS_TMP_ROOT/supervisor-final-reap-complete-$EFCS_SEQUENCE"
    arguments+=(
      --self-test-final-reap-delay-ms "$EFCS_FINAL_REAP_DELAY_MS"
      --self-test-final-reap-file "$EFCS_FINAL_REAP_FILE"
      --self-test-final-reap-complete-file "$EFCS_FINAL_REAP_COMPLETE_FILE"
    )
  fi
  if (( EFCS_PAYLOAD_OUTCOME_DELAY_MS > 0 )); then
    EFCS_PAYLOAD_OUTCOME_FILE="$EFCS_TMP_ROOT/supervisor-payload-outcome-$EFCS_SEQUENCE"
    arguments+=(
      --self-test-payload-outcome-delay-ms "$EFCS_PAYLOAD_OUTCOME_DELAY_MS"
      --self-test-payload-outcome-file "$EFCS_PAYLOAD_OUTCOME_FILE"
    )
  fi
  if [[ -n "$EFCS_TIMEOUT_READINESS_FILE" ]]; then
    arguments+=(
      --self-test-timeout-readiness-file "$EFCS_TIMEOUT_READINESS_FILE"
      --self-test-timeout-startup-ms "$EFCS_TIMEOUT_STARTUP_MS"
    )
  fi
  AOS_DISABLE_DAEMON_AUTOSTART=1 AOS_ALLOW_DAEMON_AUTOSTART=0 \
    /usr/bin/env node "$EFCS_SUPERVISION_HELPER" "${arguments[@]}" -- "$@" \
      >"$stdout_file" 2>"$stderr_file" &
  EFCS_PID="$!"
  local supervised_pid="$EFCS_PID"
  if (( EFCS_KILL_SUPERVISOR_AFTER_PAYLOAD_OUTCOME == 1 )); then
    /bin/zsh -c '
      . "$5"
      zmodload zsh/zselect
      integer attempt=0
      while (( attempt < 600 )); do
        if [[ -f "$1" && ! -L "$1" && -f "$2" && ! -L "$2" ]]; then
          [[ "$(<"$1")" == validated ]] || exit 1
          descendant_pid="$(tr -d "[:space:]" < "$2")"
          [[ "$descendant_pid" == <-> ]] || exit 1
          /bin/kill -0 "$descendant_pid" || exit 1
          exact_focus_supervision_signal_supervisor_if_current KILL "$3" "$6" \
            "$7" "$8" "$9" "${10}" "${11}" "${12}" "${13}" || exit 1
          umask 077
          print -r -- "killed-after-validated-outcome $descendant_pid" > "$4.tmp"
          /bin/mv "$4.tmp" "$4"
          exit 0
        fi
        zselect -t 1 || true
        (( attempt += 1 ))
      done
      exit 1
    ' payload-outcome-kill "$EFCS_PAYLOAD_OUTCOME_FILE" "$EFCS_DESCENDANT_PID_FILE" \
      "$supervised_pid" "$EFCS_SIGNAL_RECEIPT_FILE" "$EFCS_SUPERVISION_SHELL_SOURCE" "$$" \
      "$EFCS_SUPERVISION_HELPER" "$EFCS_SUPERVISION_PROTOCOL" "$EFCS_SUPERVISOR_TOKEN" "$EFCS_GROUP_PID_FILE" \
      "$EFCS_GUARDIAN_IDENTITY_FILE" "$EFCS_READY_FILE" "$EFCS_FAILURE_RECEIPT_FILE" &
    EFCS_SIGNAL_SENDER_PID="$!"
  elif (( EFCS_SIGNAL_BEFORE_ADMISSION_ACK == 1 )); then
    /bin/zsh -c '
      . "$5"
      zmodload zsh/zselect
      integer attempt=0
      while (( attempt < 600 )); do
        if [[ -e "$1" || -L "$1" ]]; then
          marker="$(/usr/bin/env node "$4" --read-owner-record "$1" 2>/dev/null)" || exit 1
          read -r leader_pid token <<< "$marker" || exit 1
          /bin/kill -0 "$leader_pid" || exit 1
          exact_focus_supervision_signal_supervisor_if_current TERM "$2" "$6" \
            "$7" "$4" "$8" "$1" "$9" "${10}" "${11}" || exit 1
          umask 077
          print -r -- "sent-before-admission $leader_pid" > "$3.tmp"
          /bin/mv "$3.tmp" "$3"
          exit 0
        fi
        zselect -t 1 || true
        (( attempt += 1 ))
      done
      exit 1
    ' admission-signal "$EFCS_GROUP_PID_FILE" "$supervised_pid" \
      "$EFCS_SIGNAL_RECEIPT_FILE" "$EFCS_SUPERVISION_PROTOCOL" \
      "$EFCS_SUPERVISION_SHELL_SOURCE" "$$" \
      "$EFCS_SUPERVISION_HELPER" "$EFCS_SUPERVISOR_TOKEN" \
      "$EFCS_GUARDIAN_IDENTITY_FILE" "$EFCS_READY_FILE" \
      "$EFCS_FAILURE_RECEIPT_FILE" &
    EFCS_SIGNAL_SENDER_PID="$!"
  elif (( EFCS_SIGNAL_FINAL_REAP == 1 )); then
    /bin/zsh -c '
      . "$5"
      zmodload zsh/zselect
      integer attempt=0
      while (( attempt < 400 )); do
        if [[ -f "$1" && -f "$2" ]]; then
          descendant_pid="$(tr -d "[:space:]" < "$2")"
          [[ "$descendant_pid" == <-> ]] || exit 1
          /bin/kill -0 "$descendant_pid" || exit 1
          exact_focus_supervision_signal_supervisor_if_current TERM "$3" "$6" \
            "$7" "$8" "$9" "${10}" "${11}" "${12}" "${13}" || exit 1
          zselect -t 5 || true
          exact_focus_supervision_signal_supervisor_if_current TERM "$3" "$6" \
            "$7" "$8" "$9" "${10}" "${11}" "${12}" "${13}" || exit 1
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
    ' final-reap-signal "$EFCS_FINAL_REAP_FILE" "$EFCS_DESCENDANT_PID_FILE" \
      "$supervised_pid" "$EFCS_SIGNAL_RECEIPT_FILE" "$EFCS_SUPERVISION_SHELL_SOURCE" "$$" \
      "$EFCS_SUPERVISION_HELPER" "$EFCS_SUPERVISION_PROTOCOL" "$EFCS_SUPERVISOR_TOKEN" "$EFCS_GROUP_PID_FILE" \
      "$EFCS_GUARDIAN_IDENTITY_FILE" "$EFCS_READY_FILE" "$EFCS_FAILURE_RECEIPT_FILE" &
    EFCS_SIGNAL_SENDER_PID="$!"
  fi
  local attempt=0 ready_pid=""
  while exact_focus_supervision_path_is_absent "$EFCS_READY_FILE" \
    && kill -0 "$supervised_pid" 2>/dev/null && (( attempt < 600 )); do
    if (( EFCS_FAIL_HANDSHAKE_AFTER_ADMISSION_ACK == 1 )) \
      && exact_focus_supervision_admission_delay_oracle_is_valid; then
      EFCS_HANDSHAKE_ABORTED_AFTER_ADMISSION_ACK=1
      break
    fi
    exact_focus_supervision_pause 1
    (( attempt += 1 ))
  done
  if (( EFCS_HANDSHAKE_ABORTED_AFTER_ADMISSION_ACK == 0 )) \
    && [[ -e "$EFCS_READY_FILE" || -L "$EFCS_READY_FILE" ]]; then
    ready_pid="$(/usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" \
      --read-supervisor-ready "$EFCS_READY_FILE" 2>/dev/null)" || ready_pid=""
  fi
  if (( EFCS_HANDSHAKE_ABORTED_AFTER_ADMISSION_ACK == 1 )) \
    || [[ "$ready_pid" != "$supervised_pid" ]]; then
    EFCS_HANDSHAKE_FAILED=1
    exact_focus_supervision_stop_supervisor "$supervised_pid" || return 125
    local handshake_status="${EFCS_LAST_STOPPED_SUPERVISOR_STATUS:-125}" allow_absent=0
    (( EFCS_SUPERVISOR_EXIT_BEFORE_GROUP_RECORD == 1 \
      || EFCS_SUPERVISOR_EXIT_BEFORE_ADMISSION_ACK == 1 )) && allow_absent=1
    exact_focus_supervision_resolve_failure_receipt \
      "$handshake_status" "$allow_absent" || return 125
    exact_focus_supervision_settle_late_group_record || return 125
    exact_focus_supervision_path_is_absent "$EFCS_GROUP_PID_FILE" \
      && exact_focus_supervision_path_is_absent "$EFCS_ADMISSION_ACK_FILE" \
      && exact_focus_supervision_path_is_absent "$EFCS_GUARDIAN_IDENTITY_FILE" || return 125
    wait "$supervised_pid" 2>/dev/null || true
    exact_focus_supervision_finish_sender || EFCS_HANDSHAKE_FAILED=1
    EFCS_PID=""
    EFCS_SUPERVISOR_TOKEN=""
    return 125
  fi
  local child_status=0 wait_status=0 interruptions=0
  while true; do
    wait_status=0
    wait "$supervised_pid" || wait_status="$?"
    if ! kill -0 "$supervised_pid" 2>/dev/null; then
      child_status="$wait_status"
      break
    fi
    (( interruptions += 1 ))
    if (( interruptions >= 8 )); then
      exact_focus_supervision_stop_supervisor "$supervised_pid" || return 125
      child_status="${EFCS_LAST_STOPPED_SUPERVISOR_STATUS:-125}"
      break
    fi
  done
  local receipt_failed=0 allow_absent=0
  (( EFCS_KILL_SUPERVISOR_AFTER_PAYLOAD_OUTCOME == 1 && child_status == 137 )) \
    && allow_absent=1
  exact_focus_supervision_resolve_failure_receipt "$child_status" "$allow_absent" \
    || { exact_focus_supervision_set_shell_finalizer_failure "$child_status"; receipt_failed=1; }
  if (( child_status == 0 && receipt_failed == 0 )); then
    EFCS_LAST_SUPERVISOR_DETAIL=""
    EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL=""
    EFCS_LAST_SUPERVISOR_CLEANUP_STAGE=""
    EFCS_LAST_SUPERVISOR_REASON=""
    EFCS_LAST_SUPERVISOR_STAGE=""
    EFCS_LAST_SUPERVISOR_STATUS=""
  fi
  if exact_focus_supervision_process_exists "$supervised_pid"; then
    exact_focus_supervision_stop_supervisor "$supervised_pid" || {
      exact_focus_supervision_set_shell_finalizer_failure 125
      return 125
    }
  fi
  wait "$supervised_pid" 2>/dev/null || true
  if (( EFCS_CORRUPT_GUARDIAN_IDENTITY == 1 )) \
    && [[ -f "$EFCS_GUARDIAN_IDENTITY_FILE" && ! -L "$EFCS_GUARDIAN_IDENTITY_FILE" ]]; then
    print -r -- invalid >| "$EFCS_GUARDIAN_IDENTITY_FILE"
    chmod 600 "$EFCS_GUARDIAN_IDENTITY_FILE" || return 125
  fi
  exact_focus_supervision_stop_group || {
    exact_focus_supervision_set_shell_finalizer_failure 125
    return 125
  }
  exact_focus_supervision_path_is_absent "$EFCS_GROUP_PID_FILE" \
    && exact_focus_supervision_path_is_absent "$EFCS_ADMISSION_ACK_FILE" \
    && exact_focus_supervision_path_is_absent "$EFCS_GUARDIAN_IDENTITY_FILE" || {
    exact_focus_supervision_set_shell_finalizer_failure 125
    return 125
  }
  exact_focus_supervision_remove_expected_ready "$supervised_pid" || {
    exact_focus_supervision_set_shell_finalizer_failure 125
    return 125
  }
  exact_focus_supervision_finish_sender || {
    exact_focus_supervision_set_shell_finalizer_failure 125
    return 125
  }
  exact_focus_supervision_reconcile_outer_reap "$child_status"
  child_status="$REPLY"
  (( receipt_failed == 0 )) || return 125
  EFCS_READY_FILE=""
  EFCS_GUARDIAN_IDENTITY_FILE=""
  EFCS_TIMEOUT_READINESS_FILE=""
  EFCS_TIMEOUT_STARTUP_MS=0
  EFCS_PID=""
  EFCS_SUPERVISOR_TOKEN=""
  return "$child_status"
}
exact_focus_supervision_run_driver() {
  local timeout_ms="$1"
  shift
  exact_focus_supervision_run_to_files "$timeout_ms" "$EFCS_DRIVER_STDOUT" "$EFCS_DRIVER_STDERR" "$@"
}
exact_focus_supervision_quiesce() {
  local failed=0 supervisor_pid="$EFCS_PID" supervisor_status=0 allow_absent=0
  if [[ -n "$EFCS_SIGNAL_SENDER_PID" ]]; then
    exact_focus_supervision_finish_sender || failed=1
  fi
  exact_focus_supervision_stop_group || true
  if [[ -n "$supervisor_pid" ]]; then
    exact_focus_supervision_stop_supervisor "$supervisor_pid" || failed=1
    supervisor_status="${EFCS_LAST_STOPPED_SUPERVISOR_STATUS:-125}"
  fi
  (( EFCS_KILL_SUPERVISOR_AFTER_PAYLOAD_OUTCOME == 1 && supervisor_status == 137 \
    || EFCS_SUPERVISOR_EXIT_BEFORE_GROUP_RECORD == 1 \
    || EFCS_SUPERVISOR_EXIT_BEFORE_ADMISSION_ACK == 1 )) && allow_absent=1
  exact_focus_supervision_resolve_failure_receipt \
    "$supervisor_status" "$allow_absent" || failed=1
  exact_focus_supervision_stop_group || failed=1
  [[ -z "$supervisor_pid" ]] \
    || ! exact_focus_supervision_process_exists "$supervisor_pid" || failed=1
  if exact_focus_supervision_path_is_absent "$EFCS_GROUP_PID_FILE" \
    && exact_focus_supervision_path_is_absent "$EFCS_ADMISSION_ACK_FILE" \
    && { [[ -z "$EFCS_GUARDIAN_IDENTITY_FILE" ]] \
      || exact_focus_supervision_path_is_absent "$EFCS_GUARDIAN_IDENTITY_FILE"; }; then
    (( EFCS_GUARDIAN_IDENTITY_REQUIRED == 0 )) || failed=1
  else
    failed=1
  fi
  if (( failed == 0 )); then
    [[ -z "$EFCS_READY_FILE" ]] \
      || exact_focus_supervision_remove_expected_ready "$supervisor_pid" || failed=1
  fi
  if (( failed == 0 )); then
    EFCS_READY_FILE=""
    EFCS_GUARDIAN_IDENTITY_FILE=""
    EFCS_PID=""
    EFCS_SUPERVISOR_TOKEN=""
  fi
  (( failed == 0 ))
}
