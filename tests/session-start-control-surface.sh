#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
HELP_TEXT="$("$ROOT/aos" --help)"
OUTPUT="$(AOS_SESSION_NAME="session-start-control-surface-$$" bash "$ROOT/.agents/hooks/session-start.sh" 2>/dev/null)"

[[ "$OUTPUT" == *"You are developing agent-os. Your primary tools should be the following control surface:"* ]] || {
  echo "FAIL: startup hook missing control-surface instruction" >&2
  exit 1
}

[[ "$OUTPUT" == *"| Role | Instruction |"* ]] || {
  echo "FAIL: startup hook missing structured control-surface table" >&2
  exit 1
}

[[ "$OUTPUT" == *'```text'* ]] || {
  echo "FAIL: startup hook missing fenced help block" >&2
  exit 1
}

[[ "$OUTPUT" == *"$HELP_TEXT"* ]] || {
  echo "FAIL: startup hook did not embed live ./aos --help output" >&2
  exit 1
}

[[ "$OUTPUT" == *'Prefer `./aos see` and AX-aware x-ray capture over raw image blobs'* ]] || {
  echo "FAIL: startup hook missing perception guidance" >&2
  exit 1
}

[[ "$OUTPUT" == *'Lean on `./aos focus`, `./aos graph`, and `./aos show`'* ]] || {
  echo "FAIL: startup hook missing focus/graph/show guidance" >&2
  exit 1
}

[[ "$OUTPUT" == *'Start with `./aos status`.'* ]] || {
  echo "FAIL: startup hook missing status point of entry" >&2
  exit 1
}

[[ "$OUTPUT" == *'The session-start hook already attempts daemon bring-up; check `./aos status` before manual restart loops.'* ]] || {
  echo "FAIL: startup hook missing runtime automation guidance" >&2
  exit 1
}

[[ "$OUTPUT" == *'Use `./aos introspect review` after failed attempts or when asked to self-review.'* ]] || {
  echo "FAIL: startup hook missing introspection guidance" >&2
  exit 1
}

[[ "$OUTPUT" == *'Use `gh` for issue/PR comments and updates in this repo; the GitHub app frequently 403s with `Resource not accessible by integration`.'* ]] || {
  echo "FAIL: startup hook missing gh fallback guidance" >&2
  exit 1
}

[[ "$OUTPUT" == *"For multi-display or coordinate work, launch \`bash tests/display-debug-battery.sh\` to bring up \`spatial-telemetry\` and \`canvas-inspector\` in deterministic operator panel positions on the main display's visible bounds."* ]] || {
  echo "FAIL: startup hook missing display-debug battery guidance" >&2
  exit 1
}

[[ "$OUTPUT" == *'Treat that placement as operator convenience only; the shared world contract is `DesktopWorld` (arranged full-display union).'* ]] || {
  echo "FAIL: startup hook missing DesktopWorld clarification for display-debug battery" >&2
  exit 1
}

[[ "$OUTPUT" == *'For spatial work, also run `node scripts/spatial-audit.mjs --summary` before editing; coordinate helpers are under explicit allowlist governance now.'* ]] || {
  echo "FAIL: startup hook missing spatial-audit guidance" >&2
  exit 1
}

[[ "$OUTPUT" == *'Toolkit-side JS spatial helpers now belong in `packages/toolkit/runtime/spatial.js`; avoid adding new ad hoc transform helpers elsewhere.'* ]] || {
  echo "FAIL: startup hook missing canonical spatial-runtime guidance" >&2
  exit 1
}

echo "PASS"
