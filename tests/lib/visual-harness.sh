#!/usr/bin/env bash

VISUAL_HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VISUAL_HARNESS_ROOT="$(cd "$VISUAL_HARNESS_DIR/../.." && pwd)"

source "$VISUAL_HARNESS_DIR/isolated-daemon.sh"
source "$VISUAL_HARNESS_DIR/status-item.sh"
source "$VISUAL_HARNESS_ROOT/apps/sigil/scripts/launch-common.sh"
source "$VISUAL_HARNESS_ROOT/scripts/aos-content-scope.sh"

# Generic visual/canvas primitives.
#
# Keep reusable AOS visual workspace, content-root, diagnostics, and bounded
# command helpers in this section. App-specific compositions should stay below
# the mixed compatibility section or move into tests/lib/sigil/ when they grow.

aos_visual_root() {
  printf '%s\n' "$VISUAL_HARNESS_ROOT"
}

aos_visual_aos() {
  printf '%s\n' "${AOS:-$VISUAL_HARNESS_ROOT/aos}"
}

aos_visual_global_status_item_diagnostic_inventory() {
  aos_global_status_item_diagnostic_matches_json
}

aos_visual_phase_snapshot() {
  local label="$1"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  python3 - "$label" "$aos_bin" "$(aos_visual_global_status_item_diagnostic_inventory)" <<'PY'
import json
import subprocess
import sys

label, aos, status_items = sys.argv[1:4]

def run_json(*args):
    try:
        completed = subprocess.run(
            [aos, *args],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=3,
        )
    except subprocess.TimeoutExpired:
        return {"error": f"{' '.join(args)} timed out"}
    if completed.returncode != 0:
        return {"error": completed.stdout.strip() or f"{' '.join(args)} exited {completed.returncode}"}
    try:
        return json.loads(completed.stdout or "{}")
    except Exception as error:
        return {"error": f"invalid JSON from {' '.join(args)}: {error}", "output": completed.stdout[:1000]}

try:
    status_payload = json.loads(status_items or '{"matches":[]}')
except Exception as error:
    status_payload = {"error": f"invalid status item inventory: {error}", "raw": status_items}

snapshot = {
    "label": label,
    "statusItems": status_payload.get("matches", []),
    "showList": run_json("show", "list", "--json").get("canvases", []),
    "runtime": run_json("status", "--json"),
    "cleanDryRun": run_json("clean", "--dry-run", "--json"),
}
print(json.dumps(snapshot, sort_keys=True))
PY
}

aos_visual_run_bounded() {
  local timeout="$1"
  local label="$2"
  shift 2

  local stdout_file stderr_file pid elapsed status
  stdout_file="$(mktemp "${TMPDIR:-/tmp}/aos-visual-phase-stdout.XXXXXX")"
  stderr_file="$(mktemp "${TMPDIR:-/tmp}/aos-visual-phase-stderr.XXXXXX")"

  "$@" >"$stdout_file" 2>"$stderr_file" &
  pid="$!"
  elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( elapsed >= timeout )); then
      kill "$pid" 2>/dev/null || true
      sleep 0.2
      kill -9 "$pid" 2>/dev/null || true
      echo "FAIL: timed out after ${timeout}s during ${label}" >&2
      echo "stdout:" >&2
      sed -n '1,80p' "$stdout_file" >&2 || true
      echo "stderr:" >&2
      sed -n '1,80p' "$stderr_file" >&2 || true
      echo "snapshot:" >&2
      aos_visual_phase_snapshot "$label" >&2 || true
      rm -f "$stdout_file" "$stderr_file"
      return 124
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  wait "$pid"
  status="$?"
  if (( status != 0 )); then
    echo "FAIL: ${label} exited ${status}" >&2
    echo "stdout:" >&2
    sed -n '1,80p' "$stdout_file" >&2 || true
    echo "stderr:" >&2
    sed -n '1,80p' "$stderr_file" >&2 || true
    echo "snapshot:" >&2
    aos_visual_phase_snapshot "$label" >&2 || true
    rm -f "$stdout_file" "$stderr_file"
    return "$status"
  fi

  cat "$stdout_file"
  rm -f "$stdout_file" "$stderr_file"
}

