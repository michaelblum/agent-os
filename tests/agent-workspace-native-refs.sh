#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/agent-workspace-fixtures.sh"
agent_workspace_test_setup

FAKE_AOS="$TMP_DIR/fake-aos"
write_fake_native_aos "$FAKE_AOS"

grep -q 'struct NativeFocusCursorSpaceBaselineJSON' "$ROOT/src/perceive/models.swift" \
    || fail "native AX baseline must encode captured as a boolean producer fact"
grep -q 'struct NativeSavedRefEvidenceJSON' "$ROOT/src/perceive/models.swift" \
    || fail "native AX saved-ref evidence must be a typed producer verdict"
grep -q 'let focusCursorSpaceBaseline = nativeAXFocusCursorSpaceBaseline()' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX traversal must emit a captured focus/cursor/Space baseline"
grep -q 'focus_cursor_space_baseline: focusCursorSpaceBaseline' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX traversal must include the captured focus/cursor/Space baseline"
grep -q 'native_saved_ref_evidence: nativeAXSavedRefEvidence(' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX traversal must emit a producer saved-ref evidence verdict"
grep -q 'permissionState: permissionState' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX saved-ref evidence must be derived from captured permission state"
grep -q 'enabled: enabled' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX saved-ref evidence must be derived from captured enabled state"
grep -q 'actionNames: actionNames' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX saved-ref evidence must be derived from captured action names"
grep -q 'baseline: focusCursorSpaceBaseline' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX saved-ref evidence must be derived from captured focus/cursor/Space baseline"
grep -q 'knownLimitFactsComplete: Bool = false' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX saved-ref evidence must default to incomplete known-limit facts"
grep -q 'if knownLimitFactsComplete && reasons.isEmpty' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX saved-ref evidence must not become actionable without complete known-limit facts"
grep -q 'struct NativeAXKnownLimitFacts' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX traversal must model known-limit facts before marking saved refs actionable"
grep -q 'knownLimitFactsComplete: knownLimitFacts.complete' "$ROOT/src/perceive/ax.swift" \
    || fail "live Swift native AX traversal must derive known-limit completeness from concrete facts"
grep -q 'knownLimitBlockers: knownLimitFacts.blockers' "$ROOT/src/perceive/ax.swift" \
    || fail "live Swift native AX traversal must feed concrete known-limit blockers into the producer verdict"
for fact in window_state space_state control_kind surface_kind focus_state minimized off_space custom_control canvas_surface; do
    grep -q "$fact: knownLimitFacts" "$ROOT/src/perceive/ax.swift" \
        || fail "native AX traversal must emit $fact from concrete known-limit facts"
done
grep -q 'actionability: "direct_ax_saved_ref_mutation"' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX producer must emit actionable saved-ref evidence for durable safe captures"
grep -q 'actionability: "inspection_only"' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX producer must keep missing or unsafe captures inspection-only"
if grep -q 'errorResponse("set_value"\|okResponse("set_value"' "$ROOT/src/act/actions.swift"; then
    fail "native AX set-value handler must report the public set-value action name"
fi
grep -q 'resp.execution?.ax_focused_after = focusedAfter' "$ROOT/src/act/actions.swift" \
    || fail "native AX focus dispatch must report post-action focused state"
grep -q 'resp.execution?.ax_value_matches_request = valueAfter == newValue' "$ROOT/src/act/actions.swift" \
    || fail "native AX set-value dispatch must report post-action value verification"
grep -q 'let focused = axBool(element, kAXFocusedAttribute as String)' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX traversal must emit actual focused state"
grep -q 'focused: focused' "$ROOT/src/perceive/ax.swift" \
    || fail "native AX traversal must include focused state in captured elements"
grep -q 'func xrayAppsIntersectingCapture' "$ROOT/src/perceive/capture-pipeline.swift" \
    || fail "display native AX capture must discover apps from the captured region, not only the frontmost app"
grep -q 'window.frame.intersects(captureRect)' "$ROOT/src/perceive/capture-pipeline.swift" \
    || fail "display native AX capture must filter AX traversal by captured-region windows"
grep -q 'captureRect: surface.globalBounds' "$ROOT/src/perceive/capture-pipeline.swift" \
    || fail "explicit-surface native AX capture must traverse apps intersecting the surface bounds"
grep -q 'let captureRect = globalCaptureRect(display: entry, windowFrame: windowFrame, cropRect: cropRect)' "$ROOT/src/perceive/capture-pipeline.swift" \
    || fail "display native AX capture must compute the actual capture rect before xray traversal"
if grep -q 'xrayFrontmostApp' "$ROOT/src/perceive/capture-pipeline.swift"; then
    fail "display native AX capture regressed to frontmost-only traversal"
fi

NATIVE="$TMP_DIR/capture-native.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace ws-native --name snapnative >"$NATIVE"
jq -e '
  .status == "success"
  and .capture_mode == "ax"
  and .capture_target == "main"
  and .workspace_id == "ws-native"
  and .snapshot_id == "snapnative"
  and .refs[0].backend == "native_ax"
  and .refs[0].capture_target == "main"
  and .refs[0].capture_mode == "ax"
  and .refs[0].resolution_class == "volatile"
  and .refs[0].confidence == "low"
  and .refs[0].identity_facts.app_pid == 4242
  and .refs[0].identity_facts.app_name == "Fixture"
  and .refs[0].identity_facts.window_id == 5150
  and .refs[0].identity_facts.app_hint == "Fixture"
  and .refs[0].identity_facts.window_hint == "Main"
  and .refs[0].identity_facts.label == "Install fixture"
  and .refs[0].identity_facts.ax_identifier == "install-button"
  and .refs[0].identity_facts.ax_identifier_or_stable_path == "install-button"
  and (.refs[0].identity_facts.action_names | index("AXPress") != null)
  and .refs[0].identity_facts.permission_state == "granted"
  and .refs[0].identity_facts.value == "ready"
  and .refs[0].identity_facts.enabled == true
  and .refs[0].identity_facts.focused == false
  and .refs[0].hint_facts.enabled == true
  and (.refs[0].supported_actions | length) == 0
  and .refs[0].conformance.actionability == "inspection_only"
  and .refs[0].conformance.mutation == "unsupported"
  and .refs[0].conformance.validation == "native_durable_identity_facts_missing"
  and .refs[0].conformance.proof.level == "known_limit_contract"
  and .refs[0].conformance.proof.status == "approval_gated_live_proof_not_run"
  and (.refs[0].conformance.proof.evidence | index("tests/agent-workspace-native-refs.sh") != null)
  and (.refs[0].conformance.proof.approval_gates | index("HITL live smoke") != null)
  and (.refs[0].conformance.proof.approval_gates | index("TCC/manual runtime flow") != null)
  and (.refs[0].conformance.proof.approval_gates | index("native repo-mode artifact rebuild") != null)
  and .refs[0].conformance.no_foreground.claim == "not_claimed"
  and .refs[0].conformance.no_foreground.focus_preservation == "unverified"
  and .refs[0].conformance.no_foreground.cursor_preservation == "unverified"
  and .refs[0].conformance.no_foreground.space_preservation == "unverified"
  and .refs[0].conformance.no_foreground.permission_state == "granted"
  and .refs[0].conformance.target_uncertainty.status == "blocked_missing_native_identity"
  and .refs[0].conformance.target_uncertainty.missing_identity_facts == ["focus_cursor_space_baseline", "native_saved_ref_evidence"]
  and any(.refs[0].conformance.target_uncertainty.reasons[]; contains("producer did not emit an actionable saved-ref evidence verdict"))
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "app_pid")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "app_name")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "window_id")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "ax_identifier")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "ax_identifier_or_stable_path")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "action_names")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "permission_state")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "role")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "label")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "value")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "enabled")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "app_hint")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "window_hint")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "bounds")
  and (.refs[0].warnings[0] | contains("native AX"))
  and (.refs[0].known_limits[0] | contains("hints"))
  and any(.refs[0].known_limits[]; contains("required durable AX identity facts or the actionable native producer verdict are missing"))
  and all(.refs[0].known_limits[]; contains("mutation is disabled until durable AX identity") | not)
  and any(.refs[0].known_limits[]; contains("no-foreground"))
  and any(.known_limits[]; contains("non-browser ax mode"))
  and any(.known_limits[]; contains("no saved-action no-foreground guarantee"))
  and (.recommended_next_commands | length) == 1
  and .recommended_next_commands[0] == "aos see refs --workspace ws-native --snapshot snapnative --json"
