#!/usr/bin/env bash
# save-current.sh - Persist the current HTML File Workbench canvas state.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${1:-${CANVAS_ID:-html-file-workbench}}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

EVAL_JSON="$("$AOS" show eval --id "$CANVAS_ID" --js 'JSON.stringify(window.__htmlFileWorkbenchState || null)')"

SAVE_JSON="$(
  EVAL_JSON="$EVAL_JSON" python3 -c '
import json, os, pathlib

try:
    outer = json.loads(os.environ["EVAL_JSON"])
    snapshot = json.loads(outer.get("result") or "null")
except Exception as error:
    raise SystemExit(f"failed to read html file workbench state: {error}")

if not isinstance(snapshot, dict):
    raise SystemExit("html file workbench state is unavailable")

path = pathlib.Path(snapshot.get("path") or "").expanduser().resolve()
content = str(snapshot.get("content") or "")
if not str(path).lower().endswith((".html", ".htm")):
    raise SystemExit(f"refusing to save non-HTML target: {path}")
if not path.exists():
    raise SystemExit(f"refusing to create missing file from workbench save: {path}")
if not path.is_file():
    raise SystemExit(f"refusing to save non-file target: {path}")

path.write_text(content, encoding="utf-8")
print(json.dumps({
    "type": "html_file.save.result",
    "status": "saved",
    "path": str(path),
    "content": content,
    "message": "saved by html-file-workbench/save-current.sh",
}))
'
)"

"$AOS" show post --id "$CANVAS_ID" --event "$SAVE_JSON" >/dev/null

echo "$SAVE_JSON"
