#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/harness-contracts.sh"

LOCK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-harness-contract-test.XXXXXX")"
export AOS_TEST_HARNESS_LOCK_ROOT="$LOCK_ROOT"

READY_FILE="$LOCK_ROOT/holder.ready"
STOP_FILE="$LOCK_ROOT/holder.stop"
OUT_FILE="$LOCK_ROOT/conflict.out"
ERR_FILE="$LOCK_ROOT/conflict.err"
HOLDER_PID=""

cleanup() {
  local status="$?"
  if [[ -n "${HOLDER_PID:-}" ]] && kill -0 "$HOLDER_PID" 2>/dev/null; then
    touch "$STOP_FILE"
    wait "$HOLDER_PID" 2>/dev/null || true
  fi
  rm -rf "$LOCK_ROOT"
  exit "$status"
}
trap cleanup EXIT

(
  source "$ROOT/tests/lib/harness-contracts.sh"
  export AOS_TEST_HARNESS_LOCK_ROOT="$LOCK_ROOT"
  aos_harness_contract_acquire "fake-live-radial" \
    --group repo-daemon-live \
    --group status-item-owner \
    --group real-input-pointer \
    --blocks repo-service-mutator
  trap aos_harness_contract_release_all EXIT
  touch "$READY_FILE"
  while [[ ! -f "$STOP_FILE" ]]; do
    sleep 0.05
  done
) &
HOLDER_PID="$!"

for _ in $(seq 1 100); do
  [[ -f "$READY_FILE" ]] && break
  sleep 0.05
done
[[ -f "$READY_FILE" ]] || {
  echo "FAIL: holder did not acquire harness contract" >&2
  exit 1
}

if bash -c '
  set -euo pipefail
  source "$1"
  export AOS_TEST_HARNESS_LOCK_ROOT="$2"
  aos_harness_contract_acquire "fake-repo-service-mutator" \
    --group repo-service-mutator \
    --group status-item-owner \
    --group real-input-pointer \
    --blocks repo-daemon-live
' bash "$ROOT/tests/lib/harness-contracts.sh" "$LOCK_ROOT" >"$OUT_FILE" 2>"$ERR_FILE"; then
  echo "FAIL: incompatible harness contract unexpectedly acquired" >&2
  exit 1
fi

grep -q "harness-contract conflict" "$ERR_FILE"
grep -q "fake-live-radial" "$ERR_FILE"
grep -Eq "repo-daemon-live|repo-service-mutator|status-item-owner|real-input-pointer" "$ERR_FILE"

touch "$STOP_FILE"
wait "$HOLDER_PID"
HOLDER_PID=""

bash -c '
  set -euo pipefail
  source "$1"
  export AOS_TEST_HARNESS_LOCK_ROOT="$2"
  aos_harness_contract_acquire "fake-repo-service-mutator-after-release" \
    --group repo-service-mutator \
    --blocks repo-daemon-live
  aos_harness_contract_release_all
' bash "$ROOT/tests/lib/harness-contracts.sh" "$LOCK_ROOT"

echo "PASS: harness composability contracts fail fast and release cleanly."
