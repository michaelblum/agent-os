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
printf 'PBCOPY_CALLED' >"$AOS_FAKE_CLIPBOARD_FILE"
cat >/dev/null
SH
chmod +x "$fake_pbcopy"

for dock in gdi foreman operator; do
  printf 'CLIPBOARD_SENTINEL' >"$clipboard"
  if printf '%s' 'Runtime Readiness Data Bundle V0.' \
    | AOS_HANDOFF_PBCOPY="$fake_pbcopy" AOS_FAKE_CLIPBOARD_FILE="$clipboard" AOS_HANDOFF_TIMESTAMP='Fri May 8 6:47AM' \
      scripts/dock-handoff-clipboard --target-dock "$dock" >"$TMPDIR_ROOT/$dock.out" 2>"$TMPDIR_ROOT/$dock.err"; then
    echo "FAIL: retired dock handoff clipboard surface should fail closed for $dock" >&2
    exit 1
  fi
  python3 - "$dock" "$clipboard" "$TMPDIR_ROOT/$dock.out" "$TMPDIR_ROOT/$dock.err" <<'PY'
import pathlib
import sys

dock, clipboard_path, out_path, err_path = sys.argv[1:]
clipboard = pathlib.Path(clipboard_path).read_text()
out = pathlib.Path(out_path).read_text()
err = pathlib.Path(err_path).read_text()
if clipboard != "CLIPBOARD_SENTINEL":
    raise SystemExit(f"FAIL: retired {dock} handoff mutated clipboard: {clipboard!r}")
if out:
    raise SystemExit(f"FAIL: retired {dock} handoff should not emit chat output: {out!r}")
for expected in [
    "scripts/dock-handoff-clipboard is retired",
    ".docks removal",
    "No clipboard mutation was attempted",
]:
    if expected not in err:
        raise SystemExit(f"FAIL: retired {dock} handoff missing {expected!r}: {err!r}")
PY
done

echo "PASS: dock handoff clipboard script fails closed after .docks retirement."
