#!/bin/bash
# launch.sh — Create the shared click-through DesktopWorld visual stage.

set -euo pipefail

AOS="${AOS:-./aos}"
CANVAS_ID="${AOS_DESKTOP_WORLD_STAGE_ID:-aos-desktop-world-stage}"

$AOS show remove --id "$CANVAS_ID" 2>/dev/null || true

$AOS set content.roots.toolkit packages/toolkit >/dev/null
$AOS content wait --root toolkit --auto-start --timeout 15s >/dev/null

$AOS show create --id "$CANVAS_ID" \
  --surface desktop-world \
  --scope global \
  --url 'aos://toolkit/components/desktop-world-stage/index.html'

$AOS show wait --id "$CANVAS_ID" --manifest desktop-world-stage --timeout 5s >/dev/null

echo "DesktopWorld visual stage launched as ${CANVAS_ID}"
echo "Send non-interactive layers with canvas.send to ${CANVAS_ID}: desktop_world_stage.layer.upsert/remove/clear"
