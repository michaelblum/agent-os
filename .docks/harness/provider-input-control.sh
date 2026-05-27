#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: provider-input-control.sh send <tmux-target> [text]" >&2
  echo "       printf '%s' text | provider-input-control.sh send <tmux-target>" >&2
  exit 2
}

command="${1:-}"
target="${2:-}"
text="${3:-}"

if [[ "$command" != "send" || -z "$target" ]]; then
  usage
fi

case "$target" in
  *[!a-zA-Z0-9_%:.-]*|"") usage ;;
esac

if [[ -z "$text" ]]; then
  text="$(cat || true)"
fi
if [[ -z "$text" ]]; then
  usage
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/pty-input-control.sh" send "$target" "$text"
