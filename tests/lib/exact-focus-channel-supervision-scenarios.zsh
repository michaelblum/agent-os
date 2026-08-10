# Offline-only scenarios for the exact focus-channel supervision contract.
# The runner sources this side-effect-free query only after no runner-owned mode matched.

exact_focus_supervision_scenario_init() {
  typeset -g EFCS_PAYLOAD_MARKER_FILE=""
  typeset -g EFCS_SCENARIO_CLEANUP_MODE="none"
  typeset -g EFCS_SCENARIO_ERROR=""
  typeset -g EFCS_SCENARIO_SUMMARY=""
  typeset -gi EFCS_SCENARIO_EXIT_STATUS=0
}

exact_focus_supervision_scenario_fail() {
  if [[ -z "$EFCS_SCENARIO_ERROR" ]]; then
    EFCS_SCENARIO_ERROR="{\"error_code\":\"$1\",\"status\":\"failed\"}"
  fi
  return 1
}

exact_focus_supervision_scenario_status_fail() {
  [[ "$2" == <-> ]] || return 2
  local handshake_failed=false
  (( EFCS_HANDSHAKE_FAILED == 1 )) && handshake_failed=true
  if [[ -z "$EFCS_SCENARIO_ERROR" ]]; then
    EFCS_SCENARIO_ERROR="{\"error_code\":\"$1\",\"handshake_failed\":$handshake_failed,\"status\":\"failed\",\"supervisor_status\":$2}"
  fi
  return 1
}

exact_focus_supervision_scenario_receipt_mismatch() {
  local error_code="$1" actual_status="$EFCS_LAST_SUPERVISOR_STATUS" \
    cleanup_fields="" handshake_failed=false
  if [[ "$actual_status" != <-> \
    || ! "$EFCS_LAST_SUPERVISOR_DETAIL" =~ '^[a-z0-9_]+$' \
    || ! "$EFCS_LAST_SUPERVISOR_REASON" =~ '^[a-z0-9_]+$' \
    || ! "$EFCS_LAST_SUPERVISOR_STAGE" =~ '^[a-z0-9_]+$' ]]; then
    exact_focus_supervision_scenario_fail "$error_code"
    return 1
  fi
  if [[ -n "$EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL" \
    || -n "$EFCS_LAST_SUPERVISOR_CLEANUP_STAGE" ]]; then
    case "$EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL:$EFCS_LAST_SUPERVISOR_CLEANUP_STAGE" in
      group_reap_failed:final_group_reap|group_record_remove_failed:group_record_remove) ;;
      *) exact_focus_supervision_scenario_fail "$error_code"; return 1 ;;
    esac
    cleanup_fields=",\"supervisor_cleanup_detail\":\"$EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL\",\"supervisor_cleanup_stage\":\"$EFCS_LAST_SUPERVISOR_CLEANUP_STAGE\""
  fi
  (( EFCS_HANDSHAKE_FAILED == 1 )) && handshake_failed=true
  if [[ -z "$EFCS_SCENARIO_ERROR" ]]; then
    EFCS_SCENARIO_ERROR="{\"error_code\":\"$error_code\",\"handshake_failed\":$handshake_failed,\"status\":\"failed\",\"supervisor_detail\":\"$EFCS_LAST_SUPERVISOR_DETAIL\",\"supervisor_reason\":\"$EFCS_LAST_SUPERVISOR_REASON\",\"supervisor_stage\":\"$EFCS_LAST_SUPERVISOR_STAGE\",\"supervisor_status\":$actual_status$cleanup_fields}"
  fi
  return 1
}

