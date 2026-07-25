#!/bin/bash
# Compatibility wrapper for the generic AOS app launcher.

set -euo pipefail

RESTART=0
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --new|--new-codex)
      export AGENT_COMMAND="codex --no-alt-screen"
      shift
      ;;
    --new-claude)
      export AGENT_COMMAND="claude"
      shift
      ;;
    --pick)
      export AGENT_COMMAND="codex --no-alt-screen resume"
      shift
      ;;
    --last)
      export AGENT_COMMAND="codex --no-alt-screen resume --last"
      shift
      ;;
    --restart)
      RESTART=1
      shift
      ;;
    -h|--help)
      printf 'Usage: %s [--new|--new-codex|--new-claude|--pick|--last|--restart]\n' "$0"
      exit 0
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done
export RESTART

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
exec "$REPO_ROOT/aos" launch sigil agent-terminal "${ARGS[@]}"
