#!/usr/bin/env bash
set -euo pipefail

phase="${1:-}"
dock="${2:-}"
if [[ "$phase" != "pre-tool-use" ]]; then
  echo "FAIL: usage: pre-tool-use-runner.sh pre-tool-use <dock>" >&2
  exit 2
fi
case "$dock" in
  *[!a-zA-Z0-9_.-]*|"") echo "FAIL: invalid dock" >&2; exit 2 ;;
esac

cat >/dev/null || true
printf '{"continue":true}\n'