exact_focus_supervision_timeout_status_failure() {
  local error_prefix="$1" supervisor_status="$2" supervisor_detail="${3:-}" \
    supervisor_stage="${4:-}" supervisor_reason="${5:-}" error_code=""
  [[ "$error_prefix" == TIMEOUT || "$error_prefix" == PROGRESS_TIMEOUT \
    || "$error_prefix" == INJECTED_SUPERVISOR || "$error_prefix" == PAYLOAD_EXIT \
    || "$error_prefix" == OUTER_REAP ]] || return 2
  [[ "$supervisor_status" == <-> ]] || return 2
  error_code="${error_prefix}_STATUS_MISMATCH"
  (( supervisor_status == 0 )) \
    && error_code="${error_prefix}_UNEXPECTED_INNER_COMPLETION"
  if (( supervisor_status != 0 )); then
    case "$supervisor_reason" in
      group_record_failed|initialization_timeout|none|parent_lost|payload_exit|sigint|sigterm|supervisor_exception|timeout|shell_finalizer) ;;
      *) exact_focus_supervision_scenario_status_fail "$error_code" "$supervisor_status"; return 1 ;;
    esac
    case "$supervisor_status:$supervisor_detail:$supervisor_stage:$supervisor_reason" in
      125:group_reap_failed:final_group_reap:*) error_code="${error_prefix}_GROUP_REAP_FAILED" ;;
      125:group_record_remove_failed:group_record_remove:*) error_code="${error_prefix}_GROUP_RECORD_REMOVE_FAILED" ;;
      125:group_record_failed:admission_ack_publish:group_record_failed|125:group_record_failed:final_group_reap:group_record_failed|125:group_record_failed:group_record_wait:group_record_failed) error_code="${error_prefix}_GROUP_RECORD_FAILED" ;;
      125:parent_lost:admission_ack_publish:parent_lost|125:parent_lost:group_record_wait:parent_lost|125:parent_lost:payload_readiness_wait:parent_lost|125:parent_lost:wrapper_result_wait:parent_lost|125:parent_lost:wrapper_spawn:parent_lost) error_code="${error_prefix}_PARENT_LOST" ;;
      126:payload_initialization_timeout:payload_readiness_wait:initialization_timeout) error_code="${error_prefix}_PAYLOAD_INITIALIZATION_TIMEOUT" ;;
      *:payload_nonzero_exit:wrapper_result_wait:payload_exit) error_code="${error_prefix}_PAYLOAD_NONZERO_EXIT" ;;
      125:payload_spawn_or_init_failure:wrapper_result_wait:payload_exit) error_code="${error_prefix}_PAYLOAD_SPAWN_OR_INIT_FAILURE" ;;
      130:supervisor_signal:*:sigint|143:supervisor_signal:*:sigterm) error_code="${error_prefix}_SUPERVISOR_SIGNAL" ;;
      124:supervisor_timeout:*:timeout) error_code="${error_prefix}_SUPERVISOR_TIMEOUT" ;;
      125:unexpected_supervisor_exception:*:supervisor_exception) error_code="${error_prefix}_UNEXPECTED_SUPERVISOR_EXCEPTION" ;;
      125:wrapper_admission_failure:admission_ack_publish:payload_exit|125:wrapper_admission_failure:group_record_wait:payload_exit|125:wrapper_admission_failure:wrapper_result_wait:payload_exit) error_code="${error_prefix}_WRAPPER_ADMISSION_FAILURE" ;;
      *:wrapper_or_payload_failure:wrapper_result_wait:payload_exit) error_code="${error_prefix}_WRAPPER_OR_PAYLOAD_FAILURE" ;;
      *:shell_finalizer_failure:shell_finalizer:shell_finalizer) error_code="${error_prefix}_SHELL_FINALIZER_FAILURE" ;;
      *) exact_focus_supervision_scenario_status_fail "$error_code" "$supervisor_status"; return 1 ;;
    esac
    local handshake_failed=false
    (( EFCS_HANDSHAKE_FAILED == 1 )) && handshake_failed=true
    if [[ -z "$EFCS_SCENARIO_ERROR" ]]; then
      EFCS_SCENARIO_ERROR="{\"error_code\":\"$error_code\",\"handshake_failed\":$handshake_failed,\"status\":\"failed\",\"supervisor_detail\":\"$supervisor_detail\",\"supervisor_reason\":\"$supervisor_reason\",\"supervisor_stage\":\"$supervisor_stage\",\"supervisor_status\":$supervisor_status}"
    fi
    return 1
  fi
  exact_focus_supervision_scenario_status_fail "$error_code" "$supervisor_status"
}

exact_focus_supervision_progress_status_failure() {
  exact_focus_supervision_timeout_status_failure \
    PROGRESS_TIMEOUT "$1" "${2:-}" "${3:-}" "${4:-}"
}

exact_focus_supervision_timeout_receipt_is_valid() {
  case "$EFCS_LAST_SUPERVISOR_DETAIL:$EFCS_LAST_SUPERVISOR_STAGE:$EFCS_LAST_SUPERVISOR_REASON:$EFCS_LAST_SUPERVISOR_STATUS:$EFCS_OUTER_REAP_RECOVERED" in
    supervisor_timeout:wrapper_result_wait:timeout:124:0) return 0 ;;
    group_reap_failed:final_group_reap:timeout:125:1) return 0 ;;
    *) return 1 ;;
  esac
}

exact_focus_supervision_scenario_timeout() {
      local variant="$1" command_status=0 receipt_status=0
      local readiness="$EFCS_TMP_ROOT/basic-timeout-readiness.json"
      local nonce="$(/usr/bin/env node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
      local -a payload_arguments=(--basic-timeout-self-test --readiness "$readiness")
      if [[ "$variant" == remove ]]; then
        EFCS_GROUP_RECORD_REMOVE_FAILURE=1
        payload_arguments+=(--self-test-default-sigterm)
      fi
      EFCS_TIMEOUT_READINESS_FILE="$readiness"
      EFCS_TIMEOUT_STARTUP_MS=5000
      AOS_PROCESS_TREE_READINESS_NONCE="$nonce" \
        exact_focus_supervision_run_driver 50 /usr/bin/env node "$EFCS_SELF_TEST_HELPER" \
        "${payload_arguments[@]}" || command_status="$?"
      AOS_PROCESS_TREE_READINESS_NONCE="$nonce" \
        /usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" --validate-process-tree-retired "$readiness" \
        || receipt_status="$?"
      if (( command_status == 126 || receipt_status == 2 )); then
        exact_focus_supervision_scenario_fail TIMEOUT_INITIALIZATION_FAILED
      elif (( command_status != 124 )); then
        exact_focus_supervision_timeout_status_failure TIMEOUT "$command_status" \
          "$EFCS_LAST_SUPERVISOR_DETAIL" "$EFCS_LAST_SUPERVISOR_STAGE" \
          "$EFCS_LAST_SUPERVISOR_REASON"
      elif ! exact_focus_supervision_timeout_receipt_is_valid; then
        exact_focus_supervision_scenario_fail TIMEOUT_RECEIPT_INVALID
      elif (( receipt_status == 3 )); then
        exact_focus_supervision_scenario_fail TIMEOUT_PAYLOAD_RETAINED
      fi
      [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
        && ( -z "$EFCS_WRAPPER_IDENTITY_FILE" || ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ) ]] \
        || exact_focus_supervision_scenario_fail TIMEOUT_GROUP_RECORD_RETAINED
      if [[ "$variant" == remove ]]; then
        [[ "$EFCS_LAST_SUPERVISOR_DETAIL" == supervisor_timeout \
          && "$EFCS_LAST_SUPERVISOR_REASON" == timeout \
          && "$EFCS_LAST_SUPERVISOR_STAGE" == wrapper_result_wait \
          && "$EFCS_LAST_SUPERVISOR_STATUS" == 124 \
          && "$EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL" == group_record_remove_failed \
          && "$EFCS_LAST_SUPERVISOR_CLEANUP_STAGE" == group_record_remove ]] \
          || exact_focus_supervision_scenario_receipt_mismatch \
            TIMEOUT_REMOVE_FAILURE_RECEIPT_MISMATCH
        EFCS_GROUP_RECORD_REMOVE_FAILURE=0
        EFCS_SCENARIO_CLEANUP_MODE=remove
        EFCS_SCENARIO_SUMMARY='{"cleanup_complete":true,"primary_timeout_preserved":true,"status":"passed","supervisor_cleanup_detail":"group_record_remove_failed","supervisor_cleanup_stage":"group_record_remove","supervisor_detail":"supervisor_timeout","supervisor_reason":"timeout","supervisor_stage":"wrapper_result_wait","supervisor_status":124}'
      else
        EFCS_SCENARIO_SUMMARY='{"owned_process_group_reaped":true,"status":"passed"}'
      fi
}

