#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; FAILS=$((FAILS + 1)); }

HISTORICAL="tests/fixtures/dev-drift-lint/historical-status.md"
STANDING="tests/fixtures/dev-drift-lint/standing-status.md"
IDENTITY="tests/fixtures/dev-drift-lint/identity-paraphrase.md"
BLOCK_SCOPE="tests/fixtures/dev-drift-lint/block-scope.md"
CODE_SPANS="tests/fixtures/dev-drift-lint/code-spans.md"
DATED_SAMELINE="tests/fixtures/dev-drift-lint/dated-sameline.md"
SAME_LINE_CONTAMINATION="tests/fixtures/dev-drift-lint/same-line-contamination.md"
SOFT_HEADING_SCOPE="tests/fixtures/dev-drift-lint/soft-heading-scope.md"
COMBINED_CONTAMINATION="tests/fixtures/dev-drift-lint/combined-contamination.md"
NARRATIVE="docs/design/agent-relay-readiness-narrative-ledger-2026-06-04.md"
export NARRATIVE

if OUT="$(./aos dev drift-lint --files "$HISTORICAL" --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["detector"]["kind"] == "heuristic_tripwire", data
assert data["detector"]["proof"] is False, data
assert data["detector"]["denylist_complete"] is False, data
assert data["detector"]["block_scoped_markers"] is False, data
assert data["detector"]["claim_scoped_markers"] is True, data
assert data["summary"]["finding_count"] == 0, data
assert data["scanned_files"] == ["tests/fixtures/dev-drift-lint/historical-status.md"], data
PY
then
    pass "dev drift-lint permits dated historical status fixture"
else
    fail "dev drift-lint over-flagged historical fixture"
fi

if OUT="$(./aos dev drift-lint --files "$STANDING" --json 2>/dev/null)"; then
    fail "dev drift-lint should fail unmarked standing status fixture"
elif OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
rules = {finding["rule_id"] for finding in data["findings"]}
assert data["status"] == "failed", data
assert "issue_lifecycle_standing_claim" in rules, data
assert "stash_lifecycle_standing_claim" in rules, data
assert "runtime_lifecycle_standing_claim" in rules, data
assert data["summary"]["finding_count"] >= 3, data
PY
then
    pass "dev drift-lint blocks fabricated unmarked standing status claims"
else
    fail "dev drift-lint under-flagged standing status fixture"
fi

if OUT="$(./aos dev drift-lint --files "$IDENTITY" --json 2>/dev/null)"; then
    fail "dev drift-lint should fail bare issue identity paraphrase fixture"
elif OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert any(item["rule_id"] == "issue_identity_paraphrase" for item in data["findings"]), data
assert any("Cite the number and query" in item["suggested_fix"] for item in data["findings"]), data
PY
then
    pass "dev drift-lint blocks issue-number scope paraphrases"
else
    fail "dev drift-lint did not report issue identity paraphrase"
fi

if OUT="$(./aos dev drift-lint --files "$BLOCK_SCOPE" --json 2>/dev/null)"; then
    fail "dev drift-lint should not let a prior historical block license a later standing claim"
elif OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["summary"]["finding_count"] == 1, data
finding = data["findings"][0]
assert finding["line"] == 5, finding
assert finding["token"] == "#222 is open", finding
PY
then
    pass "dev drift-lint keeps nearby markers from licensing later claims"
else
    fail "dev drift-lint nearby-marker behavior drifted"
fi

if OUT="$(./aos dev drift-lint --files "$DATED_SAMELINE" --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["summary"]["finding_count"] == 0, data
PY
then
    pass "dev drift-lint permits same-clause dated status claims"
else
    fail "dev drift-lint over-flagged same-clause dated fixture"
fi

if OUT="$(./aos dev drift-lint --files "$SAME_LINE_CONTAMINATION" --json 2>/dev/null)"; then
    fail "dev drift-lint should fail same-line two-sentence contamination"
elif OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "failed", data
assert data["summary"]["finding_count"] == 1, data
finding = data["findings"][0]
assert finding["line"] == 3, finding
assert finding["token"] == "#407 is open", finding
assert finding["rule_id"] == "issue_lifecycle_standing_claim", finding
PY
then
    pass "dev drift-lint catches same-line two-sentence contamination"
else
    fail "dev drift-lint missed same-line contamination"
fi

if OUT="$(./aos dev drift-lint --files "$SOFT_HEADING_SCOPE" --json 2>/dev/null)"; then
    fail "dev drift-lint should fail fresh status under soft historical heading"
elif OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "failed", data
assert data["summary"]["finding_count"] == 1, data
finding = data["findings"][0]
assert finding["line"] == 5, finding
assert finding["token"] == "#407 is open", finding
PY
then
    pass "dev drift-lint catches soft-heading scope contamination"
else
    fail "dev drift-lint missed soft-heading contamination"
fi

if OUT="$(./aos dev drift-lint --files "$COMBINED_CONTAMINATION" --json 2>/dev/null)"; then
    fail "dev drift-lint should fail realistic ledger contamination"
elif OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
tokens = {finding["token"] for finding in data["findings"]}
rules = {finding["rule_id"] for finding in data["findings"]}
assert data["status"] == "failed", data
assert data["summary"]["finding_count"] == 4, data
assert "#407 is open" in tokens, tokens
assert "#411 is the parser simplification work" in tokens, tokens
assert "#415 is closable" in tokens, tokens
assert "lane:active" in tokens, tokens
assert "issue_lifecycle_standing_claim" in rules, rules
assert "issue_identity_paraphrase" in rules, rules
assert "lane_label_standing_claim" in rules, rules
PY
then
    pass "dev drift-lint catches every claim in realistic ledger contamination"
else
    fail "dev drift-lint missed realistic ledger contamination"
fi

if OUT="$(./aos dev drift-lint --files "$CODE_SPANS" --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["detector"]["excludes_fenced_code_blocks"] is True, data
assert data["detector"]["excludes_inline_code_spans"] is True, data
assert data["summary"]["finding_count"] == 0, data
PY
then
    pass "dev drift-lint excludes fenced code blocks and inline code spans"
else
    fail "dev drift-lint flagged code-span or fenced evidence text"
fi

if OUT="$(./aos dev drift-lint --files "$NARRATIVE" --json 2>/dev/null)" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["OUT"])
text = Path(os.environ["NARRATIVE"]).read_text(encoding="utf-8")
assert text.count("stash@{") == 3, text.count("stash@{")
assert data["status"] == "success", data
assert data["summary"]["finding_count"] == 0, data
PY
then
    pass "dev drift-lint permits historical stash refs in narrative ledger"
else
    fail "dev drift-lint over-flagged narrative ledger historical stash refs"
fi

if ERR="$(./aos dev drift-lint --bogus 2>&1 >/dev/null)"; then
    fail "dev drift-lint should reject unknown flags"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["code"] == "UNKNOWN_FLAG", data
assert "Unknown dev drift-lint flag" in data["error"], data
PY
then
    pass "dev drift-lint rejects unknown flags"
else
    fail "dev drift-lint unknown flag error drifted: $ERR"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
    echo "dev-drift-lint: all checks passed"
    exit 0
fi

echo "dev-drift-lint: $FAILS failure(s)"
exit 1
