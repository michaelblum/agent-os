#!/usr/bin/env bash
set -euo pipefail

phase="${1:-}"
dock="${2:-}"

if [[ "$phase" != "post-tool-use" ]]; then
  echo "FAIL: usage: post-tool-use-runner.sh post-tool-use <dock>" >&2
  exit 2
fi
if [[ -z "$dock" ]]; then
  echo "FAIL: dock name is required" >&2
  exit 2
fi
case "$dock" in
  *[!a-zA-Z0-9_.-]*|"") echo "FAIL: invalid dock" >&2; exit 2 ;;
esac

cat >/dev/null || true
printf '{"continue":true}\n'
