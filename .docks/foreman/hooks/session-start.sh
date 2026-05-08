#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
AOS_BIN="${AOS_DOCK_AOS_BIN:-$REPO_ROOT/aos}"
source "$REPO_ROOT/.agents/hooks/session-common.sh"

HOOK_INPUT="$(cat || true)"
SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
if [[ -n "$SESSION_ID" && -x "$AOS_BIN" ]]; then
  "$AOS_BIN" tell --register --session-id "$SESSION_ID" --name foreman --role foreman --harness codex >/dev/null 2>&1 || true
  "$AOS_BIN" voice bind --session-id "$SESSION_ID" --quality-tier premium --language en --gender male >/dev/null 2>&1 || true
fi

printf '{"continue":true}\n'
