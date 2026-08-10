# Focused process-group ownership for the exact focus-channel proof. The caller
# supplies every path once; this module neither installs traps nor removes roots.

exact_focus_supervision_init() {
  (( $# == 8 )) || return 2
  typeset -g EFCS_SUPERVISION_HELPER="$1"
  typeset -g EFCS_SELF_TEST_HELPER="$2"
  typeset -g EFCS_SUPERVISION_PROTOCOL="$3"
  typeset -g EFCS_PROOF_CONTRACT="$4"
  typeset -g EFCS_TMP_ROOT="$5"
  typeset -g EFCS_GROUP_PID_FILE="$6"
  typeset -g EFCS_ADMISSION_ACK_FILE="$6.admission-ack"
  typeset -g EFCS_DRIVER_STDOUT="$7"
  typeset -g EFCS_DRIVER_STDERR="$8"
  typeset -g EFCS_LAST_SUPERVISOR_DETAIL=""
  typeset -g EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL=""
  typeset -g EFCS_LAST_SUPERVISOR_CLEANUP_STAGE=""
  typeset -g EFCS_LAST_SUPERVISOR_REASON=""
  typeset -g EFCS_LAST_SUPERVISOR_STAGE=""
  typeset -g EFCS_LAST_SUPERVISOR_STATUS=""
  typeset -g EFCS_PID=""
  typeset -g EFCS_READY_FILE=""
  typeset -gi EFCS_SEQUENCE=0
  typeset -gi EFCS_HANDSHAKE_FAILED=0
  typeset -gi EFCS_READY_DELAY_MS=0
  typeset -gi EFCS_WRAPPER_RECORD_DELAY_MS=0
  typeset -gi EFCS_ADMISSION_ACK_DELAY_MS=0
  typeset -gi EFCS_WRAPPER_RECORD_PUBLICATION_FAILURE=0
  typeset -gi EFCS_WRAPPER_CRASH_BEFORE_ACK=0
  typeset -gi EFCS_SUPERVISOR_EXIT_BEFORE_GROUP_RECORD=0
  typeset -gi EFCS_SUPERVISOR_EXIT_BEFORE_ADMISSION_ACK=0
  typeset -gi EFCS_SIGNAL_BEFORE_ADMISSION_ACK=0
  typeset -gi EFCS_THROW_AFTER_READINESS=0
  typeset -gi EFCS_GROUP_RECORD_REMOVE_FAILURE=0
  typeset -gi EFCS_FIRST_TIER_REAP_FAILURE=0
  typeset -gi EFCS_LAST_GROUP_REAP_PROVEN=0
  typeset -gi EFCS_OUTER_REAP_RECOVERED=0
  typeset -gi EFCS_FINAL_REAP_DELAY_MS=0
  typeset -gi EFCS_SIGNAL_FINAL_REAP=0
  typeset -gi EFCS_TIMEOUT_STARTUP_MS=0
  typeset -g EFCS_TIMEOUT_READINESS_FILE=""
  typeset -g EFCS_SIGNAL_SENDER_PID=""
  typeset -g EFCS_SIGNAL_RECEIPT_FILE=""
  typeset -g EFCS_WRAPPER_IDENTITY_FILE=""
  typeset -gi EFCS_WRAPPER_IDENTITY_REQUIRED=0
  typeset -gi EFCS_WRAPPER_IDENTITY_PUBLICATION_FAILURE=0
  typeset -gi EFCS_CORRUPT_WRAPPER_IDENTITY=0
  typeset -g EFCS_FINAL_REAP_FILE=""
  typeset -g EFCS_FINAL_REAP_COMPLETE_FILE=""
  typeset -g EFCS_DESCENDANT_PID_FILE=""
}

exact_focus_supervision_pause() {
  zmodload zsh/zselect
  zselect -t "$1" || true
}

exact_focus_supervision_process_exists() {
  /bin/kill -0 "$1" 2>/dev/null
}

exact_focus_supervision_process_group_id() {
  ps -p "$1" -o pgid= 2>/dev/null | tr -d '[:space:]'
}

exact_focus_supervision_process_command() {
  ps -ww -p "$1" -o command= 2>/dev/null
}

exact_focus_supervision_command_has_ownership_token() {
  (( $# == 2 )) || return 2
  local command="$1" token="$2" pattern
  [[ "$token" =~ '^[0-9a-f]{32}$' ]] || return 2
  pattern="(^|[[:space:]])--ownership-token[[:space:]]${token}([[:space:]]|$)"
  [[ "$command" =~ $pattern ]]
}

exact_focus_supervision_admission_state_is_clear() {
  [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
    && -z "$EFCS_PID" && -z "$EFCS_READY_FILE" ]] || return 1
  (( EFCS_WRAPPER_IDENTITY_REQUIRED == 0 ))
}

exact_focus_supervision_owned_group_pid_from_file() {
  local ownership_file="$1"
  [[ -f "$ownership_file" && ! -L "$ownership_file" ]] || return 1
  local pgid token actual_pgid command attempt=0
  read -r pgid token < "$ownership_file" || return 2
  [[ "$pgid" == <-> && "$token" =~ '^[0-9a-f]{32}$' ]] || return 2
  /usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" --validate-wrapper-identity \
    "$ownership_file" "$pgid" "$token" || return 2
  while (( attempt < 20 )); do
    actual_pgid="$(exact_focus_supervision_process_group_id "$pgid" || true)"
    command=""
    if [[ "$actual_pgid" == "$pgid" ]]; then
      command="$(exact_focus_supervision_process_command "$pgid" || true)"
      if [[ "$command" == *"$EFCS_SUPERVISION_HELPER --owned-group-wrapper --group-pid-file $EFCS_GROUP_PID_FILE --admission-ack-file $EFCS_ADMISSION_ACK_FILE --supervisor-pid "* ]] \
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
  local ownership_file=""
  if (( EFCS_WRAPPER_IDENTITY_REQUIRED == 1 )); then
    [[ -f "$EFCS_WRAPPER_IDENTITY_FILE" && ! -L "$EFCS_WRAPPER_IDENTITY_FILE" ]] \
      || return 1
    ownership_file="$EFCS_WRAPPER_IDENTITY_FILE"
  elif [[ -f "$EFCS_GROUP_PID_FILE" && ! -L "$EFCS_GROUP_PID_FILE" ]]; then
    ownership_file="$EFCS_GROUP_PID_FILE"
  elif [[ -f "$EFCS_ADMISSION_ACK_FILE" && ! -L "$EFCS_ADMISSION_ACK_FILE" ]]; then
    ownership_file="$EFCS_ADMISSION_ACK_FILE"
  elif [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
    && ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ]]; then
    return 0
  else
    return 1
  fi
  local pgid lookup_status=0 attempt=0
  pgid="$(exact_focus_supervision_owned_group_pid_from_file "$ownership_file" 2>/dev/null)" \
    || lookup_status="$?"
  if (( lookup_status == 1 )); then
    rm -f "$EFCS_ADMISSION_ACK_FILE" "$EFCS_GROUP_PID_FILE" \
      "$EFCS_WRAPPER_IDENTITY_FILE" || return 1
    EFCS_WRAPPER_IDENTITY_REQUIRED=0
    EFCS_LAST_GROUP_REAP_PROVEN=1
    return 0
  fi
  (( lookup_status == 0 )) || return 1
  /bin/kill -TERM -"$pgid" 2>/dev/null || true
  while exact_focus_supervision_group_exists "$pgid" && (( attempt < 80 )); do
    exact_focus_supervision_pause 5
    (( attempt += 1 ))
  done
  if exact_focus_supervision_group_exists "$pgid"; then
    /bin/kill -KILL -"$pgid" 2>/dev/null || true
  fi
  attempt=0
  while exact_focus_supervision_group_exists "$pgid" && (( attempt < 60 )); do
    exact_focus_supervision_pause 2
    (( attempt += 1 ))
  done
  exact_focus_supervision_group_exists "$pgid" && return 1
  rm -f "$EFCS_ADMISSION_ACK_FILE" "$EFCS_GROUP_PID_FILE" \
    "$EFCS_WRAPPER_IDENTITY_FILE" || return 1
  EFCS_WRAPPER_IDENTITY_REQUIRED=0
  EFCS_LAST_GROUP_REAP_PROVEN=1
}

exact_focus_supervision_settle_late_group_record() {
  local attempt=0
  while (( attempt < 1000 )); do
    if [[ -e "$EFCS_WRAPPER_IDENTITY_FILE" ]]; then
      exact_focus_supervision_stop_group || return 1
      [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
        && ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ]] || return 1
      return 0
    fi
    exact_focus_supervision_pause 1
    (( attempt += 1 ))
  done
  return 1
}

exact_focus_supervision_stop_pid() {
  local pid="$1" attempt=0
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 0
  kill -TERM "$pid" 2>/dev/null || true
  while kill -0 "$pid" 2>/dev/null && (( attempt < 200 )); do
    exact_focus_supervision_pause 5
    (( attempt += 1 ))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  attempt=0
  while kill -0 "$pid" 2>/dev/null && (( attempt < 60 )); do
    exact_focus_supervision_pause 2
    (( attempt += 1 ))
  done
  wait "$pid" 2>/dev/null || true
  ! kill -0 "$pid" 2>/dev/null
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
  local stderr_file="$1" expected_status="$2" projection="" detail="" reason="" \
    stage="" receipt_status="" cleanup_detail="" cleanup_stage="" extra=""
  projection="$(/usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" \
    --read-supervisor-failure-detail "$stderr_file" 2>/dev/null)" || projection=""
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
    return 0
  fi
  exact_focus_supervision_set_shell_finalizer_failure "$expected_status"
  return 1
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
    && [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
      && ( -z "$EFCS_WRAPPER_IDENTITY_FILE" || ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ) ]]; then
    REPLY=124
    EFCS_OUTER_REAP_RECOVERED=1
  fi
}