' "$NATIVE" >/dev/null || fail "native AX saved-ref reporting drifted: $(cat "$NATIVE")"
jq -e '
  any(.known_limits[]; contains("stable saved-ref actions require durable native identity facts"))
  and any(.known_limits[]; contains("no saved-action no-foreground guarantee"))
' "$NATIVE" >/dev/null || fail "native AX snapshot known-limit wording drifted: $(cat "$NATIVE")"

NATIVE_REFS_PATH="$(jq -r '.paths.refs' "$NATIVE")"

NATIVE_ERR="$TMP_DIR/do-native-ref.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs click ref:snapnative:r1 --workspace ws-native --dry-run >"$TMP_DIR/do-native-ref.out" 2>"$NATIVE_ERR"; then
    fail "native volatile inspection ref unexpectedly became actionable"
fi
expect_error_code "REF_UNSUPPORTED" "$NATIVE_ERR"
jq -e '.status == "unsupported" and .ref.backend == "native_ax" and .ref.resolution_class == "volatile" and any(.ref.known_limits[]; contains("no-foreground"))' "$NATIVE_ERR" >/dev/null \
    || fail "native unsupported ref payload drifted: $(cat "$NATIVE_ERR")"

WEAK_NATIVE="$TMP_DIR/capture-native-weak-baseline.json"
NATIVE_WEAK_BASELINE_CAPTURE=1 AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace ws-native --name snapweak >"$WEAK_NATIVE"
jq -e '
  .status == "success"
  and .snapshot_id == "snapweak"
  and .refs[0].backend == "native_ax"
  and .refs[0].resolution_class == "volatile"
  and .refs[0].confidence == "low"
  and (.refs[0].supported_actions | length) == 0
  and .refs[0].identity_facts.app_pid == 4242
  and .refs[0].identity_facts.window_id == 5150
  and .refs[0].identity_facts.ax_identifier == "install-button"
  and (.refs[0].identity_facts.action_names | index("AXPress") != null)
  and .refs[0].identity_facts.permission_state == "granted"
  and .refs[0].identity_facts.focus_cursor_space_baseline.focus == "not_changed"
  and (.refs[0].identity_facts.focus_cursor_space_baseline.captured == null)
  and .refs[0].conformance.actionability == "inspection_only"
  and .refs[0].conformance.target_uncertainty.status == "blocked_missing_native_identity"
  and .refs[0].conformance.target_uncertainty.missing_identity_facts == ["focus_cursor_space_baseline", "native_saved_ref_evidence"]
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "focus_cursor_space_baseline")
' "$WEAK_NATIVE" >/dev/null || fail "weak native AX baseline became durable: $(cat "$WEAK_NATIVE")"

SYNTHETIC_BASELINE_NATIVE="$TMP_DIR/capture-native-synthetic-baseline-only.json"
NATIVE_SYNTHETIC_BASELINE_ONLY_CAPTURE=1 AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace ws-native --name snapsyntheticbaseline >"$SYNTHETIC_BASELINE_NATIVE"
jq -e '
  .status == "success"
  and .snapshot_id == "snapsyntheticbaseline"
  and .refs[0].backend == "native_ax"
  and .refs[0].resolution_class == "volatile"
  and .refs[0].confidence == "low"
  and (.refs[0].supported_actions | length) == 0
  and .refs[0].action_target == null
  and .refs[0].identity_facts.app_pid == 4242
  and .refs[0].identity_facts.window_id == 5150
  and .refs[0].identity_facts.ax_identifier == "install-button"
  and (.refs[0].identity_facts.action_names | index("AXPress") != null)
  and .refs[0].identity_facts.permission_state == "granted"
  and .refs[0].identity_facts.enabled == true
  and .refs[0].identity_facts.focus_cursor_space_baseline.captured == true
  and .refs[0].identity_facts.native_saved_ref_evidence == null
  and .refs[0].conformance.actionability == "inspection_only"
  and .refs[0].conformance.mutation == "unsupported"
  and .refs[0].conformance.validation == "native_durable_identity_facts_missing"
  and .refs[0].conformance.target_uncertainty.status == "blocked_missing_native_identity"
  and .refs[0].conformance.target_uncertainty.missing_identity_facts == ["native_saved_ref_evidence"]
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "focus_cursor_space_baseline")
  and any(.refs[0].conformance.target_uncertainty.reasons[]; contains("producer did not emit an actionable saved-ref evidence verdict"))
' "$SYNTHETIC_BASELINE_NATIVE" >/dev/null || fail "synthetic native AX baseline-only facts became durable: $(cat "$SYNTHETIC_BASELINE_NATIVE")"

DENIED_NATIVE="$TMP_DIR/capture-native-denied-permission.json"
NATIVE_DENIED_PERMISSION_CAPTURE=1 AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace ws-native --name snapdenied >"$DENIED_NATIVE"
jq -e '
  .status == "success"
  and .snapshot_id == "snapdenied"
  and .refs[0].backend == "native_ax"
  and .refs[0].resolution_class == "volatile"
  and .refs[0].confidence == "low"
  and (.refs[0].supported_actions | length) == 0
  and .refs[0].identity_facts.app_pid == 4242
  and .refs[0].identity_facts.window_id == 5150
  and .refs[0].identity_facts.ax_identifier == "install-button"
  and (.refs[0].identity_facts.action_names | index("AXPress") != null)
  and .refs[0].identity_facts.permission_state == "denied"
  and .refs[0].identity_facts.focus_cursor_space_baseline.captured == true
  and .refs[0].conformance.actionability == "inspection_only"
  and .refs[0].conformance.no_foreground.permission_state == "denied"
  and .refs[0].conformance.target_uncertainty.status == "blocked_missing_native_identity"
  and .refs[0].conformance.target_uncertainty.missing_identity_facts == ["permission_state", "native_saved_ref_evidence"]
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "permission_state")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "focus_cursor_space_baseline")
' "$DENIED_NATIVE" >/dev/null || fail "denied native AX permission became durable: $(cat "$DENIED_NATIVE")"

