#!/usr/bin/env bash

if [[ -z "${AOS_HARNESS_CONTRACTS_SH_LOADED:-}" ]]; then
AOS_HARNESS_CONTRACTS_SH_LOADED=1
AOS_HARNESS_CONTRACT_HELD_DIRS=()

aos_harness_contract_lock_root() {
  local user_name
  user_name="${USER:-unknown}"
  printf '%s\n' "${AOS_TEST_HARNESS_LOCK_ROOT:-${TMPDIR:-/tmp}/aos-test-harness-contracts-${user_name}}"
}

_aos_harness_contract_lock_dir() {
  local group="$1"
  local root safe_group
  root="$(aos_harness_contract_lock_root)"
  safe_group="$(printf '%s' "$group" | tr -c '[:alnum:]_.-' '_')"
  printf '%s/%s.lock\n' "$root" "$safe_group"
}

_aos_harness_contract_pid_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

_aos_harness_contract_owner_pid() {
  local owner_file="$1"
  python3 - "$owner_file" <<'PY' 2>/dev/null || true
import json
import sys
from pathlib import Path

try:
    payload = json.loads(Path(sys.argv[1]).read_text())
except Exception:
    raise SystemExit(0)
pid = payload.get("pid")
if pid is not None:
    print(pid)
PY
}

_aos_harness_contract_write_owner() {
  local owner_file="$1"
  local group="$2"
  local contract="$3"
  local groups="$4"
  local blocks="$5"
  local pid="$6"
  local script="${AOS_HARNESS_CONTRACT_SCRIPT:-${BASH_SOURCE[2]:-${BASH_SOURCE[1]:-$0}}}"
  local started_at
  started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  python3 - "$owner_file" "$group" "$contract" "$groups" "$blocks" "$pid" "$script" "$PWD" "$started_at" <<'PY'
import json
import sys
from pathlib import Path

owner_file, group, contract, groups, blocks, pid, script, cwd, started_at = sys.argv[1:10]
payload = {
    "pid": int(pid),
    "script": script,
    "cwd": cwd,
    "started_at": started_at,
    "contract": contract,
    "exclusive_group": group,
    "exclusive_groups": [item for item in groups.split(",") if item],
    "blocks": [item for item in blocks.split(",") if item],
}
Path(owner_file).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

_aos_harness_contract_conflict_message() {
  local owner_file="$1"
  local group="$2"
  local requested_contract="$3"

  python3 - "$owner_file" "$group" "$requested_contract" <<'PY' >&2
import json
import sys
from pathlib import Path

owner_file, group, requested_contract = sys.argv[1:4]
try:
    owner = json.loads(Path(owner_file).read_text())
except Exception:
    owner = {}

detail = {
    "requested_contract": requested_contract,
    "exclusive_group": group,
    "conflicting_contract": owner.get("contract", "unknown"),
    "conflicting_pid": owner.get("pid"),
    "conflicting_script": owner.get("script", "unknown"),
    "conflicting_cwd": owner.get("cwd"),
    "conflicting_started_at": owner.get("started_at"),
    "conflicting_exclusive_groups": owner.get("exclusive_groups", []),
    "conflicting_blocks": owner.get("blocks", []),
}
print("FAIL: harness-contract conflict: " + json.dumps(detail, sort_keys=True))
PY
}

aos_harness_contract_release_all() {
  local lock_dir owner_file owner_pid current_pid
  current_pid="${BASHPID:-$$}"

  for lock_dir in "${AOS_HARNESS_CONTRACT_HELD_DIRS[@]:-}"; do
    [[ -n "$lock_dir" ]] || continue
    owner_file="$lock_dir/owner.json"
    owner_pid="$(_aos_harness_contract_owner_pid "$owner_file")"
    if [[ "$owner_pid" == "$current_pid" ]]; then
      rm -rf "$lock_dir"
    fi
  done
  AOS_HARNESS_CONTRACT_HELD_DIRS=()
}

aos_harness_contract_acquire() {
  local contract="${1:?harness contract name required}"
  shift

  local groups=()
  local blocks=()
  while (( $# > 0 )); do
    case "$1" in
      --group)
        groups+=("${2:?--group requires a value}")
        shift 2
        ;;
      --blocks)
        blocks+=("${2:?--blocks requires a value}")
        shift 2
        ;;
      *)
        groups+=("$1")
        shift
        ;;
    esac
  done

  if (( ${#groups[@]} == 0 && ${#blocks[@]} == 0 )); then
    echo "FAIL: harness-contract acquire requires at least one group or blocked group" >&2
    return 2
  fi

  local root groups_csv blocks_csv current_pid
  root="$(aos_harness_contract_lock_root)"
  mkdir -p "$root"
  groups_csv="$(IFS=,; printf '%s' "${groups[*]}")"
  blocks_csv="$(IFS=,; printf '%s' "${blocks[*]}")"
  current_pid="${BASHPID:-$$}"

  local lock_groups=()
  local item
  while IFS= read -r item; do
    [[ -n "$item" ]] || continue
    lock_groups+=("$item")
  done < <(printf '%s\n' "${groups[@]}" "${blocks[@]}" | sort -u)

  local acquired=()
  local group lock_dir owner_file owner_pid
  for group in "${lock_groups[@]}"; do
    lock_dir="$(_aos_harness_contract_lock_dir "$group")"
    owner_file="$lock_dir/owner.json"
    while true; do
      if mkdir "$lock_dir" 2>/dev/null; then
        _aos_harness_contract_write_owner "$owner_file" "$group" "$contract" "$groups_csv" "$blocks_csv" "$current_pid"
        acquired+=("$lock_dir")
        AOS_HARNESS_CONTRACT_HELD_DIRS+=("$lock_dir")
        break
      fi

      owner_pid="$(_aos_harness_contract_owner_pid "$owner_file")"
      if [[ -z "$owner_pid" ]]; then
        sleep 0.05
        owner_pid="$(_aos_harness_contract_owner_pid "$owner_file")"
      fi
      if [[ -z "$owner_pid" ]]; then
        rm -rf "$lock_dir"
        continue
      fi
      if [[ -n "$owner_pid" ]] && ! _aos_harness_contract_pid_alive "$owner_pid"; then
        rm -rf "$lock_dir"
        continue
      fi

      _aos_harness_contract_conflict_message "$owner_file" "$group" "$contract"
      for lock_dir in "${acquired[@]}"; do
        rm -rf "$lock_dir"
      done
      return 1
    done
  done
}

aos_harness_repo_service_stop_for_isolated_test() {
  local aos_bin="${AOS:-./aos}"
  local was_running

  was_running="$(
    env -u AOS_STATE_ROOT "$aos_bin" service status --mode repo --json 2>/dev/null \
      | python3 -c 'import json,sys; print("1" if json.load(sys.stdin).get("running") else "0")' 2>/dev/null \
      || printf '0'
  )"
  export AOS_HARNESS_REPO_SERVICE_WAS_RUNNING="$was_running"
  env -u AOS_STATE_ROOT "$aos_bin" service stop --mode repo --json >/dev/null
}

aos_harness_repo_service_restore_if_needed() {
  local aos_bin="${AOS:-./aos}"
  if [[ "${AOS_HARNESS_REPO_SERVICE_WAS_RUNNING:-0}" != "1" ]]; then
    return 0
  fi

  if ! env -u AOS_STATE_ROOT "$aos_bin" service start --mode repo --json >/dev/null; then
    echo "FAIL: harness-contract restore failed: repo service was running before test and could not be restarted" >&2
    return 1
  fi
}

fi
