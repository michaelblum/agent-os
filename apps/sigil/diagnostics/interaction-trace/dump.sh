#!/bin/bash
# dump.sh — export the latest Sigil interaction trace capture.

set -euo pipefail

AOS="${AOS:-./aos}"
AVATAR_ID="${AOS_SIGIL_AVATAR_ID:-avatar-main}"
OUT="${1:-${TMPDIR:-/tmp}/sigil-interaction-trace-latest.json}"

PAYLOAD="$("$AOS" show eval --id "$AVATAR_ID" --js 'JSON.stringify(window.__sigilDebug?.latestInteractionTraceCapture?.() ?? window.__sigilDebug?.interactionTrace?.() ?? null)')"

python3 - "$OUT" "$PAYLOAD" <<'PY'
import json
import sys

out = sys.argv[1]
payload = json.loads(sys.argv[2])
result = payload.get("result")
if not result:
    raise SystemExit("no trace result returned")
trace = json.loads(result)
with open(out, "w") as f:
    json.dump(trace, f, indent=2)
    f.write("\n")
print(out)
PY