exact_focus_supervision_scenario_payload_exit() {
      local variant="$1" command_status=0 receipt_status=0
      local readiness="$EFCS_TMP_ROOT/payload-exit-readiness.json"
      local nonce="$(/usr/bin/env node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
      EFCS_TIMEOUT_READINESS_FILE="$readiness"
      EFCS_TIMEOUT_STARTUP_MS=5000
      [[ "$variant" == remove ]] \
        && EFCS_GROUP_RECORD_REMOVE_FAILURE=1
      AOS_PROCESS_TREE_READINESS_NONCE="$nonce" \
        exact_focus_supervision_run_driver 1000 /usr/bin/env node "$EFCS_SELF_TEST_HELPER" \
        --basic-timeout-self-test --readiness "$readiness" --self-test-exit-status 1 \
        || command_status="$?"
      AOS_PROCESS_TREE_READINESS_NONCE="$nonce" \
        /usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" --validate-process-tree-retired "$readiness" \
        || receipt_status="$?"
      (( command_status == 1 )) \
        || exact_focus_supervision_timeout_status_failure PAYLOAD_EXIT "$command_status" \
          "$EFCS_LAST_SUPERVISOR_DETAIL" "$EFCS_LAST_SUPERVISOR_STAGE" \
          "$EFCS_LAST_SUPERVISOR_REASON"
      [[ "$EFCS_LAST_SUPERVISOR_DETAIL" == payload_nonzero_exit \
        && "$EFCS_LAST_SUPERVISOR_REASON" == payload_exit \
        && "$EFCS_LAST_SUPERVISOR_STAGE" == wrapper_result_wait \
        && "$EFCS_LAST_SUPERVISOR_STATUS" == 1 ]] \
        || exact_focus_supervision_scenario_fail PAYLOAD_EXIT_RECEIPT_MISMATCH
      (( receipt_status == 0 && EFCS_OUTER_REAP_RECOVERED == 0 )) \
        || exact_focus_supervision_scenario_fail PAYLOAD_EXIT_RETIREMENT_INVALID
      if [[ "$variant" == remove ]]; then
        [[ "$EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL" == group_record_remove_failed \
          && "$EFCS_LAST_SUPERVISOR_CLEANUP_STAGE" == group_record_remove ]] \
          || exact_focus_supervision_scenario_receipt_mismatch \
            PAYLOAD_EXIT_REMOVE_FAILURE_RECEIPT_MISMATCH
      else
        [[ -z "$EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL" \
          && -z "$EFCS_LAST_SUPERVISOR_CLEANUP_STAGE" ]] \
          || exact_focus_supervision_scenario_receipt_mismatch PAYLOAD_EXIT_RECEIPT_MISMATCH
      fi
      [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
        && ( -z "$EFCS_WRAPPER_IDENTITY_FILE" || ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ) ]] \
        || exact_focus_supervision_scenario_fail PAYLOAD_EXIT_OWNERSHIP_RETAINED
      EFCS_SCENARIO_CLEANUP_MODE=remove
      if [[ "$variant" == remove ]]; then
        EFCS_GROUP_RECORD_REMOVE_FAILURE=0
        EFCS_SCENARIO_SUMMARY='{"cleanup_complete":true,"payload_exit_status_preserved":true,"status":"passed","supervisor_cleanup_detail":"group_record_remove_failed","supervisor_cleanup_stage":"group_record_remove","supervisor_detail":"payload_nonzero_exit","supervisor_reason":"payload_exit","supervisor_stage":"wrapper_result_wait","supervisor_status":1}'
      else
        EFCS_SCENARIO_SUMMARY='{"cleanup_complete":true,"payload_exit_status_preserved":true,"status":"passed","supervisor_detail":"payload_nonzero_exit","supervisor_reason":"payload_exit","supervisor_stage":"wrapper_result_wait","supervisor_status":1}'
      fi
}

