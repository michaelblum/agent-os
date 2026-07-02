#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/agent-workspace-fixtures.sh"
agent_workspace_test_setup

CAP1="$TMP_DIR/capture-snap1.json"
./aos see capture browser:todo --save --mode ax --workspace ws-browser --name snap1 --query button >"$CAP1"
REF="$(jq -r '.refs[0].ref' "$CAP1")"
[[ "$REF" == "r2" ]] || fail "expected query to resolve r2, got $REF"
WORKSPACE_PATH="$(jq -r '.paths.workspace' "$CAP1")"

REFS="$TMP_DIR/refs-snap1.json"
./aos see refs --workspace ws-browser --snapshot snap1 --query button --json >"$REFS"
jq -e '
  .status == "success"
  and .workspace_id == "ws-browser"
  and .snapshot_id == "snap1"
  and (.refs | length) == 1
  and .refs[0].copyable_action_target == "ref:snap1:r2"
' "$REFS" >/dev/null || fail "refs readback shape drifted: $(cat "$REFS")"

CURRENT_REFS="$TMP_DIR/refs-current.json"
./aos see refs --workspace ws-browser --query button --json >"$CURRENT_REFS"
jq -e '
  .status == "success"
  and .snapshot_id == "snap1"
  and (.refs | length) == 1
  and .refs[0].ref == "r2"
' "$CURRENT_REFS" >/dev/null || fail "current refs readback shape drifted: $(cat "$CURRENT_REFS")"

DRY="$TMP_DIR/do-ref-dry-run.json"
./aos do click "ref:snap1:$REF" --workspace ws-browser --dry-run >"$DRY"
jq -e '
  .status == "dry_run"
  and .schema_version == "aos.agent-workspace.v0"
  and .action == "click"
  and .workspace_id == "ws-browser"
  and .snapshot_id == "snap1"
  and .ref.ref == "r2"
  and .resolved_action.resolution_status == "validation_required"
  and .current_validation.status == "reacquired"
  and .current_validation.current_target.ref == "e2"
  and (.resolved_action.command | index("browser:todo/e2") != null)
  and (.recommended_next_command | contains("aos see capture --save"))
' "$DRY" >/dev/null || fail "browser ref dry-run advisory shape drifted: $(cat "$DRY")"

BARE_DRY="$TMP_DIR/do-ref-bare-dry-run.json"
./aos do click "ref:$REF" --workspace ws-browser --dry-run >"$BARE_DRY"
jq -e '
  .status == "dry_run"
  and .snapshot_id == "snap1"
  and .ref.ref == "r2"
  and .resolved_action.resolution_status == "validation_required"
  and .current_validation.status == "reacquired"
' "$BARE_DRY" >/dev/null || fail "bare browser ref dry-run shape drifted before ambiguity: $(cat "$BARE_DRY")"

REAL_ACTION_ERR="$TMP_DIR/do-ref-real.err"
if ./aos do click "ref:snap1:$REF" --workspace ws-browser >"$TMP_DIR/do-ref-real.out" 2>"$REAL_ACTION_ERR"; then
    fail "browser saved-ref click unexpectedly executed real mutation"
fi
expect_error_code "REF_REVALIDATION_REQUIRED" "$REAL_ACTION_ERR"
jq -e '
  .status == "snapshot_scoped"
  and .ref.backend == "browser"
  and .ref.resolution_class == "snapshot_scoped"
  and (.safe_next_action | contains("aos see capture --save"))
' "$REAL_ACTION_ERR" >/dev/null || fail "browser real mutation fail-closed payload drifted: $(cat "$REAL_ACTION_ERR")"

HOVER_DRY="$TMP_DIR/do-ref-hover-dry.json"
./aos do hover "ref:snap1:$REF" --workspace ws-browser --dry-run >"$HOVER_DRY"
jq -e '
  .status == "dry_run"
  and .action == "hover"
  and .resolved_action.resolution_status == "validation_required"
  and .current_validation.current_target.ref == "e2"
  and (.resolved_action.command | index("browser:todo/e2") != null)
' "$HOVER_DRY" >/dev/null || fail "browser hover saved-ref dry-run drifted: $(cat "$HOVER_DRY")"

