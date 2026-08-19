#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROOF_ROOT="${AOS_M3E_PROOF_ROOT:-}"

if [[ -z "$PROOF_ROOT" ]]; then
  PROOF_ROOT="$(mktemp -d /tmp/aos-m3e-v1-proof.XXXXXX)"
fi
case "$PROOF_ROOT" in
  /tmp/aos-m3e-v1-*) ;;
  *) echo "M3E proof root must be an explicit /tmp/aos-m3e-v1-* directory" >&2; exit 64 ;;
esac

mkdir -p "$PROOF_ROOT/tmp" "$PROOF_ROOT/state"
chmod 700 "$PROOF_ROOT" "$PROOF_ROOT/tmp" "$PROOF_ROOT/state"

cleanup() {
  local size_kib
  size_kib="$(du -sk "$PROOF_ROOT" | awk '{print $1}')"
  rm -rf -- "$PROOF_ROOT"
  [[ ! -e "$PROOF_ROOT" ]]
  printf 'm3e-cleanup: root_absent=1 retained_kib=0 removed_kib=%s\n' "$size_kib"
}
trap cleanup EXIT

cd "$ROOT"
TMPDIR="$PROOF_ROOT/tmp" \
  AOS_STATE_ROOT="$PROOF_ROOT/state" \
  node --test tests/m3-screen-recording-integrated.test.mjs
