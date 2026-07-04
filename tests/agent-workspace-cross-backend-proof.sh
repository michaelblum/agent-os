#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROOF_ROOT="$(mktemp -d /tmp/aos-cross-backend-saved-ref-regression-test.XXXXXX)"
trap 'rm -rf "$PROOF_ROOT"' EXIT

AOS_SAVED_REF_PROOF_MODE=fixture \
AOS_SAVED_REF_PROOF_ID=test \
AOS_SAVED_REF_PROOF_ROOT="$PROOF_ROOT" \
    bash tests/manual/cross-backend-saved-ref-regression-proof.sh >"$PROOF_ROOT/stdout.json"

SUMMARY="$PROOF_ROOT/summary.json"

jq -e '
  .schema_version == "aos.saved-ref-cross-backend-proof.v0"
  and .status == "passed"
  and .mode == "fixture"
  and .build.binary_rebuilt == false
  and .build.binary_resigned == false
  and .row_status_counts.passed == 7
  and (.rows | length) == 7
  and ([.rows[].backend] | unique | sort) == ["aos_canvas", "browser", "native_ax"]
  and any(.rows[]; .backend == "browser" and .action == "click" and .status == "passed" and .proof_level == "deterministic_fixture")
  and any(.rows[]; .backend == "browser" and .action == "fill" and .status == "passed")
  and any(.rows[]; .backend == "aos_canvas" and .action == "click" and .status == "passed")
  and any(.rows[]; .backend == "aos_canvas" and .action == "set-value" and .status == "passed")
  and any(.rows[]; .backend == "native_ax" and .action == "press" and .status == "passed")
  and any(.rows[]; .backend == "native_ax" and .action == "focus" and .status == "passed")
  and any(.rows[]; .backend == "native_ax" and .action == "set-value" and .status == "passed")
  and all(.rows[];
    (.artifacts.setup | type == "string")
    and (.artifacts.before_capture | type == "string")
    and (.artifacts.selected_ref | type == "string")
    and (.artifacts.dry_run | type == "string")
    and (.artifacts.dispatch | type == "string")
    and (.artifacts.after_capture | type == "string")
    and (.artifacts.readback | type == "string")
    and (.artifacts.cleanup | type == "string")
  )
' "$SUMMARY" >/dev/null || {
    cat "$SUMMARY" >&2
    exit 1
}

for artifact in \
    browser/dry-run/click.json \
    browser/dispatch/fill.json \
    canvas/dry-run/set-value.json \
    canvas/dispatch/click.json \
    native_ax/dry-run/press.json \
    native_ax/dispatch/focus.json \
    native_ax/readback/set-value.json \
    cleanup.json; do
    [[ -f "$PROOF_ROOT/$artifact" ]] || {
        echo "missing proof artifact $artifact" >&2
        exit 1
    }
done

echo "PASS cross-backend saved-ref proof"