aos_visual_content_root_key() {
  local prefix="$1"
  local env_name value
  case "$prefix" in
    toolkit) env_name="AOS_TOOLKIT_CONTENT_ROOT" ;;
    sigil) env_name="AOS_SIGIL_CONTENT_ROOT" ;;
    repo) env_name="AOS_REPO_CONTENT_ROOT" ;;
    *) env_name="" ;;
  esac
  if [[ -n "$env_name" ]]; then
    value="${!env_name:-}"
    if [[ -n "$value" ]]; then
      printf '%s\n' "$value"
      return
    fi
  fi

  case "${AOS_VISUAL_CONTENT_ROOT_SCOPE:-}" in
    branch|scoped|parallel|worktree)
      aos_content_root_key_for "$prefix" "$VISUAL_HARNESS_ROOT"
      return
      ;;
    canonical|single)
      printf '%s\n' "$prefix"
      return
      ;;
  esac

  if [[ "$(git -C "$VISUAL_HARNESS_ROOT" worktree list --porcelain 2>/dev/null | awk '$1 == "worktree" { count++ } END { print count + 0 }')" -le 1 ]]; then
    printf '%s\n' "$prefix"
    return
  fi

  aos_content_root_key_for "$prefix" "$VISUAL_HARNESS_ROOT"
}

aos_visual_content_url() {
  local root_key="$1"
  local path="$2"
  local query="${3:-}"

  path="${path#/}"
  if [[ -n "$query" && "$query" != \?* ]]; then
    query="?$query"
  fi
  printf 'aos://%s/%s%s\n' "$root_key" "$path" "$query"
}

aos_visual_sigil_renderer_url() {
  local sigil_key toolkit_key
  sigil_key="$(aos_visual_content_root_key sigil)"
  toolkit_key="$(aos_visual_content_root_key toolkit)"
  aos_visual_content_url "$sigil_key" "renderer/index.html" "toolkit-root=$toolkit_key"
}

aos_visual_toolkit_url() {
  local path="$1"
  local query="${2:-}"
  aos_visual_content_url "$(aos_visual_content_root_key toolkit)" "$path" "$query"
}