DISABLED_NATIVE="$TMP_DIR/capture-native-disabled.json"
NATIVE_DISABLED_CAPTURE=1 AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace ws-native --name snapdisabled >"$DISABLED_NATIVE"
jq -e '
  .status == "success"
  and .snapshot_id == "snapdisabled"
  and .refs[0].backend == "native_ax"
  and .refs[0].resolution_class == "volatile"
  and .refs[0].confidence == "low"
  and (.refs[0].supported_actions | length) == 0
  and .refs[0].identity_facts.app_pid == 4242
  and .refs[0].identity_facts.window_id == 5150
  and .refs[0].identity_facts.ax_identifier == "install-button"
  and (.refs[0].identity_facts.action_names | index("AXPress") != null)
  and .refs[0].identity_facts.enabled == false
  and .refs[0].hint_facts.enabled == false
  and .refs[0].identity_facts.permission_state == "granted"
  and .refs[0].identity_facts.focus_cursor_space_baseline.captured == true
  and .refs[0].conformance.actionability == "inspection_only"
  and .refs[0].conformance.no_foreground.permission_state == "granted"
  and .refs[0].conformance.target_uncertainty.status == "blocked_missing_native_identity"
  and .refs[0].conformance.target_uncertainty.missing_identity_facts == ["enabled", "native_saved_ref_evidence"]
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "enabled")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "permission_state")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "focus_cursor_space_baseline")
' "$DISABLED_NATIVE" >/dev/null || fail "disabled native AX element became durable: $(cat "$DISABLED_NATIVE")"

KNOWN_LIMIT_NATIVE="$TMP_DIR/capture-native-known-limit.json"
NATIVE_KNOWN_LIMIT_CAPTURE=1 AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace ws-native --name snapknown >"$KNOWN_LIMIT_NATIVE"
jq -e '
  .status == "success"
  and .snapshot_id == "snapknown"
  and (.refs | length) == 5
  and all(.refs[];
    .backend == "native_ax"
    and .resolution_class == "volatile"
    and .confidence == "low"
    and (.supported_actions | length) == 0
    and .conformance.actionability == "inspection_only"
    and .conformance.mutation == "unsupported"
    and .conformance.validation == "native_known_limit_blocked"
    and .conformance.target_uncertainty.status == "blocked_native_known_limit"
    and (.conformance.target_uncertainty.missing_identity_facts | length) == 0
    and any(.warnings[]; contains("known-limit"))
    and any(.known_limits[]; contains("saved refs fail closed"))
  )
  and ((.refs[] | select(.identity_facts.source_ref == "native-off-space") | .identity_facts.space_state) == "off_space")
  and ((.refs[] | select(.identity_facts.source_ref == "native-off-space") | .identity_facts.off_space) == true)
  and any((.refs[] | select(.identity_facts.source_ref == "native-off-space") | .conformance.target_uncertainty.reasons[]); contains("off-Space"))
  and ((.refs[] | select(.identity_facts.source_ref == "native-minimized") | .identity_facts.window_state) == "minimized")
  and ((.refs[] | select(.identity_facts.source_ref == "native-minimized") | .identity_facts.minimized) == true)
  and any((.refs[] | select(.identity_facts.source_ref == "native-minimized") | .conformance.target_uncertainty.reasons[]); contains("minimized"))
  and ((.refs[] | select(.identity_facts.source_ref == "native-custom-control") | .identity_facts.control_kind) == "custom_control")
  and ((.refs[] | select(.identity_facts.source_ref == "native-custom-control") | .identity_facts.custom_control) == true)
  and any((.refs[] | select(.identity_facts.source_ref == "native-custom-control") | .conformance.target_uncertainty.reasons[]); contains("custom control"))
  and ((.refs[] | select(.identity_facts.source_ref == "native-game-canvas") | .identity_facts.surface_kind) == "game_canvas")
  and ((.refs[] | select(.identity_facts.source_ref == "native-game-canvas") | .identity_facts.canvas_surface) == true)
  and any((.refs[] | select(.identity_facts.source_ref == "native-game-canvas") | .conformance.target_uncertainty.reasons[]); contains("canvas/game"))
  and ((.refs[] | select(.identity_facts.source_ref == "native-focus-mismatch") | .identity_facts.focus_state) == "mismatch")
  and ((.refs[] | select(.identity_facts.source_ref == "native-focus-mismatch") | .identity_facts.focus_cursor_space_baseline.focus) == "changed")
  and any((.refs[] | select(.identity_facts.source_ref == "native-focus-mismatch") | .conformance.target_uncertainty.reasons[]); contains("focus baseline"))
' "$KNOWN_LIMIT_NATIVE" >/dev/null || fail "native known-limit refs did not stay blocked: $(cat "$KNOWN_LIMIT_NATIVE")"

KNOWN_LIMIT_ERR="$TMP_DIR/do-native-known-limit.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs press ref:snapknown:r1 --workspace ws-native --dry-run >"$TMP_DIR/do-native-known-limit.out" 2>"$KNOWN_LIMIT_ERR"; then
    fail "native known-limit ref unexpectedly became actionable"
fi
expect_error_code "REF_UNSUPPORTED" "$KNOWN_LIMIT_ERR"
jq -e '
  .status == "unsupported"
  and .ref.backend == "native_ax"
  and .ref.conformance.validation == "native_known_limit_blocked"
  and .ref.conformance.target_uncertainty.status == "blocked_native_known_limit"
  and any(.ref.conformance.target_uncertainty.reasons[]; contains("off-Space"))
  and .recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
' "$KNOWN_LIMIT_ERR" >/dev/null || fail "native known-limit ref did not fail closed: $(cat "$KNOWN_LIMIT_ERR")"

cp "$NATIVE_REFS_PATH" "$NATIVE_REFS_PATH.coordinate-backup"
jq '(.refs[0].resolution_class = "coordinate_fallback")
  | (.refs[0].action_target = "10,20")
  | (.refs[0].current_address.action_target = "10,20")
  | (.refs[0].supported_actions = ["click"])
  | (.refs[0].conformance.actionability = "diagnostic_fallback_refused")
  | (.refs[0].conformance.mutation = "refused")
  | (.refs[0].conformance.validation = "coordinate_fallback_refused_before_dispatch")
  | (.refs[0].conformance.proof.level = "known_limit_contract")
  | (.refs[0].conformance.proof.status = "known_limit_refusal_tested")
  | (.refs[0].conformance.proof.evidence = ["tests/agent-workspace-native-refs.sh"])
  | (.refs[0].conformance.proof.approval_gates = [])
  | (.refs[0].conformance.target_uncertainty.status = "blocked_coordinate_fallback")
  | (.refs[0].conformance.target_uncertainty.reasons = ["coordinate fallback refs are diagnostic-only and refused before dispatch"])
  | (.refs[0].warnings += ["coordinate fallback is diagnostic-only"])
  | (.refs[0].known_limits += ["coordinate-backed saved-ref mutation is refused in v0"])' "$NATIVE_REFS_PATH.coordinate-backup" >"$NATIVE_REFS_PATH"
COORDINATE_FALLBACK_ERR="$TMP_DIR/do-native-coordinate-fallback.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs click ref:snapnative:r1 --workspace ws-native --dry-run >"$TMP_DIR/do-native-coordinate-fallback.out" 2>"$COORDINATE_FALLBACK_ERR"; then
    mv "$NATIVE_REFS_PATH.coordinate-backup" "$NATIVE_REFS_PATH"
    fail "coordinate fallback diagnostic ref unexpectedly became actionable"
fi
mv "$NATIVE_REFS_PATH.coordinate-backup" "$NATIVE_REFS_PATH"
expect_error_code "REF_UNSUPPORTED" "$COORDINATE_FALLBACK_ERR"
jq -e '
  .status == "unsupported"
  and .ref.resolution_class == "coordinate_fallback"
  and .ref.conformance.actionability == "diagnostic_fallback_refused"
  and .ref.conformance.proof.status == "known_limit_refusal_tested"
  and .ref.conformance.target_uncertainty.status == "blocked_coordinate_fallback"
  and any(.ref.warnings[]; contains("diagnostic-only"))
  and .recommended_next.kind == "fresh_saved_capture"
  and .recommended_next.argv == ["aos","see","capture","main","--save","--workspace","ws-native","--mode","ax"]
  and .recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
