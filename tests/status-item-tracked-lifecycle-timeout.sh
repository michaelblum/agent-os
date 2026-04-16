#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

press_status_item() {
  local pid="$1"
  for _ in $(seq 1 30); do
    if swift - "$pid" <<'SWIFT'
import AppKit
import ApplicationServices
import Foundation

let expectedLabel = "AOS status item"

func getAttr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(el, name as CFString, &value)
    guard result == .success else { return nil }
    return value
}

guard CommandLine.arguments.count >= 2, let pidValue = Int32(CommandLine.arguments[1]) else {
    fputs("FAIL: missing pid\n", stderr)
    exit(1)
}

let app = AXUIElementCreateApplication(pidValue)
guard let extrasValue = getAttr(app, kAXExtrasMenuBarAttribute as String) else {
    fputs("FAIL: missing extras menu bar\n", stderr)
    exit(1)
}
let extras = extrasValue as! AXUIElement

var childrenRef: CFTypeRef?
let childrenResult = AXUIElementCopyAttributeValue(extras, kAXChildrenAttribute as CFString, &childrenRef)
guard childrenResult == .success,
      let childrenValue = childrenRef,
      let children = childrenValue as? [AXUIElement] else {
    fputs("FAIL: missing status item\n", stderr)
    exit(1)
}

func matchesExpectedItem(_ el: AXUIElement) -> Bool {
    let title = getAttr(el, kAXTitleAttribute as String) as? String
    let desc = getAttr(el, kAXDescriptionAttribute as String) as? String
    let help = getAttr(el, kAXHelpAttribute as String) as? String
    return [title, desc, help].contains(expectedLabel)
}

let item = children.first(where: matchesExpectedItem) ?? (children.count == 1 ? children.first : nil)
guard let item else {
    fputs("FAIL: matching status item not found\n", stderr)
    exit(1)
}

let pressResult = AXUIElementPerformAction(item, kAXPressAction as CFString)
guard pressResult == .success else {
    fputs("FAIL: status item press failed\n", stderr)
    exit(1)
}
SWIFT
    then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

assert_canvas_state() {
  local canvas_id="$1"
  local expected_suspended="$2"
  local state_file="$3"

  mkdir -p "$(dirname "$state_file")"
  ./aos show list --json >"$state_file"
  python3 - "$canvas_id" "$expected_suspended" "$state_file" <<'PY'
import json, pathlib, sys

canvas_id = sys.argv[1]
expected_suspended = sys.argv[2] == "true"
payload = json.loads(pathlib.Path(sys.argv[3]).read_text())
for canvas in payload.get("canvases", []):
    if canvas.get("id") == canvas_id:
        if canvas.get("suspended") is expected_suspended:
            raise SystemExit(0)
        raise SystemExit(f"FAIL: canvas {canvas_id} suspended={canvas.get('suspended')} expected {expected_suspended}")
raise SystemExit(f"FAIL: canvas {canvas_id} missing")
PY
}

assert_received_count() {
  local canvas_id="$1"
  local state_file="$2"
  local key="$3"
  local expected="$4"

  mkdir -p "$(dirname "$state_file")"
  ./aos show eval --id "$canvas_id" --js 'JSON.stringify(window.__smokeState)' >"$state_file"
  python3 - "$state_file" "$key" "$expected" <<'PY'
import json, pathlib, sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
state = json.loads(payload["result"])
key = sys.argv[2]
expected = int(sys.argv[3])
count = sum(1 for event in state.get("events", []) if event.get("type") == key)
if count != expected:
    raise SystemExit(f"FAIL: {key} count {count} != {expected}; state={state}")
print("PASS")
PY
}

canvas_is_suspended() {
  local canvas_id="$1"
  local state_file="$2"

  mkdir -p "$(dirname "$state_file")"
  ./aos show list --json >"$state_file"
  python3 - "$canvas_id" "$state_file" <<'PY'
import json, pathlib, sys

canvas_id = sys.argv[1]
payload = json.loads(pathlib.Path(sys.argv[2]).read_text())
for canvas in payload.get("canvases", []):
    if canvas.get("id") == canvas_id and canvas.get("suspended") is True:
        raise SystemExit(0)
raise SystemExit(1)
PY
}

run_case() (
  set -euo pipefail

  local prefix="$1"
  local canvas_id="$2"
  local toggle_url="$3"

  aos_test_cleanup_prefix "$prefix"

  local root
  root="$(mktemp -d "${TMPDIR:-/tmp}/${prefix}.XXXXXX")"
  export AOS_STATE_ROOT="$root"

  cleanup() {
    aos_test_kill_root "$root"
    rm -rf "$root"
  }
  trap cleanup EXIT

  ./aos set content.roots.toolkit packages/toolkit >/dev/null
  ./aos set status_item.enabled true >/dev/null
  ./aos set status_item.toggle_id "$canvas_id" >/dev/null
  ./aos set status_item.toggle_url "$toggle_url" >/dev/null
  ./aos set status_item.toggle_track union >/dev/null

  ./aos serve --idle-timeout none >"$root/daemon.stdout" 2>"$root/daemon.stderr" &
  aos_test_wait_for_socket "$root" || { echo "FAIL: isolated daemon socket did not become reachable"; exit 1; }
  local pid
  pid="$(aos_test_wait_for_lock_pid "$root")"
  [[ -n "$pid" ]] || { echo "FAIL: daemon pid missing"; exit 1; }

  press_status_item "$pid"
  ./aos show wait \
    --id "$canvas_id" \
    --manifest runtime-lifecycle-timeout-smoke \
    --js 'document.body.dataset.ready === "1"' \
    --timeout 5s >/dev/null

  case "$prefix" in
    *exit*)
      press_status_item "$pid"
      sleep 1.5
      local state_file="$root/state.json"
      assert_canvas_state "$canvas_id" true "$state_file"
      assert_received_count "$canvas_id" "$state_file" "received_lifecycle_exit" 1
      press_status_item "$pid"
      sleep 2.0
      assert_canvas_state "$canvas_id" false "$state_file"
      assert_received_count "$canvas_id" "$state_file" "received_lifecycle_enter" 1
      ;;
    *enter*)
      press_status_item "$pid"
      local state_file="$root/state.json"
      for _ in $(seq 1 30); do
        if canvas_is_suspended "$canvas_id" "$state_file"; then
          break
        fi
        sleep 0.1
      done
      assert_received_count "$canvas_id" "$state_file" "received_lifecycle_exit" 1

      press_status_item "$pid"
      sleep 2.4
      assert_canvas_state "$canvas_id" false "$state_file"
      assert_received_count "$canvas_id" "$state_file" "received_lifecycle_enter" 1
      press_status_item "$pid"
      sleep 0.4
      assert_canvas_state "$canvas_id" true "$state_file"
      assert_received_count "$canvas_id" "$state_file" "received_lifecycle_exit" 2
      ;;
    *)
      echo "FAIL: unknown case prefix $prefix"
      exit 1
      ;;
  esac
)

run_case \
  "aos-status-item-exit-timeout" \
  "status-timeout-exit" \
  'aos://toolkit/runtime/_smoke/lifecycle-timeout.html?ack_exit=0&ack_enter=1'

run_case \
  "aos-status-item-enter-timeout" \
  "status-timeout-enter" \
  'aos://toolkit/runtime/_smoke/lifecycle-timeout.html?ack_exit=1&ack_enter=0'