aos_visual_url_is_canonical() {
  [[ "$1" == aos://* ]]
}

aos_visual_assert_canonical_url() {
  local url="$1"
  if aos_visual_url_is_canonical "$url"; then
    return 0
  fi

  if [[ "$url" == http://127.0.0.1:* || "$url" == http://localhost:* ]]; then
    echo "FAIL: resolved localhost URL is runtime evidence, not a canonical launch/update input: $url" >&2
  else
    echo "FAIL: expected canonical aos:// URL, got: $url" >&2
  fi
  return 1
}

aos_visual_update_canvas_url() {
  local canvas_id="$1"
  local url="$2"
  local mode="${3:-canonical}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  if [[ "$mode" != "diagnostic" ]]; then
    aos_visual_assert_canonical_url "$url" || return $?
  fi
  "$aos_bin" show update --id "$canvas_id" --url "$url" >/dev/null
}

aos_visual_urls_equivalent() {
  local canonical_url="$1"
  local live_url="$2"

  python3 - "$canonical_url" "$live_url" <<'PY'
from urllib.parse import parse_qsl, urlparse
import sys

left, right = sys.argv[1:3]

def parts(raw):
    parsed = urlparse(raw)
    if parsed.scheme == "aos":
        root = parsed.netloc
        path = parsed.path
    elif parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost"}:
        segments = parsed.path.lstrip("/").split("/", 1)
        root = segments[0] if segments else ""
        path = "/" + (segments[1] if len(segments) > 1 else "")
    else:
        raise ValueError(f"unsupported URL form: {raw}")
    return (root, path, sorted(parse_qsl(parsed.query, keep_blank_values=True)))

try:
    raise SystemExit(0 if parts(left) == parts(right) else 1)
except Exception:
    raise SystemExit(1)
PY
}

aos_visual_assert_url_equivalent() {
  local expected="$1"
  local actual="$2"
  if ! aos_visual_urls_equivalent "$expected" "$actual"; then
    echo "FAIL: content URL mismatch." >&2
    echo "Expected: $expected" >&2
    echo "Actual:   $actual" >&2
    return 1
  fi
}

aos_visual_assert_canvas_worktree() {
  local canvas_id="$1"
  local expected_root="${2:-$VISUAL_HARNESS_ROOT}"
  local aos_bin show_json
  aos_bin="$(aos_visual_aos)"
  show_json="$("$aos_bin" show list --json)"

  python3 - "$canvas_id" "$expected_root" "$show_json" <<'PY'
import json
import pathlib
import sys

canvas_id, expected_root, raw = sys.argv[1:4]
payload = json.loads(raw)
expected = str(pathlib.Path(expected_root).expanduser().resolve(strict=False))
for canvas in payload.get("canvases") or []:
    if canvas.get("id") != canvas_id:
        continue
    owner = canvas.get("owner") or {}
    actual = owner.get("worktree_root")
    if actual and str(pathlib.Path(actual).expanduser().resolve(strict=False)) == expected:
        raise SystemExit(0)
    print(f"FAIL: canvas {canvas_id} worktree mismatch. Expected: {expected} Actual: {actual or '<missing>'}", file=sys.stderr)
    raise SystemExit(1)
print(f"FAIL: canvas {canvas_id} missing from show list data", file=sys.stderr)
raise SystemExit(1)
PY
}

aos_visual_assert_sigil_renderer_fresh() {
  local canvas_id="${1:-avatar-main}"
  local commit_time="${2:-}"
  local aos_bin eval_json
  aos_bin="$(aos_visual_aos)"
  if [[ -z "$commit_time" ]]; then
    commit_time="$(git -C "$VISUAL_HARNESS_ROOT" show -s --format=%cI HEAD)"
  fi

  eval_json="$("$aos_bin" show eval --id "$canvas_id" --js 'window.__sigilDebug && window.__sigilDebug.snapshot && window.__sigilDebug.snapshot().runtime && window.__sigilDebug.snapshot().runtime.loadedAt' --json)"
  python3 - "$commit_time" "$eval_json" <<'PY'
import json
from datetime import datetime
import sys

commit_time, raw = sys.argv[1:3]
payload = json.loads(raw)
loaded_at = payload.get("result")
if isinstance(loaded_at, str) and len(loaded_at) >= 2 and loaded_at[0] == loaded_at[-1] == '"':
    loaded_at = json.loads(loaded_at)

def parse(value):
    if not value:
        raise ValueError("missing timestamp")
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))

try:
    commit_dt = parse(commit_time)
    loaded_dt = parse(loaded_at)
except Exception as error:
    print(f"FAIL: unable to compare Sigil renderer freshness: {error}; loadedAt={loaded_at!r}", file=sys.stderr)
    raise SystemExit(1)

if loaded_dt < commit_dt:
    print(f"FAIL: Sigil renderer is stale. loadedAt={loaded_at} commit={commit_time}", file=sys.stderr)
    raise SystemExit(1)
PY
}

aos_visual_assert_live_content_root() {
  local root_name="$1"
  local expected_path="$2"
  local aos_bin mode status_json verdict
  aos_bin="$(aos_visual_aos)"
  mode="${AOS_VISUAL_CONTENT_PREFLIGHT:-fail}"

  status_json="$("$aos_bin" content status --json 2>/dev/null)" || {
    echo "FAIL: unable to read active AOS content roots for visual harness preflight." >&2
    echo "Expected ${root_name}: ${expected_path}" >&2
    return 1
  }

  verdict="$(python3 - "$root_name" "$expected_path" "$status_json" <<'PY'
import json
import pathlib
import sys

root_name, expected_path, payload = sys.argv[1:4]
try:
    status = json.loads(payload)
except Exception as error:
    print(f"error\tinvalid content status JSON: {error}")
    raise SystemExit(0)

roots = status.get("roots") or {}
active_path = roots.get(root_name)
if not active_path:
    print(f"mismatch\t{root_name}\t{expected_path}\t<missing>")
    raise SystemExit(0)

def normalize(path):
    return str(pathlib.Path(path).expanduser().resolve(strict=False))

expected = normalize(expected_path)
active = normalize(active_path)
if expected != active:
    print(f"mismatch\t{root_name}\t{expected}\t{active}")
else:
    print(f"ok\t{root_name}\t{expected}\t{active}")
PY
)"

  case "$verdict" in
    ok$'\t'*)
      return 0
      ;;
    error$'\t'*)
      echo "FAIL: ${verdict#*$'\t'}" >&2
      return 1
      ;;
    mismatch$'\t'*)
      local name expected active prefix
      IFS=$'\t' read -r _ name expected active <<<"$verdict"
      prefix="FAIL"
      if [[ "$mode" == "warn" ]]; then
        prefix="WARN"
      fi
      echo "${prefix}: live content root mismatch for ${name}." >&2
      echo "Expected: ${expected}" >&2
      echo "Active:   ${active}" >&2
      echo "The running daemon is not serving the worktree used by this visual harness." >&2
      echo "Restart AOS after changing content.roots. If explicit HTTP URL overrides are intentional, rerun with AOS_VISUAL_CONTENT_PREFLIGHT=warn." >&2
      [[ "$mode" == "warn" ]]
      return $?
      ;;
    *)
      echo "FAIL: unexpected visual harness content preflight result: ${verdict}" >&2
      return 1
      ;;
  esac
}