' "$COORDINATE_FALLBACK_ERR" >/dev/null \
    || fail "coordinate fallback diagnostic ref did not refuse with warning context: $(cat "$COORDINATE_FALLBACK_ERR")"

NATIVE_FOCUS_ERR="$TMP_DIR/do-native-focus-ref.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs focus ref:snapnative:r1 --workspace ws-native >"$TMP_DIR/do-native-focus-ref.out" 2>"$NATIVE_FOCUS_ERR"; then
    fail "native focus volatile inspection ref unexpectedly became actionable"
fi
expect_error_code "REF_UNSUPPORTED" "$NATIVE_FOCUS_ERR"
jq -e '
  .status == "unsupported"
  and .ref.backend == "native_ax"
  and .safe_next_action == "aos see capture main --save --workspace ws-native --mode ax"
  and .recommended_next.kind == "fresh_saved_capture"
  and .recommended_next.argv == ["aos","see","capture","main","--save","--workspace","ws-native","--mode","ax"]
' "$NATIVE_FOCUS_ERR" >/dev/null \
    || fail "native focus unsupported ref payload drifted: $(cat "$NATIVE_FOCUS_ERR")"

NATIVE_PRESS_ERR="$TMP_DIR/do-native-press-ref.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs press ref:snapnative:r1 --workspace ws-native >"$TMP_DIR/do-native-press-ref.out" 2>"$NATIVE_PRESS_ERR"; then
    fail "native press volatile inspection ref unexpectedly became actionable"
fi
expect_error_code "REF_UNSUPPORTED" "$NATIVE_PRESS_ERR"
jq -e '.status == "unsupported" and .ref.backend == "native_ax" and .recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"' "$NATIVE_PRESS_ERR" >/dev/null \
    || fail "native press unsupported ref payload drifted: $(cat "$NATIVE_PRESS_ERR")"

DURABLE_NATIVE="$TMP_DIR/capture-native-durable.json"
NATIVE_DURABLE_CAPTURE=1 AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace ws-native --name snapdurable >"$DURABLE_NATIVE"
jq -e '
  .status == "success"
  and .snapshot_id == "snapdurable"
  and .refs[0].backend == "native_ax"
  and .refs[0].resolution_class == "stable"
  and .refs[0].confidence == "medium"
  and (.refs[0].supported_actions | index("press") != null)
  and (.refs[0].supported_actions | index("focus") != null)
  and .refs[0].identity_facts.app_pid == 4242
  and .refs[0].identity_facts.window_id == 5150
  and .refs[0].identity_facts.ax_identifier == "install-button"
  and .refs[0].identity_facts.ax_identifier_or_stable_path == "install-button"
  and (.refs[0].identity_facts.action_names | index("AXPress") != null)
  and .refs[0].identity_facts.enabled == true
  and .refs[0].identity_facts.permission_state == "granted"
  and .refs[0].identity_facts.focus_cursor_space_baseline.captured == true
  and .refs[0].identity_facts.native_saved_ref_evidence.status == "actionable"
  and .refs[0].identity_facts.native_saved_ref_evidence.actionability == "direct_ax_saved_ref_mutation"
  and .refs[0].identity_facts.native_saved_ref_evidence.known_limit_facts_complete == true
  and .refs[0].current_address.direct_ax_args.app_pid == 4242
  and .refs[0].current_address.direct_ax_args.window_id == 5150
  and .refs[0].conformance.actionability == "direct_ax_saved_ref_mutation"
  and .refs[0].conformance.mutation == "supported_after_direct_ax_current_matching"
  and .refs[0].conformance.validation == "durable_native_identity_facts_plus_direct_ax_current_matching_semantics"
  and .refs[0].conformance.proof.level == "native_saved_ref_contract_tests_plus_approval_gates"
  and .refs[0].conformance.proof.status == "live_dispatch_proven_no_foreground_not_claimed"
  and (.refs[0].conformance.proof.evidence | index("tests/manual/native-ax-saved-ref-live-proof.sh") != null)
  and (.refs[0].conformance.proof.approval_gates | length) == 0
  and .refs[0].conformance.no_foreground.permission_state == "granted"
  and .refs[0].conformance.no_foreground.claim == "not_claimed"
  and .refs[0].conformance.target_uncertainty.status == "requires_direct_ax_current_matching"
  and (.refs[0].conformance.target_uncertainty.missing_identity_facts | length) == 0
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "app_pid")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "window_id")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "ax_identifier_or_stable_path")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "ax_identifier")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "enabled")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "action_names")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "permission_state")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "focus_cursor_space_baseline")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "native_saved_ref_evidence")
  and any(.refs[0].warnings[]; contains("direct AX current matching"))
  and any(.refs[0].known_limits[]; contains("live native AX dispatch is proven"))
  and all(.refs[0].known_limits[]; contains("mutation is disabled") | not)
  and .refs[1].backend == "native_ax"
  and .refs[1].resolution_class == "stable"
  and (.refs[1].supported_actions | index("set-value") != null)
  and (.refs[1].supported_actions | index("focus") != null)
  and .refs[1].identity_facts.focused == false
' "$DURABLE_NATIVE" >/dev/null || fail "durable native AX saved-ref reporting drifted: $(cat "$DURABLE_NATIVE")"

PRESS_ONLY_NATIVE="$TMP_DIR/capture-native-press-only-durable.json"
NATIVE_PRESS_ONLY_DURABLE_CAPTURE=1 AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace ws-native --name snappressonly >"$PRESS_ONLY_NATIVE"
jq -e '
  .status == "success"
  and .snapshot_id == "snappressonly"
  and .refs[0].backend == "native_ax"
  and .refs[0].resolution_class == "stable"
  and (.refs[0].supported_actions | index("press") != null)
  and (.refs[0].supported_actions | index("focus") != null)
  and .recommended_next[0].kind == "inspect_saved_refs"
  and .recommended_next[0].argv == ["aos","see","refs","--workspace","ws-native","--snapshot","snappressonly","--json"]
  and .recommended_next[1].kind == "dry_run_saved_ref_action"
  and .recommended_next[1].action == "press"
  and .recommended_next[1].backend == "native_ax"
  and .recommended_next[1].argv == ["aos","do","press","ref:snappressonly:r1","--workspace","ws-native","--dry-run"]
  and (.recommended_next_commands | index("aos see refs --workspace ws-native --snapshot snappressonly --json") != null)
  and (.recommended_next_commands | index("aos do press ref:snappressonly:r1 --workspace ws-native --dry-run") != null)
' "$PRESS_ONLY_NATIVE" >/dev/null || fail "native press-only saved-ref recommendation drifted: $(cat "$PRESS_ONLY_NATIVE")"

DURABLE_PRESS_DRY="$TMP_DIR/do-native-durable-press-dry.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs press ref:snapdurable:r1 --workspace ws-native --dry-run >"$DURABLE_PRESS_DRY"
jq -e '
  .status == "dry_run"
  and .action == "press"
  and .ref.backend == "native_ax"
  and .ref.resolution_class == "stable"
  and .resolved_action.resolution_status == "direct_ax_ready"
  and (.resolved_action.command | index("--pid") != null)
  and (.resolved_action.command | index("4242") != null)
  and (.resolved_action.command | index("--window") != null)
  and (.resolved_action.command | index("5150") != null)
  and (.resolved_action.command | index("--identifier") != null)
  and (.resolved_action.command | index("install-button") != null)
  and .current_validation.status == "direct_ax_current_matching_required"
  and .current_validation.direct_target.app_pid == 4242
  and .current_validation.direct_target.window_id == 5150
  and .recommended_next_command == null
