#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
# shellcheck source=/dev/null
source "$ROOT/.agents/hooks/session-common.sh"
SESSION_NAME="session-start-bootstrap-$$"
export AOS_STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-session-bootstrap.XXXXXX")"
BOOTSTRAP_FILE="$(aos_session_bootstrap_payload_file "$SESSION_NAME")"

cleanup() {
  rm -rf "$AOS_STATE_ROOT"
  rm -f "$BOOTSTRAP_FILE"
}
trap cleanup EXIT

printf '{"brief":"Startup bootstrap smoke test"}\n' > "$BOOTSTRAP_FILE"

OUTPUT="$(AOS_SESSION_NAME="$SESSION_NAME" bash "$ROOT/.agents/hooks/session-start.sh" 2>/dev/null)"

printf '%s' "$OUTPUT" | grep -q "## Handoff Brief" || {
  echo "FAIL: startup hook did not emit handoff brief heading" >&2
  exit 1
}

printf '%s' "$OUTPUT" | grep -q "Startup bootstrap smoke test" || {
  echo "FAIL: startup hook did not emit bootstrap brief body" >&2
  exit 1
}

[[ ! -f "$BOOTSTRAP_FILE" ]] || {
  echo "FAIL: startup hook did not consume bootstrap file" >&2
  exit 1
}

echo "PASS"
