#!/usr/bin/env bash
# Launch a minimal manual harness for Sigil wormhole fast-travel testing.
#
# This intentionally avoids the outmoded Sigil workbench. It brings up only:
#   - avatar-main: the live Sigil renderer on the display union
#   - canvas-inspector: the standalone toolkit inspector

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
AOS="${AOS:-$REPO_ROOT/aos}"
MODE="${MODE:-repo}"
AVATAR_ID="${AVATAR_ID:-avatar-main}"
INSPECTOR_ID="${INSPECTOR_ID:-canvas-inspector}"
FAST_TRAVEL_EFFECT="${FAST_TRAVEL_EFFECT:-wormhole}"

cd "$REPO_ROOT"

"$AOS" ready >/dev/null
"$AOS" set content.roots.toolkit packages/toolkit >/dev/null
"$AOS" set content.roots.sigil apps/sigil >/dev/null
"$AOS" content wait --root toolkit --root sigil --auto-start --timeout 15s >/dev/null
"$REPO_ROOT/apps/sigil/sigilctl-seed.sh" --mode "$MODE" >/dev/null

"$AOS" show remove --id "$AVATAR_ID" >/dev/null 2>&1 || true
"$AOS" show remove --id "$INSPECTOR_ID" >/dev/null 2>&1 || true

AOS="$AOS" bash "$REPO_ROOT/packages/toolkit/components/canvas-inspector/launch.sh" >/dev/null

"$AOS" show create \
  --id "$AVATAR_ID" \
  --url 'aos://sigil/renderer/index.html' \
  --track union >/dev/null

"$AOS" show wait \
  --id "$AVATAR_ID" \
  --js 'window.__sigilDebug && window.__sigilDebug.snapshot().hitTargetReady === true && window.liveJs?.avatarPos?.valid === true && window.__sigilBootError == null' \
  --timeout 10s >/dev/null

"$AOS" show eval \
  --id "$AVATAR_ID" \
  --js "window.__sigilDebug.dispatch({ type: 'status_item.show' }); window.state.transitionFastTravelEffect = '$FAST_TRAVEL_EFFECT'; JSON.stringify(window.__sigilDebug.snapshot())" >/dev/null

"$AOS" show wait \
  --id "$AVATAR_ID" \
  --js 'window.__sigilDebug?.snapshot().avatarVisible === true' \
  --timeout 5s >/dev/null

cat <<EOF
Sigil wormhole harness launched.
  avatar:    $AVATAR_ID
  inspector: $INSPECTOR_ID
  effect:    $FAST_TRAVEL_EFFECT

Manual test:
  Drag the avatar dot away from its current position, then release.
  The Canvas Inspector should show avatar-main plus the sigil-hit child canvas.

Debug snapshot:
  $AOS show eval --id $AVATAR_ID --js 'JSON.stringify(window.__sigilDebug.snapshot())'

Replay one wormhole travel programmatically:
  $AOS show eval --id $AVATAR_ID --js '(() => {
    const p = window.liveJs.avatarPos;
    const d = window.liveJs.displays.find((display) => display.is_main) || window.liveJs.displays[0];
    const vb = d.visible_bounds || d.visibleBounds || d.bounds;
    const target = { x: vb.x + vb.w * 0.25, y: vb.y + vb.h * 0.30 };
    window.state.transitionFastTravelEffect = "wormhole";
    window.liveJs.fastTravelEvents = [];
    window.__sigilDebug.dispatch({ type: "left_mouse_down", x: p.x, y: p.y });
    window.__sigilDebug.dispatch({ type: "left_mouse_dragged", x: target.x, y: target.y });
    window.__sigilDebug.dispatch({ type: "left_mouse_up", x: target.x, y: target.y });
    return JSON.stringify({ target, snapshot: window.__sigilDebug.snapshot() });
  })()'

Teardown:
  $AOS show remove --id $AVATAR_ID
  $AOS show remove --id $INSPECTOR_ID
EOF
