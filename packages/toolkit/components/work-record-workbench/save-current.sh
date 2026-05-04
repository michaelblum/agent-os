#!/usr/bin/env bash
# save-current.sh - Persist the current work-record workbench canvas state.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${1:-${CANVAS_ID:-work-record-workbench}}"
OUTPUT_PATH="${2:-${OUTPUT_PATH:-}}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

EVAL_JSON="$("$AOS" show eval --id "$CANVAS_ID" --js 'JSON.stringify(window.__workRecordWorkbenchState || null)')"

SAVE_JSON="$(
  EVAL_JSON="$EVAL_JSON" OUTPUT_PATH="$OUTPUT_PATH" python3 -c '
import json, os, pathlib

try:
    outer = json.loads(os.environ["EVAL_JSON"])
    snapshot = json.loads(outer.get("result") or "null")
except Exception as error:
    raise SystemExit(f"failed to read work-record workbench state: {error}")

if not isinstance(snapshot, dict):
    raise SystemExit("work-record workbench state is unavailable")

record = snapshot.get("record")
if not isinstance(record, dict):
    raise SystemExit("work-record workbench state did not include a record")

source = snapshot.get("source") or {}
output = os.environ.get("OUTPUT_PATH") or ""
if not output:
    if source.get("kind") != "file" or not source.get("path"):
        raise SystemExit("no output path supplied and work record is not file-backed")
    output = str(source["path"])

path = pathlib.Path(output).expanduser().resolve()
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
print(json.dumps({
    "type": "work_record.patch.result",
    "status": "saved",
    "record_id": record.get("id") or "",
    "source": {
        "kind": "file",
        "path": str(path),
    },
    "message": f"saved work record to {path}",
}))
'
)"

"$AOS" show post --id "$CANVAS_ID" --event "$SAVE_JSON" >/dev/null

echo "$SAVE_JSON"
