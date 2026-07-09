#!/usr/bin/env bash
# launch.sh - Open the graph-first Wiki Subject Browser V0 shell.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/scripts/aos-content-scope.sh"

AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${CANVAS_ID:-wiki-subject-browser-v0}"
TARGET="${1:-}"
PANEL_W="${AOS_WIKI_SUBJECT_BROWSER_W:-1220}"
PANEL_H="${AOS_WIKI_SUBJECT_BROWSER_H:-760}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$ROOT")}"
REPO_CONTENT_ROOT="${AOS_REPO_CONTENT_ROOT:-$(aos_content_root_key_for repo "$ROOT")}"
WORK_RECORD_FIXTURE="${WORK_RECORD_FIXTURE:-$ROOT/shared/schemas/fixtures/aos-work-record-v0/valid/workflow-browser-click-status.json}"
ARTIFACT_BUNDLE_FIXTURE="${ARTIFACT_BUNDLE_FIXTURE:-$ROOT/docs/design/fixtures/aos-artifacts/example-design-pass/subject.json}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

WIKI_PATH=""
if [[ -n "$TARGET" ]]; then
  if [[ "$TARGET" != wiki:* ]]; then
    echo "Optional target must be wiki:<path>" >&2
    exit 1
  fi
  WIKI_PATH="${TARGET#wiki:}"
  if [[ -z "$WIKI_PATH" ]]; then
    echo "Wiki target must be wiki:<path>" >&2
    exit 1
  fi
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
panel_w = min(int(os.environ["PANEL_W"]), max(820, w - 48))
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
  --url "aos://$TOOLKIT_CONTENT_ROOT/components/wiki-subject-browser/index.html" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest wiki-subject-browser-v0 \
  --js 'window.__wikiSubjectBrowserState?.graph_first === true && document.querySelector("[data-aos-ref=\"wiki-subject-browser-v0:root\"]") && document.querySelector("[data-aos-ref=\"wiki-subject-browser-v0:subject-search\"]") && document.querySelector("[data-aos-ref=\"wiki-subject-browser-v0:subject-filters\"]") && document.querySelector("[data-aos-ref=\"wiki-subject-browser-v0:subject-filter:health\"]") && document.querySelector("[data-aos-ref=\"wiki-subject-browser-v0:subject-details\"]")' \
  --timeout 5s \
  --json >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest wiki-subject-browser-v0 \
  --js 'document.querySelector(".wiki-kb-status")?.textContent?.includes("nodes")' \
  --timeout 10s \
  --json >/dev/null || true

