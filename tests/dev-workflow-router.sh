#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; FAILS=$((FAILS + 1)); }

if OUT="$(node scripts/aos-dev-workflow.mjs classify --json --paths src/main.swift,packages/toolkit/runtime/canvas.js,shared/schemas/input-event-v2.schema.json,docs/guides/example.md 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert data["status"] == "success"
assert data["diff_base"] == "explicit"
assert "swift-core" in summary["rule_ids"], summary
assert "toolkit-components" in summary["rule_ids"], summary
assert "schemas" in summary["rule_ids"], summary
assert "docs-only" in summary["rule_ids"], summary
assert summary["requires_swift_build"] is True, summary
assert summary["tcc_identity_sensitive"] is True, summary
assert summary["hot_swappable"] is False, summary
assert any(item["command"] == "node scripts/aos-dev-build.mjs build --no-restart --json" for item in summary["commands"]), summary
assert [item["command"] for item in summary["verification"][:2]] == [
    "./aos help --json",
    "./aos ready --post-permission --json",
], summary
PY
then
    pass "dev classify aggregates manifest-backed workflow classes"
else
    fail "dev classify did not report expected aggregate classes"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files docs/guides/example.md 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["next_commands"] == [], data
assert data["verification"] == [], data
assert data["notes"], data
assert data["summary"]["rule_ids"] == ["docs-only"], data
PY
then
    pass "dev recommend keeps docs-only changes out of runtime loops"
else
    fail "dev recommend docs-only routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files tests/dev-workflow-router.sh 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["proof_worth"]["status"] == "passed", data
assert data["proof_worth"]["changed_asset_count"] == 1, data
commands = [item["command"] for item in data["next_commands"]]
assert commands.count("bash tests/dev-workflow-router.sh") == 1, data
router = next(item for item in data["next_commands"] if item["command"] == "bash tests/dev-workflow-router.sh")
assert "dev-workflow-manifest" in router["source_rules"], router
assert "proof:dev-workflow-router-contract" in router["source_rules"], router
assert all(item["command"] != "bash <changed-test>" for item in data["verification"]), data
PY
then
    pass "dev recommend accepts registered changed tests and deduplicates registry commands"
else
    fail "dev recommend proof-worth registered test routing drifted"
fi

PROOF_TEMP="tests/.proof-worth-unregistered-temp.sh"
rm -f "$PROOF_TEMP"
printf '#!/usr/bin/env bash\nexit 0\n' > "$PROOF_TEMP"
set +e
OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files "$PROOF_TEMP" 2>/dev/null)"
RC=$?
set -e
if [[ "$RC" -eq 0 ]]; then
    fail "dev recommend should fail for existing unregistered proof assets"
elif OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "failed", data
assert data["code"] == "MISSING_PROOF_WORTH", data
assert data["proof_worth"]["status"] == "failed", data
failure = data["proof_worth"]["failures"][0]
assert failure["path"] == "tests/.proof-worth-unregistered-temp.sh", data
assert failure["reason"] == "missing_registry_entry", data
PY
then
    pass "dev recommend fails existing unregistered proof assets"
else
    fail "dev recommend unregistered proof-worth failure shape drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs classify --json --files "$PROOF_TEMP" 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["proof_worth"]["status"] == "failed", data
assert data["proof_worth"]["failures"][0]["reason"] == "missing_registry_entry", data
PY
then
    pass "dev classify reports proof-worth metadata without failing"
else
    fail "dev classify proof-worth metadata behavior drifted"
fi
rm -f "$PROOF_TEMP"

DELETED_PROOF="tests/.proof-worth-deleted-temp.sh"
rm -f "$DELETED_PROOF"
if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files "$DELETED_PROOF" 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["proof_worth"]["status"] == "passed", data
asset = data["proof_worth"]["assets"][0]
assert asset["path"] == "tests/.proof-worth-deleted-temp.sh", data
assert asset["deleted"] is True, data
assert asset["coverage"] == "deleted_unregistered_cleanup", data
assert all(item["command"] != "bash <changed-test>" for item in data["verification"]), data
PY
then
    pass "dev recommend treats deleted unregistered proof assets as cleanup"
else
    fail "dev recommend deleted proof cleanup behavior drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files tests/manual/native-ax-saved-ref-live-proof.sh 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["proof_worth"]["status"] == "passed", data
assert data["proof_worth"]["commands"] == [], data
guarded = data["proof_worth"]["guarded"]
assert guarded and guarded[0]["entry"] == "native-ax-saved-ref-live-proof", data
assert "real-input approval" in guarded[0]["guard"], data
assert all(item["command"] != "bash tests/manual/native-ax-saved-ref-live-proof.sh" for item in data["next_commands"]), data
assert all(item["command"] != "bash <changed-test>" for item in data["verification"]), data
PY
then
    pass "dev recommend reports guarded manual proofs without default verification"
else
    fail "dev recommend guarded proof behavior drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files tests/lib/visual-harness.sh 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "visual-harness-primitives" in summary["rule_ids"], data
assert "tests" in summary["rule_ids"], data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/visual-harness-boundary.sh",
    "bash tests/visual-harness-canonical-url-primitives.sh",
    "bash tests/harness-composability-contracts.sh",
} <= commands, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
PY
then
    pass "dev recommend routes visual harness primitive changes to deterministic battery"
else
    fail "dev recommend visual harness primitive routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs classify --json --files unknown/path.txt 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["summary"]["rule_ids"] == ["unclassified"], data
