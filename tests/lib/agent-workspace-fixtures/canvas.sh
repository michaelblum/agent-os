write_fake_canvas_aos() {
    local file="$1"
    cat >"$file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    cat <<'JSON'
{
  "status": "success",
  "state_id": "see_canvas_fixture",
  "files": [],
  "semantic_targets": [
    {
      "ref": "save-button",
      "surface": "fixture-panel",
      "role": "button",
      "name": "Save",
      "enabled": true,
      "actions": ["click", "focus"],
      "target": {
        "target_id": "fixture.save",
        "owner_namespace": {
          "app_id": "fixture",
          "canvas_id": "canvas-fixture",
          "surface_id": "fixture-panel",
          "component_family": "fixture.panel",
          "structural_owner": ["fixture-panel"]
        }
      },
      "provenance": {
        "canvas_id": "canvas-fixture",
        "do_target": "canvas:canvas-fixture/save-button",
        "center": { "x": 20, "y": 30 }
      },
      "reacquisition": {
        "strategy": "owner-structural-fingerprint",
        "machine_fingerprint": {
          "role": "button",
          "structural_path": ["fixture-panel", "save-button"],
          "capabilities": ["click", "focus"]
        }
      }
    },
    {
      "ref": "brightness-slider",
      "surface": "fixture-panel",
      "role": "slider",
      "name": "Brightness",
      "enabled": true,
      "actions": ["set-value", "focus"],
      "target": {
        "target_id": "fixture.brightness",
        "owner_namespace": {
          "app_id": "fixture",
          "canvas_id": "canvas-fixture",
          "surface_id": "fixture-panel",
          "component_family": "fixture.panel",
          "structural_owner": ["fixture-panel"]
        }
      },
      "state": {
        "value": "10",
        "values": [10],
        "min": 0,
        "max": 100,
        "step": 1,
        "orientation": "horizontal",
        "thumb_count": 1
      },
      "provenance": {
        "canvas_id": "canvas-fixture",
        "do_target": "canvas:canvas-fixture/brightness-slider",
        "center": { "x": 80, "y": 30 }
      },
      "reacquisition": {
        "strategy": "owner-structural-fingerprint",
        "machine_fingerprint": {
          "role": "slider",
          "structural_path": ["fixture-panel", "brightness-slider"],
          "capabilities": ["set-value", "focus"]
        }
      }
    }
  ]
}
JSON
    exit 0
fi

if [[ "${1:-}" == "do" && "${2:-}" == "click" && "${3:-}" == "canvas:canvas-fixture/save-button" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

args = sys.argv[1:]
assert "--state-id" in args, args
assert args[args.index("--state-id") + 1] == "see_canvas_fixture", args
print(json.dumps({
    "status": "success",
    "received": args,
    "execution": {
        "backend": "canvas",
        "strategy": "fixture_canvas_click",
        "state_id": "see_canvas_fixture"
    }
}))
PY
    exit 0
fi

if [[ "${1:-}" == "do" && "${2:-}" == "set-value" && "${3:-}" == "canvas:canvas-fixture/brightness-slider" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

args = sys.argv[1:]
assert "--state-id" in args, args
assert args[args.index("--state-id") + 1] == "see_canvas_fixture", args
value = args[args.index("--value") + 1] if "--value" in args else args[3]
print(json.dumps({
    "status": "success",
    "received": args,
    "execution": {
        "backend": "canvas",
        "strategy": "fixture_canvas_set_value",
        "state_id": "see_canvas_fixture"
    },
    "value": value
}))
PY
    exit 0
fi

if [[ "${1:-}" == "__do" && "${2:-}" == "set-value" && "${3:-}" == "canvas:canvas-fixture/brightness-slider" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

print(json.dumps({
    "status": "dry_run_passthrough",
    "received": sys.argv[1:]
}))
PY
    exit 0
fi

if [[ "${1:-}" == "__do" && "${2:-}" == "drag" && "${3:-}" == canvas:* ]]; then
    python3 - "$@" <<'PY'
import json
import sys

print(json.dumps({
    "status": "dry_run_passthrough",
    "received": sys.argv[1:]
}))
PY
    exit 0
fi

echo "unexpected fake canvas aos invocation: $*" >&2
exit 2
SH
    chmod +x "$file"
}
