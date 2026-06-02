#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-canvas-visible-surface-audit"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
STALE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-stale.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  ./aos show remove-all >/dev/null 2>&1 || true
  if [[ -n "${STALE_PID:-}" ]] && kill -0 "$STALE_PID" 2>/dev/null; then
    kill "$STALE_PID" 2>/dev/null || true
    wait "$STALE_PID" 2>/dev/null || true
  fi
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT" "$STALE_ROOT"
}
trap cleanup EXIT

cat >"$STALE_ROOT/aos" <<'SH'
#!/usr/bin/env bash
while true; do
  sleep 10
done
SH
chmod +x "$STALE_ROOT/aos"
"$STALE_ROOT/aos" serve --idle-timeout 5m \
  >"$STALE_ROOT/stale.stdout" 2>"$STALE_ROOT/stale.stderr" &
STALE_PID=$!

export AOS_TEST_VISIBLE_SURFACE_AUDIT_NATIVE_WINDOWS_JSON
AOS_TEST_VISIBLE_SURFACE_AUDIT_NATIVE_WINDOWS_JSON="$(python3 - "$STALE_PID" "$PWD" <<'PY'
import json
import os
import sys

pid = int(sys.argv[1])
cwd = sys.argv[2]
print(json.dumps([{
    "window_number": 900001,
    "owner_pid": pid,
    "owner_name": "aos",
    "name": "test external AOS window",
    "actual_frame": {"x": 520, "y": 70, "w": 180, "h": 120},
    "window_layer": 3,
    "alpha": 1,
    "on_screen": True,
    "visible": True,
    "front_to_back_index": 0,
    "display_relationship": [{
        "display_id": -1,
        "frame": {"x": 0, "y": 0, "w": 2000, "h": 1200},
        "intersection": {"x": 520, "y": 70, "w": 180, "h": 120},
    }],
    "focus": {
        "is_key_window": False,
        "source": "test fixture for cross-process visible-surface audit classification",
    },
    "test_fixture": True,
}]))
PY
)"

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

def audit(point):
    return json.loads(subprocess.check_output([
        "./aos", "show", "audit", "--json", "--point", point
    ], text=True))

deadline = time.time() + 5
payload = None
while time.time() < deadline:
    payload = audit("80,90")
    rows = {row.get("id"): row for row in payload.get("registered_canvases", [])}
    native = rows.get(id_a, {}).get("actual_native_windows") or []
    external = payload.get("external_aos_native_windows") or []
    if rows.get(id_a) and rows.get(id_b) and native and external:
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
runtime = payload.get("runtime", {})
assert runtime.get("native_window_scope") == "current_daemon_process", runtime
assert isinstance(runtime.get("current_daemon_pid"), int), runtime
cross = runtime.get("cross_process_aos_window_discovery") or {}
assert cross.get("ran") is True, cross
assert cross.get("cleanup_command") == "./aos clean --dry-run --json", cross
assert "aos clean" in (cross.get("stale_daemon_model") or ""), cross
assert payload.get("unavailable", {}).get("orphan_synthesis"), payload

external_rows = payload.get("external_aos_native_windows") or []
external = next((row for row in external_rows if row.get("classification") == "stale_aos_daemon_window"), None)
if not external:
    raise SystemExit(f"FAIL: missing stale external AOS native window: {external_rows}")
assert external.get("scope") == "external_process", external
assert external.get("owner_pid") != runtime.get("current_daemon_pid"), external
assert external.get("visible") is True, external
assert external.get("on_screen") is True, external
assert external.get("appears_in_aos_clean_stale_daemons") is True, external
identity = external.get("process_identity") or {}
assert identity.get("pid") == external.get("owner_pid"), identity
assert isinstance(identity.get("command_line"), str) and (
    "aos serve" in identity.get("command_line") or "aos __serve" in identity.get("command_line")
), identity
assert "runtime_mode" in identity, identity
assert identity.get("runtime_mode") == "repo" or identity.get("runtime_mode_unavailable_reason"), identity
assert "worktree_root" in identity, identity
assert identity.get("worktree_root") == cwd or identity.get("worktree_root_unavailable_reason"), identity
assert "branch" in identity and "branch_unavailable_reason" in identity, identity
assert "repo_git_commit" in identity and "repo_git_commit_unavailable_reason" in identity, identity

winner = payload.get("input_target_winner", {}).get("winner") or {}
assert winner.get("status") in ("matched_registered_surface", "matched_noninteractive_or_suspended_surface"), winner
assert winner.get("canvas_id") == id_a, winner
assert winner.get("interactive") is True, winner

external_payload = audit("540,90")
external_winner = external_payload.get("input_target_winner", {}).get("winner") or {}
assert external_winner.get("status") == "external_aos_native_window", external_winner
assert external_winner.get("scope") == "external_process", external_winner
assert external_winner.get("classification") == "stale_aos_daemon_window", external_winner
assert (external_winner.get("process_identity") or {}).get("pid") == external_winner.get("owner_pid"), external_winner

print("PASS")
PY
