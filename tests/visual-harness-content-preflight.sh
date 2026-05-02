#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/visual-harness.sh"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

fake_aos="$tmpdir/aos"
cat >"$fake_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "set" ]]; then
  exit 0
fi

if [[ "${1:-}" == "content" && "${2:-}" == "wait" ]]; then
  exit 0
fi

if [[ "${1:-}" == "content" && "${2:-}" == "status" ]]; then
  python3 - <<'PY'
import json
import os

print(json.dumps({
    "address": "127.0.0.1",
    "port": 65535,
    "roots": {
        "toolkit": os.environ["AOS_FAKE_TOOLKIT_ROOT"],
        "sigil": os.environ["AOS_FAKE_SIGIL_ROOT"],
    },
}))
PY
  exit 0
fi

echo "unexpected fake aos invocation: $*" >&2
exit 2
SH
chmod +x "$fake_aos"

matching_out="$tmpdir/matching.out"
matching_err="$tmpdir/matching.err"
AOS="$fake_aos" \
AOS_FAKE_TOOLKIT_ROOT="$ROOT/packages/toolkit" \
AOS_FAKE_SIGIL_ROOT="$ROOT/apps/sigil" \
  aos_visual_prepare_live_roots >"$matching_out" 2>"$matching_err"

if [[ -s "$matching_err" ]]; then
  echo "FAIL: expected matching content roots to be quiet" >&2
  cat "$matching_err" >&2
  exit 1
fi

mismatch_err="$tmpdir/mismatch.err"
active_old_sigil="$(python3 - "$tmpdir/old-root/apps/sigil" <<'PY'
import pathlib
import sys

print(pathlib.Path(sys.argv[1]).resolve(strict=False))
PY
)"
if AOS="$fake_aos" \
  AOS_FAKE_TOOLKIT_ROOT="$ROOT/packages/toolkit" \
  AOS_FAKE_SIGIL_ROOT="$tmpdir/old-root/apps/sigil" \
    aos_visual_prepare_live_roots >"$tmpdir/mismatch.out" 2>"$mismatch_err"; then
  echo "FAIL: expected mismatched Sigil content root to fail" >&2
  exit 1
fi

grep -Fq "FAIL: live content root mismatch for sigil" "$mismatch_err"
grep -Fq "Expected: $ROOT/apps/sigil" "$mismatch_err"
grep -Fq "Active:   $active_old_sigil" "$mismatch_err"
grep -Fq "not serving the worktree" "$mismatch_err"

warn_err="$tmpdir/warn.err"
AOS="$fake_aos" \
AOS_VISUAL_CONTENT_PREFLIGHT=warn \
AOS_FAKE_TOOLKIT_ROOT="$tmpdir/old-root/packages/toolkit" \
AOS_FAKE_SIGIL_ROOT="$ROOT/apps/sigil" \
  aos_visual_prepare_live_roots >"$tmpdir/warn.out" 2>"$warn_err"

grep -Fq "WARN: live content root mismatch for toolkit" "$warn_err"

echo "PASS: visual harness content preflight detects stale active roots."