assert data["summary"]["actions"] == ["inspect_manually"], data
PY
then
    pass "dev classify reports unmatched paths through fallback"
else
    fail "dev classify fallback routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files scripts/aos-do-native.mjs 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-surface-implementations" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/external-command-dispatch.sh",
    "bash tests/external-parser-flags.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes external command wrappers to hot-swappable command-surface checks"
else
    fail "dev recommend external command wrapper routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files manifests/commands/source/aos/03-see-01-capture.json scripts/generate-command-manifests.mjs tests/command-manifest-generation.sh 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-surface-manifests" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/command-manifest-generation.sh",
    "node --test tests/schemas/aos-external-command-manifest-v0.test.mjs",
    "bash tests/external-command-dispatch.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes command source and generator edits to manifest generation checks"
else
    fail "dev recommend command source/generator routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files packages/cli/verbs/gate-ask.js 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-surface-implementations" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/external-command-dispatch.sh",
    "bash tests/external-parser-flags.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes package CLI commands to command-surface checks"
else
    fail "dev recommend package CLI command routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files scripts/sign-aos-runtime 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-surface-implementations" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/external-command-dispatch.sh",
    "bash tests/external-parser-flags.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes runtime signing script to command-surface checks"
else
    fail "dev recommend runtime signing command routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files packages/gateway/dist/doctor-cli.js 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "package-gateway" in summary["rule_ids"], data
assert "command-surface-implementations" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "cd packages/gateway && npm test",
    "bash tests/external-command-dispatch.sh",
    "bash tests/external-parser-flags.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes gateway doctor CLI to package and command-surface checks"
else
    fail "dev recommend gateway doctor CLI routing drifted"
fi

if OUT="$(node - <<'NODE'
const { spawnSync } = require('node:child_process');
const manifest = require('./manifests/commands/aos-external-commands.json');
const targets = [...new Set(
  manifest.commands
    .flatMap((command) => command.argv_prefix || [])
    .filter((arg) => /^(scripts|packages)\//.test(arg))
)].sort();
const result = spawnSync(process.execPath, ['scripts/aos-dev-workflow.mjs', 'classify', '--json', '--files', ...targets], { encoding: 'utf8' });
if (result.stderr) process.stderr.write(result.stderr);
if (result.stdout) process.stdout.write(result.stdout);
process.exit(result.status ?? 1);
NODE
)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["files"], data
for item in data["files"]:
    rules = set(item["rules"])
    assert "command-surface-implementations" in rules, item
    assert "unclassified" not in rules, item
    assert item["hot_swappable"] is True, item
    assert item["tcc_identity_sensitive"] is False, item
summary = data["summary"]
assert summary["requires_swift_build"] is False, summary
assert summary["tcc_identity_sensitive"] is False, summary
PY
then
    pass "dev classify routes every external manifest implementation target to command-surface checks"
else
    fail "dev classify external manifest implementation target routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs classify --json --files apps/example/feature.js 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["summary"]["rule_ids"] == ["app-subtree-local-contract"], data
assert data["summary"]["actions"] == ["read_local_contract"], data
assert "nearest subtree AGENTS.md" in data["summary"]["notes"][0], data
assert "sigil" not in json.dumps(data).lower(), data
PY
then
    pass "dev classify routes app subtree changes to local contracts"
else
    fail "dev classify app local-contract routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files docs/api/aos.md 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-contract-docs" in summary["rule_ids"], data
assert any(item["command"] == "bash tests/help-contract.sh" for item in data["next_commands"]), data
PY
then
    pass "dev recommend routes command-contract docs to help verification"
else
    fail "dev recommend command-contract docs routing drifted"
fi

if ERR="$(node scripts/aos-dev-workflow.mjs recommend --json --base definitely-not-a-ref 2>&1 >/dev/null)"; then
    fail "dev recommend should reject invalid --base refs"
elif echo "$ERR" | grep -q '"code" : "INVALID_BASE_REF"'; then
    pass "dev recommend rejects invalid --base refs"
else
    fail "dev recommend invalid --base error mismatch: $ERR"
fi

if ERR="$(node scripts/aos-dev-workflow.mjs recommend --base --json 2>&1 >/dev/null)"; then
    fail "dev recommend should reject missing --base values before a flag"
elif echo "$ERR" | grep -q '"code" : "MISSING_ARG"'; then
    pass "dev recommend treats flag-after---base as missing value"
else
    fail "dev recommend missing --base error mismatch: $ERR"
fi

if ERR="$(node scripts/aos-dev-workflow.mjs audit --repo --json 2>&1 >/dev/null)"; then
    fail "dev audit should reject missing --repo values before a flag"
elif echo "$ERR" | grep -q '"code" : "MISSING_ARG"'; then
    pass "dev audit treats flag-after---repo as missing value"
else
    fail "dev audit missing --repo error mismatch: $ERR"
fi

if ERR="$(./aos help dev --json 2>&1 >/dev/null)"; then
    fail "aos help dev should not resolve after dev command removal"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_COMMAND"'; then
    pass "public help rejects removed dev command"
else
    fail "aos help dev returned unexpected error: $ERR"
fi

if ERR="$(./aos dev classify --json 2>&1 >/dev/null)"; then
    fail "aos dev classify should not dispatch after dev command removal"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_COMMAND"'; then
    pass "public dispatch rejects removed dev command"
else
    fail "aos dev classify returned unexpected error: $ERR"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
    echo "dev-workflow-router: all checks passed"
    exit 0
fi

echo "dev-workflow-router: $FAILS failure(s)"
exit 1
