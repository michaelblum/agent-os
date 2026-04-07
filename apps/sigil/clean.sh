#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

paths=(
  "$PWD/build"
  "$PWD/avatar-sub"
)

removed_any=false
for path in "${paths[@]}"; do
  if [[ -e "$path" ]]; then
    rm -rf "$path"
    echo "removed $path"
    removed_any=true
  fi
done

if [[ "$removed_any" == false ]]; then
  echo "no Sigil build artifacts found"
fi