exact_focus_supervision_scenario_outer_reap() {
      local command_status=0 receipt_status=0
      local readiness="$EFCS_TMP_ROOT/outer-reap-readiness.json"
      local nonce="$(/usr/bin/env node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
      EFCS_FIRST_TIER_REAP_FAILURE=1
      EFCS_TIMEOUT_READINESS_FILE="$readiness"
      EFCS_TIMEOUT_STARTUP_MS=5000
      AOS_PROCESS_TREE_READINESS_NONCE="$nonce" \
        exact_focus_supervision_run_driver 50 /usr/bin/env node "$EFCS_SELF_TEST_HELPER" \
        --basic-timeout-self-test --readiness "$readiness" || command_status="$?"
      AOS_PROCESS_TREE_READINESS_NONCE="$nonce" \
        /usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" --validate-process-tree-retired "$readiness" \
        || receipt_status="$?"
      (( command_status == 124 )) \
        || exact_focus_supervision_timeout_status_failure OUTER_REAP "$command_status" \
          "$EFCS_LAST_SUPERVISOR_DETAIL" "$EFCS_LAST_SUPERVISOR_STAGE" \
          "$EFCS_LAST_SUPERVISOR_REASON"
      [[ "$EFCS_LAST_SUPERVISOR_DETAIL" == group_reap_failed \
        && "$EFCS_LAST_SUPERVISOR_REASON" == timeout \
        && "$EFCS_LAST_SUPERVISOR_STAGE" == final_group_reap \
        && "$EFCS_LAST_SUPERVISOR_STATUS" == 125 ]] \
        || exact_focus_supervision_scenario_fail OUTER_REAP_RECEIPT_MISMATCH
      (( receipt_status == 0 && EFCS_OUTER_REAP_RECOVERED == 1 )) \
        || exact_focus_supervision_scenario_fail OUTER_REAP_RECOVERY_INVALID
      [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
        && ( -z "$EFCS_WRAPPER_IDENTITY_FILE" || ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ) ]] \
        || exact_focus_supervision_scenario_fail OUTER_REAP_OWNERSHIP_RETAINED
      EFCS_FIRST_TIER_REAP_FAILURE=0
      EFCS_SCENARIO_CLEANUP_MODE=remove
      EFCS_SCENARIO_SUMMARY='{"cleanup_complete":true,"outer_reap_recovered":true,"status":"passed","supervisor_detail":"group_reap_failed","supervisor_reason":"timeout","supervisor_stage":"final_group_reap","supervisor_status":125}'
}

exact_focus_supervision_scenario_injected_failure() {
      local variant="$1" command_status=0 receipt_status=0
      local readiness="$EFCS_TMP_ROOT/injected-supervisor-readiness.json"
      local nonce="$(/usr/bin/env node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
      local expected_detail=unexpected_supervisor_exception expected_reason=supervisor_exception \
        expected_stage=payload_readiness_wait supervision_timeout=50 \
        payload_arguments=(--basic-timeout-self-test --readiness "$readiness")
      if [[ "$variant" == post_ready ]]; then
        EFCS_THROW_AFTER_READINESS=1
        payload_arguments+=(--self-test-default-sigterm)
      else
        EFCS_GROUP_RECORD_REMOVE_FAILURE=1
        supervision_timeout=2000
        expected_detail=group_record_remove_failed
        expected_reason=none
        expected_stage=group_record_remove
        payload_arguments+=(--self-test-exit-after-readiness-ms 100)
      fi
      EFCS_TIMEOUT_READINESS_FILE="$readiness"
      EFCS_TIMEOUT_STARTUP_MS=5000
      AOS_PROCESS_TREE_READINESS_NONCE="$nonce" \
        exact_focus_supervision_run_driver "$supervision_timeout" \
        /usr/bin/env node "$EFCS_SELF_TEST_HELPER" "${payload_arguments[@]}" || command_status="$?"
      AOS_PROCESS_TREE_READINESS_NONCE="$nonce" \
        /usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" --validate-process-tree-retired "$readiness" \
        || receipt_status="$?"
      (( command_status == 125 )) \
        || exact_focus_supervision_timeout_status_failure INJECTED_SUPERVISOR \
          "$command_status" "$EFCS_LAST_SUPERVISOR_DETAIL" "$EFCS_LAST_SUPERVISOR_STAGE" \
          "$EFCS_LAST_SUPERVISOR_REASON"
      (( EFCS_HANDSHAKE_FAILED == 0 )) \
        || exact_focus_supervision_scenario_fail INJECTED_SUPERVISOR_HANDSHAKE_FAILED
      [[ "$EFCS_LAST_SUPERVISOR_DETAIL" == "$expected_detail" \
        && "$EFCS_LAST_SUPERVISOR_REASON" == "$expected_reason" \
        && "$EFCS_LAST_SUPERVISOR_STAGE" == "$expected_stage" \
        && "$EFCS_LAST_SUPERVISOR_STATUS" == 125 ]] \
        || exact_focus_supervision_scenario_receipt_mismatch \
          INJECTED_SUPERVISOR_RECEIPT_MISMATCH
      [[ ( -z "$EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL" \
          && -z "$EFCS_LAST_SUPERVISOR_CLEANUP_STAGE" ) \
        || ( "$EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL" == group_reap_failed \
          && "$EFCS_LAST_SUPERVISOR_CLEANUP_STAGE" == final_group_reap ) \
        || ( "$EFCS_LAST_SUPERVISOR_CLEANUP_DETAIL" == group_record_remove_failed \
          && "$EFCS_LAST_SUPERVISOR_CLEANUP_STAGE" == group_record_remove ) ]] \
        || exact_focus_supervision_scenario_receipt_mismatch \
          INJECTED_SUPERVISOR_RECEIPT_MISMATCH
      (( receipt_status == 0 )) \
        || exact_focus_supervision_scenario_fail INJECTED_SUPERVISOR_PAYLOAD_RETAINED
      [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
        && ( -z "$EFCS_WRAPPER_IDENTITY_FILE" || ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ) \
        && -z "$EFCS_PID" ]] \
        || exact_focus_supervision_scenario_fail INJECTED_SUPERVISOR_OWNERSHIP_RETAINED
      EFCS_THROW_AFTER_READINESS=0
      EFCS_GROUP_RECORD_REMOVE_FAILURE=0
      EFCS_SCENARIO_CLEANUP_MODE=remove
      EFCS_SCENARIO_SUMMARY="{\"cleanup_complete\":true,\"handshake_failed\":false,\"injected_supervisor_failure_reaped\":true,\"status\":\"passed\",\"supervisor_detail\":\"$expected_detail\",\"supervisor_reason\":\"$expected_reason\",\"supervisor_stage\":\"$expected_stage\",\"supervisor_status\":125}"
}