SCROLL_DRY="$TMP_DIR/do-ref-scroll-dry.json"
./aos do scroll "ref:snap1:$REF" 0,-200 --workspace ws-browser --dry-run >"$SCROLL_DRY"
jq -e '
  .status == "dry_run"
  and .action == "scroll"
  and .resolved_action.resolution_status == "validation_required"
  and .current_validation.current_target.ref == "e2"
  and (.resolved_action.command | index("browser:todo/e2") != null)
  and (.resolved_action.command | index("0,-200") != null)
' "$SCROLL_DRY" >/dev/null || fail "browser scroll saved-ref dry-run drifted: $(cat "$SCROLL_DRY")"

DRAG_DRY="$TMP_DIR/do-ref-drag-dry.json"
./aos do drag "ref:snap1:$REF" ref:snap1:r3 --workspace ws-browser --dry-run >"$DRAG_DRY"
jq -e '
  .status == "dry_run"
  and .action == "drag"
  and .resolved_action.resolution_status == "validation_required"
  and .current_validation.current_target.ref == "e2"
  and .secondary_ref.ref == "r3"
  and .secondary_current_validation.current_target.ref == "e3"
  and (.resolved_action.command | index("browser:todo/e2") != null)
  and (.resolved_action.command | index("browser:todo/e3") != null)
' "$DRAG_DRY" >/dev/null || fail "browser drag saved-ref dry-run drifted: $(cat "$DRAG_DRY")"

DRAG_REAL_ERR="$TMP_DIR/do-ref-drag-real.err"
if ./aos do drag "ref:snap1:$REF" ref:snap1:r3 --workspace ws-browser >"$TMP_DIR/do-ref-drag-real.out" 2>"$DRAG_REAL_ERR"; then
    fail "browser saved-ref drag unexpectedly executed real mutation"
fi
expect_error_code "REF_REVALIDATION_REQUIRED" "$DRAG_REAL_ERR"

DRAG_MISSING_ERR="$TMP_DIR/do-ref-drag-missing.err"
if ./aos do drag "ref:snap1:$REF" --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-drag-missing.out" 2>"$DRAG_MISSING_ERR"; then
    fail "browser saved-ref drag without destination unexpectedly succeeded"
fi
expect_error_code "MISSING_ARG" "$DRAG_MISSING_ERR"

DRAG_INVALID_ERR="$TMP_DIR/do-ref-drag-invalid.err"
if ./aos do drag "ref:snap1:$REF" browser:todo/e3 --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-drag-invalid.out" 2>"$DRAG_INVALID_ERR"; then
    fail "browser saved-ref drag with non-ref destination unexpectedly succeeded"
fi
expect_error_code "INVALID_REF_TARGET" "$DRAG_INVALID_ERR"

SCROLL_MISSING_ERR="$TMP_DIR/do-ref-scroll-missing.err"
if ./aos do scroll "ref:snap1:$REF" --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-scroll-missing.out" 2>"$SCROLL_MISSING_ERR"; then
    fail "browser saved-ref scroll without delta unexpectedly succeeded"
fi
expect_error_code "MISSING_ARG" "$SCROLL_MISSING_ERR"

SCROLL_INVALID_ERR="$TMP_DIR/do-ref-scroll-invalid.err"
if ./aos do scroll "ref:snap1:$REF" nope --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-scroll-invalid.out" 2>"$SCROLL_INVALID_ERR"; then
    fail "browser saved-ref scroll with invalid delta unexpectedly succeeded"
fi
expect_error_code "INVALID_ARG" "$SCROLL_INVALID_ERR"

CAP2="$TMP_DIR/capture-snap2.json"
./aos see capture browser:todo --save --mode ax --workspace ws-browser --name snap2 >"$CAP2"
jq -e '.status == "success" and .snapshot_id == "snap2" and .capture_mode == "ax"' "$CAP2" >/dev/null \
    || fail "second browser capture failed: $(cat "$CAP2")"
jq -e '([.snapshots[].snapshot_id] | index("snap1") != null and index("snap2") != null)' "$WORKSPACE_PATH/index.json" >/dev/null \
    || fail "sequential browser saves did not preserve both committed snapshot index entries: $(cat "$WORKSPACE_PATH/index.json")"

AMBIG_ERR="$TMP_DIR/do-ref-ambiguous.err"
if ./aos do click "ref:$REF" --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-ambiguous.out" 2>"$AMBIG_ERR"; then
    fail "bare ref unexpectedly resolved across multiple snapshots"
