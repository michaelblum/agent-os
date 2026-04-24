#!/usr/bin/env bash
set -euo pipefail

# Observed schema (as of Task 15): CommandDescriptor paths are single-element
# for `do`, `show`, `focus` — subcommands like `focus create` are distinguished
# by form .id (e.g. "focus-create"), not by a compound path array. (Contrast:
# `see zone` does register as ["see","zone"].) Filter by form id, not by a
# presumed compound path.

j=$(./aos help --json)

must_have() {
    local path="$1"
    echo "$j" | jq -e "$path" >/dev/null || { echo "FAIL missing: $path" >&2; exit 1; }
}

# do fill
must_have '.commands[] | select(.path == ["do"]).forms[] | select(.id == "do-fill")'
# do navigate
must_have '.commands[] | select(.path == ["do"]).forms[] | select(.id == "do-navigate")'
# focus create --target flag surfaced
must_have '.commands[] | select(.path == ["focus"]).forms[] | select(.id == "focus-create") | .args[] | select(.token == "--target")'
# show create --anchor-browser
must_have '.commands[] | select(.path == ["show"]).forms[] | select(.id == "show-create") | .args[] | select(.token == "--anchor-browser")'
# show update --anchor-browser
must_have '.commands[] | select(.path == ["show"]).forms[] | select(.id == "show-update") | .args[] | select(.token == "--anchor-browser")'

echo "PASS"
