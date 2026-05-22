#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMPDIR_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-dock-handoff-clipboard.XXXXXX")"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

fake_pbcopy="$TMPDIR_ROOT/pbcopy"
clipboard="$TMPDIR_ROOT/clipboard"
cat >"$fake_pbcopy" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cat >"$AOS_FAKE_CLIPBOARD_FILE"
SH
chmod +x "$fake_pbcopy"

message='Employer Brand Comparative Audit Data Bundle V0.

No report renderer.'

out="$(printf '%s' "$message" | AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' scripts/dock-handoff-clipboard --target-dock gdi)"
python3 - "$message" "$out" "$clipboard" <<'PY'
import pathlib
import sys

message, out, clipboard_path = sys.argv[1:]
clipboard = pathlib.Path(clipboard_path).read_text()
payload = message
expected_out = f"Recipient: gdi\n----- BEGIN HANDOFF -----\n{payload}\n----- END HANDOFF -----\n\n(copied to clipboard)\nFri May 8 6:47AM"
if clipboard != payload:
    raise SystemExit(f"FAIL: GDI clipboard payload mismatch: {clipboard!r}")
if out != expected_out:
    raise SystemExit(f"FAIL: GDI chat tail mismatch: {out!r}")
PY

out="$(printf '%s' "$message" | AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' scripts/dock-handoff-clipboard --target-dock foreman)"
python3 - "$message" "$out" "$clipboard" <<'PY'
import pathlib
import sys

message, out, clipboard_path = sys.argv[1:]
payload = message
clipboard = pathlib.Path(clipboard_path).read_text()
expected_out = f"Recipient: foreman\n----- BEGIN HANDOFF -----\n{payload}\n----- END HANDOFF -----\n\n(copied to clipboard)\nFri May 8 6:47AM"
if clipboard != payload:
    raise SystemExit(f"FAIL: Foreman clipboard payload mismatch: {clipboard!r}")
if out != expected_out:
    raise SystemExit(f"FAIL: Foreman chat tail mismatch: {out!r}")
PY

out="$(printf '%s' "$message" | AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' scripts/dock-handoff-clipboard --target-dock operator)"
python3 - "$message" "$out" "$clipboard" <<'PY'
import pathlib
import sys

message, out, clipboard_path = sys.argv[1:]
payload = message
clipboard = pathlib.Path(clipboard_path).read_text()
expected_out = f"Recipient: operator\n----- BEGIN HANDOFF -----\n{payload}\n----- END HANDOFF -----\n\n(copied to clipboard)\nFri May 8 6:47AM"
if clipboard != payload:
    raise SystemExit(f"FAIL: Operator clipboard payload mismatch: {clipboard!r}")
if out != expected_out:
    raise SystemExit(f"FAIL: Operator chat tail mismatch: {out!r}")
PY

legacy_command_name="goal"
legacy_prefix="/${legacy_command_name} "
prefixed="${legacy_prefix}Already prefixed."
out="$(printf '%s' "$prefixed" | AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' scripts/dock-handoff-clipboard --target-dock gdi)"
python3 - "$prefixed" "$out" "$clipboard" <<'PY'
import pathlib
import sys

_, out, clipboard_path = sys.argv[1:]
payload = "Already prefixed."
clipboard = pathlib.Path(clipboard_path).read_text()
expected_out = f"Recipient: gdi\n----- BEGIN HANDOFF -----\n{payload}\n----- END HANDOFF -----\n\n(copied to clipboard)\nFri May 8 6:47AM"
if clipboard != payload:
    raise SystemExit(f"FAIL: GDI accidental legacy-command strip clipboard payload mismatch: {clipboard!r}")
if out != expected_out:
    raise SystemExit(f"FAIL: GDI accidental legacy-command strip chat tail mismatch: {out!r}")
PY

out="$(printf '%s' "$prefixed" | AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' scripts/dock-handoff-clipboard --target-dock operator)"
python3 - "$out" "$clipboard" <<'PY'
import pathlib
import sys

out, clipboard_path = sys.argv[1:]
payload = "Already prefixed."
clipboard = pathlib.Path(clipboard_path).read_text()
expected_out = f"Recipient: operator\n----- BEGIN HANDOFF -----\n{payload}\n----- END HANDOFF -----\n\n(copied to clipboard)\nFri May 8 6:47AM"
if clipboard != payload:
    raise SystemExit(f"FAIL: Operator accidental legacy-command strip clipboard payload mismatch: {clipboard!r}")
if out != expected_out:
    raise SystemExit(f"FAIL: Operator accidental legacy-command strip chat tail mismatch: {out!r}")
PY

echo "PASS: dock handoff clipboard script copies plain handoffs and prints chat tail."
