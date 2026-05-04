#!/usr/bin/env bash
# save-current.sh - Persist the current Markdown workbench canvas state.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${1:-${CANVAS_ID:-markdown-workbench}}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

EVAL_JSON="$("$AOS" show eval --id "$CANVAS_ID" --js 'JSON.stringify(window.__markdownWorkbenchState || null)')"

SAVE_JSON="$(
  EVAL_JSON="$EVAL_JSON" python3 -c '
import json, os, pathlib, sys

try:
    outer = json.loads(os.environ["EVAL_JSON"])
    snapshot = json.loads(outer.get("result") or "null")
except Exception as error:
    raise SystemExit(f"failed to read markdown workbench state: {error}")

if not isinstance(snapshot, dict):
    raise SystemExit("markdown workbench state is unavailable")

path = pathlib.Path(snapshot.get("path") or "").expanduser().resolve()
if not path:
    raise SystemExit("markdown workbench state did not include a path")

path.write_text(str(snapshot.get("content") or ""), encoding="utf-8")
print(json.dumps({
    "type": "markdown_document.save.result",
    "status": "saved",
    "path": str(path),
    "message": "saved by markdown-workbench/save-current.sh",
}))
'
)"

"$AOS" show post --id "$CANVAS_ID" --event "$SAVE_JSON" >/dev/null

echo "$SAVE_JSON"