exact_focus_supervision_scenario_process_tree() {
      local variant="$1" command_status=0 receipt_status=0
      local readiness="$EFCS_TMP_ROOT/process-tree-readiness.json"
      local nonce="$(/usr/bin/env node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
      local withheld=0 arguments=(--hang-with-grandchild --readiness "$readiness")
      if [[ "$variant" == withheld ]]; then
        withheld=1
        arguments+=(--withhold-readiness)
      fi
      EFCS_TIMEOUT_READINESS_FILE="$readiness"
      EFCS_TIMEOUT_STARTUP_MS=5000
      AOS_PROCESS_TREE_READINESS_NONCE="$nonce" \
        exact_focus_supervision_run_driver 1000 /usr/bin/env node "$EFCS_SELF_TEST_HELPER" "${arguments[@]}" \
        || command_status="$?"
      AOS_PROCESS_TREE_READINESS_NONCE="$nonce" \
        /usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" --validate-process-tree-retired "$readiness" \
        || receipt_status="$?"
      if (( command_status == 126 )); then
        (( withheld == 1 && receipt_status == 2 )) \
          || exact_focus_supervision_scenario_fail PROCESS_TREE_INITIALIZATION_FAILED
      elif (( command_status != 124 )); then
        exact_focus_supervision_scenario_fail PROCESS_TREE_SUPERVISOR_STATUS_MISMATCH
      elif (( receipt_status == 2 )); then
        exact_focus_supervision_scenario_fail PROCESS_TREE_INITIALIZATION_FAILED
      elif (( receipt_status == 3 )); then
        exact_focus_supervision_scenario_fail PROCESS_TREE_DESCENDANT_RETAINED
      fi
      [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
        && ( -z "$EFCS_WRAPPER_IDENTITY_FILE" || ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ) ]] \
        || exact_focus_supervision_scenario_fail PROCESS_TREE_GROUP_RECORD_RETAINED
      if (( withheld == 1 )); then
        EFCS_SCENARIO_SUMMARY='{"initialization_error_code":"PROCESS_TREE_INITIALIZATION_FAILED","owned_group_reaped":true,"status":"passed","withheld_readiness_cleanup":true}'
      else
        EFCS_SCENARIO_SUMMARY='{"owned_descendant_reaped":true,"status":"passed"}'
      fi
}

exact_focus_supervision_scenario_progress_timeout() {
      local command_status=0 receipt_status=0
      local pid_file="$EFCS_TMP_ROOT/progress-grandchild.pid" pid="" \
        readiness="$EFCS_TMP_ROOT/progress-timeout-readiness.json"
      local nonce="$(/usr/bin/env node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
      EFCS_TIMEOUT_READINESS_FILE="$readiness"
      EFCS_TIMEOUT_STARTUP_MS=10000
      AOS_PROCESS_TREE_READINESS_NONCE="$nonce" \
        exact_focus_supervision_run_driver 5000 /usr/bin/env node "$EFCS_SELF_TEST_HELPER" \
        --progress-hang-self-test --progress "$EFCS_TMP_ROOT/progress.json" \
        --pid-file "$pid_file" --readiness "$readiness" \
        || command_status="$?"
      AOS_PROCESS_TREE_READINESS_NONCE="$nonce" \
        /usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" --validate-process-tree-retired "$readiness" \
        || receipt_status="$?"
      [[ ! -f "$pid_file" ]] || pid="$(tr -d '[:space:]' < "$pid_file")"
      if (( command_status != 124 )); then
        exact_focus_supervision_progress_status_failure \
          "$command_status" "$EFCS_LAST_SUPERVISOR_DETAIL" "$EFCS_LAST_SUPERVISOR_STAGE" \
          "$EFCS_LAST_SUPERVISOR_REASON"
      elif ! exact_focus_supervision_timeout_receipt_is_valid; then
        exact_focus_supervision_scenario_fail PROGRESS_TIMEOUT_RECEIPT_INVALID
      elif (( receipt_status == 2 )) || [[ "$pid" != <-> ]]; then
        exact_focus_supervision_scenario_fail PROGRESS_TIMEOUT_PID_MISSING_OR_INVALID
      elif (( receipt_status == 3 )) || kill -0 "$pid" 2>/dev/null; then
        exact_focus_supervision_scenario_fail PROGRESS_TIMEOUT_DESCENDANT_RETAINED
      elif [[ -e "$EFCS_GROUP_PID_FILE" || -e "$EFCS_ADMISSION_ACK_FILE" \
        || ( -n "$EFCS_WRAPPER_IDENTITY_FILE" && -e "$EFCS_WRAPPER_IDENTITY_FILE" ) ]]; then
        exact_focus_supervision_scenario_fail PROGRESS_TIMEOUT_GROUP_RECORD_RETAINED
      fi
      EFCS_SCENARIO_CLEANUP_MODE="remove"
      EFCS_SCENARIO_EXIT_STATUS=124
      EFCS_SCENARIO_SUMMARY='{"cleanup_complete":true,"error_code":"PROOF_TIMEOUT","microphone_requested":false,"pixels_persisted":false,"raw_capture_logged":false,"status":"failed"}'
}

