#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/visual-harness.sh"

require_function() {
  declare -F "$1" >/dev/null || { echo "FAIL: missing generic helper $1" >&2; exit 1; }
}

reject_function() {
  if declare -F "$1" >/dev/null; then
    echo "FAIL: product helper leaked into generic visual harness: $1" >&2
    exit 1
  fi
}

for fn in \
  aos_visual_root \
  aos_visual_aos \
  aos_visual_content_root_key \
  aos_visual_content_url \
  aos_visual_urls_equivalent \
  aos_visual_update_canvas_url
do
  require_function "$fn"
done

reject_function aos_visual_seed_sigil
reject_function aos_visual_launch_sigil_avatar
reject_function aos_visual_launch_sigil_with_inspector

test ! -d "$ROOT/tests/lib/sigil"
echo "PASS: visual harness contains generic AOS primitives only."
