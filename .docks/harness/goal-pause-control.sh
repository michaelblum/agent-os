#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: goal-pause-control.sh request <repo-root> <dock> <reason>" >&2
  exit 2
}

command="${1:-}"
repo_root="${2:-}"
dock="${3:-}"
reason="${4:-}"

if [[ "$command" != "request" || -z "$repo_root" || -z "$dock" || -z "$reason" ]]; then
  usage
fi

case "$dock" in
  *[!a-zA-Z0-9_.-]*|"") usage ;;
esac
case "$reason" in
  *[!a-zA-Z0-9_.-]*|"") usage ;;
esac

if [[ "$dock" != "gdi" ]]; then
  printf 'not_applicable\n'
  exit 0
fi

if [[ "${AOS_DOCK_DISABLE_GOAL_PAUSE_INJECT:-}" == "1" ]]; then
  printf 'disabled\n'
  exit 0
fi

pane="${AOS_DOCK_CONTROL_TMUX_PANE:-${TMUX_PANE:-}}"
if [[ -z "$pane" ]]; then
  printf 'no_tmux_pane\n'
  exit 0
fi
case "$pane" in
  *[!a-zA-Z0-9_%:.-]*)
    printf 'invalid_tmux_pane\n'
    exit 0
    ;;
esac

if ! command -v tmux >/dev/null 2>&1; then
  printf 'tmux_unavailable\n'
  exit 0
fi

delay="${AOS_DOCK_GOAL_PAUSE_DELAY_SECONDS:-0}"
send_pause() {
  "$repo_root/.docks/harness/pty-input-control.sh" send "$pane" "/goal pause"
}

if [[ "$delay" == "0" || "$delay" == "0.0" ]]; then
  send_pause >/dev/null 2>&1 || true
else
  (
    sleep "$delay"
    send_pause >/dev/null 2>&1 || true
  ) >/dev/null 2>&1 &
fi

printf 'injected\n'
