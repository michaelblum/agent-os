#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-canvas-visible-surface-audit"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  ./aos show remove-all >/dev/null 2>&1 || true
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

ID_A="sigil-avatar-controls-audit-a"
ID_B="sigil-avatar-controls-audit-b"

AOS_SESSION_ID="audit-session" \
AOS_SESSION_HARNESS="audit-harness" \
./aos show create \
  --id "$ID_A" \
  --at 60,70,180,120 \
  --interactive \
  --window-level floating \
  --html '<!doctype html><html><body style="margin:0;background:rgba(120,40,200,.35)">audit a</body></html>' >/dev/null

AOS_SESSION_ID="audit-session" \
AOS_SESSION_HARNESS="audit-harness" \
./aos show create \
  --id "$ID_B" \
  --at 280,70,180,120 \
  --interactive \
  --window-level floating \
  --html '<!doctype html><html><body style="margin:0;background:rgba(40,200,120,.35)">audit b</body></html>' >/dev/null

python3 - "$ID_A" "$ID_B" "$PWD" <<'PY'
import json
import subprocess
import sys
import time

id_a, id_b, cwd = sys.argv[1:]

def audit():
    return json.loads(subprocess.check_output([
        "./aos", "show", "audit", "--json", "--point", "80,90"
    ], text=True))

deadline = time.time() + 5
payload = None
while time.time() < deadline:
    payload = audit()
    rows = {row.get("id"): row for row in payload.get("registered_canvases", [])}
    native = rows.get(id_a, {}).get("actual_native_windows") or []
    if rows.get(id_a) and rows.get(id_b) and native:
        break
    time.sleep(0.1)

if not payload:
    raise SystemExit("FAIL: audit did not return JSON")

assert payload.get("status") == "success", payload
assert payload.get("schema_version") == 1, payload
assert payload.get("join", {}).get("key") == "CanvasInfo.windowNumbers[] == CGWindowListCopyWindowInfo[kCGWindowNumber]", payload.get("join")

rows = {row.get("id"): row for row in payload.get("registered_canvases", [])}
for canvas_id in (id_a, id_b):
    row = rows.get(canvas_id)
    if not row:
        raise SystemExit(f"FAIL: missing registered audit row for {canvas_id}: {payload}")
    requested = row.get("requested_frame")
    assert isinstance(requested, list) and len(requested) == 4, row
    assert row.get("requested_frame_source") == "Canvas.desiredCGFrame", row
    assert row.get("native_join_status") == "matched", row
    assert row.get("logical_surface_key") == "sigil.avatar.controls", row
    assert row.get("interactive") is True, row
    assert row.get("window_level") == "floating", row
    owner = row.get("owner") or {}
    assert owner.get("consumer_id") == "audit-session", owner
    assert owner.get("harness") == "audit-harness", owner
    assert owner.get("cwd") == cwd, owner
    assert owner.get("worktree_root") == cwd, owner
    assert owner.get("runtime_mode") == "repo", owner
    native = row.get("actual_native_windows") or []
    assert native, row
    first = native[0]
    assert isinstance(first.get("window_number"), int), first
    assert first.get("visible") is True, first
    assert first.get("on_screen") is True, first
    assert isinstance(first.get("front_to_back_index"), int), first
    assert isinstance(first.get("window_layer"), int), first
    assert "actual_frame" in first, first
    assert "display_relationship" in first, first
    assert "focus" in first, first

duplicates = payload.get("duplicate_logical_surfaces") or []
avatar_dupe = next((entry for entry in duplicates if entry.get("logical_surface_key") == "sigil.avatar.controls"), None)
if not avatar_dupe:
    raise SystemExit(f"FAIL: missing duplicate logical surface entry: {duplicates}")
assert sorted(avatar_dupe.get("canvas_ids") or []) == sorted([id_a, id_b]), avatar_dupe

assert isinstance(payload.get("native_windows"), list), payload
assert isinstance(payload.get("orphan_native_windows"), list), payload
for orphan in payload.get("orphan_native_windows") or []:
    assert orphan.get("visible") is True, orphan
    assert orphan.get("on_screen") is True, orphan
assert isinstance(payload.get("non_visible_unmatched_native_windows"), list), payload
assert isinstance(payload.get("registered_without_native_window"), list), payload
assert payload.get("runtime", {}).get("native_window_scope") == "current_daemon_process", payload.get("runtime")
assert payload.get("unavailable", {}).get("orphan_synthesis"), payload

winner = payload.get("input_target_winner", {}).get("winner") or {}
assert winner.get("status") in ("matched_registered_surface", "matched_noninteractive_or_suspended_surface"), winner
assert winner.get("canvas_id") == id_a, winner
assert winner.get("interactive") is True, winner

print("PASS")
PY
