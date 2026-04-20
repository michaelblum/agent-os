#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
OUTPUT="$(AOS_SESSION_NAME="session-start-control-surface-$$" bash "$ROOT/.agents/hooks/session-start.sh" 2>/dev/null)"

[[ "$OUTPUT" == *"## Session"* ]] || {
  echo "FAIL: startup hook missing compact session heading" >&2
  exit 1
}

[[ "$OUTPUT" == *"## Snapshot"* ]] || {
  echo "FAIL: startup hook missing compact snapshot heading" >&2
  exit 1
}

[[ "$OUTPUT" == *"trust=AGENTS.md docs/SESSION_CONTRACT.md"* ]] || {
  echo "FAIL: startup hook missing trust pointer" >&2
  exit 1
}

[[ "$OUTPUT" == *"entry=./aos status"* ]] || {
  echo "FAIL: startup hook missing entrypoint guidance" >&2
  exit 1
}

[[ "$OUTPUT" == *"visual=./aos see"* ]] || {
  echo "FAIL: startup hook missing visual verification guidance" >&2
  exit 1
}

[[ "$OUTPUT" == *"handoff=scripts/handoff"* ]] || {
  echo "FAIL: startup hook missing handoff guidance" >&2
  exit 1
}

[[ "$OUTPUT" == *"branch="*"ahead="*"dirty="* ]] || {
  echo "FAIL: startup hook missing compact git snapshot" >&2
  exit 1
}

[[ "$OUTPUT" == *"stale="* ]] || {
  echo "FAIL: startup hook missing stale-state summary" >&2
  exit 1
}

[[ "$OUTPUT" != *"## AOS Control Surface"* ]] || {
  echo "FAIL: startup hook should not emit verbose control-surface block" >&2
  exit 1
}

[[ "$OUTPUT" != *"## Open Issues"* ]] || {
  echo "FAIL: startup hook should not emit open-issues block" >&2
  exit 1
}

[[ "$OUTPUT" != *'```text'* ]] || {
  echo "FAIL: startup hook should not embed ./aos --help" >&2
  exit 1
}

LINE_COUNT="$(printf '%s\n' "$OUTPUT" | wc -l | tr -d ' ')"
if [ "$LINE_COUNT" -gt 16 ]; then
  echo "FAIL: startup hook too long ($LINE_COUNT lines)" >&2
  exit 1
fi

echo "PASS"