' "$DURABLE_PRESS_DRY" >/dev/null || fail "durable native AX dry-run drifted: $(cat "$DURABLE_PRESS_DRY")"

DURABLE_PRESS_UNKNOWN_FLAG_ERR="$TMP_DIR/do-native-durable-press-unknown-flag.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs press ref:snapdurable:r1 --workspace ws-native --bogus --dry-run >"$TMP_DIR/do-native-durable-press-unknown-flag.out" 2>"$DURABLE_PRESS_UNKNOWN_FLAG_ERR"; then
    fail "durable native AX press with unknown flag unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_FLAG" "$DURABLE_PRESS_UNKNOWN_FLAG_ERR"

DURABLE_PRESS_DIRECT_FILTER_ERR="$TMP_DIR/do-native-durable-press-direct-filter.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs press ref:snapdurable:r1 --workspace ws-native --role AXButton --dry-run >"$TMP_DIR/do-native-durable-press-direct-filter.out" 2>"$DURABLE_PRESS_DIRECT_FILTER_ERR"; then
    fail "durable native AX press saved ref accepted direct-only filter"
fi
expect_error_code "UNKNOWN_FLAG" "$DURABLE_PRESS_DIRECT_FILTER_ERR"
jq -e '.error | contains("Unknown saved-ref press flag: --role")' "$DURABLE_PRESS_DIRECT_FILTER_ERR" >/dev/null \
    || fail "durable native AX press direct-only filter error drifted: $(cat "$DURABLE_PRESS_DIRECT_FILTER_ERR")"

DURABLE_PRESS="$TMP_DIR/do-native-durable-press.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs press ref:snapdurable:r1 --workspace ws-native >"$DURABLE_PRESS"
jq -e '
  .status == "success"
  and .action == "press"
  and .ref.backend == "native_ax"
  and .resolved_action.resolution_status == "direct_ax_ready"
  and .underlying_result.status == "success"
  and .underlying_result.direct_target.app_pid == 4242
  and .underlying_result.direct_target.window_id == 5150
  and .underlying_result.direct_target.ax_identifier == "install-button"
  and .underlying_result.conformance.actionability == "direct_ax_action"
  and .underlying_result.conformance.target_uncertainty.status == "direct_ax_current_matching"
  and any(.underlying_result.known_limits[]; contains("HITL proof"))
  and .post_action.verification == "fresh_capture_recommended"
  and .post_action.recommended_next.kind == "fresh_saved_capture"
  and .post_action.recommended_next.argv == ["aos","see","capture","main","--save","--workspace","ws-native","--mode","ax"]
  and .post_action.recommended_next.capture_target == "main"
  and .post_action.recommended_next.query == null
  and .post_action.recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
  and .recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
' "$DURABLE_PRESS" >/dev/null || fail "durable native AX press dispatch drifted: $(cat "$DURABLE_PRESS")"

DURABLE_PRESS_FALLBACK="$TMP_DIR/do-native-durable-press-fallback.json"
NATIVE_AX_FALLBACK=1 AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs press ref:snapdurable:r1 --workspace ws-native >"$DURABLE_PRESS_FALLBACK"
jq -e '
  .status == "success"
  and .action == "press"
  and .ref.backend == "native_ax"
  and .resolved_action.resolution_status == "direct_ax_ready"
  and .underlying_result.status == "success"
  and .underlying_result.execution.fallback_used == true
  and .underlying_result.execution.foreground_fallback_required == true
  and .underlying_result.conformance.no_foreground.claim == "not_claimed"
  and .underlying_result.conformance.no_foreground.fallback_used == true
  and .underlying_result.conformance.no_foreground.foreground_fallback_required == true
  and any(.underlying_result.conformance.target_uncertainty.reasons[]; contains("fallback use"))
  and any(.underlying_result.known_limits[]; contains("foreground fallback"))
  and .post_action.verification == "fresh_capture_recommended"
  and .post_action.recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
  and .recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
' "$DURABLE_PRESS_FALLBACK" >/dev/null || fail "durable native AX saved-ref fallback conformance was hidden: $(cat "$DURABLE_PRESS_FALLBACK")"

DURABLE_PRESS_FAIL_ERR="$TMP_DIR/do-native-durable-press-fail.err"
if NATIVE_AX_FAIL=1 AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs press ref:snapdurable:r1 --workspace ws-native >"$TMP_DIR/do-native-durable-press-fail.out" 2>"$DURABLE_PRESS_FAIL_ERR"; then
    fail "durable native AX missing target unexpectedly succeeded"
fi
jq -e '
  .status == "error"
  and .action == "press"
  and .ref.backend == "native_ax"
  and .resolved_action.resolution_status == "direct_ax_ready"
  and .underlying_exit_code == 9
  and .underlying_result.code == "AX_TARGET_NOT_FOUND"
  and .underlying_result.conformance.actionability == "direct_ax_action"
  and .underlying_result.conformance.target_uncertainty.status == "direct_ax_current_matching"
  and .post_action.verification == "underlying_action_failed"
  and .post_action.recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
  and .recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
' "$DURABLE_PRESS_FAIL_ERR" >/dev/null || fail "durable native AX failure envelope drifted: $(cat "$DURABLE_PRESS_FAIL_ERR")"

DURABLE_SET_VALUE="$TMP_DIR/do-native-durable-set-value.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs set-value ref:snapdurable:r2 Ada --workspace ws-native >"$DURABLE_SET_VALUE"
jq -e '
  .status == "success"
  and .action == "set-value"
  and .ref.backend == "native_ax"
  and .ref.resolution_class == "stable"
  and (.resolved_action.command | index("--value") != null)
  and (.resolved_action.command | index("Ada") != null)
  and .underlying_result.status == "success"
  and .underlying_result.direct_target.role == "AXTextField"
  and .underlying_result.direct_target.ax_identifier == "name-field"
  and .post_action.verification == "fresh_capture_recommended"
  and .post_action.recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
  and .recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
' "$DURABLE_SET_VALUE" >/dev/null || fail "durable native AX set-value dispatch drifted: $(cat "$DURABLE_SET_VALUE")"

DURABLE_SET_VALUE_FALLBACK="$TMP_DIR/do-native-durable-set-value-fallback.json"
NATIVE_AX_FALLBACK=1 AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs set-value ref:snapdurable:r2 Ada --workspace ws-native >"$DURABLE_SET_VALUE_FALLBACK"
jq -e '
  .status == "success"
  and .action == "set-value"
  and .ref.backend == "native_ax"
  and .resolved_action.resolution_status == "direct_ax_ready"
  and .underlying_result.execution.fallback_used == true
  and .underlying_result.execution.foreground_fallback_required == true
  and .underlying_result.conformance.no_foreground.claim == "not_claimed"
  and .underlying_result.conformance.no_foreground.fallback_used == true
  and .underlying_result.conformance.no_foreground.foreground_fallback_required == true
  and any(.underlying_result.conformance.target_uncertainty.reasons[]; contains("fallback use"))
  and any(.underlying_result.known_limits[]; contains("foreground fallback"))
  and .post_action.recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
  and .recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
' "$DURABLE_SET_VALUE_FALLBACK" >/dev/null || fail "durable native AX set-value fallback conformance was hidden: $(cat "$DURABLE_SET_VALUE_FALLBACK")"