exact_focus_supervision_run_to_files() {
  local timeout_ms="$1" stdout_file="$2" stderr_file="$3"
  shift 3
  exact_focus_supervision_set_shell_finalizer_failure 125
  EFCS_OUTER_REAP_RECOVERED=0
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
  EFCS_WRAPPER_IDENTITY_FILE="$EFCS_TMP_ROOT/supervisor-wrapper-$EFCS_SEQUENCE.identity"
  EFCS_WRAPPER_IDENTITY_REQUIRED=1
  [[ ! -e "$EFCS_READY_FILE" && ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ]] || {
    EFCS_HANDSHAKE_FAILED=1
    return 125
  }
  local arguments=(
    --supervise-command
    --owner-pid "$$"
    --group-pid-file "$EFCS_GROUP_PID_FILE"
    --wrapper-identity-file "$EFCS_WRAPPER_IDENTITY_FILE"
    --ready-file "$EFCS_READY_FILE"
    --timeout-ms "$timeout_ms"
  )
  if (( EFCS_READY_DELAY_MS > 0 )); then
    arguments+=(--self-test-ready-delay-ms "$EFCS_READY_DELAY_MS")
  fi
  if (( EFCS_WRAPPER_RECORD_DELAY_MS > 0 )); then
    arguments+=(--self-test-wrapper-record-delay-ms "$EFCS_WRAPPER_RECORD_DELAY_MS")
  fi
  if (( EFCS_ADMISSION_ACK_DELAY_MS > 0 )); then
    arguments+=(--self-test-admission-ack-delay-ms "$EFCS_ADMISSION_ACK_DELAY_MS")
  fi
  if (( EFCS_WRAPPER_RECORD_PUBLICATION_FAILURE == 1 )); then
    arguments+=(--self-test-wrapper-record-publication-failure)
  fi
  if (( EFCS_WRAPPER_IDENTITY_PUBLICATION_FAILURE == 1 )); then
    arguments+=(--self-test-wrapper-identity-publication-failure)
  fi
  if (( EFCS_WRAPPER_CRASH_BEFORE_ACK == 1 )); then
    arguments+=(--self-test-wrapper-crash-before-ack)
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
  if (( EFCS_FINAL_REAP_DELAY_MS > 0 )); then
    EFCS_FINAL_REAP_FILE="$EFCS_TMP_ROOT/supervisor-final-reap-$EFCS_SEQUENCE"
    EFCS_FINAL_REAP_COMPLETE_FILE="$EFCS_TMP_ROOT/supervisor-final-reap-complete-$EFCS_SEQUENCE"
    arguments+=(
      --self-test-final-reap-delay-ms "$EFCS_FINAL_REAP_DELAY_MS"
      --self-test-final-reap-file "$EFCS_FINAL_REAP_FILE"
      --self-test-final-reap-complete-file "$EFCS_FINAL_REAP_COMPLETE_FILE"
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

  if (( EFCS_SIGNAL_BEFORE_ADMISSION_ACK == 1 )); then
    /bin/zsh -c '
      zmodload zsh/zselect
      integer attempt=0
      while (( attempt < 600 )); do
        if [[ -f "$1" && ! -L "$1" ]]; then
          marker="$(<"$1")"
          leader_pid="${marker%% *}"
          token="${marker#* }"
          [[ "$leader_pid" == <-> && "${#token}" == 32 && "$token" != *[^0-9a-f]* ]] || exit 1
          /bin/kill -0 "$leader_pid" || exit 1
          /usr/bin/env node "$4" --validate-owned-group-record "$1" "$leader_pid" "$token" \
            || exit 1
          /bin/kill -TERM "$2" || exit 1
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
      "$EFCS_SIGNAL_RECEIPT_FILE" "$EFCS_SUPERVISION_PROTOCOL" &
    EFCS_SIGNAL_SENDER_PID="$!"
  elif (( EFCS_SIGNAL_FINAL_REAP == 1 )); then
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
    ' final-reap-signal "$EFCS_FINAL_REAP_FILE" "$EFCS_DESCENDANT_PID_FILE" \
      "$supervised_pid" "$EFCS_SIGNAL_RECEIPT_FILE" &
    EFCS_SIGNAL_SENDER_PID="$!"
  fi

  local attempt=0 ready_pid="" ready_mode="" ready_size=""
  while [[ ! -e "$EFCS_READY_FILE" ]] && kill -0 "$supervised_pid" 2>/dev/null && (( attempt < 600 )); do
    exact_focus_supervision_pause 1
    (( attempt += 1 ))
  done
  if [[ -f "$EFCS_READY_FILE" && ! -L "$EFCS_READY_FILE" ]]; then
    ready_mode="$(/usr/bin/stat -f '%Lp' "$EFCS_READY_FILE" 2>/dev/null || true)"
    ready_size="$(/usr/bin/stat -f '%z' "$EFCS_READY_FILE" 2>/dev/null || true)"
    ready_pid="$(<"$EFCS_READY_FILE")"
  fi
  if [[ "$ready_pid" != "$supervised_pid" || "$ready_pid" != <-> || "$ready_mode" != 600 \
    || "$ready_size" != <-> ]] || (( ready_size < 2 || ready_size > 32 )); then
    EFCS_HANDSHAKE_FAILED=1
    exact_focus_supervision_stop_pid "$supervised_pid" || return 125
    exact_focus_supervision_settle_late_group_record || return 125
    [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
      && ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ]] || return 125
    wait "$supervised_pid" 2>/dev/null || true
    exact_focus_supervision_finish_sender || EFCS_HANDSHAKE_FAILED=1
    EFCS_PID=""
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
      exact_focus_supervision_stop_pid "$supervised_pid" || return 125
      child_status=125
      break
    fi
  done
  if (( child_status != 0 )); then
    exact_focus_supervision_capture_failure_detail "$stderr_file" "$child_status" || true
  else
    EFCS_LAST_SUPERVISOR_DETAIL=""
    EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL=""
    EFCS_LAST_SUPERVISOR_CLEANUP_STAGE=""
    EFCS_LAST_SUPERVISOR_REASON=""
    EFCS_LAST_SUPERVISOR_STAGE=""
    EFCS_LAST_SUPERVISOR_STATUS=""
  fi
  if kill -0 "$supervised_pid" 2>/dev/null; then
    exact_focus_supervision_stop_pid "$supervised_pid" || {
      exact_focus_supervision_set_shell_finalizer_failure 125
      return 125
    }
  fi
  wait "$supervised_pid" 2>/dev/null || true
  if (( EFCS_CORRUPT_WRAPPER_IDENTITY == 1 )) \
    && [[ -f "$EFCS_WRAPPER_IDENTITY_FILE" && ! -L "$EFCS_WRAPPER_IDENTITY_FILE" ]]; then
    print -r -- invalid >| "$EFCS_WRAPPER_IDENTITY_FILE"
    chmod 600 "$EFCS_WRAPPER_IDENTITY_FILE" || return 125
  fi
  exact_focus_supervision_stop_group || {
    exact_focus_supervision_set_shell_finalizer_failure 125
    return 125
  }
  [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
    && ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ]] || {
    exact_focus_supervision_set_shell_finalizer_failure 125
    return 125
  }
  rm -f "$EFCS_READY_FILE" || {
    exact_focus_supervision_set_shell_finalizer_failure 125
    return 125
  }
  exact_focus_supervision_finish_sender || {
    exact_focus_supervision_set_shell_finalizer_failure 125
    return 125
  }
  exact_focus_supervision_reconcile_outer_reap "$child_status"
  child_status="$REPLY"
  EFCS_READY_FILE=""
  EFCS_WRAPPER_IDENTITY_FILE=""
  EFCS_TIMEOUT_READINESS_FILE=""
  EFCS_TIMEOUT_STARTUP_MS=0
  EFCS_PID=""
  return "$child_status"
}

