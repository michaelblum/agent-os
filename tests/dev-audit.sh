#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; FAILS=$((FAILS + 1)); }

if OUT="$(node scripts/aos-dev-workflow.mjs audit --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
claims = {claim["id"]: claim for claim in data["claims"]}
expected = {
    "dev-default-manifest-path",
    "dev-manifest-readable",
    "dev-manifest-decodes",
    "dev-help-registry-absent",
    "dev-external-routes-absent",
    "dev-workflow-self-routes",
    "dev-workflow-self-verifies",
    "dev-recommend-explicit-files",
}
assert data["status"] == "success", data
assert data["subject"] == "maintainer-workflow", data
assert data["summary"]["failed"] == 0, data
assert expected <= set(claims), claims
assert all(claim["status"] == "passed" for claim in claims.values()), claims
assert claims["dev-default-manifest-path"]["observed"] == "docs/dev/workflow-rules.json"
PY
then
    pass "maintainer workflow audit reports evidence-backed passing claims"
else
    fail "maintainer workflow audit did not report expected passing claims"
fi

MISSING_MANIFEST="$(mktemp -t aos-dev-audit-missing.XXXXXX)"
rm -f "$MISSING_MANIFEST"
if OUT="$(node scripts/aos-dev-workflow.mjs audit --json --manifest "$MISSING_MANIFEST" 2>/dev/null)"; then
    fail "maintainer workflow audit should fail when the selected manifest is missing"
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
assert data["next"].startswith("node scripts/aos-dev-build.mjs build"), data
PY
then
    pass "maintainer workflow audit failure path reports failed claims and repair hint"
else
    fail "maintainer workflow audit missing-manifest failure did not expose expected claims"
fi

if ERR="$(./aos help dev audit --json 2>&1 >/dev/null)"; then
    fail "aos help dev audit should not resolve after dev command removal"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_COMMAND"'; then
    pass "aos help dev audit is retired from the AOS command surface"
else
    fail "aos help dev audit returned unexpected error: $ERR"
fi

if ERR="$(node scripts/aos-dev-workflow.mjs audit --repo --json 2>&1 >/dev/null)"; then
    fail "maintainer workflow audit should reject missing --repo values before a flag"
elif echo "$ERR" | grep -q '"code" : "MISSING_ARG"'; then
    pass "maintainer workflow audit parser stays direct and deterministic"
else
    fail "maintainer workflow audit missing --repo error drifted: $ERR"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files docs/guides/example.md 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["summary"]["rule_ids"] == ["docs-only"], data
assert data["next_commands"] == [], data
assert data["verification"] == [], data
PY
then
    pass "direct maintainer recommendation remains available outside AOS CLI"
else
    fail "direct maintainer recommendation drifted"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
    echo "dev-audit: all checks passed"
    exit 0
fi

echo "dev-audit: $FAILS failure(s)"
exit 1
