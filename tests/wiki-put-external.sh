#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-wiki-put-external.XXXXXX")"
ROOT="$(cd "$ROOT" && pwd -P)"
export AOS_STATE_ROOT="$ROOT"
trap 'rm -rf "$ROOT"' EXIT

AOS_BIN="${AOS_BIN:-./aos}"
RELATIVE_PATH="consumer/concepts/reviewed-fact.md"
TARGET="$ROOT/repo/wiki/$RELATIVE_PATH"
CREATE_INPUT="$ROOT/create.md"
UPDATE_INPUT="$ROOT/update.md"
CONFLICT_INPUT="$ROOT/conflict.md"

printf '%s\n' '# Reviewed fact' 'Initial public command proof.' >"$CREATE_INPUT"
printf '%s\n' '# Reviewed fact' 'Updated public command proof.' >"$UPDATE_INPUT"
printf '%s\n' 'PRIVATE_CONFLICT_INPUT_MUST_NOT_ECHO' >"$CONFLICT_INPUT"

CREATE_OUT="$("$AOS_BIN" wiki put "$RELATIVE_PATH" --stdin --if-match none --json <"$CREATE_INPUT")"
CREATE_HASH="$(CREATE_OUT="$CREATE_OUT" TARGET="$TARGET" python3 - <<'PY'
import hashlib
import json
import os
import stat

data = json.loads(os.environ["CREATE_OUT"])
target = os.environ["TARGET"]
content = open(target, "rb").read()
assert data["schema_version"] == "aos.wiki.put-result.v1", data
assert data["operation"] == "created", data
assert data["path"] == "consumer/concepts/reviewed-fact.md", data
assert data["previous_sha256"] is None, data
assert data["sha256"] == hashlib.sha256(content).hexdigest(), data
assert data["bytes"] == len(content), data
assert stat.S_IMODE(os.stat(target).st_mode) == 0o600
print(data["sha256"])
PY
)"

UPDATE_OUT="$("$AOS_BIN" wiki put "$RELATIVE_PATH" --stdin --if-match "$CREATE_HASH" --json <"$UPDATE_INPUT")"
CREATE_HASH="$CREATE_HASH" UPDATE_OUT="$UPDATE_OUT" TARGET="$TARGET" python3 - <<'PY'
import hashlib
import json
import os

data = json.loads(os.environ["UPDATE_OUT"])
content = open(os.environ["TARGET"], "rb").read()
assert data["operation"] == "updated", data
assert data["previous_sha256"] == os.environ["CREATE_HASH"], data
assert data["sha256"] == hashlib.sha256(content).hexdigest(), data
PY

LIST_OUT="$("$AOS_BIN" wiki list --json)"
LIST_OUT="$LIST_OUT" python3 - <<'PY'
import json
import os

pages = json.loads(os.environ["LIST_OUT"])
assert any(page["path"] == "consumer/concepts/reviewed-fact.md" for page in pages), pages
PY

if "$AOS_BIN" wiki put "$RELATIVE_PATH" --stdin --if-match none --json \
    <"$CONFLICT_INPUT" >"$ROOT/conflict.out" 2>"$ROOT/conflict.err"; then
  echo "FAIL: wiki put accepted create-only precondition for an existing page"
  exit 1
fi

python3 - "$ROOT/conflict.err" <<'PY'
import json
import pathlib
import sys

text = pathlib.Path(sys.argv[1]).read_text()
data = json.loads(text)
assert data["code"] == "WIKI_CONFLICT", data
assert data["exists"] is True, data
assert len(data["actual_sha256"]) == 64, data
assert "PRIVATE_CONFLICT_INPUT_MUST_NOT_ECHO" not in text
assert "Updated public command proof" not in text
PY

echo "PASS"