DURABLE_FOCUS_DRY="$TMP_DIR/do-native-durable-focus-dry.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs focus ref:snapdurable:r2 --workspace ws-native --dry-run >"$DURABLE_FOCUS_DRY"
jq -e '
  .status == "dry_run"
  and .action == "focus"
  and .ref.backend == "native_ax"
  and .ref.resolution_class == "stable"
  and .resolved_action.resolution_status == "direct_ax_ready"
  and (.resolved_action.command | index("--pid") != null)
  and (.resolved_action.command | index("4242") != null)
  and (.resolved_action.command | index("--role") != null)
  and (.resolved_action.command | index("AXTextField") != null)
  and (.resolved_action.command | index("--identifier") != null)
  and (.resolved_action.command | index("name-field") != null)
  and .current_validation.status == "direct_ax_current_matching_required"
  and .current_validation.direct_target.app_pid == 4242
  and .current_validation.direct_target.window_id == 5150
  and .current_validation.direct_target.ax_identifier == "name-field"
  and .recommended_next_command == null
' "$DURABLE_FOCUS_DRY" >/dev/null || fail "durable native AX focus dry-run drifted: $(cat "$DURABLE_FOCUS_DRY")"

DURABLE_FOCUS="$TMP_DIR/do-native-durable-focus.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs focus ref:snapdurable:r2 --workspace ws-native >"$DURABLE_FOCUS"
jq -e '
  .status == "success"
  and .action == "focus"
  and .ref.backend == "native_ax"
  and .ref.resolution_class == "stable"
  and .resolved_action.resolution_status == "direct_ax_ready"
  and .current_validation.status == "direct_ax_current_matching_required"
  and .current_validation.direct_target.ax_identifier == "name-field"
  and .underlying_result.status == "success"
  and .underlying_result.action == "focus"
  and .underlying_result.execution.strategy == "ax_focus"
  and (.underlying_result.received | index("--identifier") != null)
  and (.underlying_result.received | index("name-field") != null)
  and .post_action.verification == "fresh_capture_recommended"
  and .post_action.recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
  and .recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
' "$DURABLE_FOCUS" >/dev/null || fail "durable native AX focus dispatch drifted: $(cat "$DURABLE_FOCUS")"

DURABLE_FOCUS_FALLBACK="$TMP_DIR/do-native-durable-focus-fallback.json"
NATIVE_AX_FALLBACK=1 AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs focus ref:snapdurable:r2 --workspace ws-native >"$DURABLE_FOCUS_FALLBACK"
jq -e '
  .status == "success"
  and .action == "focus"
  and .ref.backend == "native_ax"
  and .resolved_action.resolution_status == "direct_ax_ready"
  and .underlying_result.execution.fallback_used == true
  and .underlying_result.execution.foreground_fallback_required == true
  and .underlying_result.conformance.no_foreground.claim == "not_claimed"
  and .underlying_result.conformance.no_foreground.fallback_used == true
  and .underlying_result.conformance.no_foreground.foreground_fallback_required == true
  and any(.underlying_result.conformance.target_uncertainty.reasons[]; contains("fallback use"))
  and any(.underlying_result.known_limits[]; contains("foreground fallback"))
  and .post_action.recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
  and .recommended_next_command == "aos see capture main --save --workspace ws-native --mode ax"
' "$DURABLE_FOCUS_FALLBACK" >/dev/null || fail "durable native AX focus fallback conformance was hidden: $(cat "$DURABLE_FOCUS_FALLBACK")"

DURABLE_FOCUS_DIRECT_FILTER_ERR="$TMP_DIR/do-native-durable-focus-direct-filter.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs focus ref:snapdurable:r2 --workspace ws-native --timeout 200 --dry-run >"$TMP_DIR/do-native-durable-focus-direct-filter.out" 2>"$DURABLE_FOCUS_DIRECT_FILTER_ERR"; then
    fail "durable native AX focus saved ref accepted direct-only filter"
fi
expect_error_code "UNKNOWN_FLAG" "$DURABLE_FOCUS_DIRECT_FILTER_ERR"
jq -e '.error | contains("Unknown saved-ref focus flag: --timeout")' "$DURABLE_FOCUS_DIRECT_FILTER_ERR" >/dev/null \
    || fail "durable native AX focus direct-only filter error drifted: $(cat "$DURABLE_FOCUS_DIRECT_FILTER_ERR")"

DURABLE_SET_VALUE_BOTH_SOURCES_ERR="$TMP_DIR/do-native-durable-set-value-both-sources.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs set-value ref:snapdurable:r2 Ada --workspace ws-native --value Grace >"$TMP_DIR/do-native-durable-set-value-both-sources.out" 2>"$DURABLE_SET_VALUE_BOTH_SOURCES_ERR"; then
    fail "durable native AX set-value with both value sources unexpectedly succeeded"
fi
expect_error_code "INVALID_ARG" "$DURABLE_SET_VALUE_BOTH_SOURCES_ERR"
jq -e '.error | contains("exactly one value source")' "$DURABLE_SET_VALUE_BOTH_SOURCES_ERR" >/dev/null \
    || fail "durable native AX set-value both-source error drifted: $(cat "$DURABLE_SET_VALUE_BOTH_SOURCES_ERR")"

DURABLE_SET_VALUE_EXTRA_POSITIONAL_ERR="$TMP_DIR/do-native-durable-set-value-extra-positional.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs set-value ref:snapdurable:r2 Ada Grace --workspace ws-native >"$TMP_DIR/do-native-durable-set-value-extra-positional.out" 2>"$DURABLE_SET_VALUE_EXTRA_POSITIONAL_ERR"; then
    fail "durable native AX set-value with extra positional value unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_ARG" "$DURABLE_SET_VALUE_EXTRA_POSITIONAL_ERR"

DURABLE_SET_VALUE_DIRECT_FILTER_ERR="$TMP_DIR/do-native-durable-set-value-direct-filter.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs set-value ref:snapdurable:r2 Ada --workspace ws-native --title Name >"$TMP_DIR/do-native-durable-set-value-direct-filter.out" 2>"$DURABLE_SET_VALUE_DIRECT_FILTER_ERR"; then
    fail "durable native AX set-value saved ref accepted direct-only filter"
fi
expect_error_code "UNKNOWN_FLAG" "$DURABLE_SET_VALUE_DIRECT_FILTER_ERR"
jq -e '.error | contains("Unknown saved-ref set-value flag: --title")' "$DURABLE_SET_VALUE_DIRECT_FILTER_ERR" >/dev/null \
    || fail "durable native AX set-value direct-only filter error drifted: $(cat "$DURABLE_SET_VALUE_DIRECT_FILTER_ERR")"

UNSUPPORTED_DURABLE_NATIVE="$TMP_DIR/capture-native-unsupported-durable-action.json"
NATIVE_UNSUPPORTED_DURABLE_ACTION_CAPTURE=1 AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace ws-native --name snapunsupportednative >"$UNSUPPORTED_DURABLE_NATIVE"
jq -e '
  .status == "success"
  and .snapshot_id == "snapunsupportednative"
  and .refs[0].backend == "native_ax"
  and .refs[0].resolution_class == "volatile"
  and .refs[0].confidence == "low"
  and .refs[0].identity_facts.app_pid == 4242
  and .refs[0].identity_facts.window_id == 5150
  and .refs[0].identity_facts.ax_identifier == "options-menu"
  and .refs[0].identity_facts.enabled == true
  and .refs[0].identity_facts.permission_state == "granted"
  and .refs[0].identity_facts.focus_cursor_space_baseline.captured == true
  and (.refs[0].identity_facts.action_names | index("AXShowMenu") != null)
  and (.refs[0].identity_facts.action_names | index("AXPress") == null)
  and (.refs[0].identity_facts.action_names | index("AXFocus") == null)
  and (.refs[0].identity_facts.action_names | index("AXSetValue") == null)
  and (.refs[0].supported_actions | length) == 0
  and .refs[0].action_target == null
  and .refs[0].current_address.direct_ax_args.ax_identifier == "options-menu"
  and .refs[0].conformance.actionability == "inspection_only"
  and .refs[0].conformance.mutation == "unsupported"
  and .refs[0].conformance.validation == "native_action_matrix_unsupported"
  and .refs[0].conformance.target_uncertainty.status == "blocked_unsupported_native_action"
  and (.refs[0].conformance.target_uncertainty.missing_identity_facts | length) == 0
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "ax_identifier")
  and any(.refs[0].warnings[]; contains("no v0 supported saved-ref action"))
  and any(.refs[0].known_limits[]; contains("action_names do not map to v0 saved-ref actions"))
