#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-worktree-policy.XXXXXX")"
WORKTREE="$TMP/linked-agent-os"

cleanup() {
  git -C "$ROOT" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

git -C "$ROOT" worktree add --detach "$WORKTREE" HEAD >/dev/null

# Local verification often runs before these changes are committed. Mirror only
# the runtime-policy sources into the disposable worktree so Node-only command
# guards exercise the same scripts that this checkout is validating. Do not copy
# or execute the native ./aos binary from the temporary worktree; endpoint tools
# can treat that as a different executable identity.
git -C "$ROOT" diff --binary -- \
  scripts/lib/aos-cli.mjs \
  scripts/lib/aos-readiness.mjs \
  scripts/lib/aos-live-operation.mjs \
  scripts/aos-ready.mjs \
  scripts/aos-content.mjs \
  scripts/aos-show-client.mjs \
  scripts/aos-service.mjs \
  >"$TMP/runtime-policy.patch"
if [[ -s "$TMP/runtime-policy.patch" ]]; then
  git -C "$WORKTREE" apply "$TMP/runtime-policy.patch"
fi

assert_json_code() {
  local stdout_file="$1"
  local stderr_file="$2"
  local code="$3"
  local blocker="$4"
  python3 - "$stdout_file" "$stderr_file" "$code" "$blocker" <<'PY'
import json
import pathlib
import sys

payload = None
errors = []
for candidate in sys.argv[1:3]:
    text = pathlib.Path(candidate).read_text()
    if not text.strip():
        continue
    try:
        payload = json.loads(text)
        break
    except json.JSONDecodeError as exc:
        errors.append(f"{candidate}: {exc}")
if payload is None:
    raise AssertionError(f"no JSON payload in stdout/stderr: {errors}")

expected_code = sys.argv[3]
expected_blocker = sys.argv[4]

assert payload.get("code") == expected_code or payload.get("diagnosis") == expected_blocker, payload
if "blocker" in payload:
    assert payload.get("blocker") == expected_blocker, payload
if "blockers" in payload:
    assert any(item.get("id") == expected_blocker for item in payload.get("blockers", [])), payload
PY
}

node --input-type=module - "$WORKTREE" >"$TMP/policy.out" <<'NODE'
import assert from 'node:assert/strict';
import path from 'node:path';

const worktree = process.argv[2];
process.env.AOS_REPO_ROOT = worktree;
const { agentOSWorktreePolicy } = await import(path.join(worktree, 'scripts/lib/aos-cli.mjs'));

const blocked = agentOSWorktreePolicy({ mode: 'repo', root: worktree });
assert.equal(blocked.allowed, false, blocked);
assert.equal(blocked.id, 'agent_os_worktree_default_runtime', blocked);

process.env.AOS_STATE_ROOT = path.join(worktree, '.tmp-isolated-state');
const isolated = agentOSWorktreePolicy({ mode: 'repo', root: worktree });
assert.equal(isolated.allowed, true, isolated);
assert.equal(isolated.reason, 'explicit_state_root', isolated);

console.log('policy PASS');
NODE

if (cd "$WORKTREE" && node scripts/aos-content.mjs wait --root toolkit --timeout 1s --json) >"$TMP/content.out" 2>"$TMP/content.err"; then
  echo "FAIL: content wait allowed linked worktree default runtime"
  exit 1
fi
assert_json_code "$TMP/content.out" "$TMP/content.err" AGENT_OS_WORKTREE_DEFAULT_RUNTIME agent_os_worktree_default_runtime

if (cd "$WORKTREE" && node scripts/aos-show-client.mjs wait --id worktree-policy --timeout 1ms --json) >"$TMP/show.out" 2>"$TMP/show.err"; then
  echo "FAIL: show wait allowed linked worktree default runtime"
  exit 1
fi
assert_json_code "$TMP/show.out" "$TMP/show.err" AGENT_OS_WORKTREE_DEFAULT_RUNTIME agent_os_worktree_default_runtime

if (cd "$WORKTREE" && AOS_SERVICE_BINARY="$TMP/missing-aos-binary" node scripts/aos-service.mjs start --mode repo --json) >"$TMP/service.out" 2>"$TMP/service.err"; then
  echo "FAIL: service start allowed linked worktree default runtime"
  exit 1
fi
assert_json_code "$TMP/service.out" "$TMP/service.err" AGENT_OS_WORKTREE_DEFAULT_RUNTIME agent_os_worktree_default_runtime

echo "PASS"
