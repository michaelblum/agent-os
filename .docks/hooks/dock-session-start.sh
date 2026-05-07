#!/usr/bin/env bash
set -euo pipefail

ROLE="${AOS_DOCK_ROLE:-dock}"
REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
AOS_BIN="${AOS_DOCK_AOS_BIN:-$REPO_ROOT/aos}"
HOOK_INPUT="$(cat || true)"

# shellcheck source=/dev/null
source "$REPO_ROOT/.agents/hooks/session-common.sh"

SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
if [[ -n "$SESSION_ID" && -x "$AOS_BIN" ]]; then
  "$AOS_BIN" tell --register --session-id "$SESSION_ID" --name "$ROLE" --role "$ROLE" --harness codex >/dev/null 2>&1 || true
  case "$ROLE" in
    gdi)
      "$AOS_BIN" voice bind --session-id "$SESSION_ID" --quality-tier premium --language en --gender female >/dev/null 2>&1 || true
      ;;
    foreman)
      "$AOS_BIN" voice bind --session-id "$SESSION_ID" --quality-tier premium --language en --gender male >/dev/null 2>&1 || true
      ;;
  esac
fi

printf '{"continue":true}\n'
