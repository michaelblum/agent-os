#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

AOS="${AOS:-./aos}"
WIKI_ID="utility-wiki-workbench"
STAGE_ID="aos-desktop-world-stage"
LOG_FILE="${HOME}/.config/aos/repo/daemon.log"

cleanup() {
  "$AOS" show remove --id "$WIKI_ID" >/dev/null 2>&1 || true
  "$AOS" show remove --id "$STAGE_ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
start_line=0
if [[ -f "$LOG_FILE" ]]; then
  start_line="$(wc -l < "$LOG_FILE" | tr -d ' ')"
fi

"$AOS" ready --json >/dev/null
sleep 0.2
"$AOS" ready --json >/dev/null
"$AOS" config set content.roots.toolkit "$ROOT/packages/toolkit" >/dev/null
"$AOS" content wait --root toolkit --auto-start --allow-start --timeout 15s >/dev/null

create_wiki_workbench() {
  "$AOS" show create \
    --id "$WIKI_ID" \
    --allow-start \
    --url "aos://toolkit/components/wiki-subject-browser/index.html?wiki=aos/concepts/runtime-modes.md" \
    --at 80,80,900,620 \
    --interactive \
    --focus >/dev/null
  "$AOS" show wait --id "$WIKI_ID" --manifest wiki-subject-browser-v0 --timeout 30s --json
}

create_err="$ROOT/.utility-warm-create.err"
if ! create_wiki_workbench >/dev/null 2>"$create_err"; then
  if "$AOS" ready --json >/dev/null && "$AOS" show get --id "$WIKI_ID" | python3 -c 'import json,sys; raise SystemExit(0 if not json.load(sys.stdin).get("exists") else 1)'; then
    create_wiki_workbench >/dev/null
  else
    cat "$create_err" >&2
    echo "wiki workbench create failed without absent-canvas daemon handoff recovery state" >&2
    exit 1
  fi
fi
rm -f "$create_err"

first_window_numbers="$("$AOS" show get --id "$WIKI_ID" | python3 -c 'import json,sys; data=json.load(sys.stdin); print(",".join(map(str, (data.get("canvas") or {}).get("windowNumbers") or [])))')"

for _ in 1 2 3; do
  "$AOS" show eval --id "$WIKI_ID" --js 'document.querySelector(".aos-window-close").click(); "closed"' >/dev/null
  python3 - "$("$AOS" show get --id "$WIKI_ID")" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
canvas = data.get("canvas") or {}
if not data.get("exists"):
    raise SystemExit("wiki workbench was removed instead of retained")
if canvas.get("lifecycle_state") not in ("warm_suspended", "suspended") and canvas.get("suspended") is not True:
    raise SystemExit(f"wiki workbench was not suspended: {canvas}")
PY
  "$AOS" show eval --id "$WIKI_ID" --js 'window.webkit.messageHandlers.headsup.postMessage({type:"canvas.resume",payload:{id:"utility-wiki-workbench"}}); "resume-requested"' >/dev/null
  for _ in 1 2 3 4 5; do
    if python3 - "$("$AOS" show get --id "$WIKI_ID")" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
canvas = data.get("canvas") or {}
raise SystemExit(0 if data.get("exists") and canvas.get("suspended") is not True else 1)
PY
    then
      break
    fi
    sleep 0.2
  done
  python3 - "$("$AOS" show get --id "$WIKI_ID")" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
canvas = data.get("canvas") or {}
if not data.get("exists"):
    raise SystemExit("wiki workbench disappeared after resume")
if canvas.get("lifecycleState") != "active" and canvas.get("suspended") is True:
    raise SystemExit(f"wiki workbench was not active after resume: {canvas}")
PY
done

last_window_numbers="$("$AOS" show get --id "$WIKI_ID" | python3 -c 'import json,sys; data=json.load(sys.stdin); print(",".join(map(str, (data.get("canvas") or {}).get("windowNumbers") or [])))')"
if [[ -n "$first_window_numbers" && "$first_window_numbers" != "$last_window_numbers" ]]; then
  echo "wiki workbench did not retain the same canvas instance" >&2
  exit 1
fi

if [[ -f "$LOG_FILE" ]]; then
  tail -n "+$((start_line + 1))" "$LOG_FILE" | grep -E 'DUPLICATE_ID|WIKI_DB_ERROR|database is locked' && {
    echo "warm lifecycle log contained duplicate create or wiki DB lock evidence" >&2
    exit 1
  }
fi

"$AOS" status --json | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data["status"] == "ok", data'
"$AOS" clean --dry-run --json | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data["status"] == "clean", data'
