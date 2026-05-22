#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMPDIR_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-agent-handoff.XXXXXX")"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

fake_pbcopy="$TMPDIR_ROOT/pbcopy"
clipboard="$TMPDIR_ROOT/clipboard"
cat >"$fake_pbcopy" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cat >"$AOS_FAKE_CLIPBOARD_FILE"
SH
chmod +x "$fake_pbcopy"

message='follow the instructions in docs/design/work-cards/example.md'
options='{"timestamp":true,"gateStringStart":"----- BEGIN HANDOFF -----","gateStringEnd":"----- END HANDOFF -----","addPostInstructions":"(copied to clipboard)","addHRTimestamp":true}'
out="$(AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' scripts/agent-handoff --text "$message" --options-json "$options")"
python3 - "$message" "$out" "$clipboard" <<'PY'
import pathlib
import sys

message, out, clipboard_path = sys.argv[1:]
clipboard = pathlib.Path(clipboard_path).read_text()
expected = f"----- BEGIN HANDOFF -----\n{message}\n----- END HANDOFF -----\n\n(copied to clipboard)\nFri May 8 6:47AM"
if clipboard != message:
    raise SystemExit(f"FAIL: clipboard mismatch: {clipboard!r}")
if out != expected:
    raise SystemExit(f"FAIL: output mismatch: {out!r}")
PY

recipient_options='{"recipient":"gdi","timestamp":true,"gateStringStart":"----- BEGIN HANDOFF -----","gateStringEnd":"----- END HANDOFF -----","addPostInstructions":"(copied to clipboard)","addHRTimestamp":true}'
out="$(AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' scripts/agent-handoff --text "$message" --options-json "$recipient_options")"
python3 - "$message" "$out" "$clipboard" <<'PY'
import pathlib
import sys

message, out, clipboard_path = sys.argv[1:]
clipboard = pathlib.Path(clipboard_path).read_text()
expected = f"Recipient: gdi\n----- BEGIN HANDOFF -----\n{message}\n----- END HANDOFF -----\n\n(copied to clipboard)\nFri May 8 6:47AM"
if clipboard != message:
    raise SystemExit(f"FAIL: recipient clipboard mismatch: {clipboard!r}")
if out != expected:
    raise SystemExit(f"FAIL: recipient output mismatch: {out!r}")
PY

custom_options='{"timestamp":false,"gateStringStart":"<<< HANDOFF","gateStringEnd":"HANDOFF >>>","addPostInstructions":"ready for paste","addHRTimestamp":true}'
out="$(printf '%s' "$message" | AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' scripts/agent-handoff --options-json "$custom_options")"
python3 - "$message" "$out" "$clipboard" <<'PY'
import pathlib
import sys

message, out, clipboard_path = sys.argv[1:]
clipboard = pathlib.Path(clipboard_path).read_text()
expected = f"<<< HANDOFF\n{message}\nHANDOFF >>>\n\nready for paste"
if clipboard != message:
    raise SystemExit(f"FAIL: stdin clipboard mismatch: {clipboard!r}")
if out != expected:
    raise SystemExit(f"FAIL: custom output mismatch: {out!r}")
PY

set +e
bad_out="$(scripts/agent-handoff --text "$message" --options-json '[]' 2>&1)"
bad_rc=$?
set -e
if [[ "$bad_rc" -eq 0 ]] || [[ "$bad_out" != *"--options-json must be a JSON object"* ]]; then
  echo "FAIL: invalid options JSON was not rejected: $bad_out" >&2
  exit 1
fi

echo "PASS: agent handoff tool copies payload and prints deterministic chat block."
