#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-wiki-lint.XXXXXX")"
ROOT="$(cd "$ROOT" && pwd -P)"
export AOS_STATE_ROOT="$ROOT"
trap 'rm -rf "$ROOT"' EXIT

./aos wiki seed --json >/dev/null

OUT="$(./aos wiki lint --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

issues = json.loads(os.environ["OUT"])
assert isinstance(issues, list), issues
PY

mkdir -p "$ROOT/repo/wiki/aos/entities"
cat > "$ROOT/repo/wiki/aos/entities/broken-link-source.md" <<'EOF'
---
type: entity
name: Broken Link Source
---

# Broken Link Source

## Related

- [Missing](missing-target.md)
EOF

./aos wiki reindex --json >/dev/null
OUT="$(./aos wiki lint --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

issues = json.loads(os.environ["OUT"])
assert any(
    item["severity"] == "error"
    and item["category"] == "broken_link"
    and item["path"] == "aos/entities/broken-link-source.md"
    for item in issues
), issues
PY

cat > "$ROOT/repo/wiki/aos/entities/index-drift.md" <<'EOF'
---
type: entity
name: Index Drift
---

# Index Drift
EOF

OUT="$(./aos wiki lint --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

issues = json.loads(os.environ["OUT"])
assert any(item["category"] == "index_drift" and item["path"] == "aos/entities/index-drift.md" for item in issues), issues
PY

OUT="$(./aos wiki lint --fix --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

issues = json.loads(os.environ["OUT"])
assert not any(item["category"] == "index_drift" and item["path"] == "aos/entities/index-drift.md" for item in issues), issues
PY

if ./aos wiki lint --bogus 2>"$ROOT/wiki-lint-bogus.err"; then
  echo "FAIL: wiki lint accepted unknown flag"
  exit 1
fi
grep -q '"code": "UNKNOWN_FLAG"' "$ROOT/wiki-lint-bogus.err" || {
  echo "FAIL: wiki lint unknown flag did not use external script error contract"
  cat "$ROOT/wiki-lint-bogus.err"
  exit 1
}

if ./aos wiki lint extra 2>"$ROOT/wiki-lint-extra.err"; then
  echo "FAIL: wiki lint accepted extra positional"
  exit 1
fi
grep -q '"code": "UNKNOWN_ARG"' "$ROOT/wiki-lint-extra.err" || {
  echo "FAIL: wiki lint extra positional did not use UNKNOWN_ARG"
  cat "$ROOT/wiki-lint-extra.err"
  exit 1
}
grep -q '"error": "Unknown argument: extra"' "$ROOT/wiki-lint-extra.err" || {
  echo "FAIL: wiki lint extra positional message did not say Unknown argument"
  cat "$ROOT/wiki-lint-extra.err"
  exit 1
}

echo "PASS"
