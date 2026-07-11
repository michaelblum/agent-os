#!/usr/bin/env bash

aos_cleanup_subject_family() {
  local root_id="${1:?root canvas id required}"
  local aos_bin="${AOS:-./aos}"

  python3 - "$aos_bin" "$root_id" <<'PY'
import json
import subprocess
import sys

aos, root_id = sys.argv[1:3]

def run_json(*args):
    try:
        completed = subprocess.run(
            [aos, *args],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=True,
        )
    except subprocess.CalledProcessError as error:
        raise SystemExit("FAIL: cleanup command failed: " + json.dumps({
            "command": [aos, *args],
            "exit": error.returncode,
            "output": (error.stdout or "").strip(),
        }, sort_keys=True)) from error
    try:
        return json.loads(completed.stdout or "{}")
    except Exception as error:
        raise SystemExit("FAIL: cleanup command returned invalid JSON: " + json.dumps({
            "command": [aos, *args],
            "error": str(error),
            "output": completed.stdout,
        }, sort_keys=True)) from error

before = run_json("show", "list", "--json").get("canvases", [])
by_id = {canvas.get("id"): canvas for canvas in before if canvas.get("id")}
children = {}
for canvas in before:
    parent = canvas.get("parent") or canvas.get("parent_id")
    if parent:
        children.setdefault(parent, []).append(canvas)

removed_candidates = []
orphan_candidates = []

def walk(canvas_id):
    canvas = by_id.get(canvas_id)
    if not canvas:
        return
    removed_candidates.append(canvas_id)
    for child in children.get(canvas_id, []):
        child_id = child.get("id")
        if not child_id:
            continue
        if child.get("cascade") is False:
            orphan_candidates.append(child_id)
        else:
            walk(child_id)

walk(root_id)
root_present = root_id in by_id
remove_error = None
if root_present:
    try:
        subprocess.check_output(
            [aos, "show", "remove", "--id", root_id],
            text=True,
            stderr=subprocess.STDOUT,
        )
    except subprocess.CalledProcessError as error:
        remove_error = error.output.strip()

after = run_json("show", "list", "--json").get("canvases", [])
after_by_id = {canvas.get("id"): canvas for canvas in after if canvas.get("id")}

removed = [canvas_id for canvas_id in removed_candidates if canvas_id not in after_by_id]
preserved = [canvas.get("id") for canvas in after if canvas.get("id") not in removed_candidates]
orphaned = [
    canvas_id for canvas_id in orphan_candidates
    if canvas_id in after_by_id and not (after_by_id[canvas_id].get("parent") or after_by_id[canvas_id].get("parent_id"))
]
errors = []
if remove_error:
    errors.append({"kind": "canvas", "id": root_id, "message": remove_error})
for canvas_id in removed_candidates:
    if canvas_id in after_by_id and canvas_id not in orphan_candidates:
        errors.append({"kind": "canvas", "id": canvas_id, "message": "expected removal but canvas remains"})

print(json.dumps({
    "rootCanvasId": root_id,
    "rootPresentBeforeCleanup": root_present,
    "removed": removed,
    "preserved": preserved,
    "orphaned": orphaned,
    "errors": errors,
}, sort_keys=True))
sys.exit(1 if errors else 0)
PY
}