# Mixed compatibility section.
#
# This lower section still contains generic inspector/daemon wrappers alongside
# Sigil launch and avatar compositions. Sigil-specific helpers are named with
# `sigil`; new reusable Sigil-only flows should prefer tests/lib/sigil/.

aos_visual_seed_sigil() {
  local mode="${1:-repo}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"
  AOS_BIN="$aos_bin" AOS_RUNTIME_MODE="$mode" "$VISUAL_HARNESS_ROOT/apps/sigil/sigilctl-seed.sh" >/dev/null
}

aos_visual_start_isolated_daemon() {
  local state_root="$1"
  shift

  AOS_STATE_ROOT="$state_root" aos_test_start_daemon "$state_root" "$@"
}

aos_visual_prepare_live_roots() {
  local aos_bin toolkit_key sigil_key
  aos_bin="$(aos_visual_aos)"
  toolkit_key="$(aos_visual_content_root_key toolkit)"
  sigil_key="$(aos_visual_content_root_key sigil)"

  aos_ensure_content_roots_live "$aos_bin" \
    "$toolkit_key" "$VISUAL_HARNESS_ROOT/packages/toolkit" \
    "$sigil_key" "$VISUAL_HARNESS_ROOT/apps/sigil"
  aos_visual_assert_live_content_root "$toolkit_key" "$VISUAL_HARNESS_ROOT/packages/toolkit"
  aos_visual_assert_live_content_root "$sigil_key" "$VISUAL_HARNESS_ROOT/apps/sigil"
}

aos_visual_configure_sigil_status_item() {
  local avatar_id="${1:-avatar-main}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  sigil_configure_status_item "$aos_bin" "$VISUAL_HARNESS_ROOT/apps/sigil" "$VISUAL_HARNESS_ROOT/packages/toolkit" "$avatar_id"
}

