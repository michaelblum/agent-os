#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/agent-workspace-fixtures.sh"
agent_workspace_test_setup

CAP1="$TMP_DIR/capture-snap1.json"
./aos see capture browser:todo --save --mode ax --workspace ws1 --name snap1 >"$CAP1"
WORKSPACE_PATH="$(jq -r '.paths.workspace' "$CAP1")"

WORKSPACE_INFO="$TMP_DIR/workspace-info.json"
./aos see workspace ws1 --json >"$WORKSPACE_INFO"
jq -e '.lock_state.status == "unlocked" and (.lock_state.path | endswith("/.write-lock"))' "$WORKSPACE_INFO" >/dev/null \
    || fail "workspace lock state did not report unlocked: $(cat "$WORKSPACE_INFO")"

mkdir "$WORKSPACE_PATH/.write-lock"
cat >"$WORKSPACE_PATH/.write-lock/owner.json" <<'JSON'
{"owner":"test"}
JSON
LOCKED_INFO="$TMP_DIR/workspace-locked-info.json"
./aos see workspace ws1 --json >"$LOCKED_INFO"
jq -e '.lock_state.status == "locked" and .lock_state.owner.owner == "test"' "$LOCKED_INFO" >/dev/null \
    || fail "workspace lock state did not report locked: $(cat "$LOCKED_INFO")"
LOCKED_SAVE_ERR="$TMP_DIR/locked-save.err"
if ./aos see capture browser:todo --save --mode ax --workspace ws1 --name locked-save >"$TMP_DIR/locked-save.out" 2>"$LOCKED_SAVE_ERR"; then
    fail "save succeeded under pre-existing workspace lock"
fi
expect_error_code "AGENT_WORKSPACE_LOCKED" "$LOCKED_SAVE_ERR"
LOCKED_PRUNE_ERR="$TMP_DIR/locked-prune.err"
if ./aos see workspace prune ws1 --older-than 0s --i-understand-local-artifacts --json >"$TMP_DIR/locked-prune.out" 2>"$LOCKED_PRUNE_ERR"; then
    fail "prune succeeded under pre-existing workspace lock"
fi
expect_error_code "AGENT_WORKSPACE_LOCKED" "$LOCKED_PRUNE_ERR"
LOCKED_DELETE_ERR="$TMP_DIR/locked-delete.err"
if ./aos see snapshot delete snap1 --workspace ws1 --i-understand-local-artifacts --json >"$TMP_DIR/locked-delete.out" 2>"$LOCKED_DELETE_ERR"; then
    fail "snapshot delete succeeded under pre-existing workspace lock"
fi
expect_error_code "AGENT_WORKSPACE_LOCKED" "$LOCKED_DELETE_ERR"
rm -rf "$WORKSPACE_PATH/.write-lock"

SNAPS="$TMP_DIR/snapshots.json"
./aos see snapshots --workspace ws1 --json >"$SNAPS"
jq -e '
  .status == "success"
  and .workspace_id == "ws1"
  and .current_snapshot_id == "snap1"
  and (.snapshots | length) == 1
  and .snapshots[0].snapshot_id == "snap1"
  and .snapshots[0].capture_target == "browser:todo"
  and .snapshots[0].query == null
  and (.snapshots[0].paths.snapshot_record | endswith("/snapshot.json"))
' "$SNAPS" >/dev/null || fail "snapshot readback shape drifted: $(cat "$SNAPS")"

WORKSPACES="$TMP_DIR/workspaces.json"
./aos see workspaces --json >"$WORKSPACES"
jq -e '.status == "success" and any(.workspaces[]; .workspace_id == "ws1" and .snapshot_count == 1)' "$WORKSPACES" >/dev/null \
    || fail "workspace list missing ws1: $(cat "$WORKSPACES")"

BAD_ENV_WORKSPACES="$TMP_DIR/bad-env-workspaces.json"
AOS_AGENT_WORKSPACE=bad/id node scripts/aos-agent-workspace.mjs workspaces --json >"$BAD_ENV_WORKSPACES"
jq -e '.status == "success" and any(.workspaces[]; .workspace_id == "ws1")' "$BAD_ENV_WORKSPACES" >/dev/null \
    || fail "workspaces validated AOS_AGENT_WORKSPACE default: $(cat "$BAD_ENV_WORKSPACES")"

BAD_ENV_WORKSPACE_ERR="$TMP_DIR/bad-env-workspace-missing.err"
if AOS_AGENT_WORKSPACE=bad/id node scripts/aos-agent-workspace.mjs workspace missing --json >"$TMP_DIR/bad-env-workspace-missing.out" 2>"$BAD_ENV_WORKSPACE_ERR"; then
    fail "missing workspace unexpectedly succeeded with bad env default"
