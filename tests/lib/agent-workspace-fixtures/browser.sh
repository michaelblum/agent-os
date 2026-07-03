write_fake_form_aos() {
    local file="$1"
    cat >"$file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    if [[ "${FORM_STALE:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_form_fixture_stale",
  "files": [],
  "elements": [
    {
      "ref": "e43",
      "role": "textbox",
      "title": "Search",
      "enabled": true,
      "context_path": ["browser:form"]
    }
  ]
}
JSON
        exit 0
    fi
    if [[ "${FORM_AMBIGUOUS:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_form_fixture_ambiguous",
  "files": [],
  "elements": [
    {
      "ref": "e42",
      "role": "textbox",
      "title": "Search",
      "label": "Search field",
      "enabled": true,
      "context_path": ["browser:form"]
    },
    {
      "ref": "e42",
      "role": "textbox",
      "title": "Search",
      "label": "Search field",
      "enabled": true,
      "context_path": ["browser:form", "duplicate"]
    }
  ]
}
JSON
        exit 0
    fi
    role="textbox"
    title="Search"
    label="Search field"
    enabled="true"
    context='["browser:form"]'
    bounds='{"x":10,"y":20,"width":200,"height":24}'
    if [[ "${FORM_ROLE_DRIFT:-0}" == "1" ]]; then role="button"; fi
    if [[ "${FORM_TITLE_DRIFT:-0}" == "1" ]]; then title="Find"; fi
    if [[ "${FORM_LABEL_DRIFT:-0}" == "1" ]]; then label="Find field"; fi
    if [[ "${FORM_DISABLED:-0}" == "1" ]]; then enabled="false"; fi
    if [[ "${FORM_CONTEXT_DRIFT:-0}" == "1" ]]; then context='["browser:form","search-panel"]'; fi
    if [[ "${FORM_MOVED:-0}" == "1" ]]; then bounds='{"x":48,"y":112,"width":200,"height":24}'; fi
    python3 - "$role" "$title" "$label" "$enabled" "$context" "$bounds" <<'PY'
import json
import sys

print(json.dumps({
    "status": "success",
    "state_id": "see_form_fixture",
    "files": [],
    "elements": [{
        "ref": "e42",
        "role": sys.argv[1],
        "title": sys.argv[2],
        "label": sys.argv[3],
        "enabled": sys.argv[4] == "true",
        "context_path": json.loads(sys.argv[5]),
        "bounds": json.loads(sys.argv[6]),
    }],
}))
PY
    exit 0
fi

if [[ "${1:-}" == "do" && "${2:-}" == "fill" && "${3:-}" == "browser:form/e42" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

print(json.dumps({
    "status": "success",
    "execution": {"backend": "playwright", "strategy": "fake_form_fill"},
    "received": sys.argv[1:],
}))
PY
    exit 0
fi

if [[ "${1:-}" == "do" && "${2:-}" == "type" && "${3:-}" == "browser:form/e42" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

print(json.dumps({
    "status": "success",
    "execution": {"backend": "playwright", "strategy": "fake_form_type"},
    "received": sys.argv[1:],
}))
PY
    exit 0
fi

if [[ "${1:-}" == "do" && "${2:-}" == "key" && "${3:-}" == "browser:form/e42" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

print(json.dumps({
    "status": "success",
    "execution": {"backend": "playwright", "strategy": "fake_form_key"},
    "received": sys.argv[1:],
}))
PY
    exit 0
fi

if [[ "${1:-}" == "do" && "${2:-}" == "click" && "${3:-}" == "browser:form/e42" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

print(json.dumps({
    "status": "success",
    "execution": {"backend": "playwright", "strategy": "fake_form_click"},
    "received": sys.argv[1:],
}))
PY
    exit 0
fi

echo "unexpected fake form aos invocation: $*" >&2
exit 2
SH
    chmod +x "$file"
}

write_non_click_ref_literal_aos() {
    local file="$1"
    cat >"$file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__do" && "${2:-}" == "type" && "${3:-}" == "ref:literal" ]]; then
    python3 - "$@" <<'PY'
import json
import sys

print(json.dumps({
    "status": "success",
    "received": sys.argv[1:],
}))
PY
    exit 0
fi

echo "unexpected non-click aos invocation: $*" >&2
exit 2
SH
    chmod +x "$file"
}
