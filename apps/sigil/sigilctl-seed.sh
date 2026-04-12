#!/bin/bash
# sigilctl-seed.sh — Seed Sigil's wiki documents (agents, etc.) into the AOS wiki.
#
# Idempotent: relies on `aos wiki seed --namespace --file` (seedIfAbsent
# semantics). Running twice is a no-op on the second pass.
#
# Usage:
#   apps/sigil/sigilctl-seed.sh [--mode repo|installed]
#
# Sources the seed payload from apps/sigil/seed/wiki/sigil/<...>, so the
# committed repo copy is always authoritative regardless of runtime mode.
set -euo pipefail

cd "$(dirname "$0")"
SIGIL_DIR="$(pwd)"
REPO_ROOT="$(cd ../.. && pwd)"

MODE="${AOS_RUNTIME_MODE:-repo}"
if [[ "${1:-}" == "--mode" ]]; then
  MODE="${2:-}"
  shift 2 || true
fi
if [[ "$MODE" != "repo" && "$MODE" != "installed" ]]; then
  echo "Mode must be 'repo' or 'installed'." >&2
  exit 1
fi

INSTALLED_AOS_APP="$HOME/Applications/AOS.app"
INSTALLED_AOS_BIN="$INSTALLED_AOS_APP/Contents/MacOS/aos"
if [[ -n "${AOS_BIN:-}" ]]; then
  :
elif [[ "$MODE" == "installed" ]]; then
  AOS_BIN="$INSTALLED_AOS_BIN"
else
  AOS_BIN="$REPO_ROOT/aos"
fi

if [[ ! -x "$AOS_BIN" ]]; then
  echo "aos binary not found at $AOS_BIN; build it first (bash build.sh)." >&2
  exit 1
fi

SEED_ROOT="$SIGIL_DIR/seed/wiki/sigil"
if [[ ! -d "$SEED_ROOT" ]]; then
  echo "Seed payload not found at $SEED_ROOT" >&2
  exit 1
fi

# Collect every .md under seed/wiki/sigil/ and build --file <rel>:<absolute>
# pairs for a single `aos wiki seed --namespace sigil ...` invocation.
FILE_ARGS=()
while IFS= read -r abs; do
  rel="${abs#$SEED_ROOT/}"
  FILE_ARGS+=("--file" "$rel:$abs")
done < <(find "$SEED_ROOT" -type f -name '*.md' | sort)

if (( ${#FILE_ARGS[@]} == 0 )); then
  echo "No seed files found under $SEED_ROOT"
  exit 0
fi

AOS_RUNTIME_MODE="$MODE" "$AOS_BIN" wiki seed --namespace sigil "${FILE_ARGS[@]}"
