#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/sigil/visual-harness.sh"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  [[ "$actual" == "$expected" ]] || fail "$label: expected '$expected', got '$actual'"
}

assert_fails() {
  if "$@"; then
    fail "expected command to fail: $*"
  fi
}

unset AOS_SIGIL_CONTENT_ROOT AOS_TOOLKIT_CONTENT_ROOT AOS_VISUAL_CONTENT_ROOT_SCOPE
export AOS_VISUAL_DISABLE_CACHE_BUST=1
assert_eq "sigil" "$(aos_visual_content_root_key sigil)" "single-worktree Sigil root key"
assert_eq "toolkit" "$(aos_visual_content_root_key toolkit)" "single-worktree toolkit root key"
assert_eq "aos://sigil/renderer/index.html?toolkit-root=toolkit" "$(aos_visual_sigil_renderer_url)" "Sigil renderer URL"
assert_eq "aos://toolkit/components/surface-inspector/index.html" "$(aos_visual_toolkit_url components/surface-inspector/index.html)" "toolkit URL"

AOS_VISUAL_CONTENT_ROOT_SCOPE=branch
branch_key="$(aos_visual_content_root_key sigil)"
[[ "$branch_key" == sigil_* ]] || fail "branch-scoped Sigil root key did not use scoped form: $branch_key"
assert_eq "aos://$branch_key/renderer/index.html" "$(aos_visual_content_url "$branch_key" /renderer/index.html)" "branch-scoped URL"
unset AOS_VISUAL_CONTENT_ROOT_SCOPE

AOS_SIGIL_CONTENT_ROOT=sigil_manual AOS_TOOLKIT_CONTENT_ROOT=toolkit_manual \
  assert_eq "aos://sigil_manual/renderer/index.html?toolkit-root=toolkit_manual" "$(AOS_SIGIL_CONTENT_ROOT=sigil_manual AOS_TOOLKIT_CONTENT_ROOT=toolkit_manual aos_visual_sigil_renderer_url)" "explicit root override URL"

fake_aos="$tmpdir/aos"
cat >"$fake_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "show" && "${2:-}" == "update" && "${3:-}" == "--id" && "${4:-}" == "avatar-main" && "${5:-}" == "--url" && "${6:-}" == "aos://sigil/renderer/index.html?toolkit-root=toolkit" ]]; then
    echo "updated"
    exit 0
fi

if [[ "${1:-}" == "show" && "${2:-}" == "list" && "${3:-}" == "--json" ]]; then
    python3 - <<'PY'
import json
import os
print(json.dumps({
    "canvases": [{
        "id": "avatar-main",
        "url": "http://127.0.0.1:49152/sigil/renderer/index.html?toolkit-root=toolkit",
        "owner": {"worktree_root": os.environ["AOS_FAKE_WORKTREE_ROOT"]},
    }]
}))
PY
    exit 0
fi

if [[ "${1:-}" == "show" && "${2:-}" == "eval" && "${3:-}" == "--id" && "${4:-}" == "avatar-main" && "${7:-}" == "--json" ]]; then
    python3 - <<'PY'
import json
import os
print(json.dumps({"result": os.environ["AOS_FAKE_LOADED_AT"]}))
PY
    exit 0
fi

echo "unexpected fake aos invocation: $*" >&2
exit 2
SH
chmod +x "$fake_aos"

AOS="$fake_aos" aos_visual_update_canvas_url avatar-main "aos://sigil/renderer/index.html?toolkit-root=toolkit"
if AOS="$fake_aos" aos_visual_update_canvas_url avatar-main "http://127.0.0.1:49152/sigil/renderer/index.html?toolkit-root=toolkit" 2>"$tmpdir/rejected-url.err"; then
  fail "expected resolved localhost update URL to be rejected"
fi

aos_visual_urls_equivalent \
  "aos://sigil_x/renderer/index.html?toolkit-root=toolkit_x" \
  "http://127.0.0.1:49152/sigil_x/renderer/index.html?toolkit-root=toolkit_x"
assert_fails aos_visual_urls_equivalent \
  "aos://sigil_x/renderer/index.html?toolkit-root=toolkit_x" \
  "http://127.0.0.1:49152/sigil_x/renderer/index.html?toolkit-root=toolkit_y"
assert_fails aos_visual_urls_equivalent \
  "aos://sigil_x/renderer/index.html?toolkit-root=toolkit_x" \
  "http://127.0.0.1:49152/sigil_y/renderer/index.html?toolkit-root=toolkit_x"
assert_fails aos_visual_urls_equivalent \
  "aos://sigil_x/renderer/index.html?toolkit-root=toolkit_x" \
  "http://127.0.0.1:49152/sigil_x/renderer/other.html?toolkit-root=toolkit_x"

AOS="$fake_aos" AOS_FAKE_WORKTREE_ROOT="$ROOT" aos_visual_assert_canvas_worktree avatar-main "$ROOT"
if AOS="$fake_aos" AOS_FAKE_WORKTREE_ROOT="$tmpdir/other" aos_visual_assert_canvas_worktree avatar-main "$ROOT" 2>"$tmpdir/worktree-mismatch.err"; then
  fail "expected mismatched worktree owner to fail"
fi

AOS="$fake_aos" AOS_FAKE_LOADED_AT="2026-05-29T12:00:01+00:00" aos_visual_assert_sigil_renderer_fresh avatar-main "2026-05-29T12:00:00+00:00"
if AOS="$fake_aos" AOS_FAKE_LOADED_AT="2026-05-29T11:59:59+00:00" aos_visual_assert_sigil_renderer_fresh avatar-main "2026-05-29T12:00:00+00:00" 2>"$tmpdir/stale.err"; then
  fail "expected stale loadedAt to fail"
fi

echo "PASS: visual harness canonical URL primitives are deterministic."
