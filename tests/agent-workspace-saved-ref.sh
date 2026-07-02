#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FIX="$ROOT/tests/browser/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"
export AOS_RUNTIME_MODE="repo"
export AOS_STATE_ROOT="$(mktemp -d)"

TMP_DIR="$AOS_STATE_ROOT/test-output"
mkdir -p "$TMP_DIR"
trap 'rm -rf "$AOS_STATE_ROOT"' EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

expect_error_code() {
    local expected="$1"
    local err_file="$2"
    jq -e --arg code "$expected" '.code == $code' "$err_file" >/dev/null \
        || fail "expected error code $expected, got: $(cat "$err_file")"
}

expect_corrupt_state() {
    local expected_path="$1"
    local err_file="$2"
    expect_error_code "AGENT_WORKSPACE_STATE_CORRUPT" "$err_file"
    jq -e --arg path "$expected_path" '.path == $path or (.error | contains($path))' "$err_file" >/dev/null \
        || fail "corrupt-state error did not include path $expected_path: $(cat "$err_file")"
}

with_corrupt_file() {
    local file="$1"
    shift
    local backup="$file.bak-test"
    cp "$file" "$backup"
    printf '{' >"$file"
    if "$@" >"$TMP_DIR/corrupt.out" 2>"$TMP_DIR/corrupt.err"; then
        mv "$backup" "$file"
        fail "corrupt state unexpectedly succeeded for $file"
    fi
    expect_corrupt_state "$file" "$TMP_DIR/corrupt.err"
    [[ "$(cat "$file")" == "{" ]] || {
        mv "$backup" "$file"
        fail "corrupt state file was rewritten: $file"
    }
    mv "$backup" "$file"
}

FAILING_AOS="$TMP_DIR/failing-aos"
cat >"$FAILING_AOS" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    echo "primitive exploded" >&2
    exit 7
fi

echo "unexpected failing aos invocation: $*" >&2
exit 2
SH
chmod +x "$FAILING_AOS"

FAILED_CAPTURE_ERR="$TMP_DIR/failing-capture.err"
if AOS_PATH="$FAILING_AOS" node scripts/aos-see-native.mjs capture --save --mode ax --workspace ws-fail --name snapfail >"$TMP_DIR/failing-capture.out" 2>"$FAILED_CAPTURE_ERR"; then
    fail "failing primitive saved capture unexpectedly succeeded"
else
    FAILED_CAPTURE_STATUS=$?
fi
[[ "$FAILED_CAPTURE_STATUS" -eq 7 ]] || fail "failing primitive exited $FAILED_CAPTURE_STATUS instead of 7: $(cat "$FAILED_CAPTURE_ERR")"
grep -q "primitive exploded" "$FAILED_CAPTURE_ERR" \
    || fail "failing primitive stderr was not forwarded: $(cat "$FAILED_CAPTURE_ERR")"
[[ ! -e "$AOS_STATE_ROOT/repo/agent-workspaces/ws-fail/.write-lock" ]] \
    || fail "failing primitive left workspace lock behind"
[[ ! -e "$AOS_STATE_ROOT/repo/agent-workspaces/ws-fail/snapshots/snapfail" ]] \
    || fail "failing primitive left partial snapshot directory behind"

CAP1="$TMP_DIR/capture-snap1.json"
./aos see capture browser:todo --save --mode ax --workspace ws1 --name snap1 --query button >"$CAP1"
jq -e '
  .status == "success"
  and .schema_version == "aos.agent-workspace.v0"
  and .workspace_id == "ws1"
  and .snapshot_id == "snap1"
  and .runtime_mode == "repo"
  and .capture_mode == "ax"
  and .target == "browser:todo"
  and .query == "button"
  and .counts.elements == 3
  and .counts.refs == 3
  and (.refs | length) == 1
  and .refs[0].ref == "r2"
  and .refs[0].backend == "browser"
  and .refs[0].resolution_class == "snapshot_scoped"
  and .refs[0].confidence == "medium"
  and (.refs[0].supported_actions | index("click") != null)
  and (.refs[0].warnings[0] | contains("snapshot-scoped"))
  and (.omitted.heavy_payloads | index("elements") != null)
  and (.paths.capture | endswith("/capture.json"))
  and (.paths.snapshot_record | endswith("/snapshot.json"))
  and (has("elements") | not)
  and (has("semantic_targets") | not)
  and (has("base64") | not)
