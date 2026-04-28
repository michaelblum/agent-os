#!/usr/bin/env bash
set -euo pipefail

MODEL_UID="09d686a1a1f745cba6b2385d0c831214"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [[ -z "${SKETCHFAB_TOKEN:-}" ]]; then
  echo "Set SKETCHFAB_TOKEN to a Sketchfab OAuth token with model download access." >&2
  exit 2
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sigil-brain-hologram.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

DOWNLOAD_JSON="$(
  curl -fsSL \
    -H "authorization: Bearer ${SKETCHFAB_TOKEN}" \
    "https://api.sketchfab.com/v3/models/${MODEL_UID}/download"
)"

GLTF_URL="$(
  python3 -c 'import json, sys; print(json.load(sys.stdin).get("gltf", {}).get("url", ""))' \
    <<<"$DOWNLOAD_JSON"
)"

if [[ -z "$GLTF_URL" ]]; then
  echo "Sketchfab did not return a glTF download URL for model ${MODEL_UID}." >&2
  exit 1
fi

curl -fL "$GLTF_URL" -o "$TMP_DIR/model.zip"
unzip -q "$TMP_DIR/model.zip" -d "$TMP_DIR/extract"

SCENE_FILE="$(find "$TMP_DIR/extract" -name scene.gltf -type f -print -quit)"
if [[ -z "$SCENE_FILE" ]]; then
  echo "Downloaded archive did not contain scene.gltf." >&2
  exit 1
fi

SCENE_DIR="$(dirname "$SCENE_FILE")"
find "$HERE" -mindepth 1 \
  ! -name README.md \
  ! -name fetch.sh \
  -exec rm -rf {} +
cp -R "$SCENE_DIR"/. "$HERE"/

echo "Installed Brain hologram glTF asset at ${HERE}/scene.gltf"