exact_focus_supervision_scenario_run_program_timeout() {
      local command_status=0 receipt_status=0
      local readiness="$EFCS_TMP_ROOT/run-program-timeout-readiness.json"
      exact_focus_supervision_run_driver 12000 /usr/bin/env node "$EFCS_SELF_TEST_HELPER" \
        --run-program-timeout-self-test --readiness "$readiness" || command_status="$?"
      /usr/bin/env node "$EFCS_SUPERVISION_PROTOCOL" --validate-run-program-receipt "$EFCS_DRIVER_STDOUT" \
        || receipt_status="$?"
      (( command_status == 1 )) \
        || exact_focus_supervision_scenario_fail RUN_PROGRAM_TIMEOUT_SUPERVISOR_STATUS_MISMATCH
      (( receipt_status != 2 )) \
        || exact_focus_supervision_scenario_fail RUN_PROGRAM_TIMEOUT_INITIALIZATION_FAILED
      (( receipt_status != 3 )) \
        || exact_focus_supervision_scenario_fail RUN_PROGRAM_TIMEOUT_UNEXPECTED_INNER_COMPLETION
      (( receipt_status == 0 )) \
        || exact_focus_supervision_scenario_fail RUN_PROGRAM_TIMEOUT_DRIVER_RECEIPT_INVALID
      [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
        && ( -z "$EFCS_WRAPPER_IDENTITY_FILE" || ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ) ]] \
        || exact_focus_supervision_scenario_fail RUN_PROGRAM_TIMEOUT_GROUP_RECORD_RETAINED
      ! grep -q -- RAW_PROGRESS_SENTINEL_MUST_NOT_LEAK "$EFCS_DRIVER_STDOUT" "$EFCS_DRIVER_STDERR" \
        || exact_focus_supervision_scenario_fail RUN_PROGRAM_TIMEOUT_RAW_SENTINEL_REFLECTED
      EFCS_SCENARIO_CLEANUP_MODE="remove"
      EFCS_SCENARIO_SUMMARY='{"cleanup_complete":true,"run_program_timeout_ambiguous":true,"timeout_descendant_reaped":true,"captured_output_reflected":false,"status":"passed"}'
}

exact_focus_supervision_scenario_handshake_delay() {
      local command_status=0
      EFCS_READY_DELAY_MS=8000
      exact_focus_supervision_run_to_files 1000 "$EFCS_TMP_ROOT/handshake.stdout" \
        "$EFCS_TMP_ROOT/handshake.stderr" /bin/true || command_status="$?"
      (( command_status == 125 && EFCS_HANDSHAKE_FAILED == 1 )) \
        && [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
          && ( -z "$EFCS_WRAPPER_IDENTITY_FILE" || ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ) \
          && -z "$EFCS_PID" ]] \
        || exact_focus_supervision_scenario_fail SUPERVISOR_HANDSHAKE_STATE_INVALID
      EFCS_READY_DELAY_MS=0
      EFCS_SCENARIO_CLEANUP_MODE="retain_then_remove"
      EFCS_SCENARIO_SUMMARY='{"supervisor_start_handshake_fail_closed":true,"status":"passed"}'
}