' "$CAP1" >/dev/null || fail "compact saved capture shape drifted: $(cat "$CAP1")"

CAPTURE_PATH="$(jq -r '.paths.capture' "$CAP1")"
SUMMARY_PATH="$(jq -r '.paths.summary' "$CAP1")"
SNAPSHOT_RECORD_PATH="$(jq -r '.paths.snapshot_record' "$CAP1")"
REFS_PATH="$(jq -r '.paths.refs' "$CAP1")"
WORKSPACE_PATH="$(jq -r '.paths.workspace' "$CAP1")"

[[ -f "$CAPTURE_PATH" ]] || fail "missing capture payload: $CAPTURE_PATH"
[[ -f "$SUMMARY_PATH" ]] || fail "missing summary payload: $SUMMARY_PATH"
[[ -f "$SNAPSHOT_RECORD_PATH" ]] || fail "missing snapshot record: $SNAPSHOT_RECORD_PATH"
[[ -f "$REFS_PATH" ]] || fail "missing refs payload: $REFS_PATH"
[[ -f "$WORKSPACE_PATH/workspace.json" ]] || fail "missing workspace metadata: $WORKSPACE_PATH/workspace.json"
[[ -f "$WORKSPACE_PATH/index.json" ]] || fail "missing workspace index: $WORKSPACE_PATH/index.json"
jq -e 'has("current_snapshot_id") | not' "$WORKSPACE_PATH/workspace.json" >/dev/null \
    || fail "workspace metadata must not own current_snapshot_id"
jq -e '.current_snapshot_id == "snap1"' "$WORKSPACE_PATH/index.json" >/dev/null \
    || fail "workspace index did not own current_snapshot_id"
WORKSPACE_INFO="$TMP_DIR/workspace-info.json"
./aos see workspace ws1 --json >"$WORKSPACE_INFO"
jq -e '.lock_state.status == "unlocked" and (.lock_state.path | endswith("/.write-lock"))' "$WORKSPACE_INFO" >/dev/null \
    || fail "workspace lock state did not report unlocked: $(cat "$WORKSPACE_INFO")"
SNAP_EXISTS_ERR="$TMP_DIR/snapshot-exists.err"
if ./aos see capture browser:todo --save --mode ax --workspace ws1 --name snap1 >"$TMP_DIR/snapshot-exists.out" 2>"$SNAP_EXISTS_ERR"; then
    fail "duplicate snapshot unexpectedly succeeded"
fi
expect_error_code "SNAPSHOT_EXISTS" "$SNAP_EXISTS_ERR"
[[ ! -e "$WORKSPACE_PATH/.write-lock" ]] \
    || fail "duplicate snapshot left workspace lock behind"
[[ -f "$SNAPSHOT_RECORD_PATH" ]] \
    || fail "duplicate snapshot removed the existing snapshot record"
jq -e '.elements | length == 3' "$CAPTURE_PATH" >/dev/null \
    || fail "full capture did not retain element payload"
jq -e '(has("elements") | not) and (has("semantic_targets") | not) and (has("base64") | not)' "$SUMMARY_PATH" >/dev/null \
    || fail "summary leaked heavy capture payloads"
python3 - \
    shared/schemas/aos-agent-workspace-v0.schema.json \
    "$CAP1" \
    "$SUMMARY_PATH" \
    "$SNAPSHOT_RECORD_PATH" \
    "$REFS_PATH" \
    "$WORKSPACE_PATH/workspace.json" \
    "$WORKSPACE_PATH/index.json" <<'PY'
