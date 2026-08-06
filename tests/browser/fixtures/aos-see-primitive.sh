#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "__see" || "${2:-}" != "capture" ]]; then
    printf '%s\n' '{"code":"UNKNOWN_COMMAND","error":"fake supports only __see capture"}' >&2
    exit 1
fi
shift 2

target="${1:-}"
if [[ -z "$target" ]]; then
    printf '%s\n' '{"code":"MISSING_ARG","error":"capture target is required"}' >&2
    exit 1
fi
shift

if [[ "$target" == "browser:" && -z "${PLAYWRIGHT_CLI_SESSION:-}" ]]; then
    printf '%s\n' '{"code":"MISSING_SESSION","error":"PLAYWRIGHT_CLI_SESSION not set"}' >&2
    exit 1
fi

output=""
xray=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --out)
            output="${2:-}"
            shift 2
            ;;
        --xray)
            xray=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

if [[ -n "$output" ]]; then
    printf '\211PNG\r\n\032\nfixture' > "$output"
fi

if [[ "$xray" == true ]]; then
    printf '%s\n' '{"state_id":"see_test","elements":[{"ref":"e2","role":"button","label":"Click me","bounds":null,"handle":{"kind":"observation_ref","backend":"browser","state_id":"see_test","scope":{"session":"todo"},"ref":"e2"}}]}'
else
    printf '%s\n' '{"state_id":"see_screen","elements":[]}'
fi