fi
expect_error_code "WORKSPACE_NOT_FOUND" "$BAD_ENV_WORKSPACE_ERR"

expect_command_error_code "UNKNOWN_FLAG" "workspaces-dry-run-flag" ./aos see workspaces --dry-run --json
expect_command_error_code "UNKNOWN_FLAG" "workspaces-older-than-flag" ./aos see workspaces --older-than 7d --json
expect_command_error_code "UNKNOWN_FLAG" "workspaces-ack-flag" ./aos see workspaces --i-understand-local-artifacts --json
expect_command_error_code "UNKNOWN_FLAG" "workspace-read-ack-flag" ./aos see workspace ws1 --i-understand-local-artifacts --json
expect_command_error_code "UNKNOWN_FLAG" "refs-older-than-flag" ./aos see refs --older-than 7d --json
expect_command_error_code "UNKNOWN_ARG" "workspaces-stray-arg" ./aos see workspaces stray --json
expect_command_error_code "UNKNOWN_ARG" "snapshots-stray-arg" ./aos see snapshots stray --workspace ws1 --json
expect_command_error_code "UNKNOWN_ARG" "refs-stray-arg" ./aos see refs stray --workspace ws1 --json

CAP2="$TMP_DIR/capture-snap2.json"
./aos see capture browser:todo --save --mode ax --workspace ws1 --name snap2 >"$CAP2"
DELETE_CURRENT="$TMP_DIR/snapshot-delete-current.json"
./aos see snapshot delete snap2 --workspace ws1 --i-understand-local-artifacts --json >"$DELETE_CURRENT"
jq -e '.status == "deleted" and .workspace_id == "ws1" and .snapshot_id == "snap2"' "$DELETE_CURRENT" >/dev/null \
    || fail "current snapshot delete shape drifted: $(cat "$DELETE_CURRENT")"
jq -e '.current_snapshot_id == "snap1" and ([.snapshots[].snapshot_id] | index("snap2") | not)' "$WORKSPACE_PATH/index.json" >/dev/null \
    || fail "index-backed current snapshot did not fall back to snap1 after deleting snap2"
jq -e 'has("current_snapshot_id") | not' "$WORKSPACE_PATH/workspace.json" >/dev/null \
    || fail "snapshot delete reintroduced current_snapshot_id metadata"
CURRENT_AFTER_DELETE="$TMP_DIR/refs-current-after-delete.json"
./aos see refs --workspace ws1 --query button --json >"$CURRENT_AFTER_DELETE"
jq -e '.status == "success" and .snapshot_id == "snap1"' "$CURRENT_AFTER_DELETE" >/dev/null \
    || fail "current refs did not resolve through index after deleting snap2: $(cat "$CURRENT_AFTER_DELETE")"
assert_no_heavy_capture_payloads "$CURRENT_AFTER_DELETE" "current refs after delete readback"

ACK_ERR="$TMP_DIR/workspace-delete-no-ack.err"
if ./aos see workspace delete ws1 >"$TMP_DIR/workspace-delete-no-ack.out" 2>"$ACK_ERR"; then
    fail "workspace delete succeeded without acknowledgement"
fi
expect_error_code "ACK_REQUIRED" "$ACK_ERR"

MISSING_WORKSPACE_DIR="$AOS_STATE_ROOT/repo/agent-workspaces/missing"
MISSING_WORKSPACE_DELETE_ERR="$TMP_DIR/workspace-delete-missing.err"
if ./aos see workspace delete missing --i-understand-local-artifacts --json >"$TMP_DIR/workspace-delete-missing.out" 2>"$MISSING_WORKSPACE_DELETE_ERR"; then
    fail "workspace delete missing unexpectedly succeeded"
fi
expect_error_code "WORKSPACE_NOT_FOUND" "$MISSING_WORKSPACE_DELETE_ERR"
[[ ! -e "$MISSING_WORKSPACE_DIR" ]] \
    || fail "workspace delete missing created state at $MISSING_WORKSPACE_DIR"

MISSING_SNAPSHOT_DELETE_ERR="$TMP_DIR/snapshot-delete-missing-workspace.err"
if ./aos see snapshot delete snap-missing --workspace missing --i-understand-local-artifacts --json >"$TMP_DIR/snapshot-delete-missing-workspace.out" 2>"$MISSING_SNAPSHOT_DELETE_ERR"; then
    fail "snapshot delete in missing workspace unexpectedly succeeded"