import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
for instance_path in sys.argv[2:]:
    instance = json.loads(Path(instance_path).read_text(encoding="utf-8"))
    errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.path))
    if errors:
        print(f"{instance_path}: {errors[0].message}", file=sys.stderr)
        sys.exit(1)
PY

BAD_REFS="$TMP_DIR/bad-refs-missing-state-id.json"
jq 'del(.refs[0].identity_facts.state_id)' "$REFS_PATH" >"$BAD_REFS"
if python3 - \
    shared/schemas/aos-agent-workspace-v0.schema.json \
    "$BAD_REFS" <<'PY'
import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
instance = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda error: list(error.path))
sys.exit(0 if not errors else 1)
PY
then
    fail "schema accepted saved ref missing identity_facts.state_id"
fi

with_corrupt_file "$WORKSPACE_PATH/workspace.json" ./aos see workspace ws1 --json
with_corrupt_file "$WORKSPACE_PATH/index.json" ./aos see snapshots --workspace ws1 --json
with_corrupt_file "$SNAPSHOT_RECORD_PATH" ./aos see refs --workspace ws1 --snapshot snap1 --json
with_corrupt_file "$REFS_PATH" ./aos see refs --workspace ws1 --snapshot snap1 --json

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

REFS="$TMP_DIR/refs-snap1.json"
./aos see refs --workspace ws1 --snapshot snap1 --query button --json >"$REFS"
REF="$(jq -r '.refs[0].ref' "$REFS")"
[[ "$REF" == "r2" ]] || fail "expected query to resolve r2, got $REF"
jq -e '
  .status == "success"
  and .workspace_id == "ws1"
  and .snapshot_id == "snap1"
  and (.refs | length) == 1
  and .refs[0].copyable_action_target == "ref:snap1:r2"
' "$REFS" >/dev/null || fail "refs readback shape drifted: $(cat "$REFS")"

CURRENT_REFS="$TMP_DIR/refs-current.json"
./aos see refs --workspace ws1 --query button --json >"$CURRENT_REFS"
jq -e '
  .status == "success"
  and .snapshot_id == "snap1"
  and (.refs | length) == 1
  and .refs[0].ref == "r2"
' "$CURRENT_REFS" >/dev/null || fail "current refs readback shape drifted: $(cat "$CURRENT_REFS")"

SNAPS="$TMP_DIR/snapshots.json"
./aos see snapshots --workspace ws1 --json >"$SNAPS"
jq -e '
  .status == "success"
  and .workspace_id == "ws1"
  and .current_snapshot_id == "snap1"
  and (.snapshots | length) == 1
  and .snapshots[0].snapshot_id == "snap1"
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

DRY="$TMP_DIR/do-ref-dry-run.json"
./aos do click "ref:snap1:$REF" --workspace ws1 --dry-run >"$DRY"
jq -e '
  .status == "dry_run"
  and .schema_version == "aos.agent-workspace.v0"
  and .action == "click"
  and .workspace_id == "ws1"
  and .snapshot_id == "snap1"
  and .ref.ref == "r2"
  and .resolved_action.resolution_status == "validation_required"
  and (.resolved_action.command | index("browser:todo/e2") != null)
' "$DRY" >/dev/null || fail "ref dry-run shape drifted: $(cat "$DRY")"

BARE_DRY="$TMP_DIR/do-ref-bare-dry-run.json"
./aos do click "ref:$REF" --workspace ws1 --dry-run >"$BARE_DRY"
jq -e '
  .status == "dry_run"
  and .snapshot_id == "snap1"
  and .ref.ref == "r2"
  and .resolved_action.resolution_status == "validation_required"
' "$BARE_DRY" >/dev/null || fail "bare ref dry-run shape drifted before ambiguity: $(cat "$BARE_DRY")"

REAL_ERR="$TMP_DIR/do-ref-real.err"
if ./aos do click "ref:snap1:$REF" --workspace ws1 >"$TMP_DIR/do-ref-real.out" 2>"$REAL_ERR"; then
    fail "browser snapshot ref mutation unexpectedly succeeded"
