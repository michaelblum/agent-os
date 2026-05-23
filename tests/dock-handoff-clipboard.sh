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
out="$(printf '%s' "$prefixed" | AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' scripts/dock-handoff-clipboard --target-dock gdi 2>"$TMPDIR_ROOT/prefixed.err")"
python3 - "$prefixed" "$out" "$clipboard" "$TMPDIR_ROOT/prefixed.err" <<'PY'
import pathlib
import sys

_, out, clipboard_path, err_path = sys.argv[1:]
payload = "Already prefixed."
clipboard = pathlib.Path(clipboard_path).read_text()
err = pathlib.Path(err_path).read_text()
expected_out = f"Recipient: gdi\n----- BEGIN HANDOFF -----\n{payload}\n----- END HANDOFF -----\n\n(copied to clipboard)\nFri May 8 6:47AM"
if clipboard != payload:
    raise SystemExit(f"FAIL: GDI accidental legacy-command strip clipboard payload mismatch: {clipboard!r}")
if out != expected_out:
    raise SystemExit(f"FAIL: GDI accidental legacy-command strip chat tail mismatch: {out!r}")
if "warning:legacy_provider_entry_prefix_stripped" not in err:
    raise SystemExit(f"FAIL: GDI accidental legacy-command strip should surface warning: {err!r}")
PY

out="$(printf '%s' "$prefixed" | AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' scripts/dock-handoff-clipboard --target-dock operator)"
python3 - "$out" "$clipboard" <<'PY'
import pathlib
import sys

out, clipboard_path = sys.argv[1:]
payload = "/goal Already prefixed."
clipboard = pathlib.Path(clipboard_path).read_text()
expected_out = f"Recipient: operator\n----- BEGIN HANDOFF -----\n{payload}\n----- END HANDOFF -----\n\n(copied to clipboard)\nFri May 8 6:47AM"
if clipboard != payload:
    raise SystemExit(f"FAIL: Operator accidental legacy-command strip clipboard payload mismatch: {clipboard!r}")
if out != expected_out:
    raise SystemExit(f"FAIL: Operator accidental legacy-command strip chat tail mismatch: {out!r}")
PY

warning_payload='Warm TUI reuse live proof only. Reply with exactly: PASS'
out="$(printf '%s' "$warning_payload" | AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' scripts/dock-handoff-clipboard --target-dock gdi 2>"$TMPDIR_ROOT/warning.err")"
python3 - "$warning_payload" "$out" "$clipboard" "$TMPDIR_ROOT/warning.err" <<'PY'
import pathlib
import sys

payload, out, clipboard_path, err_path = sys.argv[1:]
clipboard = pathlib.Path(clipboard_path).read_text()
err = pathlib.Path(err_path).read_text()
expected_out = f"Recipient: gdi\n----- BEGIN HANDOFF -----\n{payload}\n----- END HANDOFF -----\n\n(copied to clipboard)\nFri May 8 6:47AM"
if clipboard != payload:
    raise SystemExit(f"FAIL: warning GDI payload should still copy: {clipboard!r}")
if out != expected_out:
    raise SystemExit(f"FAIL: warning GDI chat tail mismatch: {out!r}")
if "warning:gdi_one_shot_reply_exactly_risk" not in err or "warning:repeated_completion_loop_risk" not in err:
    raise SystemExit(f"FAIL: warning GDI payload should surface diagnostics: {err!r}")
PY

bad='GDI should self-accept this architecture decision and report done.'
if printf '%s' "$bad" | AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' scripts/dock-handoff-clipboard --target-dock gdi >"$TMPDIR_ROOT/bad.out" 2>"$TMPDIR_ROOT/bad.err"; then
  echo "FAIL: GDI self-acceptance payload should be rejected" >&2
  exit 1
fi
python3 - "$warning_payload" "$clipboard" "$TMPDIR_ROOT/bad.err" <<'PY'
import pathlib
import sys

previous_payload, clipboard_path, err_path = sys.argv[1:]
clipboard = pathlib.Path(clipboard_path).read_text()
err = pathlib.Path(err_path).read_text()
if clipboard != previous_payload:
    raise SystemExit(f"FAIL: rejected GDI payload should not mutate clipboard: {clipboard!r}")
if "gdi_self_acceptance_risk" not in err:
    raise SystemExit(f"FAIL: rejected GDI payload should report boundary violation: {err!r}")
PY

echo "PASS: dock handoff clipboard script copies plain handoffs and prints chat tail."
