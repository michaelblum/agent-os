#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ "${AOS_NATIVE_AX_LIVE_PROOF:-0}" != "1" ]]; then
  echo "Set AOS_NATIVE_AX_LIVE_PROOF=1 to run this live TCC/native AX proof." >&2
  exit 2
fi

AOS="${AOS_PATH:-./aos}"
PROOF_ID="${AOS_NATIVE_AX_PROOF_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
WORKSPACE="${AOS_NATIVE_AX_WORKSPACE:-native-ax-live-${PROOF_ID}}"
EVIDENCE_DIR="${AOS_NATIVE_AX_EVIDENCE_DIR:-/tmp/aos-native-ax-saved-ref-live-proof-${PROOF_ID}}"
APP_NAME="AOSNativeAXProof-${PROOF_ID}"
APP_TITLE="AOS Native AX Proof ${PROOF_ID}"
FIELD_IDENTIFIER="aos-native-ax-proof-field-${PROOF_ID}"
FIELD_LABEL="AOS Native AX Proof Field ${PROOF_ID}"
INITIAL_VALUE="initial-${PROOF_ID}"
SET_VALUE="set-value-${PROOF_ID}"
APP_PID=""

mkdir -p "$EVIDENCE_DIR"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

run_json() {
  local label="$1"
  shift
  "$@" >"$EVIDENCE_DIR/${label}.json" 2>"$EVIDENCE_DIR/${label}.err" || {
    cat "$EVIDENCE_DIR/${label}.err" >&2 || true
    fail "$label failed"
  }
}

cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  if [[ -n "$APP_PID" ]]; then
    if kill -0 "$APP_PID" 2>/dev/null; then
      echo '{"cleanup":"failed","proof_app_pid":'"$APP_PID"'}' >"$EVIDENCE_DIR/cleanup.json"
    else
      echo '{"cleanup":"verified","proof_app_pid":'"$APP_PID"'}' >"$EVIDENCE_DIR/cleanup.json"
    fi
  fi
}
trap cleanup EXIT