fi
expect_error_code "REF_REVALIDATION_REQUIRED" "$REAL_ERR"
jq -e '.status == "snapshot_scoped" and .ref.ref == "r2"' "$REAL_ERR" >/dev/null \
    || fail "real mutation did not fail closed with ref details: $(cat "$REAL_ERR")"

MALFORMED_REFS_BACKUP="$REFS_PATH.valid-test-backup"
cp "$REFS_PATH" "$MALFORMED_REFS_BACKUP"
jq 'del(.refs[0].identity_facts.state_id)' "$MALFORMED_REFS_BACKUP" >"$REFS_PATH"
MALFORMED_REFS_ERR="$TMP_DIR/malformed-refs-action.err"
if ./aos do click "ref:snap1:$REF" --workspace ws1 --dry-run >"$TMP_DIR/malformed-refs-action.out" 2>"$MALFORMED_REFS_ERR"; then
    mv "$MALFORMED_REFS_BACKUP" "$REFS_PATH"
    fail "saved-ref action accepted malformed refs record"
fi
expect_corrupt_state "$REFS_PATH" "$MALFORMED_REFS_ERR"
mv "$MALFORMED_REFS_BACKUP" "$REFS_PATH"

FAKE_FORM_AOS="$TMP_DIR/fake-form-aos"
cat >"$FAKE_FORM_AOS" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    cat <<'JSON'
{
  "status": "success",
  "state_id": "see_form_fixture",
  "files": [],
  "elements": [
    {
      "ref": "e42",
      "role": "textbox",
      "title": "Search",
      "context_path": ["browser:form"]
    }
  ]
}
JSON
    exit 0
fi

echo "unexpected fake form aos invocation: $*" >&2
exit 2
SH
chmod +x "$FAKE_FORM_AOS"

FORM="$TMP_DIR/capture-form.json"
AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-see-native.mjs capture browser:form --save --mode ax --workspace ws-form --name snapform >"$FORM"
jq -e '
  .status == "success"
  and .refs[0].backend == "browser"
  and .refs[0].resolution_class == "snapshot_scoped"
  and (.refs[0].supported_actions == ["click"])
  and (.refs[0].supported_actions | index("fill") | not)
  and (.refs[0].supported_actions | index("type") | not)
  and (.refs[0].supported_actions | index("key") | not)
  and .refs[0].action_target == "browser:form/e42"
' "$FORM" >/dev/null || fail "browser form saved-ref reporting drifted: $(cat "$FORM")"

FORM_FILL_ERR="$TMP_DIR/do-form-fill.err"
if AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-browser.mjs fill ref:snapform:r1 "hello" --workspace ws-form --dry-run >"$TMP_DIR/do-form-fill.out" 2>"$FORM_FILL_ERR"; then
    fail "browser fill saved ref unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_FLAG" "$FORM_FILL_ERR"

NON_CLICK_AOS="$TMP_DIR/non-click-aos"
cat >"$NON_CLICK_AOS" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__do" && "${2:-}" == "type" && "${3:-}" == "ref:literal" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

print(json.dumps({
    "status": "success",
    "received": sys.argv[1:],
}))
PY
    exit 0
fi

echo "unexpected non-click aos invocation: $*" >&2
exit 2
SH
chmod +x "$NON_CLICK_AOS"
NON_CLICK_LITERAL="$TMP_DIR/non-click-ref-literal.json"
AOS_AGENT_WORKSPACE=bad/id AOS_PATH="$NON_CLICK_AOS" node scripts/aos-do-native.mjs type 'ref:literal' --dry-run >"$NON_CLICK_LITERAL"
jq -e '
  .status == "success"
  and (.received | index("__do") != null)
  and (.received | index("type") != null)
  and (.received | index("ref:literal") != null)
' "$NON_CLICK_LITERAL" >/dev/null || fail "non-click ref literal was not passed through without workspace resolution: $(cat "$NON_CLICK_LITERAL")"

