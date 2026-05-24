#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: pty-input-control.sh send [--submit|--no-submit] [--clear|--no-clear] <tmux-target> [text]" >&2
  echo "       printf '%s' text | pty-input-control.sh send [options] <tmux-target>" >&2
  exit 2
}

command="${1:-}"
if [[ "$command" != "send" ]]; then
  usage
fi
shift

submit=1
clear=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --submit)
      submit=1
      shift
      ;;
    --no-submit|--leave)
      submit=0
      shift
      ;;
    --clear)
      clear=1
      shift
      ;;
    --no-clear)
      clear=0
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      usage
      ;;
    *)
      break
      ;;
  esac
done

target="${1:-}"
if [[ -z "$target" ]]; then
  usage
fi
shift

case "$target" in
  *[!a-zA-Z0-9_%:.-]*|"") usage ;;
esac

text="${1:-}"
if [[ $# -gt 0 ]]; then
  shift || true
fi
if [[ $# -gt 0 ]]; then
  usage
fi

if [[ -z "$text" ]]; then
  text="$(cat || true)"
fi
if [[ -z "$text" ]]; then
  usage
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux_unavailable" >&2
  exit 1
fi

if [[ "$clear" == "1" ]]; then
  tmux send-keys -t "$target" C-u
fi

IFS=$'\n' read -r -d '' -a parts < <(printf '%s\0' "$text") || true
if [[ ${#parts[@]} -eq 0 ]]; then
  parts=("$text")
fi
for ((i = 0; i < ${#parts[@]}; i += 1)); do
  if [[ -n "${parts[$i]}" ]]; then
    tmux send-keys -t "$target" -l "${parts[$i]}"
  fi
  if [[ $i -lt $((${#parts[@]} - 1)) ]]; then
    tmux send-keys -t "$target" Enter
  fi
done

if [[ "$submit" == "1" ]]; then
  tmux send-keys -t "$target" Enter
fi
