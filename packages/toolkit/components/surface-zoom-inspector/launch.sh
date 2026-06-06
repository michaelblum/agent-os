#!/bin/bash
# launch.sh - Create the fixture-only Surface-Zoom Annotation Inspector proof.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/scripts/aos-content-scope.sh"

AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${AOS_SURFACE_ZOOM_INSPECTOR_ID:-surface-zoom-inspector}"
PANEL_W="${AOS_SURFACE_ZOOM_INSPECTOR_W:-1180}"
PANEL_H="${AOS_SURFACE_ZOOM_INSPECTOR_H:-720}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$ROOT")}"
REPO_CONTENT_ROOT="${AOS_REPO_CONTENT_ROOT:-$(aos_content_root_key_for repo "$ROOT")}"
TREE_URL="${AOS_SURFACE_ZOOM_INSPECTOR_TREE_URL:-aos://$REPO_CONTENT_ROOT/docs/design/fixtures/spatial-subject-tree-v0/desktop-world-aos-canvas.json}"

"$AOS" show remove --id "$CANVAS_ID" 2>/dev/null || true

aos_ensure_content_roots_live "$AOS" \
  "$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit" \
  "$REPO_CONTENT_ROOT" "$ROOT"

"$AOS" show create --id "$CANVAS_ID" \
  --at "120,100,$PANEL_W,$PANEL_H" \
  --interactive \
  --scope global \
  --url "aos://$TOOLKIT_CONTENT_ROOT/components/surface-zoom-inspector/index.html?tree=$TREE_URL"

"$AOS" show wait --id "$CANVAS_ID" --manifest surface-zoom-inspector --timeout 5s --json >/dev/null

for _ in $(seq 1 25); do
  if "$AOS" show eval \
    --id "$CANVAS_ID" \
    --js 'window.surfaceZoomInspector && window.surfaceZoomInspector.snapshot().mini_map.nodes.length > 0 ? "ready" : ""' 2>/dev/null \
    | python3 -c 'import json, sys; raise SystemExit(0 if json.load(sys.stdin).get("result") == "ready" else 1)' 2>/dev/null; then
    break
  fi
  sleep 0.2
done

if ! "$AOS" show eval \
  --id "$CANVAS_ID" \
  --js 'window.surfaceZoomInspector && window.surfaceZoomInspector.snapshot().mini_map.nodes.length > 0 ? "ready" : ""' 2>/dev/null \
  | python3 -c 'import json, sys; raise SystemExit(0 if json.load(sys.stdin).get("result") == "ready" else 1)' 2>/dev/null; then
  echo "Surface-Zoom Annotation Inspector did not render the fixture mini-map before timeout" >&2
  exit 1
fi

echo "Surface-Zoom Annotation Inspector proof launched as ${CANVAS_ID}"
echo "Fixture tree: ${TREE_URL}"
