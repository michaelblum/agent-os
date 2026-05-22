#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMPDIR_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-foreman-handoff.XXXXXX")"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

fake_pbcopy="$TMPDIR_ROOT/pbcopy"
clipboard="$TMPDIR_ROOT/clipboard"
cat >"$fake_pbcopy" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cat >"$AOS_FAKE_CLIPBOARD_FILE"
SH
chmod +x "$fake_pbcopy"

payload='follow the instructions in docs/design/work-cards/example-v0.md'
out="$(AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' .docks/foreman/scripts/handoff --target-dock gdi --text "$payload")"
python3 - "$payload" "$out" "$clipboard" <<'PY'
import pathlib
import sys

payload, out, clipboard_path = sys.argv[1:]
clipboard = pathlib.Path(clipboard_path).read_text()
expected = f"Recipient: gdi\n----- BEGIN HANDOFF -----\n{payload}\n----- END HANDOFF -----\n\n(copied to clipboard)\nFri May 8 6:47AM"
if clipboard != payload:
    raise SystemExit(f"FAIL: Foreman wrapper clipboard mismatch: {clipboard!r}")
if out != expected:
    raise SystemExit(f"FAIL: Foreman wrapper chat output mismatch: {out!r}")
PY

stdin_payload='operator supervised check'
out="$(printf '%s' "$stdin_payload" | AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' .docks/foreman/scripts/handoff --target-dock operator)"
python3 - "$stdin_payload" "$out" "$clipboard" <<'PY'
import pathlib
import sys

payload, out, clipboard_path = sys.argv[1:]
clipboard = pathlib.Path(clipboard_path).read_text()
expected = f"Recipient: operator\n----- BEGIN HANDOFF -----\n{payload}\n----- END HANDOFF -----\n\n(copied to clipboard)\nFri May 8 6:47AM"
if clipboard != payload:
    raise SystemExit(f"FAIL: Foreman wrapper stdin clipboard mismatch: {clipboard!r}")
if out != expected:
    raise SystemExit(f"FAIL: Foreman wrapper stdin chat output mismatch: {out!r}")
PY

set +e
bad_out="$(.docks/foreman/scripts/handoff --target-dock slack --text "$payload" 2>&1)"
bad_rc=$?
set -e
if [[ "$bad_rc" -eq 0 ]] || [[ "$bad_out" != *"unsupported Foreman transfer target"* ]]; then
  echo "FAIL: Foreman wrapper accepted unsupported target: $bad_out" >&2
  exit 1
fi

echo "PASS: Foreman handoff wrapper delegates only supported dock handoffs."
