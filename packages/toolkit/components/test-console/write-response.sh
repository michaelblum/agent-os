#!/usr/bin/env bash
# Poll the Test Console canvas and append one captured human response to a run-dir JSONL queue.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/tests/lib/supervised-run-events.sh"

AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${CANVAS_ID:-supervised-run-test-console-v0}"
RUN_DIR="${RUN_DIR:?RUN_DIR is required}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-30}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

if [[ ! -d "$RUN_DIR" ]]; then
  echo "Supervised-run directory not found: $RUN_DIR" >&2
  exit 1
fi

end=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < end )); do
  EVAL_JSON="$("$AOS" show eval \
    --id "$CANVAS_ID" \
    --js 'JSON.stringify(window.__testConsoleLastEmission || null)' 2>/dev/null || true)"

  PAYLOAD="$(
    printf '%s' "$EVAL_JSON" | python3 -c '
import json
import sys

try:
    wrapper = json.loads(sys.stdin.read())
except Exception:
    raise SystemExit(2)

result = wrapper.get("result") if isinstance(wrapper, dict) else wrapper
if result in (None, "", "null"):
    raise SystemExit(2)

try:
    payload = json.loads(result) if isinstance(result, str) else result
except Exception:
    raise SystemExit(2)

if not isinstance(payload, dict):
    raise SystemExit(2)
if payload.get("type") != "test_console.human_response.captured":
    raise SystemExit(2)
if not isinstance(payload.get("response"), dict):
    raise SystemExit(2)

print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
' 2>/dev/null || true
  )"

  if [[ -n "$PAYLOAD" ]]; then
    RESPONSE_LINE="$(printf '%s\n' "$PAYLOAD" | aos_supervised_run_append_response_event "$RUN_DIR")"
    echo "$RESPONSE_LINE"
    echo "Response events: $(aos_supervised_run_response_events_file "$RUN_DIR")" >&2
    exit 0
  fi

  sleep 0.1
done

echo "FAIL: timed out waiting for test console human response on $CANVAS_ID" >&2
exit 124
