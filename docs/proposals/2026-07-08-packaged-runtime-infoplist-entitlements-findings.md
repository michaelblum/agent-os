# Packaged-Runtime `Info.plist` / `.entitlements` Findings

> **Historical only.** ADR 0023 supersedes this experiment as build authority.
> Its `--package`, post-link signing, entitlements, explicit identifier, and
> direct-readiness commands must not be run against repo-mode `./aos`. Git
> history preserves the evidence; the active contract is one direct `swiftc`
> link with identity-free repo metadata and `./aos help --json` as the first
> post-build launch.

- **Date tested:** 2026-07-08 EDT
- **Machine:** macOS 26.5.1 (25F80), arm64, Apple M1 Pro
- **Branch:** `perplexity-packaged-runtime-infoplist-entitlements-spike`
- **Related proposal:** `docs/proposals/2026-07-08-packaged-runtime-infoplist-entitlements-spike.md`

## Result

The option A prototype works as an additive build path:

```bash
bash build.sh --package --force --no-restart
```

That path keeps the top-level `./aos` executable shape, embeds
`packaging/Info.plist` into `__TEXT,__info_plist`, and signs with
`packaging/aos.entitlements`. The default `build.sh` path remains un-packaged.

This is a **go** as an interim build flag for embedding privacy usage strings
and testing repo-mode identity. It is **not enough** to declare the launchd
daemon TCC reset/regrant problem solved.

## Implemented Prototype

- `packaging/Info.plist`
  - `CFBundleIdentifier=com.agentos.repo-aos`
  - standard `CFBundle*` keys and `LSMinimumSystemVersion=26.0`
  - `NSMicrophoneUsageDescription`
  - `NSSpeechRecognitionUsageDescription`
  - `NSAppleEventsUsageDescription`
- `packaging/aos.entitlements`
  - empty dictionary by design for this pass
- `build.sh --package`
  - adds linker flags for `-sectcreate __TEXT __info_plist`
  - signs with `--entitlements packaging/aos.entitlements`
  - keeps `--options runtime` deferred
  - uses `AOS_CODESIGN_IDENTITY` when set, defaulting to the current ad-hoc `-`
  - fingerprints `dev+package` separately from `dev`

## Verification

Passed:

```bash
bash -n build.sh
plutil -lint packaging/Info.plist packaging/aos.entitlements
bash build.sh --force --no-restart
bash build.sh --package --force --no-restart
codesign --verify --deep --strict --verbose=4 ./aos
codesign -d --entitlements :- ./aos
otool -s __TEXT __info_plist ./aos | ... | plutil -p -
bash tests/build-signing.sh
```

The packaged binary reported:

```text
Identifier=com.agentos.repo-aos
Signature=adhoc
TeamIdentifier=not set
Info.plist entries=12
```

The embedded plist round-tripped with the expected bundle id and usage strings.
The entitlements readback was an empty plist dictionary.

## TCC Persistence Proof

CLI-side permission booleans survived ad-hoc CDHash changes:

- packaged ad-hoc + entitlements: `CDHash=5fcc455e...`
- ad-hoc + Hardened Runtime test signature: `CDHash=a3c73932...`
- packaged rebuild through `build.sh --package --force --no-restart`:
  `CDHash=591d8f62...`

After those changes, `./aos permissions check --json` still reported:

```json
{
  "accessibility": true,
  "screen_recording": true,
  "listen_access": true,
  "post_access": true
}
```

That is evidence that, for the foreground CLI path on this machine, fixed
identifier + path + embedded plist can survive ad-hoc CDHash churn. A stable
self-signed cert was not required for this CLI-side proof.

The launchd-managed daemon proof did **not** pass. After:

```bash
./aos permissions reset-runtime --mode repo
./aos permissions setup --once
./aos ready --post-permission --json
./aos ready --json
```

readiness remained:

```text
status=degraded
diagnosis=daemon_tcc_grant_stale_or_missing
blockers=accessibility,input_tap_not_active,input_monitoring_listen,input_monitoring_post
```

`reset-runtime` also reported:

```text
Targeted tccutil reset is unavailable for the bare repo ./aos binary because it is not a LaunchServices app bundle.
```

So option A improves the executable metadata, but it does not give repo-mode
`./aos` the LaunchServices app identity needed for targeted reset/regrant
handling.

## Option A vs. Option B

Option A is the right low-disruption prototype:

- keeps `./aos` as a single executable
- embeds the required mic, speech-recognition, and Apple Events usage strings
- proves foreground CLI permissions can survive ad-hoc CDHash churn
- leaves normal dev builds unchanged

Option A limitations:

- `mdls` still reports `kMDItemCFBundleIdentifier = (null)` and
  `kMDItemContentType = public.unix-executable`
- targeted `tccutil` reset remains unavailable for the bare executable
- launchd-managed daemon readiness still sees stale/missing TCC grants

Option B, a real `.app` bundle, is the likely follow-on for the daemon problem:

- LaunchServices should recognize the bundle identity
- targeted reset/regrant can operate on an app bundle instead of a raw Mach-O
- the service/LaunchAgent path and relaunch logic must be updated deliberately

Recommendation: keep option A as the branch prototype and use it to unblock
usage-string validation. Do not claim it solves daemon TCC persistence. Open the
follow-on implementation around option B if the product goal is stable daemon
permission recovery.

## Hardened Runtime

Hardened Runtime was tested manually with:

```bash
codesign --force --sign - --identifier com.agentos.repo-aos \
  --options runtime --entitlements packaging/aos.entitlements ./aos
```

`./aos permissions check --json` still preserved the CLI permission booleans.
Adoption is deferred because the Kokoro/local-model direction has not yet been
tested for dylib loading, mmap behavior, subprocess execution, or any required
`com.apple.security.cs.*` exceptions.

## Entitlements

The entitlement file stays empty for this pass. Current `src/**` uses
`NSAppleScript` for `aos do tell`, so the plist includes
`NSAppleEventsUsageDescription`. There is not yet evidence that the
non-sandboxed repo binary needs `com.apple.security.automation.apple-events`.

Do not add sandbox, Apple Events, audio-input, or code-signing exception
entitlements until a focused proof requires them.

## Deferred

- Live microphone / speech-recognition prompt test: no dictation code path has
  landed yet, so this pass only proves the usage strings are embedded.
- Self-signed and Developer ID signing: not needed for the foreground CLI proof;
  daemon behavior points first to bundle shape, not certificate identity.
- Notarization and distribution policy.
- Option B `.app` bundle implementation and service/LaunchAgent migration.
