#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; FAILS=$((FAILS + 1)); }

if OUT="$(./aos dev audit --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
claims = {claim["id"]: claim for claim in data["claims"]}
expected = {
    "dev-default-manifest-path",
    "dev-manifest-readable",
    "dev-manifest-decodes",
    "dev-help-forms",
    "dev-classify-help-flags",
    "dev-recommend-help-flags",
    "dev-audit-help-flags",
    "dev-workflow-self-routes",
    "dev-workflow-self-verifies",
    "dev-recommend-explicit-files",
}
assert data["status"] == "success", data
assert data["subject"] == "dev-grammar", data
assert data["summary"]["failed"] == 0, data
assert expected <= set(claims), claims
assert all(claim["status"] == "passed" for claim in claims.values()), claims
assert claims["dev-default-manifest-path"]["observed"] == "docs/dev/workflow-rules.json"
PY
then
    pass "dev audit reports evidence-backed passing claims"
else
    fail "dev audit did not report expected passing claims"
fi

MISSING_MANIFEST="$(mktemp -t aos-dev-audit-missing.XXXXXX)"
rm -f "$MISSING_MANIFEST"
if OUT="$(./aos dev audit --json --manifest "$MISSING_MANIFEST" 2>/dev/null)"; then
    fail "dev audit should fail when the selected manifest is missing"
elif OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
claims = {claim["id"]: claim for claim in data["claims"]}
assert data["status"] == "failed", data
assert data["summary"]["failed"] >= 2, data
assert claims["dev-manifest-readable"]["status"] == "failed", claims
assert claims["dev-manifest-decodes"]["status"] == "failed", claims
assert "missing:" in claims["dev-manifest-decodes"]["observed"], claims
assert data["next"].startswith("./aos dev build"), data
PY
then
    pass "dev audit failure path reports failed claims and repair hint"
else
    fail "dev audit missing-manifest failure did not expose expected claims"
fi

if OUT="$(./aos help dev audit --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
forms = {form["id"]: form for form in data["forms"]}
assert set(forms) == {"dev-audit"}, forms
tokens = {arg.get("token") for arg in forms["dev-audit"]["args"]}
assert {"--manifest", "--repo", "--json"} <= tokens, tokens
manifest = next(arg for arg in forms["dev-audit"]["args"] if arg.get("token") == "--manifest")
assert manifest["default_value"] == "docs/dev/workflow-rules.json", manifest
PY
then
    pass "dev audit help exposes progressive dev subcommand surface"
else
    fail "dev audit help registry drifted"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
    echo "dev-audit: all checks passed"
    exit 0
fi

echo "dev-audit: $FAILS failure(s)"
exit 1
