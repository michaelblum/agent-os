#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"
tmproot="/tmp/aos-browser-dom-target-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"
trap 'rm -rf "$tmproot"' EXIT

out=$(./aos see capture browser:test-page --browser-dom-point 12,24 --browser-content-rect 100,200,800,600)

echo "$out" | jq -e '.status == "success"' >/dev/null \
    || { echo "FAIL status: $out" >&2; exit 1; }
echo "$out" | jq -e '.adapter_id == "aos-browser-dom-element-picker"' >/dev/null \
    || { echo "FAIL adapter: $out" >&2; exit 1; }
echo "$out" | jq -e '.target.kind == "element_target" and .target.preferred_selector == "#save"' >/dev/null \
    || { echo "FAIL target vocabulary: $out" >&2; exit 1; }
echo "$out" | jq -e '.target.frame_chain[0].kind == "top" and (.target.shadow_chain | type) == "array"' >/dev/null \
    || { echo "FAIL frame/shadow evidence: $out" >&2; exit 1; }
echo "$out" | jq -e '.target.ancestor_chain[0] == "#save" and .target.ancestor_descriptors[0].preferred_selector == "#save"' >/dev/null \
    || { echo "FAIL ancestor evidence: $out" >&2; exit 1; }
echo "$out" | jq -e '.projection.can_project_display_overlay == true and .projection.display_space_rect.x == 112 and .projection.display_space_rect.y == 224' >/dev/null \
    || { echo "FAIL display projection: $out" >&2; exit 1; }

echo "PASS"
