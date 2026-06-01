#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

require_function() {
  local name="$1"
  declare -F "$name" >/dev/null || fail "expected function to be defined: $name"
}

reject_function() {
  local name="$1"
  if declare -F "$name" >/dev/null; then
    fail "generic visual harness must not define app-specific function: $name"
  fi
}

source "$ROOT/tests/lib/visual-harness.sh"

require_function aos_visual_content_url
require_function aos_visual_launch_canvas_inspector
reject_function aos_visual_seed_sigil
reject_function aos_visual_launch_sigil_avatar
reject_function aos_visual_launch_sigil_with_inspector

source "$ROOT/tests/lib/sigil/visual-harness.sh"

require_function aos_visual_seed_sigil
require_function aos_visual_launch_sigil_avatar
require_function aos_visual_launch_sigil_with_inspector

echo "PASS: visual harness boundary keeps app-specific helpers under tests/lib/sigil."
