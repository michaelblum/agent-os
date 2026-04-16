#!/usr/bin/env bash
set -euo pipefail

if ! python3 - <<'PY'
import json, subprocess
perms = json.loads(subprocess.check_output(["./aos", "permissions", "check", "--json"], text=True)).get("permissions", {})
raise SystemExit(0 if perms.get("screen_recording") else 1)
PY
then
  echo "SKIP: requires screen recording"
  exit 0
fi

ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aos-parallel-capture.XXXXXX")"
trap 'rm -rf "$ARTIFACT_DIR"' EXIT

python3 - "$ARTIFACT_DIR" <<'PY'
import json
import pathlib
import subprocess
import sys
import time

artifact_dir = pathlib.Path(sys.argv[1])
commands = []
for index in (1, 2):
    png = artifact_dir / f"capture-{index}.png"
    commands.append(
        subprocess.Popen(
            ["./aos", "see", "capture", "--region", "0,0,40,40", "--out", str(png)],
            cwd="/Users/Michael/Code/agent-os",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    )

deadline = time.time() + 20
while time.time() < deadline and any(proc.poll() is None for proc in commands):
    time.sleep(0.1)

if any(proc.poll() is None for proc in commands):
    for proc in commands:
        if proc.poll() is None:
            proc.terminate()
    time.sleep(1)
    for proc in commands:
        if proc.poll() is None:
            proc.kill()
    raise SystemExit("FAIL: concurrent captures did not finish within 20s")

for index, proc in enumerate(commands, start=1):
    stdout, stderr = proc.communicate(timeout=2)
    if proc.returncode != 0:
        raise SystemExit(f"FAIL: capture {index} exited {proc.returncode}\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}")
    payload = json.loads(stdout)
    files = payload.get("files") or []
    if len(files) != 1:
        raise SystemExit(f"FAIL: capture {index} returned unexpected payload\n{stdout}")
    png = artifact_dir / f"capture-{index}.png"
    if pathlib.Path(files[0]).resolve() != png.resolve() or not png.exists():
        raise SystemExit(f"FAIL: capture {index} did not write expected file {png}")

print("PASS")
PY
