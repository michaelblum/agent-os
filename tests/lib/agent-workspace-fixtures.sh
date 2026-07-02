#!/usr/bin/env bash

agent_workspace_test_setup() {
    ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    cd "$ROOT"

    FIX="$ROOT/tests/browser/fixtures"
    export PATH="$FIX:$PATH"
    export FAKE_PWCLI_VERSION="0.9.9"
    export FAKE_PWCLI_MODE="new"
    export AOS_RUNTIME_MODE="repo"
    export AOS_STATE_ROOT="$(mktemp -d)"

    TMP_DIR="$AOS_STATE_ROOT/test-output"
    mkdir -p "$TMP_DIR"
    trap 'rm -rf "$AOS_STATE_ROOT"' EXIT
}

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

expect_error_code() {
    local expected="$1"
    local err_file="$2"
    jq -e --arg code "$expected" '.code == $code' "$err_file" >/dev/null \
        || fail "expected error code $expected, got: $(cat "$err_file")"
}

expect_command_error_code() {
    local expected="$1"
    local label="$2"
    shift 2
    local out_file="$TMP_DIR/$label.out"
    local err_file="$TMP_DIR/$label.err"
    if "$@" >"$out_file" 2>"$err_file"; then
        fail "$label unexpectedly succeeded"
    fi
    expect_error_code "$expected" "$err_file"
}

expect_corrupt_state() {
    local expected_path="$1"
    local err_file="$2"
    expect_error_code "AGENT_WORKSPACE_STATE_CORRUPT" "$err_file"
    jq -e --arg path "$expected_path" '.path == $path or (.error | contains($path))' "$err_file" >/dev/null \
        || fail "corrupt-state error did not include path $expected_path: $(cat "$err_file")"
}

with_corrupt_file() {
    local file="$1"
    shift
    local backup="$file.bak-test"
    cp "$file" "$backup"
    printf '{' >"$file"
    if "$@" >"$TMP_DIR/corrupt.out" 2>"$TMP_DIR/corrupt.err"; then
        mv "$backup" "$file"
        fail "corrupt state unexpectedly succeeded for $file"
    fi
    expect_corrupt_state "$file" "$TMP_DIR/corrupt.err"
    [[ "$(cat "$file")" == "{" ]] || {
        mv "$backup" "$file"
        fail "corrupt state file was rewritten: $file"
    }
    mv "$backup" "$file"
}

validate_agent_workspace_schema() {
    python3 - shared/schemas/aos-agent-workspace-v0.schema.json "$@" <<'PY'
import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
for instance_path in sys.argv[2:]:
    instance = json.loads(Path(instance_path).read_text(encoding="utf-8"))
    errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.path))
    if errors:
        print(f"{instance_path}: {errors[0].message}", file=sys.stderr)
        sys.exit(1)
PY
}

expect_agent_workspace_schema_rejects() {
    local instance_path="$1"
    if python3 - shared/schemas/aos-agent-workspace-v0.schema.json "$instance_path" <<'PY'
import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
instance = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda error: list(error.path))
sys.exit(0 if not errors else 1)
PY
    then
        fail "schema accepted invalid instance: $instance_path"
    fi
}

write_failing_capture_aos() {
    local file="$1"
    cat >"$file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    echo "primitive exploded" >&2
    exit 7
fi

echo "unexpected failing aos invocation: $*" >&2
exit 2
SH
    chmod +x "$file"
}

write_fake_form_aos() {
    local file="$1"
    cat >"$file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    if [[ "${FORM_STALE:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_form_fixture_stale",
  "files": [],
  "elements": [
    {
      "ref": "e43",
      "role": "textbox",
      "title": "Search",
      "enabled": true,
      "context_path": ["browser:form"]
    }
  ]
}
JSON
        exit 0
    fi
    if [[ "${FORM_AMBIGUOUS:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_form_fixture_ambiguous",
  "files": [],
  "elements": [
    {
      "ref": "e42",
      "role": "textbox",
      "title": "Search",
      "label": "Search field",
      "enabled": true,
      "context_path": ["browser:form"]
    },
    {
      "ref": "e42",
      "role": "textbox",
      "title": "Search",
      "label": "Search field",
      "enabled": true,
      "context_path": ["browser:form", "duplicate"]
    }
  ]
}
JSON
        exit 0
    fi
    role="textbox"
    title="Search"
    label="Search field"
    enabled="true"
    context='["browser:form"]'
    if [[ "${FORM_ROLE_DRIFT:-0}" == "1" ]]; then role="button"; fi
    if [[ "${FORM_TITLE_DRIFT:-0}" == "1" ]]; then title="Find"; fi
    if [[ "${FORM_LABEL_DRIFT:-0}" == "1" ]]; then label="Find field"; fi
    if [[ "${FORM_DISABLED:-0}" == "1" ]]; then enabled="false"; fi
    if [[ "${FORM_CONTEXT_DRIFT:-0}" == "1" ]]; then context='["browser:form","search-panel"]'; fi
    python3 - "$role" "$title" "$label" "$enabled" "$context" <<'PY'
import json
import sys

print(json.dumps({
    "status": "success",
    "state_id": "see_form_fixture",
    "files": [],
    "elements": [{
        "ref": "e42",
        "role": sys.argv[1],
        "title": sys.argv[2],
        "label": sys.argv[3],
        "enabled": sys.argv[4] == "true",
        "context_path": json.loads(sys.argv[5]),
    }],
}))
PY
    exit 0
fi

if [[ "${1:-}" == "do" && "${2:-}" == "fill" && "${3:-}" == "browser:form/e42" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

print(json.dumps({
    "status": "success",
    "execution": {"backend": "playwright", "strategy": "fake_form_fill"},
    "received": sys.argv[1:],
}))
PY
    exit 0
fi

if [[ "${1:-}" == "do" && "${2:-}" == "click" && "${3:-}" == "browser:form/e42" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

print(json.dumps({
    "status": "success",
    "execution": {"backend": "playwright", "strategy": "fake_form_click"},
    "received": sys.argv[1:],
}))
PY
    exit 0
fi

echo "unexpected fake form aos invocation: $*" >&2
exit 2
SH
    chmod +x "$file"
}

write_non_click_ref_literal_aos() {
    local file="$1"
    cat >"$file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__do" && "${2:-}" == "type" && "${3:-}" == "ref:literal" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

print(json.dumps({
    "status": "success",
    "received": sys.argv[1:],
}))
PY
    exit 0
fi

echo "unexpected non-click aos invocation: $*" >&2
exit 2
SH
    chmod +x "$file"
}

write_fake_native_aos() {
    local file="$1"
    cat >"$file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    cat <<'JSON'
{
  "status": "success",
  "state_id": "see_native_fixture",
  "files": [],
  "elements": [
    {
      "role": "AXButton",
      "title": "Install",
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    }
  ]
}
JSON
    exit 0
fi

echo "unexpected fake aos invocation: $*" >&2
exit 2
SH
    chmod +x "$file"
}

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

echo "unexpected fake canvas aos invocation: $*" >&2
exit 2
SH
    chmod +x "$file"
}