fi
expect_error_code "WORKSPACE_NOT_FOUND" "$MISSING_SNAPSHOT_DELETE_ERR"
[[ ! -e "$MISSING_WORKSPACE_DIR" ]] \
    || fail "snapshot delete missing workspace created state at $MISSING_WORKSPACE_DIR"

./aos see capture browser:todo --save --mode ax --workspace ws-delete --name snapdelete >"$TMP_DIR/capture-delete.json"
mkdir "$AOS_STATE_ROOT/repo/agent-workspaces/ws-delete/.write-lock"
LOCKED_WORKSPACE_DELETE_ERR="$TMP_DIR/locked-workspace-delete.err"
if ./aos see workspace delete ws-delete --i-understand-local-artifacts --json >"$TMP_DIR/locked-workspace-delete.out" 2>"$LOCKED_WORKSPACE_DELETE_ERR"; then
    fail "workspace delete succeeded under pre-existing workspace lock"
fi
expect_error_code "AGENT_WORKSPACE_LOCKED" "$LOCKED_WORKSPACE_DELETE_ERR"
rm -rf "$AOS_STATE_ROOT/repo/agent-workspaces/ws-delete/.write-lock"

PRUNE_CAPTURE="$TMP_DIR/capture-prune.json"
./aos see capture browser:todo --save --mode ax --workspace ws-prune --name prune1 >"$PRUNE_CAPTURE"
PRUNE_WORKSPACE_PATH="$(jq -r '.paths.workspace' "$PRUNE_CAPTURE")"
PRUNE_MUTATE="$TMP_DIR/workspace-prune-mutating.json"
./aos see workspace prune ws-prune --older-than 0s --i-understand-local-artifacts --json >"$PRUNE_MUTATE"
jq -e '.status == "pruned" and .workspace_id == "ws-prune" and (.removed | length) == 1' "$PRUNE_MUTATE" >/dev/null \
    || fail "workspace prune mutation shape drifted: $(cat "$PRUNE_MUTATE")"
jq -e '.current_snapshot_id == null and (.snapshots | length) == 0' "$PRUNE_WORKSPACE_PATH/index.json" >/dev/null \
    || fail "prune mutation left stale current snapshot index metadata"
jq -e 'has("current_snapshot_id") | not' "$PRUNE_WORKSPACE_PATH/workspace.json" >/dev/null \
    || fail "prune mutation reintroduced current_snapshot_id metadata"

PRUNE="$TMP_DIR/workspace-prune-dry-run.json"
./aos see workspace prune ws1 --older-than 0s --dry-run --json >"$PRUNE"
jq -e '.status == "dry_run" and .workspace_id == "ws1" and (.removed | length) >= 1' "$PRUNE" >/dev/null \
    || fail "workspace prune dry-run shape drifted: $(cat "$PRUNE")"

DELETE_SNAP="$TMP_DIR/snapshot-delete.json"
./aos see snapshot delete snap1 --workspace ws1 --i-understand-local-artifacts --json >"$DELETE_SNAP"
jq -e '.status == "deleted" and .workspace_id == "ws1" and .snapshot_id == "snap1"' "$DELETE_SNAP" >/dev/null \
    || fail "snapshot delete shape drifted: $(cat "$DELETE_SNAP")"
[[ ! -d "$AOS_STATE_ROOT/repo/agent-workspaces/ws1/snapshots/snap1" ]] \
    || fail "snapshot delete left local artifact directory behind"
jq -e '.current_snapshot_id == null and (.snapshots | length) == 0' "$WORKSPACE_PATH/index.json" >/dev/null \
    || fail "deleting final snapshot left stale current snapshot index metadata"
jq -e 'has("current_snapshot_id") | not' "$WORKSPACE_PATH/workspace.json" >/dev/null \
    || fail "deleting final snapshot reintroduced current_snapshot_id metadata"

DELETE_WORKSPACE="$TMP_DIR/workspace-delete.json"
./aos see workspace delete ws-delete --i-understand-local-artifacts --json >"$DELETE_WORKSPACE"
jq -e '.status == "deleted" and .workspace_id == "ws-delete"' "$DELETE_WORKSPACE" >/dev/null \
    || fail "workspace delete shape drifted: $(cat "$DELETE_WORKSPACE")"
[[ ! -d "$AOS_STATE_ROOT/repo/agent-workspaces/ws-delete" ]] \
    || fail "workspace delete left local artifact directory behind"

echo "PASS cleanup"