CAP2="$TMP_DIR/capture-snap2.json"
./aos see capture browser:todo --save --mode ax --workspace ws1 --name snap2 >"$CAP2"
jq -e '.status == "success" and .snapshot_id == "snap2" and .capture_mode == "ax"' "$CAP2" >/dev/null \
    || fail "second capture failed: $(cat "$CAP2")"
jq -e '([.snapshots[].snapshot_id] | index("snap1") != null and index("snap2") != null)' "$WORKSPACE_PATH/index.json" >/dev/null \
    || fail "sequential saves did not preserve both snapshot index entries: $(cat "$WORKSPACE_PATH/index.json")"

AMBIG_ERR="$TMP_DIR/do-ref-ambiguous.err"
if ./aos do click "ref:$REF" --workspace ws1 --dry-run >"$TMP_DIR/do-ref-ambiguous.out" 2>"$AMBIG_ERR"; then
    fail "bare ref unexpectedly resolved across multiple snapshots"
fi
expect_error_code "REF_AMBIGUOUS" "$AMBIG_ERR"
jq -e '.status == "ambiguous" and (.candidates | length) >= 2' "$AMBIG_ERR" >/dev/null \
    || fail "bare-ref ambiguity payload drifted: $(cat "$AMBIG_ERR")"

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
jq -e '.status == "success" and .snapshot_id == "snap1" and .refs[0].ref == "r2"' "$CURRENT_AFTER_DELETE" >/dev/null \
    || fail "current refs did not resolve through index after deleting snap2: $(cat "$CURRENT_AFTER_DELETE")"

VISION="$TMP_DIR/capture-vision.json"
./aos see capture browser:todo --save --mode vision --workspace ws-vision --name snapv >"$VISION"
ARTIFACT="$(jq -r '.artifact_refs[0].path' "$VISION")"
jq -e '.status == "success" and .capture_mode == "vision" and .counts.files == 1 and .counts.refs == 0' "$VISION" >/dev/null \
    || fail "vision saved capture shape drifted: $(cat "$VISION")"
[[ -f "$ARTIFACT" ]] || fail "vision capture did not keep screenshot file-backed: $ARTIFACT"

FAKE_AOS="$TMP_DIR/fake-aos"
cat >"$FAKE_AOS" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    cat <<'JSON'
{
  "status": "success",
  "state_id": "see_native_fixture",
  "files": [],
  "elements": [
    {
      "role": "AXButton",
      "title": "Install",
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    }
  ]
}
JSON
    exit 0
fi

echo "unexpected fake aos invocation: $*" >&2
exit 2
SH
chmod +x "$FAKE_AOS"

NATIVE="$TMP_DIR/capture-native.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace ws-native --name snapnative >"$NATIVE"
jq -e '
  .status == "success"
  and .capture_mode == "ax"
  and .workspace_id == "ws-native"
  and .snapshot_id == "snapnative"
  and .refs[0].backend == "native_ax"
  and .refs[0].resolution_class == "volatile"
  and .refs[0].confidence == "low"
  and (.refs[0].supported_actions | length) == 0
  and (.refs[0].warnings[0] | contains("native AX"))
  and (.refs[0].known_limits[0] | contains("hints"))
  and any(.known_limits[]; contains("non-browser ax mode"))
' "$NATIVE" >/dev/null || fail "native AX saved-ref reporting drifted: $(cat "$NATIVE")"

NATIVE_ERR="$TMP_DIR/do-native-ref.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs click ref:snapnative:r1 --workspace ws-native --dry-run >"$TMP_DIR/do-native-ref.out" 2>"$NATIVE_ERR"; then
    fail "native volatile inspection ref unexpectedly became actionable"
fi
expect_error_code "REF_UNSUPPORTED" "$NATIVE_ERR"
jq -e '.status == "unsupported" and .ref.backend == "native_ax" and .ref.resolution_class == "volatile"' "$NATIVE_ERR" >/dev/null \
    || fail "native unsupported ref payload drifted: $(cat "$NATIVE_ERR")"

