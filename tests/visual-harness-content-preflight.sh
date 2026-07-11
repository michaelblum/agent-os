#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/visual-harness.sh"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

assert_file_contains() {
  local needle="$1"
  local file="$2"
  if ! grep -Fq "$needle" "$file"; then
    echo "FAIL: expected $file to contain: $needle" >&2
    cat "$file" >&2 || true
    exit 1
  fi
}

fake_aos="$tmpdir/aos"
cat >"$fake_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "content" && "${2:-}" == "status" && "${3:-}" == "--json" ]]; then
  python3 - <<'PY'
import json
import os

root = os.environ.get("AOS_FAKE_TOOLKIT_ROOT")
print(json.dumps({"roots": {} if root == "<missing>" else {"toolkit": root}}))
PY
  exit 0
fi

echo "unexpected fake aos invocation: $*" >&2
exit 2
SH
chmod +x "$fake_aos"

matching_err="$tmpdir/matching.err"
AOS="$fake_aos" \
AOS_FAKE_TOOLKIT_ROOT="$ROOT/packages/toolkit" \
  aos_visual_assert_live_content_root toolkit "$ROOT/packages/toolkit" 2>"$matching_err"
if [[ -s "$matching_err" ]]; then
  echo "FAIL: expected matching content roots to be quiet" >&2
  cat "$matching_err" >&2
  exit 1
fi

stale_root="$tmpdir/stale/packages/toolkit"
stale_root_resolved="$(python3 - "$stale_root" <<'PY'
import pathlib
import sys
print(pathlib.Path(sys.argv[1]).resolve(strict=False))
PY
)"
mismatch_err="$tmpdir/mismatch.err"
if AOS="$fake_aos" \
  AOS_FAKE_TOOLKIT_ROOT="$stale_root" \
    aos_visual_assert_live_content_root toolkit "$ROOT/packages/toolkit" 2>"$mismatch_err"; then
  echo "FAIL: expected stale content root to fail" >&2
  exit 1
fi
assert_file_contains "FAIL: live content root mismatch for toolkit" "$mismatch_err"
assert_file_contains "Expected: $ROOT/packages/toolkit" "$mismatch_err"
assert_file_contains "Active:   $stale_root_resolved" "$mismatch_err"
assert_file_contains "not serving the worktree" "$mismatch_err"

warn_err="$tmpdir/warn.err"
AOS="$fake_aos" \
AOS_VISUAL_CONTENT_PREFLIGHT=warn \
AOS_FAKE_TOOLKIT_ROOT="$stale_root" \
  aos_visual_assert_live_content_root toolkit "$ROOT/packages/toolkit" 2>"$warn_err"
assert_file_contains "WARN: live content root mismatch for toolkit" "$warn_err"

missing_err="$tmpdir/missing.err"
if AOS="$fake_aos" \
  AOS_FAKE_TOOLKIT_ROOT="<missing>" \
    aos_visual_assert_live_content_root toolkit "$ROOT/packages/toolkit" 2>"$missing_err"; then
  echo "FAIL: expected missing content root to fail" >&2
  exit 1
fi
assert_file_contains "Active:   <missing>" "$missing_err"

echo "PASS: visual harness content preflight rejects stale and missing roots."
