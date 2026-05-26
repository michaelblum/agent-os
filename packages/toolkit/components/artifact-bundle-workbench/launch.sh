#!/usr/bin/env bash
# launch.sh - Open the fixture-backed Artifact Bundle Workbench.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/scripts/aos-content-scope.sh"

AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${CANVAS_ID:-artifact-bundle-workbench}"
PANEL_W="${AOS_ARTIFACT_BUNDLE_WORKBENCH_W:-1220}"
PANEL_H="${AOS_ARTIFACT_BUNDLE_WORKBENCH_H:-760}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$ROOT")}"
REPO_CONTENT_ROOT="${AOS_REPO_CONTENT_ROOT:-$(aos_content_root_key_for repo "$ROOT")}"
SUBJECT_FIXTURE="${1:-$ROOT/docs/design/fixtures/aos-artifacts/example-design-pass/subject.json}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

if [[ ! -f "$SUBJECT_FIXTURE" ]]; then
  echo "Artifact bundle subject fixture not found: $SUBJECT_FIXTURE" >&2
  exit 1
fi

"$AOS" show remove --id "$CANVAS_ID" 2>/dev/null || true

aos_ensure_content_roots_live "$AOS" \
  "$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit" \
  "$REPO_CONTENT_ROOT" "$ROOT"

DISPLAY_JSON="$("$AOS" graph displays 2>/dev/null || echo '{"data":{"displays":[]}}')"
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
  --url "aos://$TOOLKIT_CONTENT_ROOT/components/artifact-bundle-workbench/index.html" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest artifact-bundle-workbench \
  --js 'typeof window.__artifactBundleWorkbenchState === "object" && document.querySelector("[data-aos-ref=\"artifact-bundle-workbench:root\"]")' \
  --timeout 5s >/dev/null

CONTENT_JSON="$(SUBJECT_FIXTURE="$SUBJECT_FIXTURE" REPO_CONTENT_ROOT="$REPO_CONTENT_ROOT" ROOT="$ROOT" python3 -c '
import json
import os
from pathlib import Path

path = Path(os.environ["SUBJECT_FIXTURE"]).resolve()
subject = json.loads(path.read_text(encoding="utf-8"))
repo_root = Path(os.environ["ROOT"]).resolve()
repo_content_root = os.environ["REPO_CONTENT_ROOT"]
print(json.dumps({
    "type": "artifact_bundle.open",
    "subject": subject,
    "source": {
        "kind": "file",
        "path": str(path),
    },
    "content_root": {
        "name": repo_content_root,
        "path": str(repo_root),
        "url": f"aos://{repo_content_root}/",
    },
}))
')"

"$AOS" show post --id "$CANVAS_ID" --event "$CONTENT_JSON" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest artifact-bundle-workbench \
  --js 'window.__artifactBundleWorkbenchState?.subject?.subject_type === "aos.artifact_bundle" && window.__artifactBundleWorkbenchState?.last_result?.status === "opened"' \
  --timeout 5s >/dev/null

echo "Artifact Bundle Workbench launched at ${X},${Y} (${W}x${H})"
echo "Canvas: $CANVAS_ID"
echo "URL: aos://$TOOLKIT_CONTENT_ROOT/components/artifact-bundle-workbench/index.html"
echo "Fixture: $SUBJECT_FIXTURE"