aos_visual_remove_canvas() {
  local canvas_id="$1"
  local aos_bin timeout
  aos_bin="$(aos_visual_aos)"
  timeout="${2:-3}"

  "$aos_bin" show remove --id "$canvas_id" >/dev/null 2>&1 || true
  python3 - "$aos_bin" "$canvas_id" "$timeout" <<'PY' >/dev/null 2>&1 || true
import json
import subprocess
import sys
import time

aos, canvas_id, timeout = sys.argv[1], sys.argv[2], float(sys.argv[3])
deadline = time.time() + timeout
last_remove_at = 0.0

while time.time() < deadline:
    completed = subprocess.run(
        [aos, "show", "list", "--json"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if completed.returncode != 0:
        time.sleep(0.1)
        continue
    try:
        payload = json.loads(completed.stdout or "{}")
    except Exception:
        time.sleep(0.1)
        continue
    ids = {canvas.get("id") for canvas in payload.get("canvases") or []}
    if canvas_id not in ids:
        raise SystemExit(0)
    now = time.time()
    if now - last_remove_at >= 0.5:
        subprocess.run([aos, "show", "remove", "--id", canvas_id], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        last_remove_at = now
    time.sleep(0.1)
PY
}

aos_visual_wait_canvas_absent() {
  local canvas_id="$1"
  local timeout="${2:-5}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  python3 - "$aos_bin" "$canvas_id" "$timeout" <<'PY'
import json
import subprocess
import sys
import time

aos, canvas_id, timeout = sys.argv[1], sys.argv[2], float(sys.argv[3])
deadline = time.time() + timeout
last_error = None
last_ids = None

while time.time() < deadline:
    completed = subprocess.run(
        [aos, "show", "list", "--json"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if completed.returncode == 0:
        try:
            payload = json.loads(completed.stdout or "{}")
            ids = {canvas.get("id") for canvas in payload.get("canvases") or []}
            last_ids = sorted(canvas_id for canvas_id in ids if canvas_id)
            if canvas_id not in ids:
                raise SystemExit(0)
        except Exception as error:
            last_error = f"invalid show list payload: {error}; output={completed.stdout!r}"
    else:
        last_error = completed.stdout.strip() or f"show list exited {completed.returncode}"
    time.sleep(0.1)

detail = {"canvas": canvas_id, "last_ids": last_ids, "last_error": last_error}
print("FAIL: canvas still present or absence could not be confirmed: " + json.dumps(detail, sort_keys=True), file=sys.stderr)
raise SystemExit(1)
PY
}

aos_visual_launch_canvas_inspector() {
  local inspector_id="${1:-surface-inspector}"
  local aos_bin panel_w panel_h display_json x y toolkit_key
  aos_bin="$(aos_visual_aos)"
  toolkit_key="$(aos_visual_content_root_key toolkit)"
  panel_w="${AOS_SURFACE_INSPECTOR_W:-${AOS_CANVAS_INSPECTOR_W:-360}}"
  panel_h="${AOS_SURFACE_INSPECTOR_H:-${AOS_CANVAS_INSPECTOR_H:-520}}"

  aos_visual_remove_canvas "$inspector_id" 5
  aos_ensure_content_roots_live "$aos_bin" \
    "$toolkit_key" "$VISUAL_HARNESS_ROOT/packages/toolkit"

  display_json="$("$aos_bin" graph displays 2>/dev/null || echo '{"data":{"displays":[]}}')"
  read -r x y <<EOF
$(PANEL_W="$panel_w" PANEL_H="$panel_h" python3 -c "
import json, os, sys

payload = json.load(sys.stdin)
displays = payload.get('data', {}).get('displays', payload.get('displays', payload if isinstance(payload, list) else []))
main = next((display for display in displays if display.get('is_main')), displays[0] if displays else None)
rect = (main or {}).get('visible_bounds') or (main or {}).get('bounds') or {}
x = int(rect.get('x', 0))
y = int(rect.get('y', 0))
w = int(rect.get('w', 1920))
h = int(rect.get('h', 1080))
panel_w = int(os.environ['PANEL_W'])
panel_h = int(os.environ['PANEL_H'])
print(max(x, x + w - panel_w), max(y, y + h - panel_h))
" <<<"$display_json" 2>/dev/null || echo "1600 500")
EOF

  if "$aos_bin" show create --id "$inspector_id" \
    --at "$x,$y,$panel_w,$panel_h" \
    --interactive \
    --scope global \
    --url "aos://$toolkit_key/components/surface-inspector/index.html" >/dev/null; then
    :
  else
    local status="$?"
    echo "FAIL: surface-inspector create failed: id=$inspector_id at=$x,$y,$panel_w,$panel_h" >&2
    aos_visual_phase_snapshot "surface-inspector-create" >&2 || true
    return "$status"
  fi

  if "$aos_bin" show wait --id "$inspector_id" --manifest surface-inspector --timeout 15s >/dev/null; then
    :
  else
    local status="$?"
    echo "FAIL: surface-inspector manifest wait failed: id=$inspector_id timeout=15s" >&2
    aos_visual_phase_snapshot "surface-inspector-manifest-wait" >&2 || true
    return "$status"
  fi
  if "$aos_bin" show wait \
    --id "$inspector_id" \
    --manifest surface-inspector \
    --js '!!document.querySelector(".tree-row.canvas.self .canvas-dims") && !!document.querySelector(".minimap-display")' \
    --timeout 10s >/dev/null; then
    :
  else
    local status="$?"
    echo "FAIL: surface-inspector UI wait failed: id=$inspector_id timeout=10s" >&2
    aos_visual_phase_snapshot "surface-inspector-ui-wait" >&2 || true
    return "$status"
  fi
}

aos_visual_launch_sigil_avatar() {
  local avatar_id="${1:-avatar-main}"
  local aos_bin url
  aos_bin="$(aos_visual_aos)"
  url="$(aos_visual_sigil_renderer_url)"

  python3 - "$aos_bin" "$avatar_id" "$url" <<'PY'
import json
import subprocess
import sys
import time

aos, avatar_id, url = sys.argv[1:4]
last_payload = None
last_create = None

def run(args):
    return subprocess.run(
        [aos, *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

for attempt in range(1, 4):
    last_create = run([
        "show", "create",
        "--id", avatar_id,
        "--url", url,
        "--track", "union",
        "--scope", "global",
    ])
    if last_create.returncode != 0:
        if "NO_DAEMON" in (last_create.stdout or "") and attempt < 3:
            run(["ready", "--json"])
            time.sleep(0.5 * attempt)
            continue
        raise SystemExit("FAIL: Sigil avatar create failed: " + json.dumps({
            "attempt": attempt,
            "command": [aos, "show", "create", "--id", avatar_id, "--url", url, "--track", "union", "--scope", "global"],
            "exit": last_create.returncode,
            "output": last_create.stdout.strip(),
        }, sort_keys=True))
    completed = run(["show", "list", "--json"])
    if completed.returncode != 0:
        raise SystemExit("FAIL: unable to verify Sigil avatar create: " + json.dumps({
            "attempt": attempt,
            "command": [aos, "show", "list", "--json"],
            "exit": completed.returncode,
            "output": completed.stdout.strip(),
        }, sort_keys=True))
    try:
        last_payload = json.loads(completed.stdout or "{}")
    except Exception as error:
        raise SystemExit("FAIL: invalid Sigil avatar create verification JSON: " + json.dumps({
            "attempt": attempt,
            "error": str(error),
            "output": completed.stdout,
        }, sort_keys=True))
    ids = sorted(canvas.get("id") for canvas in last_payload.get("canvases") or [] if canvas.get("id"))
    if avatar_id in ids:
        raise SystemExit(0)
    run(["ready", "--json"])
    time.sleep(0.5 * attempt)

raise SystemExit("FAIL: Sigil avatar create returned but canvas is absent: " + json.dumps({
    "avatarId": avatar_id,
    "canvasIds": sorted(canvas.get("id") for canvas in (last_payload or {}).get("canvases") or [] if canvas.get("id")),
    "createOutput": (last_create.stdout if last_create else "").strip(),
    "payload": last_payload,
}, sort_keys=True))
PY
}

aos_visual_wait_sigil_avatar_ready() {
  local avatar_id="${1:-avatar-main}"
  local timeout="${2:-10s}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  "$aos_bin" show wait \
    --id "$avatar_id" \
    --js 'window.__sigilDebug && window.__sigilDebug.snapshot().hitTargetReady === true && window.liveJs && window.liveJs.currentAgentId === "default" && window.liveJs.avatarPos?.valid === true && Array.isArray(window.liveJs.displays) && window.liveJs.displays.length > 0 && window.__sigilBootError == null' \
    --timeout "$timeout" >/dev/null
}

aos_visual_show_sigil_avatar() {
  local avatar_id="${1:-avatar-main}"
  local fast_travel_effect="${2:-}"
  local aos_bin js
  aos_bin="$(aos_visual_aos)"

  if [[ -n "$fast_travel_effect" ]]; then
    js="window.__sigilDebug.dispatch({ type: 'status_item.show' }); window.state.transitionFastTravelEffect = '$fast_travel_effect'; 'ok'"
  else
    js="window.__sigilDebug.dispatch({ type: 'status_item.show' }); 'ok'"
  fi

  "$aos_bin" show eval --id "$avatar_id" --js "$js" >/dev/null
  "$aos_bin" show wait \
    --id "$avatar_id" \
    --js 'window.__sigilDebug && window.__sigilDebug.snapshot().avatarVisible === true' \
    --timeout 5s >/dev/null
}

aos_visual_show_sigil_avatar_via_real_status_click() {
  local state_root="$1"
  local avatar_id="${2:-avatar-main}"
  local aos_bin pid status_owner_pids matches_json
  aos_bin="$(aos_visual_aos)"
  pid="$(aos_test_wait_for_lock_pid "$state_root")"
  [[ -n "$pid" ]] || {
    echo "FAIL: daemon pid missing for real status-item click" >&2
    return 1
  }
  status_owner_pids="$(aos_test_pids_for_root "$state_root" | paste -sd, -)"
  [[ -n "$status_owner_pids" ]] || status_owner_pids="$pid"
  matches_json="$(aos_status_item_matches_for_pids_json "$status_owner_pids")" || return 1
  pid="$(aos_status_item_pid_from_matches_json "$status_owner_pids" "$matches_json")" || return 1
  aos_assert_status_item_overlap_from_matches_json "$pid" "$matches_json" >/dev/null

  click_aos_status_item_real "$pid" "$aos_bin"
  aos_visual_wait_sigil_avatar_ready "$avatar_id"
  "$aos_bin" show wait \
    --id "$avatar_id" \
    --js 'window.__sigilDebug && window.__sigilDebug.snapshot().avatarVisible === true && window.__sigilDebug.snapshot().hitTargetInteractive === true' \
    --timeout 5s >/dev/null
}

aos_visual_global_diagnostic_single_status_item_pid() {
  local matches_json
  matches_json="$(aos_global_status_item_diagnostic_matches_json)" || return 1

  python3 - "$matches_json" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
matches = payload.get("matches") or []
if len(matches) != 1:
    print(
        f"FAIL: expected exactly one AOS status item, found {len(matches)}: "
        f"{json.dumps(matches, sort_keys=True)}",
        file=sys.stderr,
    )
    raise SystemExit(1)

pid = matches[0].get("pid")
if not pid:
    print(f"FAIL: AOS status item match is missing pid: {matches[0]}", file=sys.stderr)
    raise SystemExit(1)

print(pid)
PY
}

aos_visual_show_sigil_avatar_via_live_status_click() {
  local avatar_id="${1:-avatar-main}"
  local aos_bin pid
  aos_bin="$(aos_visual_aos)"
  pid="$(aos_visual_global_diagnostic_single_status_item_pid)"

  click_aos_status_item_real "$pid" "$aos_bin"
  aos_visual_wait_sigil_avatar_ready "$avatar_id"
  "$aos_bin" show wait \
    --id "$avatar_id" \
    --js 'window.__sigilDebug && window.__sigilDebug.snapshot().avatarVisible === true && window.__sigilDebug.snapshot().hitTargetInteractive === true' \
    --timeout 5s >/dev/null
}

aos_visual_avoid_sigil_avatar_overlap() {
  local avatar_id="${1:-avatar-main}"
  local inspector_id="${2:-surface-inspector}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  python3 - "$aos_bin" "$avatar_id" "$inspector_id" <<'PY'
import json
import subprocess
import sys

aos, avatar_id, inspector_id = sys.argv[1:4]


def run_json(*args):
    return json.loads(subprocess.check_output([aos, *args], text=True))


def rect_contains(rect, point, margin=48):
    x, y, w, h = rect
    return x - margin <= point["x"] <= x + w + margin and y - margin <= point["y"] <= y + h + margin


def rect_overlaps_point(rect, point, margin=48):
    return rect_contains(rect, point, margin)


inspector = run_json("show", "get", "--id", inspector_id).get("canvas")
if not inspector:
    raise SystemExit(0)

payload = run_json(
    "show",
    "eval",
    "--id",
    avatar_id,
    "--js",
    "JSON.stringify({ avatarPos: window.liveJs?.avatarPos, displays: window.liveJs?.displays || [] })",
)
state = json.loads(payload.get("result") or "{}")
avatar = state.get("avatarPos") or {}
displays = state.get("displays") or []
if not avatar.get("valid") or not displays:
    raise SystemExit(0)

avatar_native = None
avatar_display = None
for display in displays:
    world = display.get("desktopWorldBounds") or display.get("desktop_world_bounds") or display.get("bounds") or {}
    native = display.get("nativeBounds") or display.get("native_bounds") or display.get("bounds") or {}
    if (
        world.get("x", 0) <= avatar["x"] <= world.get("x", 0) + world.get("w", 0)
        and world.get("y", 0) <= avatar["y"] <= world.get("y", 0) + world.get("h", 0)
    ):
        avatar_native = {
            "x": avatar["x"] - world.get("x", 0) + native.get("x", 0),
            "y": avatar["y"] - world.get("y", 0) + native.get("y", 0),
        }
        avatar_display = display
        break

if avatar_native is None:
    raise SystemExit(0)

current = inspector.get("at") or []
if len(current) != 4 or not rect_overlaps_point(current, avatar_native):
    raise SystemExit(0)

panel_w = int(current[2])
panel_h = int(current[3])
visible = (
    avatar_display.get("nativeVisibleBounds")
    or avatar_display.get("native_visible_bounds")
    or avatar_display.get("nativeBounds")
    or avatar_display.get("native_bounds")
    or avatar_display.get("bounds")
    or {}
)
vx = int(visible.get("x", 0))
vy = int(visible.get("y", 0))
vw = int(visible.get("w", 1920))
vh = int(visible.get("h", 1080))
pad = 16
candidates = [
    [vx + pad, vy + pad, panel_w, panel_h],
    [vx + vw - panel_w - pad, vy + pad, panel_w, panel_h],
    [vx + pad, vy + vh - panel_h - pad, panel_w, panel_h],
    [vx + vw - panel_w - pad, vy + vh - panel_h - pad, panel_w, panel_h],
]

target = next((rect for rect in candidates if not rect_contains(rect, avatar_native, 96)), candidates[0])
subprocess.check_call([aos, "show", "update", "--id", inspector_id, "--at", ",".join(str(int(v)) for v in target)], stdout=subprocess.DEVNULL)
PY
}

aos_visual_place_sigil_avatar_for_manual_test() {
  local avatar_id="${1:-avatar-main}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  "$aos_bin" show eval --id "$avatar_id" --js '
    (() => {
      const displays = window.liveJs?.displays || [];
      const display = displays.find((candidate) => !candidate.is_main) || displays[0];
      if (!display) return "no-display";
      const bounds = display.visible_bounds || display.visibleBounds || display.bounds;
      const x = bounds.x + bounds.w * 0.55;
      const y = bounds.y + bounds.h * 0.45;
      window.__sigilDebug.dispatch({ type: "sigil.set_position", x, y });
      window.__sigilDebug.dispatch({ type: "status_item.show" });
      return JSON.stringify({ x, y, display: display.id || display.display_id || null });
    })()
  ' >/dev/null
}

aos_visual_launch_sigil_with_inspector() {
  local avatar_id="${1:-avatar-main}"
  local inspector_id="${2:-surface-inspector}"
  local fast_travel_effect="${3:-}"
  local placement="${4:-default}"

  aos_visual_remove_canvas "$avatar_id"
  aos_visual_remove_canvas "$inspector_id"
  aos_visual_launch_canvas_inspector "$inspector_id"
  aos_visual_launch_sigil_avatar "$avatar_id"
  aos_visual_wait_sigil_avatar_ready "$avatar_id"
  aos_visual_show_sigil_avatar "$avatar_id" "$fast_travel_effect"
  if [[ "$placement" == "manual-visible" ]]; then
    aos_visual_place_sigil_avatar_for_manual_test "$avatar_id"
  fi
  aos_visual_avoid_sigil_avatar_overlap "$avatar_id" "$inspector_id"
}

aos_visual_launch_sigil_with_inspector_via_status_item() {
  local state_root="$1"
  local avatar_id="${2:-avatar-main}"
  local inspector_id="${3:-surface-inspector}"
  local placement="${4:-default}"

  aos_visual_configure_sigil_status_item "$avatar_id"
  aos_visual_remove_canvas "$avatar_id"
  aos_visual_remove_canvas "$inspector_id"
  aos_visual_launch_canvas_inspector "$inspector_id"
  aos_visual_show_sigil_avatar_via_real_status_click "$state_root" "$avatar_id"
  if [[ "$placement" == "manual-visible" ]]; then
    aos_visual_place_sigil_avatar_for_manual_test "$avatar_id"
  fi
  aos_visual_avoid_sigil_avatar_overlap "$avatar_id" "$inspector_id"
}

aos_visual_launch_sigil_with_inspector_via_live_status_item() {
  local avatar_id="${1:-avatar-main}"
  local inspector_id="${2:-surface-inspector}"
  local placement="${3:-default}"

  aos_visual_configure_sigil_status_item "$avatar_id"
  aos_visual_remove_canvas "$avatar_id"
  aos_visual_remove_canvas "sigil-hit-$avatar_id"
  aos_visual_remove_canvas "sigil-radial-menu-$avatar_id"
  aos_visual_remove_canvas "$inspector_id"
  aos_visual_launch_canvas_inspector "$inspector_id"
  aos_visual_show_sigil_avatar_via_live_status_click "$avatar_id"
  if [[ "$placement" == "manual-visible" ]]; then
    aos_visual_place_sigil_avatar_for_manual_test "$avatar_id"
  fi
  aos_visual_avoid_sigil_avatar_overlap "$avatar_id" "$inspector_id"
}
