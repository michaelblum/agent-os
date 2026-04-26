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
with (root / "recipes/runtime/status-snapshot.json").open() as f:
    validator.validate(json.load(f))
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
PY
then
    pass "ops list discovers runtime/status-snapshot"
else
    fail "ops list did not discover runtime/status-snapshot"
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

# --- 6. duplicate recipe IDs are rejected. ---
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

# --- 7. invalid recipe explain fails before execution. ---
if ERR="$(AOS_OPS_RECIPE_ROOTS="tests/fixtures/ops/invalid" ./aos ops explain fixture/missing-command --json 2>&1 >/dev/null)"; then
    fail "invalid recipe should fail explain"
elif echo "$ERR" | grep -q '"code" : "INVALID_RECIPE"'; then
    pass "invalid recipe is rejected during explanation"
else
    fail "invalid recipe error code mismatch: $ERR"
fi

# --- 8. installed-mode index discovery does not need source roots. ---
scripts/generate-ops-recipe-index "$PWD" "$TMP/recipes-index.json"
OUT="$(AOS_RUNTIME_MODE=installed AOS_OPS_RECIPE_INDEX="$TMP/recipes-index.json" ./aos ops list --json 2>/dev/null)"
if OUT="$OUT" python3 - <<'PY'
import json
import os
data = json.loads(os.environ["OUT"])
assert any(r["id"] == "runtime/status-snapshot" for r in data["recipes"]), data
assert any(r["source_kind"] == "repo" for r in data["recipes"]), data
PY
then
    pass "installed-mode recipe index discovery works"
else
    fail "installed-mode recipe index discovery failed"
fi

# --- 9. missing recipes follow stderr/exit-code failure contract. ---
if ERR="$(./aos ops dry-run runtime/not-here --json 2>&1 >/dev/null)"; then
    fail "missing recipe dry-run should fail"
elif echo "$ERR" | grep -q '"code" : "RECIPE_NOT_FOUND"'; then
    pass "missing recipe dry-run returns RECIPE_NOT_FOUND on stderr"
else
    fail "missing recipe error code mismatch: $ERR"
fi

# --- 10. ops run executes the first read-only recipe and matches result schema. ---
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

echo
if [ "$FAILS" -eq 0 ]; then
    echo "ops-contract: all checks passed"
    exit 0
else
    echo "ops-contract: $FAILS failure(s)"
    exit 1
fi
