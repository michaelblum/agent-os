write_fake_mixed_support_aos() {
    local file="$1"
    cat >"$file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    cat <<'JSON'
{
  "status": "success",
  "state_id": "see_mixed_support_fixture",
  "files": [],
  "semantic_targets": [
    {
      "ref": "focus-only",
      "surface": "fixture-panel",
      "role": "button",
      "name": "Focus only",
      "enabled": true,
      "actions": ["focus"],
      "provenance": {
        "canvas_id": "canvas-fixture",
        "do_target": "canvas:canvas-fixture/focus-only"
      }
    },
    {
      "ref": "apply-button",
      "surface": "fixture-panel",
      "role": "button",
      "name": "Apply",
      "enabled": true,
      "actions": ["click"],
      "provenance": {
        "canvas_id": "canvas-fixture",
        "do_target": "canvas:canvas-fixture/apply-button"
      }
    }
  ]
}
JSON
    exit 0
fi

echo "unexpected fake mixed-support aos invocation: $*" >&2
exit 2
SH
    chmod +x "$file"
}