exact_focus_supervision_run_driver() {
  local timeout_ms="$1"
  shift
  exact_focus_supervision_run_to_files "$timeout_ms" "$EFCS_DRIVER_STDOUT" "$EFCS_DRIVER_STDERR" "$@"
}

exact_focus_supervision_quiesce() {
  local failed=0
  if [[ -n "$EFCS_SIGNAL_SENDER_PID" ]]; then
    exact_focus_supervision_finish_sender || failed=1
  fi
  exact_focus_supervision_stop_group || true
  exact_focus_supervision_stop_pid "$EFCS_PID" || true
  exact_focus_supervision_stop_group || true
  [[ -z "$EFCS_PID" ]] || ! kill -0 "$EFCS_PID" 2>/dev/null || failed=1
  if [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
    && ( -z "$EFCS_WRAPPER_IDENTITY_FILE" || ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ) ]]; then
    (( EFCS_WRAPPER_IDENTITY_REQUIRED == 0 )) || failed=1
  else
    failed=1
  fi
  if (( failed == 0 )); then
    [[ -z "$EFCS_READY_FILE" ]] || rm -f "$EFCS_READY_FILE" || failed=1
  fi
  if (( failed == 0 )); then
    EFCS_READY_FILE=""
    EFCS_WRAPPER_IDENTITY_FILE=""
    EFCS_PID=""
  fi
  (( failed == 0 ))
}