exact_focus_supervision_scenario_wrapper_identity_publication_failure() {
      local command_status=0
      EFCS_PAYLOAD_MARKER_FILE="$EFCS_TMP_ROOT/payload-admitted"
      EFCS_WRAPPER_IDENTITY_PUBLICATION_FAILURE=1
      exact_focus_supervision_run_driver 5000 /usr/bin/env node "$EFCS_SELF_TEST_HELPER" \
        --self-test-payload-admission-marker --marker "$EFCS_PAYLOAD_MARKER_FILE" \
        || command_status="$?"
      (( command_status == 125 && EFCS_HANDSHAKE_FAILED == 1 )) \
        || exact_focus_supervision_scenario_status_fail \
          WRAPPER_IDENTITY_PUBLICATION_STATUS_MISMATCH "$command_status"
      [[ ! -e "$EFCS_PAYLOAD_MARKER_FILE" && ! -e "$EFCS_WRAPPER_IDENTITY_FILE" \
        && ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" ]] \
        || exact_focus_supervision_scenario_fail WRAPPER_IDENTITY_PUBLICATION_FAIL_OPEN
      [[ -z "$EFCS_PID" ]] || ! kill -0 "$EFCS_PID" 2>/dev/null \
        || exact_focus_supervision_scenario_fail WRAPPER_IDENTITY_SUPERVISOR_RETAINED
      EFCS_SCENARIO_CLEANUP_MODE=retain_then_remove
      EFCS_SCENARIO_SUMMARY='{"payload_admitted":false,"recovery_root_retained":true,"status":"passed","wrapper_identity_publication_fail_closed":true}'
}

exact_focus_supervision_scenario_wrapper_identity_invalid() {
      local command_status=0
      EFCS_CORRUPT_WRAPPER_IDENTITY=1
      exact_focus_supervision_run_driver 5000 /bin/true || command_status="$?"
      (( command_status == 125 )) \
        || exact_focus_supervision_scenario_status_fail \
          WRAPPER_IDENTITY_INVALID_STATUS_MISMATCH "$command_status"
      [[ -f "$EFCS_WRAPPER_IDENTITY_FILE" \
        && "$(<"$EFCS_WRAPPER_IDENTITY_FILE")" == invalid ]] \
        || exact_focus_supervision_scenario_fail WRAPPER_IDENTITY_INVALID_NOT_RETAINED
      EFCS_SCENARIO_CLEANUP_MODE=retain_then_remove
      EFCS_SCENARIO_SUMMARY='{"invalid_wrapper_identity_failed_closed":true,"recovery_root_retained":true,"status":"passed"}'
}

exact_focus_supervision_scenario_admission() {
      local variant="$1" command_status=0
      EFCS_PAYLOAD_MARKER_FILE="$EFCS_TMP_ROOT/payload-admitted"
      local expected_status=125 expected_marker=0 expected_signal_receipt=0 supervision_timeout=5000
      case "$variant" in
        success)
          expected_status=124
          expected_marker=1
          supervision_timeout=1000 ;;
        record_failure)
          EFCS_WRAPPER_RECORD_PUBLICATION_FAILURE=1 ;;
        wrapper_crash)
          EFCS_WRAPPER_CRASH_BEFORE_ACK=1 ;;
        parent_before_record)
          EFCS_WRAPPER_RECORD_DELAY_MS=1000
          EFCS_SUPERVISOR_EXIT_BEFORE_GROUP_RECORD=1 ;;
        parent_before_admission)
          EFCS_SUPERVISOR_EXIT_BEFORE_ADMISSION_ACK=1 ;;
        signal_before_admission)
          EFCS_ADMISSION_ACK_DELAY_MS=1000
          EFCS_SIGNAL_BEFORE_ADMISSION_ACK=1
          EFCS_SIGNAL_RECEIPT_FILE="$EFCS_TMP_ROOT/admission-signal-sent"
          expected_signal_receipt=1 ;;
      esac
      exact_focus_supervision_run_driver "$supervision_timeout" /usr/bin/env node "$EFCS_SELF_TEST_HELPER" \
        --self-test-payload-admission-marker --marker "$EFCS_PAYLOAD_MARKER_FILE" \
        || command_status="$?"
      (( command_status == expected_status )) \
        || exact_focus_supervision_scenario_status_fail ADMISSION_SUPERVISOR_STATUS_MISMATCH "$command_status"
      if (( expected_marker == 1 )); then
        [[ -f "$EFCS_PAYLOAD_MARKER_FILE" && "$(<"$EFCS_PAYLOAD_MARKER_FILE")" == admitted ]] \
          || exact_focus_supervision_scenario_fail ADMISSION_PAYLOAD_MISSING
      else
        [[ ! -e "$EFCS_PAYLOAD_MARKER_FILE" ]] \
          || exact_focus_supervision_scenario_fail ADMISSION_PAYLOAD_UNEXPECTED
      fi
      if (( expected_signal_receipt == 1 )); then
        [[ -f "$EFCS_SIGNAL_RECEIPT_FILE" \
          && "$(<"$EFCS_SIGNAL_RECEIPT_FILE")" == 'sent-before-admission '* ]] \
          || exact_focus_supervision_scenario_fail ADMISSION_SIGNAL_SENDER_FAILED
      fi
      [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$EFCS_ADMISSION_ACK_FILE" \
        && ( -z "$EFCS_WRAPPER_IDENTITY_FILE" || ! -e "$EFCS_WRAPPER_IDENTITY_FILE" ) ]] \
        || exact_focus_supervision_scenario_fail ADMISSION_GROUP_RETAINED
      [[ -z "$EFCS_PID" && ! -e "$EFCS_READY_FILE" ]] \
        || exact_focus_supervision_scenario_fail ADMISSION_SUPERVISOR_STATE_RETAINED
      if [[ -n "$EFCS_WRAPPER_IDENTITY_FILE" && -f "$EFCS_WRAPPER_IDENTITY_FILE" ]]; then
        local wrapper_pid="" wrapper_token=""
        read -r wrapper_pid wrapper_token < "$EFCS_WRAPPER_IDENTITY_FILE" || true
        [[ "$wrapper_pid" == <-> && "$wrapper_token" =~ '^[0-9a-f]{32}$' ]] \
          && ! kill -0 "$wrapper_pid" 2>/dev/null \
          || exact_focus_supervision_scenario_fail ADMISSION_WRAPPER_RETAINED
      fi
      EFCS_WRAPPER_RECORD_DELAY_MS=0
      EFCS_ADMISSION_ACK_DELAY_MS=0
      EFCS_WRAPPER_RECORD_PUBLICATION_FAILURE=0
      EFCS_WRAPPER_CRASH_BEFORE_ACK=0
      EFCS_SUPERVISOR_EXIT_BEFORE_GROUP_RECORD=0
      EFCS_SUPERVISOR_EXIT_BEFORE_ADMISSION_ACK=0
      EFCS_SIGNAL_BEFORE_ADMISSION_ACK=0
      EFCS_SIGNAL_RECEIPT_FILE=""
      EFCS_WRAPPER_IDENTITY_FILE=""
      EFCS_READY_FILE=""
      EFCS_HANDSHAKE_FAILED=0
      EFCS_SCENARIO_CLEANUP_MODE="remove"
      case "$variant" in
        success)
          EFCS_SCENARIO_SUMMARY='{"admission_ack_bound":true,"cleanup_complete":true,"payload_admitted_after_ack":true,"status":"passed"}' ;;
        record_failure)
          EFCS_SCENARIO_SUMMARY='{"cleanup_complete":true,"payload_admitted":false,"record_publication_failure_bounded":true,"status":"passed"}' ;;
        wrapper_crash)
          EFCS_SCENARIO_SUMMARY='{"cleanup_complete":true,"payload_admitted":false,"record_recovered_after_wrapper_crash":true,"status":"passed"}' ;;
        parent_before_record)
          EFCS_SCENARIO_SUMMARY='{"cleanup_complete":true,"delayed_wrapper_reaped":true,"parent_loss_before_record_fail_closed":true,"payload_admitted":false,"status":"passed"}' ;;
        parent_before_admission)
          EFCS_SCENARIO_SUMMARY='{"cleanup_complete":true,"durable_record_recovered":true,"parent_loss_before_admission_fail_closed":true,"payload_admitted":false,"status":"passed"}' ;;
        *) EFCS_SCENARIO_SUMMARY='{"cleanup_complete":true,"payload_admitted":false,"signal_before_admission_fail_closed":true,"status":"passed"}' ;;
      esac
}