' "$UNSUPPORTED_DURABLE_NATIVE" >/dev/null || fail "unsupported durable native AX action reporting drifted: $(cat "$UNSUPPORTED_DURABLE_NATIVE")"

UNSUPPORTED_DURABLE_PRESS_ERR="$TMP_DIR/do-native-unsupported-durable-press.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs press ref:snapunsupportednative:r1 --workspace ws-native >"$TMP_DIR/do-native-unsupported-durable-press.out" 2>"$UNSUPPORTED_DURABLE_PRESS_ERR"; then
    fail "unsupported durable native AX action unexpectedly became actionable"
fi
expect_error_code "REF_UNSUPPORTED" "$UNSUPPORTED_DURABLE_PRESS_ERR"
jq -e '
  .status == "unsupported"
  and .ref.backend == "native_ax"
  and .ref.resolution_class == "volatile"
  and .ref.action_target == null
  and .ref.conformance.validation == "native_action_matrix_unsupported"
  and .ref.conformance.target_uncertainty.status == "blocked_unsupported_native_action"
  and (.ref.conformance.target_uncertainty.missing_identity_facts | length) == 0
' "$UNSUPPORTED_DURABLE_PRESS_ERR" >/dev/null || fail "unsupported durable native AX refusal payload drifted: $(cat "$UNSUPPORTED_DURABLE_PRESS_ERR")"

PATH_ONLY_NATIVE="$TMP_DIR/capture-native-path-only.json"
NATIVE_STABLE_PATH_ONLY_CAPTURE=1 AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace ws-native --name snappathonly >"$PATH_ONLY_NATIVE"
jq -e '
  .status == "success"
  and .snapshot_id == "snappathonly"
  and .refs[0].backend == "native_ax"
  and .refs[0].resolution_class == "volatile"
  and .refs[0].confidence == "low"
  and .refs[0].identity_facts.ax_identifier == null
  and .refs[0].identity_facts.stable_path == "AXWindow[0]/AXButton[2]"
  and .refs[0].identity_facts.ax_identifier_or_stable_path == "AXWindow[0]/AXButton[2]"
  and (.refs[0].supported_actions | length) == 0
  and .refs[0].action_target == null
  and .refs[0].conformance.actionability == "inspection_only"
  and .refs[0].conformance.target_uncertainty.status == "blocked_missing_native_identity"
  and .refs[0].conformance.target_uncertainty.missing_identity_facts == ["ax_identifier"]
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "stable_path")
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "ax_identifier_or_stable_path")
  and any(.refs[0].known_limits[]; contains("required durable AX identity facts or the actionable native producer verdict are missing"))
' "$PATH_ONLY_NATIVE" >/dev/null || fail "path-only native AX evidence became actionable: $(cat "$PATH_ONLY_NATIVE")"

PATH_ONLY_PRESS_ERR="$TMP_DIR/do-native-path-only-press.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-ref.mjs press ref:snappathonly:r1 --workspace ws-native >"$TMP_DIR/do-native-path-only-press.out" 2>"$PATH_ONLY_PRESS_ERR"; then
    fail "path-only native AX ref unexpectedly became actionable"
fi
expect_error_code "REF_UNSUPPORTED" "$PATH_ONLY_PRESS_ERR"
jq -e '
  .status == "unsupported"
  and .ref.backend == "native_ax"
  and .ref.resolution_class == "volatile"
  and .ref.identity_facts.ax_identifier == null
  and .ref.identity_facts.stable_path == "AXWindow[0]/AXButton[2]"
  and .ref.conformance.target_uncertainty.missing_identity_facts == ["ax_identifier"]
' "$PATH_ONLY_PRESS_ERR" >/dev/null || fail "path-only native AX refusal payload drifted: $(cat "$PATH_ONLY_PRESS_ERR")"

DIRECT_PRESS="$TMP_DIR/do-native-direct-press.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs press --pid 4242 --role AXButton --title Install --identifier install-button --dry-run >"$DIRECT_PRESS"
jq -e '
  .status == "dry_run"
  and .action == "press"
  and .backend == "ax"
  and .direct_target.app_pid == 4242
  and .direct_target.role == "AXButton"
  and .direct_target.title == "Install"
  and .direct_target.ax_identifier == "install-button"
  and .conformance.actionability == "direct_ax_action"
  and .conformance.mutation == "not_attempted_dry_run"
  and .conformance.validation == "direct_ax_current_matching_semantics"
  and .conformance.proof_level == "native_primitive_response_plus_wrapper_contract"
  and .conformance.proof.level == "native_primitive_response_plus_wrapper_contract"
  and .conformance.proof.status == "live_dispatch_proven_no_foreground_not_claimed"
  and (.conformance.proof.evidence | index("tests/agent-workspace-native-refs.sh") != null)
  and (.conformance.proof.evidence | index("tests/manual/native-ax-saved-ref-live-proof.sh") != null)
  and (.conformance.proof.approval_gates | length) == 0
  and .conformance.no_foreground.claim == "not_claimed"
  and .conformance.no_foreground.focus_preservation == "unverified"
  and .conformance.no_foreground.cursor_preservation == "unverified"
  and .conformance.no_foreground.space_preservation == "unverified"
  and .conformance.no_foreground.permission_state == "unknown"
  and .conformance.target_uncertainty.status == "direct_ax_current_matching"
  and any(.conformance.target_uncertainty.available_identity_facts[]; . == "app_pid")
  and any(.conformance.target_uncertainty.available_identity_facts[]; . == "ax_identifier")
  and any(.conformance.target_uncertainty.available_identity_facts[]; . == "ax_identifier_or_stable_path")
  and all(.conformance.target_uncertainty.missing_identity_facts[]; . != "app_pid")
  and all(.conformance.target_uncertainty.missing_identity_facts[]; . != "ax_identifier")
  and any(.conformance.target_uncertainty.missing_identity_facts[]; . == "window_id")
  and any(.conformance.target_uncertainty.missing_identity_facts[]; . == "enabled")
  and any(.conformance.target_uncertainty.missing_identity_facts[]; . == "action_names")
  and any(.conformance.target_uncertainty.reasons[]; contains("enabled state"))
  and any(.known_limits[]; contains("HITL proof"))
' "$DIRECT_PRESS" >/dev/null || fail "direct native AX dry-run conformance drifted: $(cat "$DIRECT_PRESS")"

DIRECT_PRESS_FALLBACK="$TMP_DIR/do-native-direct-press-fallback.json"
NATIVE_AX_FALLBACK=1 AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs press --pid 4242 --role AXButton --title Install --identifier install-button >"$DIRECT_PRESS_FALLBACK"
jq -e '
  .status == "success"
  and .action == "press"
  and .backend == "ax"
  and .execution.fallback_used == true
  and .execution.foreground_fallback_required == true
  and .conformance.no_foreground.claim == "not_claimed"
  and .conformance.no_foreground.fallback_used == true
  and .conformance.no_foreground.foreground_fallback_required == true
  and any(.conformance.target_uncertainty.reasons[]; contains("fallback use"))
  and any(.known_limits[]; contains("foreground fallback"))