cat >"$EVIDENCE_DIR/proof-app.swift" <<'SWIFT'
import Cocoa

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let env = ProcessInfo.processInfo.environment
        let title = env["AOS_NATIVE_AX_PROOF_TITLE"] ?? "AOS Native AX Proof"
        let fieldIdentifier = env["AOS_NATIVE_AX_FIELD_IDENTIFIER"] ?? "aos-native-ax-proof-field"
        let fieldLabel = env["AOS_NATIVE_AX_FIELD_LABEL"] ?? "AOS Native AX Proof Field"
        let initialValue = env["AOS_NATIVE_AX_INITIAL_VALUE"] ?? "initial"

        NSApp.setActivationPolicy(.regular)

        let window = NSWindow(
            contentRect: NSRect(x: 220, y: 220, width: 520, height: 180),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = title

        let field = NSTextField(frame: NSRect(x: 28, y: 76, width: 464, height: 28))
        field.stringValue = initialValue
        field.placeholderString = fieldLabel
        field.setAccessibilityIdentifier(fieldIdentifier)
        field.setAccessibilityLabel(fieldLabel)

        window.contentView?.addSubview(field)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
SWIFT

swiftc "$EVIDENCE_DIR/proof-app.swift" -framework Cocoa -o "$EVIDENCE_DIR/$APP_NAME"

(
  AOS_NATIVE_AX_PROOF_TITLE="$APP_TITLE" \
  AOS_NATIVE_AX_FIELD_IDENTIFIER="$FIELD_IDENTIFIER" \
  AOS_NATIVE_AX_FIELD_LABEL="$FIELD_LABEL" \
  AOS_NATIVE_AX_INITIAL_VALUE="$INITIAL_VALUE" \
    "$EVIDENCE_DIR/$APP_NAME"
) >"$EVIDENCE_DIR/proof-app.out" 2>"$EVIDENCE_DIR/proof-app.err" &
APP_PID="$!"
echo "$APP_PID" >"$EVIDENCE_DIR/proof-app.pid"

sleep 1
kill -0 "$APP_PID" 2>/dev/null || fail "proof app did not stay running"

git status --short --branch >"$EVIDENCE_DIR/git-status-before.txt"
git rev-parse HEAD >"$EVIDENCE_DIR/git-head.txt"
run_json service-status-before "$AOS" service status --mode repo --json
run_json permissions-before "$AOS" permissions check --json
run_json cursor-before "$AOS" __see cursor

"$AOS" see capture main --save --mode ax --workspace "$WORKSPACE" --name focus-before >"$EVIDENCE_DIR/capture-focus-before.json"
FOCUS_SNAPSHOT="$(jq -r '.snapshot_id' "$EVIDENCE_DIR/capture-focus-before.json")"
"$AOS" see refs --workspace "$WORKSPACE" --snapshot "$FOCUS_SNAPSHOT" --json >"$EVIDENCE_DIR/refs-focus-before.json"

REF_ID="$(jq -r --argjson pid "$APP_PID" --arg ident "$FIELD_IDENTIFIER" '
  .refs[]
  | select(.backend == "native_ax")
  | select(.identity_facts.app_pid == $pid)
  | select(.identity_facts.ax_identifier == $ident)
  | select(.resolution_class == "stable")
  | select(.conformance.actionability == "direct_ax_saved_ref_mutation")
  | select(.conformance.target_uncertainty.status == "requires_direct_ax_current_matching")
  | select((.supported_actions | index("focus")) != null)
  | select((.supported_actions | index("set-value")) != null)
  | .ref
' "$EVIDENCE_DIR/refs-focus-before.json" | head -n 1)"

[[ -n "$REF_ID" && "$REF_ID" != "null" ]] || fail "no stable native AX focus/set-value ref found"
jq --arg ref "$REF_ID" '.refs[] | select(.ref == $ref)' "$EVIDENCE_DIR/refs-focus-before.json" >"$EVIDENCE_DIR/selected-ref-before.json"

"$AOS" do focus "ref:${FOCUS_SNAPSHOT}:${REF_ID}" --workspace "$WORKSPACE" --dry-run >"$EVIDENCE_DIR/focus-dry-run.json" 2>"$EVIDENCE_DIR/focus-dry-run.err" \
  || fail "focus dry-run failed"
jq -e '.status == "dry_run" and .resolved_action.resolution_status == "direct_ax_ready"' "$EVIDENCE_DIR/focus-dry-run.json" >/dev/null \
  || fail "focus dry-run was not direct_ax_ready"

"$AOS" do focus "ref:${FOCUS_SNAPSHOT}:${REF_ID}" --workspace "$WORKSPACE" >"$EVIDENCE_DIR/focus-dispatch.json" 2>"$EVIDENCE_DIR/focus-dispatch.err" \
  || fail "focus dispatch failed"
jq -e '
  .status == "success"
  and .resolved_action.resolution_status == "direct_ax_ready"
  and (.underlying_result.execution.ax_focused_after == true)
  and (.underlying_result.conformance.no_foreground.fallback_used == false)
  and (.underlying_result.conformance.no_foreground.claim == "not_claimed")
' "$EVIDENCE_DIR/focus-dispatch.json" >/dev/null || fail "focus dispatch did not report expected native AX post-action proof"

"$AOS" see capture main --save --mode ax --workspace "$WORKSPACE" --name focus-after >"$EVIDENCE_DIR/capture-focus-after.json"
FOCUS_AFTER_SNAPSHOT="$(jq -r '.snapshot_id' "$EVIDENCE_DIR/capture-focus-after.json")"
"$AOS" see refs --workspace "$WORKSPACE" --snapshot "$FOCUS_AFTER_SNAPSHOT" --json >"$EVIDENCE_DIR/refs-focus-after.json"
jq -e --argjson pid "$APP_PID" --arg ident "$FIELD_IDENTIFIER" '
  .refs[]
  | select(.backend == "native_ax")
  | select(.identity_facts.app_pid == $pid)
  | select(.identity_facts.ax_identifier == $ident)
  | .identity_facts.focused == true
' "$EVIDENCE_DIR/refs-focus-after.json" >/dev/null || fail "post-focus capture did not report focused=true"

"$AOS" do set-value "ref:${FOCUS_SNAPSHOT}:${REF_ID}" --workspace "$WORKSPACE" --value "$SET_VALUE" --dry-run >"$EVIDENCE_DIR/set-value-dry-run.json" 2>"$EVIDENCE_DIR/set-value-dry-run.err" \
  || fail "set-value dry-run failed"
jq -e '.status == "dry_run" and .resolved_action.resolution_status == "direct_ax_ready"' "$EVIDENCE_DIR/set-value-dry-run.json" >/dev/null \
  || fail "set-value dry-run was not direct_ax_ready"

"$AOS" do set-value "ref:${FOCUS_SNAPSHOT}:${REF_ID}" --workspace "$WORKSPACE" --value "$SET_VALUE" >"$EVIDENCE_DIR/set-value-dispatch.json" 2>"$EVIDENCE_DIR/set-value-dispatch.err" \
  || fail "set-value dispatch failed"
jq -e --arg value "$SET_VALUE" '
  .status == "success"
  and .resolved_action.resolution_status == "direct_ax_ready"
  and (.underlying_result.action == "set-value")
  and (.underlying_result.execution.ax_value_after == $value)
  and (.underlying_result.execution.ax_value_matches_request == true)
  and (.underlying_result.conformance.no_foreground.fallback_used == false)
  and (.underlying_result.conformance.no_foreground.claim == "not_claimed")
' "$EVIDENCE_DIR/set-value-dispatch.json" >/dev/null || fail "set-value dispatch did not report expected native AX post-action proof"

"$AOS" see capture main --save --mode ax --workspace "$WORKSPACE" --name set-value-after >"$EVIDENCE_DIR/capture-set-value-after.json"
SET_VALUE_AFTER_SNAPSHOT="$(jq -r '.snapshot_id' "$EVIDENCE_DIR/capture-set-value-after.json")"
"$AOS" see refs --workspace "$WORKSPACE" --snapshot "$SET_VALUE_AFTER_SNAPSHOT" --json >"$EVIDENCE_DIR/refs-set-value-after.json"
jq -e --argjson pid "$APP_PID" --arg ident "$FIELD_IDENTIFIER" --arg value "$SET_VALUE" '
  .refs[]
  | select(.backend == "native_ax")
  | select(.identity_facts.app_pid == $pid)
  | select(.identity_facts.ax_identifier == $ident)
  | .identity_facts.value == $value
' "$EVIDENCE_DIR/refs-set-value-after.json" >/dev/null || fail "post-set-value capture did not report requested value"

run_json cursor-after "$AOS" __see cursor
run_json service-status-after "$AOS" service status --mode repo --json
run_json permissions-after "$AOS" permissions check --json
git status --short --branch >"$EVIDENCE_DIR/git-status-after.txt"

jq -n \
  --arg proof_id "$PROOF_ID" \
  --arg workspace "$WORKSPACE" \
  --arg evidence_dir "$EVIDENCE_DIR" \
  --arg app_pid "$APP_PID" \
  --arg ref "$REF_ID" \
  --arg focus_snapshot "$FOCUS_SNAPSHOT" \
  --arg focus_after_snapshot "$FOCUS_AFTER_SNAPSHOT" \
  --arg set_value_after_snapshot "$SET_VALUE_AFTER_SNAPSHOT" \
  --arg field_identifier "$FIELD_IDENTIFIER" \
  --arg set_value "$SET_VALUE" \
  '{
    status: "passed",
    proof_id: $proof_id,
    workspace: $workspace,
    evidence_dir: $evidence_dir,
    proof_app_pid: ($app_pid | tonumber),
    selected_ref: $ref,
    snapshots: {
      focus_before: $focus_snapshot,
      focus_after: $focus_after_snapshot,
      set_value_after: $set_value_after_snapshot
    },
    field_identifier: $field_identifier,
    set_value: $set_value,
    claims: {
      saved_native_ax_focus_dispatch: "live_proven",
      saved_native_ax_set_value_dispatch: "live_proven",
      coordinate_fallback_used: false,
      screenshot_or_image_matching_used_for_targeting: false,
      applescript_mutation_used: false,
      no_foreground_claim: "not_claimed"
    }
  }' >"$EVIDENCE_DIR/summary.json"

cat "$EVIDENCE_DIR/summary.json"
