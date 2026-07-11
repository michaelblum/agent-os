#!/usr/bin/env bash
# recipe-contract.sh — verify source-backed executable recipe contracts.

set -euo pipefail

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILS=$((FAILS + 1)); }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
source "$ROOT/tests/lib/isolated-daemon.sh"
export AOS_STATE_ROOT="$TMP/aos-state"
export AOS_ALLOW_DAEMON_AUTOSTART=1
mkdir -p "$AOS_STATE_ROOT"
cleanup() {
    aos_test_kill_root "$AOS_STATE_ROOT" 2>/dev/null || true
    rm -rf "$TMP"
}
trap cleanup EXIT

show_list_json() {
    local out
    for _ in 1 2 3; do
        if out="$(./aos show list --json 2>/dev/null)" && [ -n "$out" ]; then
            printf '%s\n' "$out"
            return 0
        fi
        /bin/sleep 0.2
    done
    return 1
}

# --- 1. Schema files are valid and fixtures validate/fail as expected. ---
if python3 - <<'PY'
import json
import pathlib
import sys
import jsonschema

root = pathlib.Path(".")
schemas = [
    "shared/schemas/recipe-assertion.schema.json",
    "shared/schemas/recipe.schema.json",
    "shared/schemas/recipe-result.schema.json",
]
for path in schemas:
    with (root / path).open() as f:
        jsonschema.Draft202012Validator.check_schema(json.load(f))

with (root / "shared/schemas/recipe.schema.json").open() as f:
    recipe_schema = json.load(f)
validator = jsonschema.Draft202012Validator(recipe_schema)
valid_recipes = [
    "recipes/runtime/status-snapshot.json",
    "recipes/runtime/clean-restart.json",
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
with (root / "tests/fixtures/recipe/invalid/missing-command.json").open() as f:
    invalid = json.load(f)
try:
    validator.validate(invalid)
except jsonschema.ValidationError:
    pass
else:
    raise SystemExit("invalid missing-command fixture unexpectedly validated")
PY
then
    pass "recipe schemas and fixtures validate"
else
    fail "recipe schemas or fixtures failed validation"
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

# --- 3. recipe list discovers source recipes. ---
OUT="$(./aos recipe list --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert any(r["id"] == "runtime/status-snapshot" for r in data["recipes"]), data
assert any(r["id"] == "runtime/clean-restart" for r in data["recipes"]), data
assert any(r["id"] == "canvas/window-level-smoke" for r in data["recipes"]), data
assert all(not r["id"].startswith("sigil/") for r in data["recipes"]), data
PY
then
    pass "recipe list discovers source recipes"
else
    fail "recipe list did not discover source recipes"
fi

# --- 4. recipe explain exposes typed command and shell blocks. ---
OUT="$(./aos recipe explain runtime/status-snapshot --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
step = data["steps"][0]
assert step["kind"] == "aos_command", step
assert step["command"]["path"] == ["status"], step
assert step["command"]["form_id"] == "status", step
assert step["mutates"] is False, step
PY
then
    pass "recipe explain reports status command ref"
else
    fail "recipe explain command contract failed"
fi

# --- 5. flag-sensitive command metadata classifies saved capture as mutating. ---
mkdir -p "$TMP/flag-sensitive"
cat >"$TMP/flag-sensitive/saved-capture.json" <<'JSON'
{
  "id": "fixture/saved-capture",
  "version": 1,
  "summary": "Planner fixture for flag-sensitive mutability.",
  "scope": "fixture",
  "mutates": false,
  "requires": ["see"],
  "steps": [
    {
      "id": "save-capture",
      "command": {
        "path": ["see"],
        "form_id": "see-capture"
      },
      "argv": ["capture", "main", "--save", "--workspace", "recipe-fixture"],
      "timeout_ms": 10000,
      "assertions": [
        {
          "path": ["status"],
          "equals": "success"
        }
      ]
    }
  ]
}
JSON
OUT="$(AOS_RECIPE_ROOTS="$TMP/flag-sensitive" ./aos recipe explain fixture/saved-capture --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["mutates"] is True, data
step = data["steps"][0]
assert step["command"]["form_id"] == "see-capture", step
assert step["mutates"] is True, step
assert "--save" in step["argv"], step
PY
then
    pass "recipe planner treats see capture --save as mutating"
else
    fail "flag-sensitive saved capture mutability contract failed"
fi

# --- 6. recipe dry-run is static and side-effect-free. ---
OUT="$(./aos recipe dry-run runtime/status-snapshot --json 2>/dev/null)"
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
    pass "recipe dry-run emits static plan"
else
    fail "recipe dry-run contract failed"
fi

# --- 7. mutating recipe dry-run exposes owned resources without creating them. ---
OUT="$(./aos recipe dry-run canvas/window-level-smoke --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
assert data["status"] == "dry_run", data
assert data["mutated_resources"], data
resource = data["mutated_resources"][0]
assert resource["id"] == "recipe-dry-run-window-level-smoke", resource
assert resource["cleanup_status"] == "planned", resource
assert any(step["finally"] for step in data["steps"]), data
assert all("dry-run" in " ".join(step["argv"]) or not step["mutates"] for step in data["steps"] if step["id"] != "inspect-canvas"), data
PY
then
    EXISTS="$(./aos show exists --id recipe-dry-run-window-level-smoke 2>/dev/null)"
    if EXISTS="$EXISTS" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["EXISTS"])
