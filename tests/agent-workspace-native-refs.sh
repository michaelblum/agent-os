#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/agent-workspace-fixtures.sh"
agent_workspace_test_setup

FAKE_AOS="$TMP_DIR/fake-aos"
write_fake_native_aos "$FAKE_AOS"

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
  and any(.refs[0].known_limits[]; contains("no-foreground"))
  and any(.known_limits[]; contains("non-browser ax mode"))
  and any(.known_limits[]; contains("no saved-action no-foreground guarantee"))
' "$NATIVE" >/dev/null || fail "native AX saved-ref reporting drifted: $(cat "$NATIVE")"

NATIVE_ERR="$TMP_DIR/do-native-ref.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs click ref:snapnative:r1 --workspace ws-native --dry-run >"$TMP_DIR/do-native-ref.out" 2>"$NATIVE_ERR"; then
    fail "native volatile inspection ref unexpectedly became actionable"
fi
expect_error_code "REF_UNSUPPORTED" "$NATIVE_ERR"
jq -e '.status == "unsupported" and .ref.backend == "native_ax" and .ref.resolution_class == "volatile" and any(.ref.known_limits[]; contains("no-foreground"))' "$NATIVE_ERR" >/dev/null \
    || fail "native unsupported ref payload drifted: $(cat "$NATIVE_ERR")"

NATIVE_FOCUS_ERR="$TMP_DIR/do-native-focus-ref.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs focus ref:snapnative:r1 --workspace ws-native >"$TMP_DIR/do-native-focus-ref.out" 2>"$NATIVE_FOCUS_ERR"; then
    fail "native focus volatile inspection ref unexpectedly became actionable"
fi
expect_error_code "REF_UNSUPPORTED" "$NATIVE_FOCUS_ERR"
jq -e '.status == "unsupported" and .ref.backend == "native_ax" and (.safe_next_action | contains("aos see capture --save"))' "$NATIVE_FOCUS_ERR" >/dev/null \
    || fail "native focus unsupported ref payload drifted: $(cat "$NATIVE_FOCUS_ERR")"

NATIVE_PRESS_ERR="$TMP_DIR/do-native-press-ref.err"
if AOS_PATH="$FAKE_AOS" node scripts/aos-do-native.mjs press ref:snapnative:r1 --workspace ws-native >"$TMP_DIR/do-native-press-ref.out" 2>"$NATIVE_PRESS_ERR"; then
    fail "native press volatile inspection ref unexpectedly became actionable"
fi
expect_error_code "REF_UNSUPPORTED" "$NATIVE_PRESS_ERR"
jq -e '.status == "unsupported" and .ref.backend == "native_ax" and (.recommended_next_command | contains("aos see capture --save"))' "$NATIVE_PRESS_ERR" >/dev/null \
    || fail "native press unsupported ref payload drifted: $(cat "$NATIVE_PRESS_ERR")"

HIGHLIGHT_MAIN="$TMP_DIR/capture-highlight-main.json"
AOS_PATH="$FAKE_AOS" node scripts/aos-see-native.mjs capture --save --mode ax --workspace ws-highlight --name snaphighlight --highlight-cursor '#ff00aa' >"$HIGHLIGHT_MAIN"
jq -e '.status == "success" and .target == "main" and .snapshot_id == "snaphighlight"' "$HIGHLIGHT_MAIN" >/dev/null \
    || fail "no-target highlight saved capture did not persist main target: $(cat "$HIGHLIGHT_MAIN")"

echo "PASS native refs"
