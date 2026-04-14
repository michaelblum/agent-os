# AOS.app Packaging Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `package.sh` that builds all binaries and assembles a self-contained `AOS.app` bundle with all web assets, so installed-mode needs no repo checkout.

**Architecture:** Single shell script at repo root. Stages the `.app` bundle in a temp directory, copies binaries to `Contents/MacOS/`, web assets to `Contents/Resources/agent-os/`, writes `Info.plist`, ad-hoc codesigns, then moves to `~/Applications/AOS.app`. No Swift changes needed — the runtime code already resolves bundled paths via `aosBundledRepoRoot()`.

**Tech Stack:** Bash, rsync, codesign

---

### Task 1: Create package.sh

**Files:**
- Create: `package.sh`

- [ ] **Step 1: Write the script**

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
REPO_ROOT="$PWD"

APP_NAME="AOS"
BUNDLE_ID="com.agent-os.aos"
VERSION="0.1.0"
BUILD_VERSION="$(date +%Y.%m.%d.%H%M%S)"
INSTALL_DIR="$HOME/Applications"
APP_PATH="$INSTALL_DIR/$APP_NAME.app"
STAGE_DIR="$(mktemp -d)"
STAGED_APP="$STAGE_DIR/$APP_NAME.app"

echo "=== AOS Packaging ==="
echo "Version: $VERSION ($BUILD_VERSION)"

# ── 1. Build binaries ──────────────────────────────────────────────
echo ""
echo "Building aos..."
bash build.sh

echo ""
echo "Building avatar-sub..."
bash apps/sigil/build-avatar.sh

# ── 2. Assemble .app bundle ────────────────────────────────────────
echo ""
echo "Assembling $APP_NAME.app..."

mkdir -p "$STAGED_APP/Contents/MacOS"
mkdir -p "$STAGED_APP/Contents/Resources/agent-os"

# Binaries
cp aos "$STAGED_APP/Contents/MacOS/aos"
cp apps/sigil/build/avatar-sub "$STAGED_APP/Contents/MacOS/avatar-sub"

# ── 3. Copy web assets ─────────────────────────────────────────────
# apps/sigil — HTML surfaces (renderer, studio, chat) + config JSON
# Exclude: Swift source, shell scripts, build dir, CLAUDE.md, sigilctl, DS_Store
rsync -a \
    --include='*/' \
    --include='*.html' --include='*.js' --include='*.mjs' \
    --include='*.css' --include='*.json' --include='*.glsl' \
    --include='*.svg' --include='*.png' --include='*.jpg' \
    --include='*.woff' --include='*.woff2' --include='*.wasm' \
    --exclude='*' \
    apps/sigil/ "$STAGED_APP/Contents/Resources/agent-os/apps/sigil/"

# packages/toolkit — reusable HTML components
rsync -a \
    --include='*/' \
    --include='*.html' --include='*.js' --include='*.mjs' \
    --include='*.css' --include='*.json' \
    --exclude='*' \
    packages/toolkit/ "$STAGED_APP/Contents/Resources/agent-os/packages/toolkit/"

# ── 4. Info.plist ──────────────────────────────────────────────────
cat > "$STAGED_APP/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleVersion</key>
  <string>$BUILD_VERSION</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>aos</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

# ── 5. Codesign (ad-hoc) ──────────────────────────────────────────
echo "Signing..."
codesign -s - -f --deep "$STAGED_APP"

# ── 6. Install ─────────────────────────────────────────────────────
echo ""
echo "Installing to $APP_PATH..."
mkdir -p "$INSTALL_DIR"

# Stop installed-mode daemon if running
if "$APP_PATH/Contents/MacOS/aos" service status --json 2>/dev/null | grep -q '"running"'; then
    echo "Stopping installed-mode daemon..."
    "$APP_PATH/Contents/MacOS/aos" service stop 2>/dev/null || true
fi

# Replace existing bundle
rm -rf "$APP_PATH"
mv "$STAGED_APP" "$APP_PATH"
rm -rf "$STAGE_DIR"

echo ""
echo "=== Done ==="
echo "$APP_PATH ($(du -sh "$APP_PATH" | cut -f1 | xargs))"
echo ""
echo "Bundled content:"
find "$APP_PATH/Contents/Resources/agent-os" -type f | wc -l | xargs echo "  files:"
echo "  sentinel: $(test -f "$APP_PATH/Contents/Resources/agent-os/packages/toolkit/components/inspector-panel.html" && echo "OK" || echo "MISSING")"
echo ""
echo "Verify: $APP_PATH/Contents/MacOS/aos runtime status --json"
```

- [ ] **Step 2: Make executable**

Run: `chmod +x package.sh`

- [ ] **Step 3: Commit**

```bash
git add package.sh
git commit -m "feat: add package.sh — assembles self-contained AOS.app bundle"
```

### Task 2: Verify the bundle

- [ ] **Step 1: Run package.sh**

Run: `bash package.sh`

Expected: Builds both binaries, assembles .app, signs, installs to `~/Applications/AOS.app`. Sentinel check prints "OK".

- [ ] **Step 2: Check bundled content resolves**

Run: `~/Applications/AOS.app/Contents/MacOS/aos runtime status --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('mode:', d['mode']); print('repo_root:', d.get('repo_root', 'NONE'))"`

Expected: `mode: installed`, `repo_root: .../AOS.app/Contents/Resources/agent-os`

- [ ] **Step 3: Spot-check asset presence**

Run:
```bash
ls ~/Applications/AOS.app/Contents/Resources/agent-os/apps/sigil/renderer/index.html
ls ~/Applications/AOS.app/Contents/Resources/agent-os/apps/sigil/studio/index.html
ls ~/Applications/AOS.app/Contents/Resources/agent-os/apps/sigil/chat/index.html
ls ~/Applications/AOS.app/Contents/Resources/agent-os/packages/toolkit/components/inspector-panel.html
ls ~/Applications/AOS.app/Contents/Resources/agent-os/packages/toolkit/components/log-console.html
ls ~/Applications/AOS.app/Contents/Resources/agent-os/packages/toolkit/components/_base/bridge.js
```

Expected: All files exist (no "No such file or directory").

- [ ] **Step 4: Verify codesigning**

Run: `codesign -v ~/Applications/AOS.app && echo "Signature valid"`

Expected: `Signature valid`
