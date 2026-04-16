#!/usr/bin/env bash

aos_test_list_temp_roots() {
  local prefix="$1"
  find "${TMPDIR:-/tmp}" -maxdepth 1 -type d -name "${prefix}.*" -print 2>/dev/null | sort
}

aos_test_lock_pid() {
  local root="$1"
  local mode="${2:-repo}"
  python3 - "$root" "$mode" <<'PY'
import json, pathlib, sys

root = pathlib.Path(sys.argv[1])
mode = sys.argv[2]
lock = root / mode / "daemon.lock"
if not lock.exists():
    raise SystemExit(0)
try:
    payload = json.loads(lock.read_text())
except Exception:
    raise SystemExit(0)
pid = payload.get("pid")
if pid is not None:
    print(pid)
PY
}

aos_test_pids_for_root() {
  local root="$1"
  python3 - "$root" <<'PY'
import subprocess, sys

root = sys.argv[1]
out = subprocess.check_output(["ps", "eww", "-Ao", "pid=,command="], text=True)
for line in out.splitlines():
    line = line.strip()
    if not line or "aos serve" not in line or f"AOS_STATE_ROOT={root}" not in line:
        continue
    pid = line.split(None, 1)[0]
    print(pid)
PY
}

aos_test_terminate_pid() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  kill -9 "$pid" 2>/dev/null || true
}

aos_test_kill_root() {
  local root="$1"
  local pid

  pid="$(aos_test_lock_pid "$root")"
  if [[ -n "$pid" ]]; then
    aos_test_terminate_pid "$pid"
  fi

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    aos_test_terminate_pid "$pid"
  done < <(aos_test_pids_for_root "$root")
}

aos_test_cleanup_prefix() {
  local prefix="$1"
  local root

  while IFS= read -r root; do
    [[ -n "$root" ]] || continue
    aos_test_kill_root "$root"
    rm -rf "$root"
  done < <(aos_test_list_temp_roots "$prefix")
}

aos_test_wait_for_lock_pid() {
  local root="$1"
  local mode="${2:-repo}"
  for _ in $(seq 1 50); do
    local pid
    pid="$(aos_test_lock_pid "$root" "$mode")"
    if [[ -n "$pid" ]]; then
      echo "$pid"
      return 0
    fi
    sleep 0.1
  done
  return 1
}

aos_test_socket_path() {
  local root="$1"
  local mode="${2:-repo}"
  printf '%s/%s/sock\n' "$root" "$mode"
}

aos_test_socket_reachable() {
  local root="$1"
  local mode="${2:-repo}"
  python3 - "$root" "$mode" <<'PY'
import pathlib, socket, sys

root = pathlib.Path(sys.argv[1])
mode = sys.argv[2]
sock_path = root / mode / "sock"
if not sock_path.exists():
    raise SystemExit(1)

sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.settimeout(0.2)
try:
    sock.connect(str(sock_path))
except OSError:
    raise SystemExit(1)
finally:
    try:
        sock.close()
    except OSError:
        pass
PY
}

aos_test_wait_for_socket() {
  local root="$1"
  local mode="${2:-repo}"
  for _ in $(seq 1 50); do
    if aos_test_socket_reachable "$root" "$mode"; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}
