#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
umask 077
PROOF_ROOT="$(mktemp -d /tmp/aos-m3e-v1-proof.XXXXXX)"
[[ ! -L "$PROOF_ROOT" && -d "$PROOF_ROOT" ]]
PROOF_IDENTITY="$(stat -f '%d:%i' "$PROOF_ROOT")"
mkdir -m 700 "$PROOF_ROOT/tmp" "$PROOF_ROOT/state"

cleanup() {
  local status="$?"
  local size_kib
  trap - EXIT
  if [[ -L "$PROOF_ROOT" || ! -d "$PROOF_ROOT" \
    || "$(stat -f '%d:%i' "$PROOF_ROOT")" != "$PROOF_IDENTITY" ]]; then
    printf 'm3e-cleanup: custody_mismatch=1\n' >&2
    return 70
  fi
  size_kib="$(du -sk "$PROOF_ROOT" | awk '{print $1}')"
  rm -rf -- "$PROOF_ROOT"
  [[ ! -e "$PROOF_ROOT" ]]
  printf 'm3e-cleanup: root_absent=1 retained_kib=0 removed_kib=%s\n' "$size_kib"
  return "$status"
}
trap cleanup EXIT

cd "$ROOT"
TMPDIR="$PROOF_ROOT/tmp" \
  AOS_STATE_ROOT="$PROOF_ROOT/state" \
  node --test tests/m3-screen-recording-integrated.test.mjs