assert data["exists"] is False, data
PY
    then
        pass "recipe dry-run reports owned resources without side effects"
    else
        fail "mutating dry-run created its planned canvas"
    fi
else
    fail "mutating dry-run contract failed"
fi

# --- 8. dry-run default output is text, matching the registry. ---
OUT="$(./aos recipe dry-run runtime/status-snapshot 2>/dev/null)"
if [[ "$OUT" != \{* ]] && echo "$OUT" | grep -q 'dry-run runtime/status-snapshot'; then
    pass "recipe dry-run default output is text"
else
    fail "recipe dry-run default output mismatch: $OUT"
fi

# --- 9. run default output is text, matching the registry. ---
OUT="$(./aos recipe run runtime/status-snapshot 2>/dev/null)"
if [[ "$OUT" != \{* ]] && echo "$OUT" | grep -q 'success runtime/status-snapshot'; then
    pass "recipe run default output is text"
else
    fail "recipe run default output mismatch: $OUT"
fi

# --- 10. duplicate recipe IDs are rejected. ---
mkdir -p "$TMP/dup-a" "$TMP/dup-b"
cp recipes/runtime/status-snapshot.json "$TMP/dup-a/status-a.json"
cp recipes/runtime/status-snapshot.json "$TMP/dup-b/status-b.json"
if ERR="$(AOS_RECIPE_ROOTS="$TMP/dup-a:$TMP/dup-b" ./aos recipe list --json 2>&1 >/dev/null)"; then
    fail "duplicate recipe IDs should fail"
elif echo "$ERR" | grep -q '"code" : "DUPLICATE_RECIPE_ID"'; then
    pass "duplicate recipe IDs are rejected"
else
    fail "duplicate recipe ID error code mismatch: $ERR"
fi

# --- 11. invalid recipe explain fails before execution. ---
if ERR="$(AOS_RECIPE_ROOTS="tests/fixtures/recipe/invalid" ./aos recipe explain fixture/missing-command --json 2>&1 >/dev/null)"; then
    fail "invalid recipe should fail explain"
elif echo "$ERR" | grep -q '"code" : "INVALID_RECIPE"'; then
    pass "invalid recipe is rejected during explanation"
else
    fail "invalid recipe error code mismatch: $ERR"
fi

# --- 12. installed-mode index discovery does not need source roots. ---
scripts/generate-recipe-index "$PWD" "$TMP/recipes-index.json"
OUT="$(AOS_RUNTIME_MODE=installed AOS_RECIPE_INDEX="$TMP/recipes-index.json" ./aos recipe list --json 2>/dev/null)"
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
if ERR="$(./aos recipe dry-run runtime/not-here --json 2>&1 >/dev/null)"; then
    fail "missing recipe dry-run should fail"
elif echo "$ERR" | grep -q '"code" : "RECIPE_NOT_FOUND"'; then
    pass "missing recipe dry-run returns RECIPE_NOT_FOUND on stderr"
else
    fail "missing recipe error code mismatch: $ERR"
fi

# --- 13. recipe run executes the first read-only recipe and matches result schema. ---
OUT="$(./aos recipe run runtime/status-snapshot --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
import pathlib
import jsonschema

data = json.loads(os.environ["OUT"])
with pathlib.Path("shared/schemas/recipe-result.schema.json").open() as f:
    schema = json.load(f)
jsonschema.Draft202012Validator(schema).validate(data)
assert data["status"] == "success", data
assert data["code"] == "OK", data
assert data["dry_run"] is False, data
assert data["steps"][0]["status"] == "success", data
assert data["mutated_resources"] == [], data
PY
then
    pass "recipe run executes read-only status recipe"
else
    fail "recipe run read-only recipe failed"
fi

# --- 14. recipe run drains large stdout without deadlocking on full pipes. ---
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
OUT="$(AOS_RECIPE_ROOTS="$TMP/large" ./aos recipe run fixture/help-snapshot --json 2>/dev/null)"
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
    pass "recipe run drains large child stdout"
else
    fail "recipe run large-output fixture failed"
fi

# --- 15. recipe run executes a mutating canvas smoke and cleans up owned resources. ---
OUT="$(./aos recipe run canvas/window-level-smoke --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
import pathlib
import jsonschema

data = json.loads(os.environ["OUT"])
with pathlib.Path("shared/schemas/recipe-result.schema.json").open() as f:
    schema = json.load(f)
jsonschema.Draft202012Validator(schema).validate(data)
assert data["status"] == "success", data
assert data["cleanup"]["status"] == "success", data
assert data["mutated_resources"][0]["cleanup_status"] == "success", data
assert data["steps"][0]["argv"][2].startswith("recipe-"), data["steps"][0]
assert data["steps"][0]["argv"][2].endswith("-window-level-smoke"), data["steps"][0]
assert data["cleanup"]["steps"][0]["status"] == "success", data
PY
then
    pass "recipe run executes mutating canvas smoke with cleanup"
else
    fail "mutating canvas smoke failed"
fi

if OUT="$(show_list_json)" && OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
leaks = [c["id"] for c in data.get("canvases", []) if c.get("id", "").startswith("recipe-") and c.get("id", "").endswith("-window-level-smoke")]
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
    "canvas_id": "recipe-test-${run_id}-assertion-cleanup"
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
      "argv": ["create", "--id", "${resources.canvas_id}", "--at", "-10000,-10000,80,60", "--html", "<html><body>recipe</body></html>", "--ttl", "30s", "--scope", "global"],
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
if ERR="$(AOS_RECIPE_ROOTS="$TMP/assertion-cleanup" ./aos recipe run fixture/assertion-cleanup --json 2>&1 >/dev/null)"; then
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
    pass "recipe run cleans up after assertion failure"
else
    fail "assertion cleanup result mismatch: $ERR"
fi

# --- 17. cleanup failure emits CLEANUP_FAILED with non-zero stderr JSON. ---
mkdir -p "$TMP/cleanup-failed"
cat >"$TMP/cleanup-failed/cleanup-failed.json" <<'JSON'
{
  "id": "fixture/cleanup-failed",
  "version": 1,
  "summary": "Force cleanup failure after removing the owned canvas.",
  "scope": "source",
  "mutates": true,
  "resources": {
    "canvas_id": "recipe-test-${run_id}-cleanup-failed"
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
      "argv": ["create", "--id", "${resources.canvas_id}", "--at", "-10000,-10000,80,60", "--html", "<html><body>recipe</body></html>", "--ttl", "30s", "--scope", "global"],
      "timeout_ms": 10000,
      "mutates": true,
      "assertions": [{ "path": ["status"], "equals": "success" }]
    },
    {
      "id": "fail-after-remove",
      "kind": "shell",
      "shell": { "script": "tests/fixtures/recipe/fail-after-remove.sh", "cwd": "." },
      "argv": ["${resources.canvas_id}"],
      "timeout_ms": 10000,
      "mutates": true,
      "finally": true,
      "cleanup_resources": ["canvas"]
    }
  ]
}
JSON
if ERR="$(AOS_RECIPE_ROOTS="$TMP/cleanup-failed" ./aos recipe run fixture/cleanup-failed --json 2>&1 >/dev/null)"; then
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
    pass "recipe run reports cleanup failure"
else
    fail "cleanup failure result mismatch: $ERR"
fi

# --- 18. transient show remove recovery is limited to owned cleanup steps. ---
mkdir -p "$TMP/recovery-narrow"
FAKE_AOS="$TMP/recovery-narrow/aos"
cat >"$FAKE_AOS" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
state_dir="${FAKE_AOS_STATE_DIR:-/tmp/aos-recipe-fake-state}"
arg_value() {
  local flag="$1"
  shift
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$flag" ] && [ "$#" -gt 1 ]; then
      printf '%s\n' "$2"
      return 0
    fi
    shift
  done
  return 1
}
if [ "${1:-}" = "help" ] && [ "${2:-}" = "--json" ]; then
  cat <<'JSON'
{
  "commands": [
    {
      "path": ["show"],
      "forms": [
        {
          "id": "show-create",
          "execution": {
            "mutates_state": true,
            "supports_dry_run": false
          }
        },
        {
          "id": "show-remove",
          "execution": {
            "mutates_state": true,
            "supports_dry_run": false
          }
        }
      ]
    }
  ]
}
JSON
  exit 0
fi
if [ "${1:-}" = "show" ] && [ "${2:-}" = "exists" ]; then
  id="$(arg_value --id "$@" || true)"
  if [ -n "$id" ] && [ -f "$state_dir/removed-$id" ]; then
    printf '{"exists":false}\n'
    exit 0
  fi
  if [[ "$id" == *create-owned* || "$id" == *create-unowned* ]]; then
    printf '{"exists":true}\n'
    exit 0
  fi
  printf '{"exists":false}\n'
  exit 0
fi
if [ "${1:-}" = "show" ] && [ "${2:-}" = "create" ]; then
  printf 'IPC failure while creating\n' >&2
  exit 1
fi
if [ "${1:-}" = "show" ] && [ "${2:-}" = "remove" ]; then
  id="$(arg_value --id "$@" || true)"
  if [ -n "$id" ]; then
    mkdir -p "$state_dir"
    touch "$state_dir/removed-$id"
  fi
  printf 'IPC failure while removing\n' >&2
  exit 1
fi
printf 'unexpected fake aos call: %s\n' "$*" >&2
exit 2
SH
chmod +x "$FAKE_AOS"
export FAKE_AOS_STATE_DIR="$TMP/recovery-narrow/fake-state"
cat >"$TMP/recovery-narrow/recovery-narrow.json" <<'JSON'
{
  "id": "fixture/recovery-narrow",
  "version": 1,
  "summary": "Verify transient remove recovery stays cleanup-only.",
  "scope": "source",
  "mutates": true,
  "resources": {
    "canvas_id": "recipe-test-${run_id}-recovery-narrow"
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
      "id": "main-remove",
      "command": { "path": ["show"], "form_id": "show-remove" },
      "argv": ["remove", "--id", "not-owned-${run_id}"],
      "timeout_ms": 10000,
      "mutates": true
    },
    {
      "id": "cleanup-remove",
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
if ERR="$(AOS_PATH="$FAKE_AOS" AOS_RECIPE_ROOTS="$TMP/recovery-narrow" node scripts/aos-recipe.mjs run fixture/recovery-narrow --json 2>&1 >/dev/null)"; then
    fail "recovery-narrow fixture should fail on main remove"
elif ERR="$ERR" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["ERR"])
assert data["status"] == "failure", data
assert data["code"] == "COMMAND_FAILED", data
assert data["steps"][0]["id"] == "main-remove", data
assert data["steps"][0]["status"] == "failure", data
assert "recovered" not in data["steps"][0].get("observed", {}), data
assert data["cleanup"]["status"] == "success", data
cleanup = data["cleanup"]["steps"][0]
assert cleanup["id"] == "cleanup-remove", data
assert cleanup["status"] == "success", data
assert cleanup["observed"]["recovered"] == "verified-removed-resource", data
PY
then
    pass "transient remove recovery is cleanup-owned only"
else
    fail "transient remove recovery scope drifted: $ERR"
fi

# --- 19. transient show create recovery is limited to owned canvas resources. ---
cat >"$TMP/recovery-narrow/recovery-create-unowned.json" <<'JSON'
{
  "id": "fixture/recovery-create-unowned",
  "version": 1,
  "summary": "Verify transient create recovery rejects unowned pre-existing canvases.",
  "scope": "source",
  "mutates": true,
  "resources": {
    "canvas_id": "owned-${run_id}-create-unowned"
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
      "id": "main-create",
      "command": { "path": ["show"], "form_id": "show-create" },
      "argv": ["create", "--id", "create-unowned-${run_id}", "--html", "<html></html>"],
      "timeout_ms": 10000,
      "mutates": true
    },
    {
      "id": "cleanup-remove",
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
if ERR="$(AOS_PATH="$FAKE_AOS" AOS_RECIPE_ROOTS="$TMP/recovery-narrow" node scripts/aos-recipe.mjs run fixture/recovery-create-unowned --json 2>&1 >/dev/null)"; then
    fail "unowned create recovery fixture should fail"
elif ERR="$ERR" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["ERR"])
assert data["status"] == "failure", data
assert data["code"] == "COMMAND_FAILED", data
assert data["steps"][0]["id"] == "main-create", data
assert data["steps"][0]["status"] == "failure", data
assert "recovered" not in data["steps"][0].get("observed", {}), data
assert data["cleanup"]["status"] == "success", data
PY
then
    pass "transient create recovery rejects unowned canvas ids"
else
    fail "transient unowned create recovery scope drifted: $ERR"
fi

cat >"$TMP/recovery-narrow/recovery-create-owned.json" <<'JSON'
{
  "id": "fixture/recovery-create-owned",
  "version": 1,
  "summary": "Verify transient create recovery accepts declared owned canvases.",
  "scope": "source",
  "mutates": true,
  "resources": {
    "canvas_id": "create-owned-${run_id}"
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
      "id": "main-create",
      "command": { "path": ["show"], "form_id": "show-create" },
      "argv": ["create", "--id", "${resources.canvas_id}", "--html", "<html></html>"],
      "timeout_ms": 10000,
      "mutates": true,
      "assertions": [{ "path": ["status"], "equals": "success" }]
    },
    {
      "id": "cleanup-remove",
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
if OUT="$(AOS_PATH="$FAKE_AOS" AOS_RECIPE_ROOTS="$TMP/recovery-narrow" node scripts/aos-recipe.mjs run fixture/recovery-create-owned --json 2>/dev/null)" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["steps"][0]["observed"]["recovered"] == "verified-created-owned-resource", data
assert data["cleanup"]["steps"][0]["observed"]["recovered"] == "verified-removed-resource", data
PY
then
    pass "transient create recovery is owned-resource only"
else
    fail "transient owned create recovery behavior drifted"
fi

# --- 20. timeout failure still runs owned cleanup. ---
mkdir -p "$TMP/timeout-cleanup"
cat >"$TMP/timeout-cleanup/timeout-cleanup.json" <<'JSON'
{
  "id": "fixture/timeout-cleanup",
  "version": 1,
  "summary": "Create a canvas, force a step timeout, and verify cleanup.",
  "scope": "source",
  "mutates": true,
  "resources": {
    "canvas_id": "recipe-test-${run_id}-timeout-cleanup"
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
      "argv": ["create", "--id", "${resources.canvas_id}", "--at", "-10000,-10000,80,60", "--html", "<html><body>recipe</body></html>", "--ttl", "30s", "--scope", "global"],
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
if ERR="$(AOS_RECIPE_ROOTS="$TMP/timeout-cleanup" ./aos recipe run fixture/timeout-cleanup --json 2>&1 >/dev/null)"; then
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
    pass "recipe run cleans up after timeout"
else
    fail "timeout cleanup result mismatch: $ERR"
fi

if OUT="$(show_list_json)" && OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
leaks = [c["id"] for c in data.get("canvases", []) if c.get("id", "").startswith("recipe-test-")]
assert not leaks, leaks
PY
then
    pass "failure fixtures leave no owned test canvases"
else
    fail "failure fixtures leaked owned test canvases"
fi

echo
if [ "$FAILS" -eq 0 ]; then
    echo "recipe-contract: all checks passed"
    exit 0
else
    echo "recipe-contract: $FAILS failure(s)"
    exit 1
fi
