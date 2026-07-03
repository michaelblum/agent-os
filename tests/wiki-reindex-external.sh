#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-wiki-reindex.XXXXXX")"
ROOT="$(cd "$ROOT" && pwd -P)"
export AOS_STATE_ROOT="$ROOT"
trap 'rm -rf "$ROOT"' EXIT

OUT="$(./aos wiki reindex --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data == {"links": 0, "pages": 0, "plugins": 0, "status": "ok"}, data
PY

./aos wiki seed --json >/dev/null

OUT="$(./aos wiki reindex --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "ok", data
assert data["pages"] > 0, data
assert data["plugins"] > 0, data
PY

OUT="$(./aos wiki list --type workflow --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

pages = json.loads(os.environ["OUT"])
assert any(page["path"] == "aos/plugins/self-check/SKILL.md" for page in pages), pages
PY

OUT="$(./aos wiki search 'IPC Protocol' --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

pages = json.loads(os.environ["OUT"])
assert any(page["path"] == "aos/concepts/ipc-protocol.md" for page in pages), pages
PY

mkdir -p "$ROOT/repo/wiki/aos/entities"
cat > "$ROOT/repo/wiki/aos/entities/reindex-link-source.md" <<'EOF'
---
type: entity
name: Reindex Link Source
tags: [test]
---

# Reindex Link Source

## Related

- [Gateway](gateway.md)
EOF

./aos wiki reindex --json >/dev/null
OUT="$(./aos wiki list --links-from aos/entities/reindex-link-source.md --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

links = json.loads(os.environ["OUT"])
assert links == [{"source_path": "aos/entities/reindex-link-source.md", "target_path": "aos/entities/gateway.md"}], links
PY

printf '\xff\xfe\x00' > "$ROOT/repo/wiki/aos/entities/reindex-invalid-utf8.md"
if ./aos wiki reindex --json >"$ROOT/wiki-reindex-invalid.out" 2>"$ROOT/wiki-reindex-invalid.err"; then
  echo "FAIL: wiki reindex accepted invalid UTF-8 markdown"
  exit 1
fi
grep -q '"code": "WIKI_REINDEX_FAILED"' "$ROOT/wiki-reindex-invalid.err" || {
  echo "FAIL: wiki reindex invalid markdown did not use structured failure"
  cat "$ROOT/wiki-reindex-invalid.err"
  exit 1
}
OUT="$(./aos wiki list --links-from aos/entities/reindex-link-source.md --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

links = json.loads(os.environ["OUT"])
assert links == [{"source_path": "aos/entities/reindex-link-source.md", "target_path": "aos/entities/gateway.md"}], links
PY
rm "$ROOT/repo/wiki/aos/entities/reindex-invalid-utf8.md"

if ./aos wiki reindex --bogus 2>"$ROOT/wiki-reindex-bogus.err"; then
  echo "FAIL: wiki reindex accepted unknown flag"
  exit 1
fi
grep -q '"code": "UNKNOWN_FLAG"' "$ROOT/wiki-reindex-bogus.err" || {
  echo "FAIL: wiki reindex unknown flag did not use external script error contract"
  cat "$ROOT/wiki-reindex-bogus.err"
  exit 1
}

if ./aos wiki reindex extra 2>"$ROOT/wiki-reindex-extra.err"; then
  echo "FAIL: wiki reindex accepted extra positional"
  exit 1
fi
grep -q '"code": "UNKNOWN_ARG"' "$ROOT/wiki-reindex-extra.err" || {
  echo "FAIL: wiki reindex extra positional did not use UNKNOWN_ARG"
  cat "$ROOT/wiki-reindex-extra.err"
  exit 1
}
grep -q '"error": "Unknown argument: extra"' "$ROOT/wiki-reindex-extra.err" || {
  echo "FAIL: wiki reindex extra positional message did not say Unknown argument"
  cat "$ROOT/wiki-reindex-extra.err"
  exit 1
}

echo "PASS"
