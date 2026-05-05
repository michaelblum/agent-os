#!/bin/bash
# launch.sh — Create the shared click-through DesktopWorld visual stage.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/scripts/aos-content-scope.sh"

AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${AOS_DESKTOP_WORLD_STAGE_ID:-aos-desktop-world-stage}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$ROOT")}"

$AOS show remove --id "$CANVAS_ID" 2>/dev/null || true

aos_ensure_content_roots_live "$AOS" \
  "$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit"

$AOS show create --id "$CANVAS_ID" \
  --surface desktop-world \
  --scope global \
  --url "aos://$TOOLKIT_CONTENT_ROOT/components/desktop-world-stage/index.html"

$AOS show wait --id "$CANVAS_ID" --manifest desktop-world-stage --timeout 5s >/dev/null

echo "DesktopWorld visual stage launched as ${CANVAS_ID}"
echo "Send non-interactive layers with canvas.send to ${CANVAS_ID}: desktop_world_stage.layer.upsert/remove/clear"
