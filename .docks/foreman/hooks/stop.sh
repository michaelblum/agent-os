#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
AOS_BIN="${AOS_DOCK_AOS_BIN:-$REPO_ROOT/aos}"
HANDOFF_NOTICE="Handoff on clipboard!"
source "$REPO_ROOT/.agents/hooks/session-common.sh"

HOOK_INPUT="$(cat || true)"
SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
MESSAGE="$(aos_extract_final_message "$HOOK_INPUT")"
if [[ -n "$MESSAGE" && "$(command -v pbcopy || true)" ]]; then
  CLIPBOARD_MESSAGE="$(aos_strip_clipboard_chat_marker "$MESSAGE")"
  if [[ -n "$CLIPBOARD_MESSAGE" ]]; then
    if [[ "$CLIPBOARD_MESSAGE" != /goal\ * ]]; then
      CLIPBOARD_MESSAGE="/goal ${CLIPBOARD_MESSAGE}"
    fi
    printf '%s' "$CLIPBOARD_MESSAGE" | pbcopy >/dev/null 2>&1 || true
  fi
fi

if [[ -n "$SESSION_ID" && -x "$AOS_BIN" ]]; then
  "$AOS_BIN" tell --register --session-id "$SESSION_ID" --name foreman --role foreman --harness codex >/dev/null 2>&1 || true
  "$AOS_BIN" voice bind --session-id "$SESSION_ID" --quality-tier premium --language en --gender male >/dev/null 2>&1 || true
  printf '{"session_id":"%s","harness":"codex","last_assistant_message":"%s"}' "$SESSION_ID" "$HANDOFF_NOTICE" \
    | "$AOS_BIN" voice final-response --harness codex --session-id "$SESSION_ID" >/dev/null 2>&1 || true
fi

printf '{"continue":true}\n'
