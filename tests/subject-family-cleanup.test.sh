#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/subject-family-cleanup.sh"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

state="$tmpdir/canvases.json"
cat >"$state" <<'JSON'
{
  "canvases": [
    {"id": "surface-inspector"},
    {"id": "subject-root"},
    {"id": "subject-child", "parent": "subject-root", "cascade": true},
    {"id": "subject-grandchild", "parent": "subject-child", "cascade": true},
    {"id": "subject-orphan", "parent": "subject-root", "cascade": false}
  ]
}
JSON

fake_aos="$tmpdir/aos"
cat >"$fake_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

python3 - "$AOS_FAKE_CANVAS_STATE" "$@" <<'PY'
import json
from pathlib import Path
import sys

state_path = Path(sys.argv[1])
args = sys.argv[2:]
payload = json.loads(state_path.read_text())

if args == ["show", "list", "--json"]:
    print(json.dumps(payload, sort_keys=True))
    raise SystemExit(0)

if len(args) == 4 and args[:3] == ["show", "remove", "--id"]:
    root_id = args[3]
    canvases = payload.get("canvases", [])
    children = {}
    for canvas in canvases:
        parent = canvas.get("parent") or canvas.get("parent_id")
        if parent:
            children.setdefault(parent, []).append(canvas)

    removed = set()
    def retire(canvas_id):
        removed.add(canvas_id)
        for child in children.get(canvas_id, []):
            if child.get("cascade") is False:
                child.pop("parent", None)
                child.pop("parent_id", None)
            else:
                retire(child["id"])

    retire(root_id)
    payload["canvases"] = [canvas for canvas in canvases if canvas.get("id") not in removed]
    state_path.write_text(json.dumps(payload, sort_keys=True))
    print(json.dumps({"removed": root_id}, sort_keys=True))
    raise SystemExit(0)

print(f"unexpected fake aos invocation: {args}", file=sys.stderr)
raise SystemExit(2)
PY
SH
chmod +x "$fake_aos"

export AOS="$fake_aos"
export AOS_FAKE_CANVAS_STATE="$state"

first="$(aos_cleanup_subject_family subject-root)"
second="$(aos_cleanup_subject_family subject-root)"

python3 - "$first" "$second" "$state" <<'PY'
import json
from pathlib import Path
import sys

first = json.loads(sys.argv[1])
second = json.loads(sys.argv[2])
state = json.loads(Path(sys.argv[3]).read_text())

assert first["rootPresentBeforeCleanup"] is True, first
assert first["removed"] == ["subject-root", "subject-child", "subject-grandchild"], first
assert first["orphaned"] == ["subject-orphan"], first
assert first["preserved"] == ["surface-inspector", "subject-orphan"], first
assert first["errors"] == [], first
assert second["rootPresentBeforeCleanup"] is False, second
assert second["removed"] == [], second
assert second["errors"] == [], second

remaining = {canvas["id"]: canvas for canvas in state["canvases"]}
assert sorted(remaining) == ["subject-orphan", "surface-inspector"], remaining
assert "parent" not in remaining["subject-orphan"], remaining
PY

echo "PASS: generic subject-family cleanup is exact and idempotent."
