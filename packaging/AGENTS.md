@../AGENTS.md

# Packaging

## Purpose

`packaging/` contains packaged-runtime metadata used by signing experiments,
including the runtime `Info.plist` and entitlements file.

## Ownership

- `Info.plist` owns bundle identity and privacy usage-description strings for
  packaged runtime experiments, not the raw repo binary.
- `aos.entitlements` owns the entitlement set used by packaged runtime signing.

## Local Contracts

- Keep the default development build path opt-in free; packaged behavior must
  stay behind an explicit build flag until promoted by a durable decision.
- Raw repo builds must not consume packaging metadata or inject plist sections.
  ADR 0023 owns that managed-endpoint compatibility contract.
- Keep packaged `CFBundleIdentifier` aligned with its packaged signing owner;
  it must never flow into the raw repo link.
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
