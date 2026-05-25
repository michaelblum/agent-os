#!/usr/bin/env bash
set -euo pipefail

PREFIX="aos-wiki-project-docs"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
ROOT="$(cd "$ROOT" && pwd -P)"
export AOS_STATE_ROOT="$ROOT"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
AOS="$REPO_ROOT/aos"
TMP_REPO_DIR="$REPO_ROOT/.tmp-wiki-project-docs-test"
SOURCE_REL=".tmp-wiki-project-docs-test/source.md"
MANIFEST="$ROOT/manifest.json"

canonicalize_path() {
  python3 - "$1" <<'PY'
import pathlib
import sys
print(pathlib.Path(sys.argv[1]).expanduser().resolve(strict=False))
PY
}

snapshot_wiki() {
  local wiki_dir="$1"
  if [[ ! -d "$wiki_dir" ]]; then
    printf '__missing__\n'
    return 0
  fi
  find "$wiki_dir" -type f -print 2>/dev/null | LC_ALL=C sort | while IFS= read -r path; do
    stat -f '%N %z %m' "$path"
  done
}

json_field() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
data = json.loads(sys.argv[1])
print(data[sys.argv[2]])
PY
}

CANONICAL_WIKI_DIR="$(canonicalize_path "$HOME/.config/aos/repo/wiki")"
BEFORE="$(snapshot_wiki "$CANONICAL_WIKI_DIR")"

cleanup() {
  rm -rf "$ROOT" "$TMP_REPO_DIR"
}
trap cleanup EXIT

mkdir -p "$TMP_REPO_DIR"
cat > "$TMP_REPO_DIR/source.md" <<'EOF'
# Projection Fixture

DesktopWorld stage and input_region are controlled concepts for this fixture.

The projected source includes a normal fenced code block:

```swift
let stage = "DesktopWorld"
let region = "input_region"
```
EOF

cat > "$MANIFEST" <<EOF
{
  "projection": "repo_docs_v0",
  "entries": [
    {
      "source_path": "$SOURCE_REL",
      "slug": "repo-doc-test-projection",
      "type": "repo_doc",
      "name": "Repo Doc Test Projection",
      "description": "Projection fixture mentioning DesktopWorld stage and input_region.",
      "tags": ["repo-docs", "test", "DesktopWorld stage"],
      "concepts": ["DesktopWorld stage", "input_region", "runtime wiki"],
      "source_type": "markdown"
    }
  ]
}
EOF

cd "$REPO_ROOT"

OUTPUT="$("$AOS" wiki project-docs --manifest "$MANIFEST" --json)"
[[ "$(json_field "$OUTPUT" status)" == "ok" ]] || { echo "$OUTPUT"; exit 1; }
[[ "$(json_field "$OUTPUT" projected)" == "1" ]] || { echo "FAIL: first projection did not write one page"; echo "$OUTPUT"; exit 1; }
test -f "$ROOT/repo/wiki/aos/concepts/repo-doc-test-projection.md" || { echo "FAIL: projected page missing"; exit 1; }

RAW="$("$AOS" wiki show aos/concepts/repo-doc-test-projection.md --raw)"
grep -q "Git is canonical" <<<"$RAW" || { echo "FAIL: canonical-source warning missing"; exit 1; }
grep -q "source_hash: sha256:" <<<"$RAW" || { echo "FAIL: source hash missing"; exit 1; }
grep -q '^````markdown$' <<<"$RAW" || { echo "FAIL: projected source wrapper did not grow beyond inner fence"; exit 1; }
grep -q '^```swift$' <<<"$RAW" || { echo "FAIL: source fenced code block missing from projection"; exit 1; }
grep -q '^````$' <<<"$RAW" || { echo "FAIL: projected source wrapper close fence missing"; exit 1; }
python3 - "$ROOT/repo/wiki/aos/concepts/repo-doc-test-projection.md" <<'PY'
import pathlib
import sys
content = pathlib.Path(sys.argv[1]).read_text()
close = content.index("\n````\n\n## Related Projected Pages")
source = content.index("\n````markdown\n")
inner = content.index("\n```swift\n")
if not source < inner < close:
    raise SystemExit("FAIL: inner source fence was not contained by projected-source wrapper")
PY
HASH1="$(grep '^source_hash:' "$ROOT/repo/wiki/aos/concepts/repo-doc-test-projection.md")"

OUTPUT="$("$AOS" wiki project-docs --manifest "$MANIFEST" --json)"
[[ "$(json_field "$OUTPUT" unchanged)" == "1" ]] || { echo "FAIL: second projection was not idempotent"; echo "$OUTPUT"; exit 1; }

SEARCH="$("$AOS" wiki search "DesktopWorld stage" --json)"
grep -q "repo-doc-test-projection.md" <<<"$SEARCH" || { echo "FAIL: search did not find projected concept"; echo "$SEARCH"; exit 1; }

LIST="$("$AOS" wiki list --type repo_doc --json)"
grep -q "repo-doc-test-projection.md" <<<"$LIST" || { echo "FAIL: list did not include projected page"; echo "$LIST"; exit 1; }

GRAPH="$("$AOS" wiki graph --json)"
grep -q "repo-doc-test-projection.md" <<<"$GRAPH" || { echo "FAIL: graph did not include projected page"; echo "$GRAPH"; exit 1; }

DRY_BEFORE="$(snapshot_wiki "$ROOT/repo/wiki")"
DRY_OUTPUT="$("$AOS" wiki project-docs --manifest "$MANIFEST" --dry-run --json)"
DRY_AFTER="$(snapshot_wiki "$ROOT/repo/wiki")"
[[ "$(json_field "$DRY_OUTPUT" dry_run)" == "True" ]] || { echo "FAIL: dry run JSON did not report dry_run"; echo "$DRY_OUTPUT"; exit 1; }
[[ "$DRY_BEFORE" == "$DRY_AFTER" ]] || { echo "FAIL: dry run mutated isolated wiki"; exit 1; }

cat >> "$TMP_REPO_DIR/source.md" <<'EOF'

Changed source content updates the source_hash.
EOF
"$AOS" wiki project-docs --manifest "$MANIFEST" --json >/dev/null
HASH2="$(grep '^source_hash:' "$ROOT/repo/wiki/aos/concepts/repo-doc-test-projection.md")"
[[ "$HASH1" != "$HASH2" ]] || { echo "FAIL: changed source did not update source_hash"; exit 1; }

if "$AOS" wiki project-docs --bogus 2>"$ROOT/wiki-project-docs-bogus.err"; then
  echo "FAIL: wiki project-docs accepted unknown flag"
  exit 1
fi
grep -q '"code": "UNKNOWN_FLAG"' "$ROOT/wiki-project-docs-bogus.err" || {
  echo "FAIL: wiki project-docs unknown flag did not use external script error contract"
  cat "$ROOT/wiki-project-docs-bogus.err"
  exit 1
}

cat > "$MANIFEST" <<EOF
{
  "projection": "repo_docs_v0",
  "entries": []
}
EOF
"$AOS" wiki project-docs --manifest "$MANIFEST" --json >/dev/null
test ! -f "$ROOT/repo/wiki/aos/concepts/repo-doc-test-projection.md" || { echo "FAIL: stale generated page not removed"; exit 1; }

AFTER="$(snapshot_wiki "$CANONICAL_WIKI_DIR")"
[[ "$BEFORE" == "$AFTER" ]] || { echo "FAIL: canonical repo wiki changed"; exit 1; }

echo "PASS"
