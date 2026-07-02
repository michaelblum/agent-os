write_failing_capture_aos() {
    local file="$1"
    cat >"$file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    echo "primitive exploded" >&2
    exit 7
fi

echo "unexpected failing aos invocation: $*" >&2
exit 2
SH
    chmod +x "$file"
}

write_native_file_capture_aos() {
    local file="$1"
    cat >"$file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    out=""
    args=("$@")
    i=0
    while [[ "$i" -lt "${#args[@]}" ]]; do
        if [[ "${args[$i]}" == "--out" ]]; then
            next=$((i + 1))
            if [[ "$next" -ge "${#args[@]}" ]]; then
                echo "--out missing value" >&2
                exit 2
            fi
            out="${args[$next]}"
        fi
        i=$((i + 1))
    done
    if [[ -z "$out" ]]; then
        echo "saved native capture must pass --out" >&2
        exit 9
    fi
    mkdir -p "$(dirname "$out")"
    printf 'native image artifact\n' >"$out"
    python3 - "$out" <<'PY'
import json
import sys

out = sys.argv[1]
print(json.dumps({
    "status": "success",
    "state_id": "see_native_file_fixture",
    "files": [out],
    "elements": [{
        "ref": "native-file-install",
        "app_pid": 4242,
        "app_name": "Fixture",
        "window_id": 5150,
        "role": "AXButton",
        "title": "Install",
        "label": "Install fixture",
        "identifier": "install-button",
        "value": "ready",
        "enabled": True,
        "action_names": ["AXPress"],
        "permission_state": "granted",
        "bounds": {"x": 10, "y": 20, "width": 80, "height": 24},
        "context_path": ["app:Fixture", "window:Main"],
    }],
}))
PY
    exit 0
fi

echo "unexpected native file capture invocation: $*" >&2
exit 2
SH
    chmod +x "$file"
}