if [[ -f "$WORK_RECORD_FIXTURE" || -f "$ARTIFACT_BUNDLE_FIXTURE" ]]; then
  CATALOG_JSON="$(ROOT="$ROOT" WORK_RECORD_FIXTURE="$WORK_RECORD_FIXTURE" ARTIFACT_BUNDLE_FIXTURE="$ARTIFACT_BUNDLE_FIXTURE" REPO_CONTENT_ROOT="$REPO_CONTENT_ROOT" node --input-type=module <<'NODE'
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.env.ROOT;
const workRecordFixturePath = process.env.WORK_RECORD_FIXTURE;
const artifactBundleFixturePath = process.env.ARTIFACT_BUNDLE_FIXTURE;
const repoContentRoot = process.env.REPO_CONTENT_ROOT;
const {
  SUBJECT_CATALOG_LOAD_TYPE,
  createArtifactBundleSubjectCatalogEntry,
  createWorkRecordSubjectCatalogEntry,
} = await import(pathToFileURL(`${root}/packages/toolkit/workbench/subject-catalog.js`).href);
const entries = [];
if (existsSync(workRecordFixturePath)) {
  const record = JSON.parse(readFileSync(workRecordFixturePath, 'utf8'));
  entries.push(createWorkRecordSubjectCatalogEntry(record, {
    source: {
      kind: 'fixture',
      path: workRecordFixturePath,
      read_only: true,
    },
  }));
}
if (existsSync(artifactBundleFixturePath)) {
  const bundle = JSON.parse(readFileSync(artifactBundleFixturePath, 'utf8'));
  entries.push(createArtifactBundleSubjectCatalogEntry(bundle, {
    source: {
      kind: 'fixture',
      path: artifactBundleFixturePath,
      read_only: true,
    },
    contentRoot: {
      name: repoContentRoot,
      path: root,
      url: `aos://${repoContentRoot}/`,
    },
  }));
}
console.log(JSON.stringify({
  type: SUBJECT_CATALOG_LOAD_TYPE,
  entries,
}));
NODE
)"
  "$AOS" show post --id "$CANVAS_ID" --event "$CATALOG_JSON" >/dev/null
  "$AOS" show wait \
    --id "$CANVAS_ID" \
    --manifest wiki-subject-browser-v0 \
    --js 'window.__wikiSubjectBrowserState?.catalog_entries?.length > 0 && document.querySelector("[data-aos-ref=\"wiki-subject-browser-v0:subject-catalog:open:work-record-workflow-browser-live-action-status-aos-browser-click-status-2026-05-06\"]") && document.querySelector("[data-aos-ref=\"wiki-subject-browser-v0:subject-list:inspect:work-record-workflow-browser-live-action-status-aos-browser-click-status-2026-05-06\"]") && document.querySelector("[data-aos-ref=\"wiki-subject-browser-v0:subject-list:open:work-record-workflow-browser-live-action-status-aos-browser-click-status-2026-05-06\"]")' \
    --timeout 5s \
    --json >/dev/null || true
  "$AOS" show wait \
    --id "$CANVAS_ID" \
    --manifest wiki-subject-browser-v0 \
    --js 'window.__wikiSubjectBrowserState?.catalog_entries?.some((entry) => entry.subject?.id === "artifact-bundle:example-design-pass") && document.querySelector("[data-aos-ref=\"wiki-subject-browser-v0:subject-catalog:open:artifact-bundle-example-design-pass\"]") && document.querySelector("[data-aos-ref=\"wiki-subject-browser-v0:subject-list:inspect:artifact-bundle-example-design-pass\"]") && document.querySelector("[data-aos-ref=\"wiki-subject-browser-v0:subject-list:open:artifact-bundle-example-design-pass\"]")' \
    --timeout 5s \
    --json >/dev/null || true
fi

if [[ -n "$WIKI_PATH" ]]; then
  PAGE_JSON="$("$AOS" wiki show "$WIKI_PATH" --json)"
  CONTENT_JSON="$(PAGE_JSON="$PAGE_JSON" python3 -c '
import json, os
page = json.loads(os.environ["PAGE_JSON"])
print(json.dumps({
    "type": "markdown_document.open",
    "path": page["path"],
    "source": {
        "kind": "wiki",
        "path": page["path"],
        "page": {
            "path": page["path"],
            "frontmatter": page.get("frontmatter") or {},
        },
    },
    "content": page.get("raw") or "",
}))
')"
  "$AOS" show post --id "$CANVAS_ID" --event "$CONTENT_JSON" >/dev/null
fi

echo "Wiki Subject Browser V0 launched at ${X},${Y} (${W}x${H})"
echo "Canvas: $CANVAS_ID"
echo "URL: aos://$TOOLKIT_CONTENT_ROOT/components/wiki-subject-browser/index.html"
if [[ -f "$WORK_RECORD_FIXTURE" ]]; then
  echo "Catalog Work Record: $WORK_RECORD_FIXTURE"
fi
if [[ -f "$ARTIFACT_BUNDLE_FIXTURE" ]]; then
  echo "Catalog Artifact Bundle: $ARTIFACT_BUNDLE_FIXTURE"
fi
if [[ -n "$WIKI_PATH" ]]; then
  echo "Wiki: $WIKI_PATH"
fi
