#!/usr/bin/env bash
# ops-contract.sh — verify source-backed ops recipe contracts.

set -euo pipefail

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILS=$((FAILS + 1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- 1. Schema files are valid and fixtures validate/fail as expected. ---
if python3 - <<'PY'
import json
import pathlib
import sys
import jsonschema

root = pathlib.Path(".")
schemas = [
    "shared/schemas/ops-assertion.schema.json",
    "shared/schemas/ops-recipe.schema.json",
    "shared/schemas/ops-result.schema.json",
]
for path in schemas:
    with (root / path).open() as f:
        jsonschema.Draft202012Validator.check_schema(json.load(f))

with (root / "shared/schemas/ops-recipe.schema.json").open() as f:
    recipe_schema = json.load(f)
validator = jsonschema.Draft202012Validator(recipe_schema)
valid_recipes = [
    "recipes/runtime/status-snapshot.json",
    "recipes/canvas/window-level-smoke.json",
]
for recipe_path in valid_recipes:
    with (root / recipe_path).open() as f:
        valid = json.load(f)
    validator.validate(valid)
invalid_allow_many = json.loads(json.dumps(valid))
invalid_allow_many["steps"][0]["assertions"][0]["allow_many"] = True
try:
    validator.validate(invalid_allow_many)
except jsonschema.ValidationError:
    pass
else:
    raise SystemExit("allow_many unexpectedly validated")
with (root / "tests/fixtures/ops/invalid/missing-command.json").open() as f:
    invalid = json.load(f)
try:
    validator.validate(invalid)
except jsonschema.ValidationError:
    pass
else:
    raise SystemExit("invalid missing-command fixture unexpectedly validated")
PY
then
    pass "ops schemas and fixtures validate"
else
    fail "ops schemas or fixtures failed validation"
fi

# --- 2. Registry drift guard: show create --scope default matches daemon. ---
if OUT="$(./aos help show create --json 2>/dev/null)" python3 - <<'PY'
import json
import os

cmd = json.loads(os.environ["OUT"])
form = next(f for f in cmd["forms"] if f["id"] == "show-create")
scope = next(a for a in form["args"] if a.get("id") == "scope")
assert scope.get("default_value") == "global", scope
PY
then
    pass "show create scope registry default is global"
else
    fail "show create scope registry default drifted"
fi

# --- 3. ops list discovers the source recipe. ---
OUT="$(./aos ops list --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert any(r["id"] == "runtime/status-snapshot" for r in data["recipes"]), data
assert any(r["id"] == "canvas/window-level-smoke" for r in data["recipes"]), data
PY
then
    pass "ops list discovers source recipes"
else
    fail "ops list did not discover source recipes"
fi

# --- 4. ops explain exposes the fully qualified command ref. ---
OUT="$(./aos ops explain runtime/status-snapshot --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
step = data["steps"][0]
assert step["command"]["path"] == ["status"], step
assert step["command"]["form_id"] == "status", step
assert step["mutates"] is False, step
PY
then
    pass "ops explain reports status command ref"
else
    fail "ops explain contract failed"
fi

# --- 5. ops dry-run is static and side-effect-free. ---
OUT="$(./aos ops dry-run runtime/status-snapshot --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
assert data["status"] == "dry_run", data
assert data["code"] == "OK", data
assert data["dry_run"] is True, data
assert data["steps"][0]["status"] == "planned", data
assert data["steps"][0]["would_run"] is True, data
PY
then
    pass "ops dry-run emits static plan"
else
    fail "ops dry-run contract failed"
fi

# --- 6. mutating recipe dry-run exposes owned resources without creating them. ---
OUT="$(./aos ops dry-run canvas/window-level-smoke --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
assert data["status"] == "dry_run", data
assert data["mutated_resources"], data
resource = data["mutated_resources"][0]
assert resource["id"] == "ops-dry-run-window-level-smoke", resource
assert resource["cleanup_status"] == "planned", resource
assert any(step["finally"] for step in data["steps"]), data
assert all("dry-run" in " ".join(step["argv"]) or not step["mutates"] for step in data["steps"] if step["id"] != "inspect-canvas"), data
PY
then
    EXISTS="$(./aos show exists --id ops-dry-run-window-level-smoke 2>/dev/null)"
    if EXISTS="$EXISTS" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["EXISTS"])
assert data["exists"] is False, data
PY
    then
        pass "ops dry-run reports owned resources without side effects"
    else
        fail "mutating dry-run created its planned canvas"
    fi
else
    fail "mutating dry-run contract failed"
fi

# --- 7. dry-run default output is text, matching the registry. ---
OUT="$(./aos ops dry-run runtime/status-snapshot 2>/dev/null)"
if [[ "$OUT" != \{* ]] && echo "$OUT" | grep -q 'dry-run runtime/status-snapshot'; then
    pass "ops dry-run default output is text"
else
    fail "ops dry-run default output mismatch: $OUT"
fi

# --- 8. run default output is text, matching the registry. ---
OUT="$(./aos ops run runtime/status-snapshot 2>/dev/null)"
if [[ "$OUT" != \{* ]] && echo "$OUT" | grep -q 'success runtime/status-snapshot'; then
    pass "ops run default output is text"
else
    fail "ops run default output mismatch: $OUT"
fi

# --- 9. duplicate recipe IDs are rejected. ---
mkdir -p "$TMP/dup-a" "$TMP/dup-b"
cp recipes/runtime/status-snapshot.json "$TMP/dup-a/status-a.json"
cp recipes/runtime/status-snapshot.json "$TMP/dup-b/status-b.json"
if ERR="$(AOS_OPS_RECIPE_ROOTS="$TMP/dup-a:$TMP/dup-b" ./aos ops list --json 2>&1 >/dev/null)"; then
    fail "duplicate recipe IDs should fail"
elif echo "$ERR" | grep -q '"code" : "DUPLICATE_RECIPE_ID"'; then
    pass "duplicate recipe IDs are rejected"
else
    fail "duplicate recipe ID error code mismatch: $ERR"
fi

# --- 10. invalid recipe explain fails before execution. ---
if ERR="$(AOS_OPS_RECIPE_ROOTS="tests/fixtures/ops/invalid" ./aos ops explain fixture/missing-command --json 2>&1 >/dev/null)"; then
    fail "invalid recipe should fail explain"
elif echo "$ERR" | grep -q '"code" : "INVALID_RECIPE"'; then
    pass "invalid recipe is rejected during explanation"
else
    fail "invalid recipe error code mismatch: $ERR"
fi

# --- 11. installed-mode index discovery does not need source roots. ---
scripts/generate-ops-recipe-index "$PWD" "$TMP/recipes-index.json"
OUT="$(AOS_RUNTIME_MODE=installed AOS_OPS_RECIPE_INDEX="$TMP/recipes-index.json" ./aos ops list --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
assert any(r["id"] == "runtime/status-snapshot" for r in data["recipes"]), data
assert any(r["id"] == "canvas/window-level-smoke" for r in data["recipes"]), data
assert any(r["source_kind"] == "repo" for r in data["recipes"]), data
PY
then
    pass "installed-mode recipe index discovery works"
else
    fail "installed-mode recipe index discovery failed"
fi

# --- 12. missing recipes follow stderr/exit-code failure contract. ---
if ERR="$(./aos ops dry-run runtime/not-here --json 2>&1 >/dev/null)"; then
    fail "missing recipe dry-run should fail"
elif echo "$ERR" | grep -q '"code" : "RECIPE_NOT_FOUND"'; then
    pass "missing recipe dry-run returns RECIPE_NOT_FOUND on stderr"
else
    fail "missing recipe error code mismatch: $ERR"
fi

# --- 13. ops run executes the first read-only recipe and matches result schema. ---
OUT="$(./aos ops run runtime/status-snapshot --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
import pathlib
import jsonschema

data = json.loads(os.environ["OUT"])
with pathlib.Path("shared/schemas/ops-result.schema.json").open() as f:
    schema = json.load(f)
jsonschema.Draft202012Validator(schema).validate(data)
assert data["status"] == "success", data
assert data["code"] == "OK", data
assert data["dry_run"] is False, data
assert data["steps"][0]["status"] == "success", data
assert data["mutated_resources"] == [], data
PY
then
    pass "ops run executes read-only status recipe"
else
    fail "ops run read-only recipe failed"
fi

# --- 14. ops run drains large stdout without deadlocking on full pipes. ---
mkdir -p "$TMP/large"
cat >"$TMP/large/help-snapshot.json" <<'JSON'
{
  "id": "fixture/help-snapshot",
  "version": 1,
  "summary": "Read the full help registry as a large-output fixture.",
  "scope": "source",
  "mutates": false,
  "steps": [
    {
      "id": "help-json",
      "command": {
        "path": ["help"],
        "form_id": "help-full"
      },
      "argv": ["--json"],
      "timeout_ms": 10000,
      "mutates": false,
      "assertions": [
        {
          "path": ["commands"],
          "exists": true
        }
      ]
    }
  ]
}
JSON
OUT="$(AOS_OPS_RECIPE_ROOTS="$TMP/large" ./aos ops run fixture/help-snapshot --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["steps"][0]["status"] == "success", data
observed = data["steps"][0]["observed"]
assert "stdout_json" in observed, observed
PY
then
    pass "ops run drains large child stdout"
else
    fail "ops run large-output fixture failed"
fi

# --- 15. ops run executes a mutating canvas smoke and cleans up owned resources. ---
OUT="$(./aos ops run canvas/window-level-smoke --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
import pathlib
import jsonschema

data = json.loads(os.environ["OUT"])
with pathlib.Path("shared/schemas/ops-result.schema.json").open() as f:
    schema = json.load(f)
jsonschema.Draft202012Validator(schema).validate(data)
assert data["status"] == "success", data
assert data["cleanup"]["status"] == "success", data
assert data["mutated_resources"][0]["cleanup_status"] == "success", data
assert data["steps"][0]["argv"][2].startswith("ops-"), data["steps"][0]
assert data["steps"][0]["argv"][2].endswith("-window-level-smoke"), data["steps"][0]
assert data["cleanup"]["steps"][0]["status"] == "success", data
PY
then
    pass "ops run executes mutating canvas smoke with cleanup"
else
    fail "mutating canvas smoke failed"
fi

if OUT="$(./aos show list 2>/dev/null)" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
leaks = [c["id"] for c in data.get("canvases", []) if c.get("id", "").startswith("ops-") and c.get("id", "").endswith("-window-level-smoke")]
assert not leaks, leaks
PY
then
    pass "mutating canvas smoke leaves no owned canvas"
else
    fail "mutating canvas smoke leaked an owned canvas"
fi

# --- 16. assertion failure still runs owned cleanup. ---
mkdir -p "$TMP/assertion-cleanup"
cat >"$TMP/assertion-cleanup/assertion-cleanup.json" <<'JSON'
{
  "id": "fixture/assertion-cleanup",
  "version": 1,
  "summary": "Create a canvas, fail an assertion, and verify cleanup.",
  "scope": "source",
  "mutates": true,
  "resources": {
    "canvas_id": "ops-test-${run_id}-assertion-cleanup"
  },
  "owned_resources": [
    {
      "name": "canvas",
      "type": "canvas",
      "id": "${resources.canvas_id}",
      "ttl_seconds": 30
    }
  ],
  "steps": [
    {
      "id": "create-canvas",
      "command": { "path": ["show"], "form_id": "show-create" },
      "argv": ["create", "--id", "${resources.canvas_id}", "--at", "-10000,-10000,80,60", "--html", "<html><body>ops</body></html>", "--ttl", "30s", "--scope", "global"],
      "timeout_ms": 10000,
      "mutates": true,
      "assertions": [{ "path": ["status"], "equals": "success" }]
    },
    {
      "id": "fail-inspection",
      "command": { "path": ["show"], "form_id": "show-list" },
      "argv": ["list"],
      "timeout_ms": 10000,
      "mutates": false,
      "assertions": [
        {
          "select": { "path": ["canvases"], "where": { "id": "${resources.canvas_id}" } },
          "field": ["windowLevel"],
          "equals": "screen_saver"
        }
      ]
    },
    {
      "id": "remove-canvas",
      "command": { "path": ["show"], "form_id": "show-remove" },
      "argv": ["remove", "--id", "${resources.canvas_id}"],
      "timeout_ms": 10000,
      "mutates": true,
      "finally": true,
      "cleanup_resources": ["canvas"],
      "assertions": [{ "path": ["status"], "equals": "success" }]
    }
  ]
}
JSON
if ERR="$(AOS_OPS_RECIPE_ROOTS="$TMP/assertion-cleanup" ./aos ops run fixture/assertion-cleanup --json 2>&1 >/dev/null)"; then
    fail "assertion cleanup fixture should fail"
elif ERR="$ERR" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["ERR"])
assert data["status"] == "failure", data
assert data["code"] == "ASSERTION_FAILED", data
assert data["cleanup"]["status"] == "success", data
assert data["mutated_resources"][0]["cleanup_status"] == "success", data
PY
then
    pass "ops run cleans up after assertion failure"
else
    fail "assertion cleanup result mismatch: $ERR"
fi

# --- 17. cleanup failure emits CLEANUP_FAILED with non-zero stderr JSON. ---
mkdir -p "$TMP/cleanup-failed"
cat >"$TMP/cleanup-failed/cleanup-failed.json" <<'JSON'
{
  "id": "fixture/cleanup-failed",
  "version": 1,
  "summary": "Force cleanup failure by removing the owned canvas before finally.",
  "scope": "source",
  "mutates": true,
  "resources": {
    "canvas_id": "ops-test-${run_id}-cleanup-failed"
  },
  "owned_resources": [
    {
      "name": "canvas",
      "type": "canvas",
      "id": "${resources.canvas_id}",
      "ttl_seconds": 30
    }
  ],
  "steps": [
    {
      "id": "create-canvas",
      "command": { "path": ["show"], "form_id": "show-create" },
      "argv": ["create", "--id", "${resources.canvas_id}", "--at", "-10000,-10000,80,60", "--html", "<html><body>ops</body></html>", "--ttl", "30s", "--scope", "global"],
      "timeout_ms": 10000,
      "mutates": true,
      "assertions": [{ "path": ["status"], "equals": "success" }]
    },
    {
      "id": "remove-before-cleanup",
      "command": { "path": ["show"], "form_id": "show-remove" },
      "argv": ["remove", "--id", "${resources.canvas_id}"],
      "timeout_ms": 10000,
      "mutates": true,
      "assertions": [{ "path": ["status"], "equals": "success" }]
    },
    {
      "id": "remove-canvas",
      "command": { "path": ["show"], "form_id": "show-remove" },
      "argv": ["remove", "--id", "${resources.canvas_id}"],
      "timeout_ms": 10000,
      "mutates": true,
      "finally": true,
      "cleanup_resources": ["canvas"],
      "assertions": [{ "path": ["status"], "equals": "success" }]
    }
  ]
}
JSON
if ERR="$(AOS_OPS_RECIPE_ROOTS="$TMP/cleanup-failed" ./aos ops run fixture/cleanup-failed --json 2>&1 >/dev/null)"; then
    fail "cleanup-failed fixture should fail"
elif ERR="$ERR" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["ERR"])
assert data["status"] == "partial", data
assert data["code"] == "CLEANUP_FAILED", data
assert data["cleanup"]["status"] == "failed", data
assert data["mutated_resources"][0]["cleanup_status"] == "failed", data
PY
then
    pass "ops run reports cleanup failure"
else
    fail "cleanup failure result mismatch: $ERR"
fi

# --- 18. timeout failure still runs owned cleanup. ---
mkdir -p "$TMP/timeout-cleanup"
cat >"$TMP/timeout-cleanup/timeout-cleanup.json" <<'JSON'
{
  "id": "fixture/timeout-cleanup",
  "version": 1,
  "summary": "Create a canvas, force a step timeout, and verify cleanup.",
  "scope": "source",
  "mutates": true,
  "resources": {
    "canvas_id": "ops-test-${run_id}-timeout-cleanup"
  },
  "owned_resources": [
    {
      "name": "canvas",
      "type": "canvas",
      "id": "${resources.canvas_id}",
      "ttl_seconds": 30
    }
  ],
  "steps": [
    {
      "id": "create-canvas",
      "command": { "path": ["show"], "form_id": "show-create" },
      "argv": ["create", "--id", "${resources.canvas_id}", "--at", "-10000,-10000,80,60", "--html", "<html><body>ops</body></html>", "--ttl", "30s", "--scope", "global"],
      "timeout_ms": 10000,
      "mutates": true,
      "assertions": [{ "path": ["status"], "equals": "success" }]
    },
    {
      "id": "wait-timeout",
      "command": { "path": ["show"], "form_id": "show-wait" },
      "argv": ["wait", "--id", "${resources.canvas_id}", "--timeout", "5s", "--json"],
      "timeout_ms": 10,
      "mutates": false
    },
    {
      "id": "remove-canvas",
      "command": { "path": ["show"], "form_id": "show-remove" },
      "argv": ["remove", "--id", "${resources.canvas_id}"],
      "timeout_ms": 10000,
      "mutates": true,
      "finally": true,
      "cleanup_resources": ["canvas"],
      "assertions": [{ "path": ["status"], "equals": "success" }]
    }
  ]
}
JSON
if ERR="$(AOS_OPS_RECIPE_ROOTS="$TMP/timeout-cleanup" ./aos ops run fixture/timeout-cleanup --json 2>&1 >/dev/null)"; then
    fail "timeout cleanup fixture should fail"
elif ERR="$ERR" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["ERR"])
assert data["status"] == "failure", data
assert data["code"] == "TIMEOUT", data
assert data["cleanup"]["status"] == "success", data
assert data["steps"][-1]["status"] == "timeout", data
PY
then
    pass "ops run cleans up after timeout"
else
    fail "timeout cleanup result mismatch: $ERR"
fi

if OUT="$(./aos show list 2>/dev/null)" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
leaks = [c["id"] for c in data.get("canvases", []) if c.get("id", "").startswith("ops-test-")]
assert not leaks, leaks
PY
then
    pass "failure fixtures leave no owned test canvases"
else
    fail "failure fixtures leaked owned test canvases"
fi

echo
if [ "$FAILS" -eq 0 ]; then
    echo "ops-contract: all checks passed"
    exit 0
else
    echo "ops-contract: $FAILS failure(s)"
    exit 1
fi
