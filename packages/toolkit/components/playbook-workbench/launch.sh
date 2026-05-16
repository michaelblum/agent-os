#!/usr/bin/env bash
# launch.sh - Open the fixture-backed Playbook Workbench V0 shell.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/scripts/aos-content-scope.sh"

AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${CANVAS_ID:-playbook-workbench-v0}"
WORK_RECORD_CANVAS_ID="${WORK_RECORD_CANVAS_ID:-playbook-workbench-v0-work-record}"
PANEL_W="${AOS_PLAYBOOK_WORKBENCH_W:-1240}"
PANEL_H="${AOS_PLAYBOOK_WORKBENCH_H:-760}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$ROOT")}"
PLAYBOOK_STEP_FIXTURE="${PLAYBOOK_STEP_FIXTURE:-$ROOT/shared/schemas/fixtures/aos-playbook-step-v0/valid/browser-click-status.json}"
EVIDENCE_FIXTURE="${EVIDENCE_FIXTURE:-$ROOT/shared/schemas/fixtures/aos-work-record-v0/evidence/aos-browser-click-status.json}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

if [[ ! -f "$PLAYBOOK_STEP_FIXTURE" ]]; then
  echo "Playbook step fixture not found: $PLAYBOOK_STEP_FIXTURE" >&2
  exit 1
fi

if [[ ! -f "$EVIDENCE_FIXTURE" ]]; then
  echo "Evidence fixture not found: $EVIDENCE_FIXTURE" >&2
  exit 1
fi

"$AOS" show remove --id "$WORK_RECORD_CANVAS_ID" 2>/dev/null || true
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
panel_w = min(int(os.environ["PANEL_W"]), max(840, w - 48))
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
  --url "aos://$TOOLKIT_CONTENT_ROOT/components/playbook-workbench/index.html" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest playbook-workbench \
  --js 'typeof window.__playbookWorkbenchState === "object" && document.querySelector("[data-aos-ref=\"playbook-workbench-v0:root\"]")' \
  --timeout 5s >/dev/null

CONTENT_JSON="$(PLAYBOOK_STEP_FIXTURE="$PLAYBOOK_STEP_FIXTURE" EVIDENCE_FIXTURE="$EVIDENCE_FIXTURE" TOOLKIT_CONTENT_ROOT="$TOOLKIT_CONTENT_ROOT" WORK_RECORD_CANVAS_ID="$WORK_RECORD_CANVAS_ID" python3 -c '
import json
import os
from pathlib import Path

step = json.loads(Path(os.environ["PLAYBOOK_STEP_FIXTURE"]).read_text(encoding="utf-8"))
evidence = json.loads(Path(os.environ["EVIDENCE_FIXTURE"]).read_text(encoding="utf-8"))
toolkit_root = os.environ["TOOLKIT_CONTENT_ROOT"]
print(json.dumps({
    "type": "playbook_workbench.load",
    "playbook_step": step,
    "evidence_source": evidence,
    "work_record_workbench_url": f"aos://{toolkit_root}/components/work-record-workbench/index.html",
    "work_record_canvas_id": os.environ["WORK_RECORD_CANVAS_ID"],
}))
')"

"$AOS" show post --id "$CANVAS_ID" --event "$CONTENT_JSON" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest playbook-workbench \
  --js 'window.__playbookWorkbenchState?.fixture_loaded === true && window.__playbookWorkbenchState?.step_summary?.id === "playbook-step:browser-click-status"' \
  --timeout 5s >/dev/null

echo "Playbook Workbench V0 launched at ${X},${Y} (${W}x${H})"
echo "Canvas: $CANVAS_ID"
echo "Work Record Canvas: $WORK_RECORD_CANVAS_ID"
echo "URL: aos://$TOOLKIT_CONTENT_ROOT/components/playbook-workbench/index.html"
echo "Fixture: $PLAYBOOK_STEP_FIXTURE"
