#!/usr/bin/env bash
# launch.sh - Open the fixture-backed Supervised Run Test Console V0.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/scripts/aos-content-scope.sh"

AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${CANVAS_ID:-supervised-run-test-console-v0}"
PANEL_W="${AOS_TEST_CONSOLE_W:-920}"
PANEL_H="${AOS_TEST_CONSOLE_H:-740}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$ROOT")}"
RUN_FIXTURE="${RUN_FIXTURE:-$ROOT/shared/schemas/fixtures/aos-supervised-run-v0/valid/dry-run-human-confirmed.json}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

if [[ ! -f "$RUN_FIXTURE" ]]; then
  echo "Supervised-run fixture not found: $RUN_FIXTURE" >&2
  exit 1
fi

"$AOS" show remove --id "$CANVAS_ID" 2>/dev/null || true

aos_ensure_content_roots_live "$AOS" \
  "$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit"

DISPLAY_JSON="$("$AOS" graph displays --json 2>/dev/null || echo '{"data":{"displays":[]}}')"
GEOMETRY="$(
  echo "$DISPLAY_JSON" | PANEL_W="$PANEL_W" PANEL_H="$PANEL_H" python3 -c '
import json, os, sys

payload = json.load(sys.stdin)
displays = payload.get("data", {}).get("displays", payload.get("displays", [])) if isinstance(payload, dict) else payload
main = next((entry for entry in displays if entry.get("is_main")), displays[0] if displays else None)
rect = (main or {}).get("visible_bounds") or (main or {}).get("bounds") or {}
x = int(rect.get("x", 0))
y = int(rect.get("y", 0))
w = int(rect.get("w", 1728))
h = int(rect.get("h", 1117))
panel_w = min(int(os.environ["PANEL_W"]), max(760, w - 48))
panel_h = min(int(os.environ["PANEL_H"]), max(560, h - 96))
print(x + 24, y + 64, panel_w, panel_h)
' 2>/dev/null || echo "24 64 $PANEL_W $PANEL_H"
)"

read -r X Y W H <<<"$GEOMETRY"

"$AOS" show create \
  --id "$CANVAS_ID" \
  --at "$X,$Y,$W,$H" \
  --interactive \
  --focus \
  --scope global \
  --url "aos://$TOOLKIT_CONTENT_ROOT/components/test-console/index.html" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest test-console-v0 \
  --js 'typeof window.__testConsoleState === "object" && document.querySelector("[data-aos-ref=\"test-console-v0:root\"]")' \
  --timeout 5s >/dev/null

CONTENT_JSON="$(RUN_FIXTURE="$RUN_FIXTURE" python3 -c '
import json
import os
from pathlib import Path

run = json.loads(Path(os.environ["RUN_FIXTURE"]).read_text(encoding="utf-8"))
print(json.dumps({
    "type": "test_console.load",
    "run": run,
    "artifact_refs": [
        {
            "id": "artifact-ref:dry-run-console-fixture",
            "ref": "artifact:dry-run-console-fixture",
            "kind": "artifact_ref",
            "relationship": "fixture_context",
            "summary": "Fixture-backed console launch payload."
        }
    ]
}))
')"

"$AOS" show post --id "$CANVAS_ID" --event "$CONTENT_JSON" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest test-console-v0 \
  --js 'window.__testConsoleState?.step_id === "step:dry-run-confirm-status" && document.querySelector("[data-aos-ref=\"test-console-v0:response-confirm\"]")' \
  --timeout 5s >/dev/null

echo "Supervised Run Test Console V0 launched at ${X},${Y} (${W}x${H})"
echo "Canvas: $CANVAS_ID"
echo "URL: aos://$TOOLKIT_CONTENT_ROOT/components/test-console/index.html"
echo "Fixture: $RUN_FIXTURE"