HIGHLIGHT_MAIN="$TMP_DIR/capture-highlight-main.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture --save --mode ax --workspace ws-highlight --name snaphighlight --highlight-cursor '#ff00aa' >"$HIGHLIGHT_MAIN"
jq -e '.status == "success" and .target == "main" and .snapshot_id == "snaphighlight"' "$HIGHLIGHT_MAIN" >/dev/null \
    || fail "no-target highlight saved capture did not persist main target: $(cat "$HIGHLIGHT_MAIN")"

FAKE_CANVAS_AOS="$TMP_DIR/fake-canvas-aos"
cat >"$FAKE_CANVAS_AOS" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    cat <<'JSON'
{
  "status": "success",
  "state_id": "see_canvas_fixture",
  "files": [],
  "semantic_targets": [
    {
      "ref": "save-button",
      "surface": "fixture-panel",
      "role": "button",
      "name": "Save",
      "enabled": true,
      "actions": ["click", "focus"],
      "target": {
        "target_id": "fixture.save",
        "owner_namespace": {
          "app_id": "fixture",
          "canvas_id": "canvas-fixture",
          "surface_id": "fixture-panel",
          "component_family": "fixture.panel",
          "structural_owner": ["fixture-panel"]
        }
      },
      "provenance": {
        "canvas_id": "canvas-fixture",
        "do_target": "canvas:canvas-fixture/save-button",
        "center": { "x": 20, "y": 30 }
      },
      "reacquisition": {
        "strategy": "owner-structural-fingerprint",
        "machine_fingerprint": {
          "role": "button",
          "structural_path": ["fixture-panel", "save-button"],
          "capabilities": ["click", "focus"]
        }
      }
    }
  ]
}
JSON
    exit 0
fi

