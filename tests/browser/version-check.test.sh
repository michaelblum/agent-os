#!/usr/bin/env bash
# Exercises src/browser/playwright-version-check.swift via the hidden
# _check-version helper. Uses a fake playwright-cli on $PATH so the test
# doesn't depend on a real Node/@playwright/cli install.
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"

# Case 1: happy path, new-mode CLI at (or above) the pinned minimum.
# Keep this >= kMinPlaywrightCLIVersion in playwright-version-check.swift.
export FAKE_PWCLI_VERSION="0.1.8"
export FAKE_PWCLI_MODE="new"
out=$(./aos browser _check-version 2>&1)
echo "$out" | grep -q '"status":"ok"' || { echo "FAIL case 1: $out" >&2; exit 1; }

# Case 1b: happy path, strictly-newer version
export FAKE_PWCLI_VERSION="0.2.0"
export FAKE_PWCLI_MODE="new"
out=$(./aos browser _check-version 2>&1)
echo "$out" | grep -q '"status":"ok"' || { echo "FAIL case 1b: $out" >&2; exit 1; }
echo "$out" | grep -q '"version":"0.2.0"' || { echo "FAIL case 1b version echo: $out" >&2; exit 1; }

# Case 2: old-mode CLI — version too old
export FAKE_PWCLI_VERSION="0.1.1"
export FAKE_PWCLI_MODE="old"
if out=$(./aos browser _check-version 2>&1); then
    echo "FAIL case 2: expected error, got success: $out" >&2
    exit 1
fi
echo "$out" | grep -q "PLAYWRIGHT_CLI_TOO_OLD" || { echo "FAIL case 2: $out" >&2; exit 1; }

# Case 3: binary not found on PATH
unset FAKE_PWCLI_VERSION
unset FAKE_PWCLI_MODE
empty_dir="/tmp/empty-$$"
mkdir -p "$empty_dir"
if out=$(PATH="$empty_dir" ./aos browser _check-version 2>&1); then
    rm -rf "$empty_dir"
    echo "FAIL case 3: expected error, got success: $out" >&2
    exit 1
fi
rm -rf "$empty_dir"
echo "$out" | grep -q "PLAYWRIGHT_CLI_NOT_FOUND" || { echo "FAIL case 3: $out" >&2; exit 1; }

# Case 4: REAL bug scenario — npm install layout where `--version` prints the
# internal playwright engine version (e.g. 1.59.0-alpha…) but the
# @playwright/cli package.json reports the true too-old version (0.1.1).
# The probe MUST prefer package.json and raise PLAYWRIGHT_CLI_TOO_OLD.
fakeinstall="/tmp/aos-pwinstall-$$"
mkdir -p "$fakeinstall/bin" "$fakeinstall/lib/node_modules/@playwright/cli"
# package.json reports 0.1.1 (too old)
cat > "$fakeinstall/lib/node_modules/@playwright/cli/package.json" <<'EOF'
{"name":"@playwright/cli","version":"0.1.1"}
EOF
# cli.js (the real entrypoint) prints a misleading `--version` like real CLI does
cat > "$fakeinstall/lib/node_modules/@playwright/cli/cli.js" <<'EOF'
#!/usr/bin/env bash
# Mimics the real playwright-cli: --version prints the playwright-core
# engine version, not the @playwright/cli package version.
if [[ "${1:-}" == "--version" ]]; then
    echo "1.59.0-alpha-1758846115000"
    exit 0
fi
echo "fake cli.js invoked: $*"
exit 0
EOF
chmod +x "$fakeinstall/lib/node_modules/@playwright/cli/cli.js"
# bin/playwright-cli is the symlink npm creates at the global bin dir
ln -s ../lib/node_modules/@playwright/cli/cli.js "$fakeinstall/bin/playwright-cli"

if out=$(PATH="$fakeinstall/bin" ./aos browser _check-version 2>&1); then
    rm -rf "$fakeinstall"
    echo "FAIL case 4: 0.1.1 package.json should error, got success: $out" >&2
    exit 1
fi
echo "$out" | grep -q "PLAYWRIGHT_CLI_TOO_OLD" || {
    rm -rf "$fakeinstall"
    echo "FAIL case 4 code: $out" >&2; exit 1
}
echo "$out" | grep -q "0.1.1" || {
    rm -rf "$fakeinstall"
    echo "FAIL case 4 should cite 0.1.1 not 1.59: $out" >&2; exit 1
}

# Case 5: same layout, bump package.json to 0.1.8 — now should pass,
# source annotated as package.json (not binary-version).
cat > "$fakeinstall/lib/node_modules/@playwright/cli/package.json" <<'EOF'
{"name":"@playwright/cli","version":"0.1.8"}
EOF
out=$(PATH="$fakeinstall/bin" ./aos browser _check-version 2>&1)
echo "$out" | grep -q '"status":"ok"' || {
    rm -rf "$fakeinstall"
    echo "FAIL case 5: $out" >&2; exit 1
}
echo "$out" | grep -q '"version":"0.1.8"' || {
    rm -rf "$fakeinstall"
    echo "FAIL case 5 version: $out" >&2; exit 1
}
echo "$out" | grep -q '"source":"package.json"' || {
    rm -rf "$fakeinstall"
    echo "FAIL case 5 source (want package.json): $out" >&2; exit 1
}
rm -rf "$fakeinstall"

echo "PASS"