' "$DIRECT_PRESS_FALLBACK" >/dev/null || fail "direct native AX fallback conformance was hidden: $(cat "$DIRECT_PRESS_FALLBACK")"

DIRECT_FOCUS_FALLBACK="$TMP_DIR/do-native-direct-focus-fallback.json"
NATIVE_AX_FALLBACK=1 AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs focus --pid 4242 --role AXTextField --title Name --identifier name-field >"$DIRECT_FOCUS_FALLBACK"
jq -e '
  .status == "success"
  and .action == "focus"
  and .backend == "ax"
  and .execution.fallback_used == true
  and .execution.foreground_fallback_required == true
  and .direct_target.app_pid == 4242
  and .direct_target.role == "AXTextField"
  and .direct_target.ax_identifier == "name-field"
  and .conformance.no_foreground.claim == "not_claimed"
  and .conformance.no_foreground.fallback_used == true
  and .conformance.no_foreground.foreground_fallback_required == true
  and any(.conformance.target_uncertainty.reasons[]; contains("fallback use"))
  and any(.known_limits[]; contains("foreground fallback"))
' "$DIRECT_FOCUS_FALLBACK" >/dev/null || fail "direct native AX focus fallback conformance was hidden: $(cat "$DIRECT_FOCUS_FALLBACK")"

DIRECT_SET_VALUE="$TMP_DIR/do-native-direct-set-value.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs set-value --pid 4242 --role AXTextField --title Name --value Ada >"$DIRECT_SET_VALUE"
jq -e '
  .status == "success"
  and .action == "set-value"
  and .backend == "ax"
  and .conformance.actionability == "direct_ax_action"
  and .conformance.mutation == "attempted_direct_native_action"
  and .conformance.proof.status == "live_dispatch_proven_no_foreground_not_claimed"
  and .conformance.target_uncertainty.status == "direct_ax_current_matching"
  and any(.conformance.target_uncertainty.missing_identity_facts[]; . == "enabled")
  and any(.conformance.target_uncertainty.reasons[]; contains("enabled-state"))
  and .direct_target.app_pid == 4242
  and .direct_target.role == "AXTextField"
  and any(.known_limits[]; contains("current AX matching semantics"))
' "$DIRECT_SET_VALUE" >/dev/null || fail "direct native AX success conformance drifted: $(cat "$DIRECT_SET_VALUE")"

DIRECT_SET_VALUE_FALLBACK="$TMP_DIR/do-native-direct-set-value-fallback.json"
NATIVE_AX_FALLBACK=1 AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs set-value --pid 4242 --role AXTextField --title Name --value Ada >"$DIRECT_SET_VALUE_FALLBACK"
jq -e '
  .status == "success"
  and .action == "set-value"
  and .backend == "ax"
  and .execution.fallback_used == true
  and .execution.foreground_fallback_required == true
  and .direct_target.app_pid == 4242
  and .direct_target.role == "AXTextField"
  and .conformance.no_foreground.claim == "not_claimed"
  and .conformance.no_foreground.fallback_used == true
  and .conformance.no_foreground.foreground_fallback_required == true
  and any(.conformance.target_uncertainty.reasons[]; contains("fallback use"))
  and any(.known_limits[]; contains("foreground fallback"))
' "$DIRECT_SET_VALUE_FALLBACK" >/dev/null || fail "direct native AX set-value fallback conformance was hidden: $(cat "$DIRECT_SET_VALUE_FALLBACK")"

DIRECT_SET_VALUE_POSITIONAL="$TMP_DIR/do-native-direct-set-value-positional.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs set-value --pid 4242 --role AXTextField --title Name Ada >"$DIRECT_SET_VALUE_POSITIONAL"
jq -e '
  .status == "success"
  and .action == "set-value"
  and .backend == "ax"
  and .conformance.actionability == "direct_ax_action"
  and .conformance.target_uncertainty.status == "direct_ax_current_matching"
  and .direct_target.app_pid == 4242
  and .direct_target.role == "AXTextField"
  and (.received | index("--value") != null)
  and (.received | index("Ada") != null)
' "$DIRECT_SET_VALUE_POSITIONAL" >/dev/null || fail "direct native AX positional set-value conformance drifted: $(cat "$DIRECT_SET_VALUE_POSITIONAL")"

DIRECT_SET_VALUE_BOTH_SOURCES_ERR="$TMP_DIR/do-native-direct-set-value-both-sources.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs set-value --pid 4242 --role AXTextField Ada --value Grace >"$TMP_DIR/do-native-direct-set-value-both-sources.out" 2>"$DIRECT_SET_VALUE_BOTH_SOURCES_ERR"; then
    fail "direct native AX set-value with both value sources unexpectedly succeeded"
fi
expect_error_code "INVALID_ARG" "$DIRECT_SET_VALUE_BOTH_SOURCES_ERR"
jq -e '.error | contains("exactly one value source")' "$DIRECT_SET_VALUE_BOTH_SOURCES_ERR" >/dev/null \
    || fail "direct native AX set-value both-source error drifted: $(cat "$DIRECT_SET_VALUE_BOTH_SOURCES_ERR")"

DIRECT_SET_VALUE_EXTRA_POSITIONAL_ERR="$TMP_DIR/do-native-direct-set-value-extra-positional.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs set-value --pid 4242 --role AXTextField Ada Grace >"$TMP_DIR/do-native-direct-set-value-extra-positional.out" 2>"$DIRECT_SET_VALUE_EXTRA_POSITIONAL_ERR"; then
    fail "direct native AX set-value with extra positional value unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_ARG" "$DIRECT_SET_VALUE_EXTRA_POSITIONAL_ERR"

DIRECT_PRESS_FAIL_ERR="$TMP_DIR/do-native-direct-press-fail.err"
if NATIVE_AX_FAIL=1 AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs press --pid 4242 --role AXButton --title Missing >"$TMP_DIR/do-native-direct-press-fail.out" 2>"$DIRECT_PRESS_FAIL_ERR"; then
    fail "direct native AX primitive failure unexpectedly succeeded"
fi
expect_error_code "AX_TARGET_NOT_FOUND" "$DIRECT_PRESS_FAIL_ERR"
jq -e '
  .error == "no matching AX element"
  and .conformance.actionability == "direct_ax_action"
  and .conformance.mutation == "attempted_direct_native_action"
  and .conformance.proof.status == "live_dispatch_proven_no_foreground_not_claimed"
  and .conformance.no_foreground.claim == "not_claimed"
  and .conformance.target_uncertainty.status == "direct_ax_current_matching"
  and any(.known_limits[]; contains("no foreground"))
' "$DIRECT_PRESS_FAIL_ERR" >/dev/null || fail "direct native AX error conformance drifted: $(cat "$DIRECT_PRESS_FAIL_ERR")"

HIGHLIGHT_MAIN="$TMP_DIR/capture-highlight-main.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture --save --mode ax --workspace ws-highlight --name snaphighlight --highlight-cursor '#ff00aa' >"$HIGHLIGHT_MAIN"
jq -e '.status == "success" and .target == "main" and .snapshot_id == "snaphighlight"' "$HIGHLIGHT_MAIN" >/dev/null \
    || fail "no-target highlight saved capture did not persist main target: $(cat "$HIGHLIGHT_MAIN")"

echo "PASS native refs"