if [[ "${1:-}" == "do" && "${2:-}" == "click" && "${3:-}" == "canvas:canvas-fixture/save-button" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

args = sys.argv[1:]
assert "--state-id" in args, args
assert args[args.index("--state-id") + 1] == "see_canvas_fixture", args
print(json.dumps({
    "status": "success",
    "received": args,
    "execution": {
        "backend": "canvas",
        "strategy": "fixture_canvas_click",
        "state_id": "see_canvas_fixture"
    }
}))
PY
    exit 0
fi

echo "unexpected fake canvas aos invocation: $*" >&2
exit 2
SH
chmod +x "$FAKE_CANVAS_AOS"

CANVAS="$TMP_DIR/capture-canvas.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-see-native.mjs capture main --save --mode som --workspace ws-canvas --name snapcanvas >"$CANVAS"
jq -e '
  .status == "success"
  and .capture_mode == "som"
  and .workspace_id == "ws-canvas"
  and .snapshot_id == "snapcanvas"
  and .state_id == "see_canvas_fixture"
  and .refs[0].backend == "aos_canvas"
  and .refs[0].resolution_class == "reacquirable"
  and .refs[0].confidence == "high"
  and .refs[0].action_target == "canvas:canvas-fixture/save-button"
  and (.refs[0].supported_actions | index("click") != null)
  and (.refs[0].supported_actions | index("focus") | not)
' "$CANVAS" >/dev/null || fail "AOS canvas saved-ref reporting drifted: $(cat "$CANVAS")"

CANVAS_DRY="$TMP_DIR/do-canvas-dry-run.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs click ref:snapcanvas:r1 --workspace ws-canvas --dry-run >"$CANVAS_DRY"
jq -e '
  .status == "dry_run"
  and .ref.backend == "aos_canvas"
  and .ref.resolution_class == "reacquirable"
  and .resolved_action.resolution_status == "resolved"
  and (.resolved_action.command | index("canvas:canvas-fixture/save-button") != null)
  and (.resolved_action.command | index("--state-id") != null)
  and (.resolved_action.command | index("see_canvas_fixture") != null)
' "$CANVAS_DRY" >/dev/null || fail "AOS canvas ref dry-run drifted: $(cat "$CANVAS_DRY")"

CANVAS_ACTION="$TMP_DIR/do-canvas-action.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs click ref:snapcanvas:r1 --workspace ws-canvas >"$CANVAS_ACTION"
jq -e '
  .status == "success"
  and .execution.backend == "canvas"
  and .execution.state_id == "see_canvas_fixture"
  and (.received | index("canvas:canvas-fixture/save-button") != null)
' "$CANVAS_ACTION" >/dev/null || fail "AOS canvas ref action drifted: $(cat "$CANVAS_ACTION")"

CANVAS_INCOMPATIBLE_ERR="$TMP_DIR/do-canvas-incompatible.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs type ref:snapcanvas:r1 --workspace ws-canvas >"$TMP_DIR/do-canvas-incompatible.out" 2>"$CANVAS_INCOMPATIBLE_ERR"; then
    fail "incompatible AOS canvas ref action unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_FLAG" "$CANVAS_INCOMPATIBLE_ERR"

ACK_ERR="$TMP_DIR/workspace-delete-no-ack.err"
if ./aos see workspace delete ws-vision >"$TMP_DIR/workspace-delete-no-ack.out" 2>"$ACK_ERR"; then
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

mkdir "$AOS_STATE_ROOT/repo/agent-workspaces/ws-vision/.write-lock"
LOCKED_WORKSPACE_DELETE_ERR="$TMP_DIR/locked-workspace-delete.err"
if ./aos see workspace delete ws-vision --i-understand-local-artifacts --json >"$TMP_DIR/locked-workspace-delete.out" 2>"$LOCKED_WORKSPACE_DELETE_ERR"; then
    fail "workspace delete succeeded under pre-existing workspace lock"
fi
expect_error_code "AGENT_WORKSPACE_LOCKED" "$LOCKED_WORKSPACE_DELETE_ERR"
rm -rf "$AOS_STATE_ROOT/repo/agent-workspaces/ws-vision/.write-lock"

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
./aos see workspace delete ws-vision --i-understand-local-artifacts --json >"$DELETE_WORKSPACE"
jq -e '.status == "deleted" and .workspace_id == "ws-vision"' "$DELETE_WORKSPACE" >/dev/null \
    || fail "workspace delete shape drifted: $(cat "$DELETE_WORKSPACE")"
[[ ! -d "$AOS_STATE_ROOT/repo/agent-workspaces/ws-vision" ]] \
    || fail "workspace delete left local artifact directory behind"

BAD_MODE_ERR="$TMP_DIR/bad-mode.err"
if ./aos see capture browser:todo --save --mode bad --workspace ws1 --name badmode >"$TMP_DIR/bad-mode.out" 2>"$BAD_MODE_ERR"; then
    fail "invalid capture mode unexpectedly succeeded"
fi
expect_error_code "INVALID_ARG" "$BAD_MODE_ERR"

NO_SAVE_MODE_ERR="$TMP_DIR/no-save-mode.err"
if ./aos see capture browser:todo --mode ax >"$TMP_DIR/no-save-mode.out" 2>"$NO_SAVE_MODE_ERR"; then
    fail "workspace-only --mode without --save unexpectedly succeeded"
fi
expect_error_code "INVALID_ARG" "$NO_SAVE_MODE_ERR"
jq -e '.error == "--mode requires --save"' "$NO_SAVE_MODE_ERR" >/dev/null \
    || fail "--mode without --save did not fail clearly: $(cat "$NO_SAVE_MODE_ERR")"

grep -q 'shared/schemas/aos-agent-workspace-v0.md' skills/aos-agent-workspace/SKILL.md \
    || fail "skill lost schema contract pointer"
grep -q 'REF_REVALIDATION_REQUIRED' skills/aos-agent-workspace/SKILL.md \
    || fail "skill lost fail-closed ref guidance"

echo "PASS"
