#!/usr/bin/env bash

agent_workspace_test_setup() {
    ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
    cd "$ROOT"

    FIX="$ROOT/tests/browser/fixtures"
    export PATH="$FIX:$PATH"
    export AOS_PLAYWRIGHT_CLI="$FIX/playwright-cli"
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

assert_no_heavy_capture_payloads() {
    local file="$1"
    local label="$2"

    jq -e '
      [
        .. | objects | to_entries[]?
        | select(
            (
              .key == "elements"
              or .key == "semantic_targets"
              or .key == "perceptions"
              or .key == "annotations"
              or .key == "base64"
              or .key == "base64_artifacts"
            )
            and (.value | type) != "number"
            and (.value | type) != "boolean"
            and .value != null
          )
      ] | length == 0
    ' "$file" >/dev/null || fail "$label leaked heavy capture payload fields: $(cat "$file")"
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