fi
expect_error_code "REF_AMBIGUOUS" "$AMBIG_ERR"
jq -e '.status == "ambiguous" and (.candidates | length) >= 2' "$AMBIG_ERR" >/dev/null \
    || fail "bare-ref ambiguity payload drifted: $(cat "$AMBIG_ERR")"

FAKE_FORM_AOS="$TMP_DIR/fake-form-aos"
write_fake_form_aos "$FAKE_FORM_AOS"

FORM="$TMP_DIR/capture-form.json"
AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-see-native.mjs capture browser:form --save --mode ax --workspace ws-form --name snapform >"$FORM"
jq -e '
  .status == "success"
  and .refs[0].backend == "browser"
  and .refs[0].resolution_class == "snapshot_scoped"
  and (.refs[0].supported_actions == ["click", "fill", "hover", "scroll", "drag"])
  and (.refs[0].supported_actions | index("type") | not)
  and (.refs[0].supported_actions | index("key") | not)
  and .refs[0].action_target == "browser:form/e42"
' "$FORM" >/dev/null || fail "browser form saved-ref reporting drifted: $(cat "$FORM")"

FORM_FILL_DRY="$TMP_DIR/do-form-fill-dry.json"
AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-browser.mjs fill ref:snapform:r1 "hello" --workspace ws-form --dry-run >"$FORM_FILL_DRY"
jq -e '
  .status == "dry_run"
  and .action == "fill"
  and .ref.backend == "browser"
  and .resolved_action.resolution_status == "validation_required"
  and .current_validation.current_target.ref == "e42"
  and (.resolved_action.command | index("browser:form/e42") != null)
  and (.resolved_action.command | index("hello") != null)
' "$FORM_FILL_DRY" >/dev/null || fail "browser fill saved ref dry-run drifted: $(cat "$FORM_FILL_DRY")"

FORM_FILL_ACTION_ERR="$TMP_DIR/do-form-fill-action.err"
if AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-browser.mjs fill ref:snapform:r1 "hello" --workspace ws-form >"$TMP_DIR/do-form-fill-action.out" 2>"$FORM_FILL_ACTION_ERR"; then
    fail "browser fill saved ref unexpectedly executed real mutation"
fi
expect_error_code "REF_REVALIDATION_REQUIRED" "$FORM_FILL_ACTION_ERR"

FORM_FILL_STALE_REAL_ERR="$TMP_DIR/do-form-fill-stale-real.err"
if FORM_STALE=1 AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-browser.mjs fill ref:snapform:r1 "hello" --workspace ws-form >"$TMP_DIR/do-form-fill-stale-real.out" 2>"$FORM_FILL_STALE_REAL_ERR"; then
    fail "stale browser fill real saved ref unexpectedly executed mutation"
fi
expect_error_code "REF_REVALIDATION_REQUIRED" "$FORM_FILL_STALE_REAL_ERR"

FORM_STALE_ERR="$TMP_DIR/do-form-fill-stale.err"
if FORM_STALE=1 AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-browser.mjs fill ref:snapform:r1 "hello" --workspace ws-form --dry-run >"$TMP_DIR/do-form-fill-stale.out" 2>"$FORM_STALE_ERR"; then
    fail "stale browser fill saved ref unexpectedly succeeded"
fi
expect_error_code "REF_STALE" "$FORM_STALE_ERR"
jq -e '.status == "stale_ref" and .backend == "browser" and .ref.ref == "r1"' "$FORM_STALE_ERR" >/dev/null \
    || fail "stale browser fill did not fail closed through current validation: $(cat "$FORM_STALE_ERR")"

NON_CLICK_AOS="$TMP_DIR/non-click-aos"
write_non_click_ref_literal_aos "$NON_CLICK_AOS"

NON_CLICK_LITERAL="$TMP_DIR/non-click-ref-literal.json"
AOS_AGENT_WORKSPACE=bad/id AOS_PATH="$NON_CLICK_AOS" node scripts/aos-do-native.mjs type 'ref:literal' --dry-run >"$NON_CLICK_LITERAL"
jq -e '
  .status == "success"
  and (.received | index("__do") != null)
  and (.received | index("type") != null)
  and (.received | index("ref:literal") != null)
' "$NON_CLICK_LITERAL" >/dev/null || fail "non-click ref literal was not passed through without workspace resolution: $(cat "$NON_CLICK_LITERAL")"

echo "PASS browser refs"
