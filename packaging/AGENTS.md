@../AGENTS.md

# Packaging

## Purpose

`packaging/` contains repo-runtime packaging metadata used by build and signing
experiments, including the embedded runtime `Info.plist` and entitlements file.

## Ownership

- `Info.plist` owns bundle identity and privacy usage-description strings for
  the repo-mode `aos` runtime.
- `aos.entitlements` owns the entitlement set used by packaged runtime signing.

## Local Contracts

- Keep the default development build path opt-in free; packaged behavior must
  stay behind an explicit build flag until promoted by a durable decision.
- Keep `CFBundleIdentifier` aligned with the repo runtime signing identifier.
- Keep entitlements minimal and evidence-backed. Do not add broad automation,
  sandbox, or hardened-runtime exceptions without a proof note or owning doc.

## Work Guidance

- Prefer additive packaging experiments that preserve the top-level `./aos`
  invocation unless a decision record adopts a bundle shape.
- Record option comparisons and TCC proof results in `docs/proposals/` or a
  narrower durable owner before treating packaging metadata as release policy.

## Verification

- Run `plutil -lint packaging/Info.plist packaging/aos.entitlements` after
  metadata edits.
- Run `bash tests/build-rebuild-policy.sh` after `build.sh`, repo-mode build
  wrapper, or signing metadata edits.

## Child DOX Index
