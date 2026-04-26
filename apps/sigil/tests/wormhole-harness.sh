#!/usr/bin/env bash
# Launch a minimal manual harness for Sigil wormhole fast-travel testing.
#
# This intentionally avoids the outmoded Sigil workbench. It brings up only:
#   - avatar-main: the live Sigil renderer on the display union
#   - canvas-inspector: the standalone toolkit inspector

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
source "$REPO_ROOT/tests/lib/visual-harness.sh"

AOS="${AOS:-$REPO_ROOT/aos}"
MODE="${MODE:-repo}"
AVATAR_ID="${AVATAR_ID:-avatar-main}"
INSPECTOR_ID="${INSPECTOR_ID:-canvas-inspector}"
FAST_TRAVEL_EFFECT="${FAST_TRAVEL_EFFECT:-wormhole}"

cd "$REPO_ROOT"

"$AOS" ready >/dev/null
aos_visual_prepare_live_roots
aos_visual_seed_sigil "$MODE"
aos_visual_launch_sigil_with_inspector "$AVATAR_ID" "$INSPECTOR_ID" "$FAST_TRAVEL_EFFECT"

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
