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
  EVAL_JSON="$EVAL_JSON" AOS="$AOS" python3 -c '
import json, os, pathlib, sys

try:
    outer = json.loads(os.environ["EVAL_JSON"])
    snapshot = json.loads(outer.get("result") or "null")
except Exception as error:
    raise SystemExit(f"failed to read markdown workbench state: {error}")

if not isinstance(snapshot, dict):
    raise SystemExit("markdown workbench state is unavailable")

path = pathlib.Path(snapshot.get("path") or "").expanduser().resolve()
source = ((snapshot.get("subject") or {}).get("source") or snapshot.get("source") or {})
content = str(snapshot.get("content") or "")

if source.get("kind") == "wiki":
    wiki_path = str(source.get("path") or snapshot.get("path") or "").lstrip("/")
    if not wiki_path:
        raise SystemExit("markdown workbench wiki source did not include a path")
    try:
        status_outer = json.loads(__import__("subprocess").check_output([os.environ.get("AOS", "aos"), "content", "status", "--json"], text=True))
        port = int(status_outer["port"])
    except Exception as error:
        raise SystemExit(f"failed to resolve aos content server for wiki save: {error}")
    import urllib.request
    from urllib.parse import quote
    url = f"http://127.0.0.1:{port}/wiki/{quote(wiki_path)}"
    request = urllib.request.Request(url, data=content.encode("utf-8"), method="PUT")
    request.add_header("Content-Type", "text/markdown; charset=utf-8")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"HTTP {response.status}")
    except Exception as error:
        raise SystemExit(f"failed to save wiki page {wiki_path}: {error}")
    print(json.dumps({
        "type": "markdown_document.save.result",
        "status": "saved",
        "path": wiki_path,
        "source": source,
        "message": "saved wiki page by markdown-workbench/save-current.sh",
    }))
    raise SystemExit(0)

path = pathlib.Path(snapshot.get("path") or "").expanduser().resolve()
if not path:
    raise SystemExit("markdown workbench state did not include a path")

path.write_text(content, encoding="utf-8")
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