exact_focus_supervision_scenario_final_reap_signal() {
      local command_status=0
      EFCS_DESCENDANT_PID_FILE="$EFCS_TMP_ROOT/final-reap-descendant.pid"
      EFCS_SIGNAL_RECEIPT_FILE="$EFCS_TMP_ROOT/final-reap-signal-sent"
      local final_ready="$EFCS_TMP_ROOT/supervisor-ready-$((EFCS_SEQUENCE + 1))"
      EFCS_FINAL_REAP_DELAY_MS=1000
      EFCS_SIGNAL_FINAL_REAP=1
      exact_focus_supervision_run_driver 10000 /usr/bin/env node "$EFCS_SELF_TEST_HELPER" \
        --exit-with-term-ignoring-descendant --pid-file "$EFCS_DESCENDANT_PID_FILE" \
        || command_status="$?"
      local descendant="$(tr -d '[:space:]' < "$EFCS_DESCENDANT_PID_FILE" 2>/dev/null || true)"
      local group="$(tr -d '[:space:]' < "$EFCS_FINAL_REAP_FILE" 2>/dev/null || true)"
      local completion="$(tr -d '[:space:]' < "$EFCS_FINAL_REAP_COMPLETE_FILE" 2>/dev/null || true)"
      local receipt="$(tr -d '[:space:]' < "$EFCS_SIGNAL_RECEIPT_FILE" 2>/dev/null || true)"
      (( command_status == 143 && EFCS_HANDSHAKE_FAILED == 0 )) \
        && [[ "$descendant" == <-> && "$group" == <-> ]] \
        && ! kill -0 "$descendant" 2>/dev/null && ! /bin/kill -0 -"$group" 2>/dev/null \
        && [[ ! -e "$EFCS_GROUP_PID_FILE" && ! -e "$final_ready" ]] \
        && [[ "$completion" == complete && "$receipt" == descendant-live-after-two-terms-final-reap ]] \
        && [[ -z "$EFCS_PID" ]] \
        || exact_focus_supervision_scenario_fail FINAL_REAP_STATE_INVALID
      EFCS_FINAL_REAP_DELAY_MS=0
      EFCS_SIGNAL_FINAL_REAP=0
      EFCS_DESCENDANT_PID_FILE=""
      EFCS_SIGNAL_RECEIPT_FILE=""
      EFCS_SCENARIO_CLEANUP_MODE="remove"
      EFCS_SCENARIO_SUMMARY='{"cleanup_complete":true,"final_reap_signal_idempotent":true,"status":"passed"}'
}

typeset -ga EFCS_SCENARIO_HANDLER_TABLE=(
  --timeout-self-test exact_focus_supervision_scenario_timeout ordinary
  --supervisor-timeout-remove-failure-self-test exact_focus_supervision_scenario_timeout remove
  --supervisor-payload-exit1-self-test exact_focus_supervision_scenario_payload_exit ordinary
  --supervisor-payload-exit1-remove-failure-self-test exact_focus_supervision_scenario_payload_exit remove
  --supervisor-outer-reap-recovery-self-test exact_focus_supervision_scenario_outer_reap ordinary
  --supervisor-post-ready-exception-self-test exact_focus_supervision_scenario_injected_failure post_ready
  --supervisor-group-record-remove-failure-self-test exact_focus_supervision_scenario_injected_failure group_remove
  --process-tree-self-test exact_focus_supervision_scenario_process_tree ordinary
  --process-tree-withheld-readiness-self-test exact_focus_supervision_scenario_process_tree withheld
  --progress-timeout-self-test exact_focus_supervision_scenario_progress_timeout ordinary
  --run-program-timeout-self-test exact_focus_supervision_scenario_run_program_timeout ordinary
  --supervisor-handshake-delay-self-test exact_focus_supervision_scenario_handshake_delay ordinary
  --supervisor-wrapper-identity-publication-failure-self-test exact_focus_supervision_scenario_wrapper_identity_publication_failure ordinary
  --supervisor-wrapper-identity-invalid-self-test exact_focus_supervision_scenario_wrapper_identity_invalid ordinary
  --supervisor-admission-success-self-test exact_focus_supervision_scenario_admission success
  --supervisor-record-publication-failure-self-test exact_focus_supervision_scenario_admission record_failure
  --supervisor-wrapper-crash-before-admission-self-test exact_focus_supervision_scenario_admission wrapper_crash
  --supervisor-parent-loss-before-record-self-test exact_focus_supervision_scenario_admission parent_before_record
  --supervisor-parent-loss-before-admission-self-test exact_focus_supervision_scenario_admission parent_before_admission
  --supervisor-signal-before-admission-self-test exact_focus_supervision_scenario_admission signal_before_admission
  --supervisor-final-reap-signal-self-test exact_focus_supervision_scenario_final_reap_signal ordinary
)

exact_focus_supervision_scenario_handler() {
  local mode="$1"
  integer index=1
  reply=()
  while (( index <= ${#EFCS_SCENARIO_HANDLER_TABLE} )); do
    if [[ "${EFCS_SCENARIO_HANDLER_TABLE[index]}" == "$mode" ]]; then
      reply=(
        "${EFCS_SCENARIO_HANDLER_TABLE[index + 1]}"
        "${EFCS_SCENARIO_HANDLER_TABLE[index + 2]}"
      )
      return 0
    fi
    (( index += 3 ))
  done
  return 1
}

exact_focus_supervision_scenario_supports() {
  exact_focus_supervision_scenario_handler "$1"
}

exact_focus_supervision_run_scenario() {
  local mode="$1" handler="" variant=""
  EFCS_SCENARIO_CLEANUP_MODE="none"
  EFCS_SCENARIO_ERROR=""
  EFCS_SCENARIO_SUMMARY=""
  EFCS_SCENARIO_EXIT_STATUS=0
  if ! exact_focus_supervision_scenario_handler "$mode"; then
    exact_focus_supervision_scenario_fail SUPERVISION_SCENARIO_UNKNOWN
    return 1
  fi
  handler="$reply[1]"
  variant="$reply[2]"
  "$handler" "$variant"
  [[ -z "$EFCS_SCENARIO_ERROR" ]]
}
