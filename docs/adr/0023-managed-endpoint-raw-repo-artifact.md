# ADR 0023: Managed-Endpoint Raw Repo Artifact

**Status:** Accepted
**Date:** 2026-07-12

## Decision

Repo-mode AOS development preserves one direct build shape:

```text
single swiftc link -> ./aos
```

The existing `swiftc` invocation may receive identity-free privacy metadata as
linker input, including `packaging/RepoRuntimeLinkInfo.plist` in
`__TEXT,__info_plist`. It still writes directly to `./aos`. Nothing may link,
sign, copy, move, wrap, rewrite, install, assess, or otherwise transform that
artifact after `swiftc` returns.

This is an intentional, temporary compatibility contract for repository
development, not accidental technical debt.

## Context

Development occurs on an enterprise-managed Mac running Cylance. Alternate
post-processed AOS artifact shapes have repeatedly been terminated by the
managed endpoint with process exit `137`. The surviving development shape is a
raw `aos` executable with linker-generated ad-hoc signing, `Identifier=aos`,
and no TeamIdentifier.

The endpoint behavior is an environmental constraint on local development. It
does not prove that every post-link operation is intrinsically invalid, and it
does not make endpoint termination a build-system recovery signal. Empty
output, timeout, or unrelated readiness failure must not be relabeled exit
`137`.

## Prohibited Corrections

Future agents must not try to “repair” or modernize the repo artifact with:

- a separate `ld` pass;
- post-build `codesign`, including forced ad-hoc signing;
- explicit signing identifiers or organization identifiers;
- entitlements;
- `cp`, `mv`, installer, or replacement staging around `./aos`;
- `install_name_tool` or other binary modification;
- app-bundle wrapping;
- `spctl` acceptance gates or allowlist assumptions.

These restrictions preserve a known endpoint-compatible artifact shape. They
do not disable, evade, bypass, or weaken Cylance or any other endpoint-security
control. A confirmed endpoint kill stops the run for human review; it does not
authorize alternate signing or packaging experiments against live `./aos`.

## Build And First-Launch Gate

The sanctioned recovery build is:

```bash
bash build.sh --force --no-restart
```

After an actual rebuild, the immediately following command is:

```bash
./aos help --json
```

No hash, signature inspection, attestation, readiness command, copy, or other
live-artifact access occurs between those commands. Exit `137` stops the run
without retry. Only after help succeeds may read-only identity inspection and
the bounded post-permission readiness workflow proceed.

Linker experiments compile to a disposable temporary output. Read-only
`codesign` and `otool` inspection may target only that disposable artifact
during implementation review; it is never copied over live `./aos`.

## Deferred Production Path

A proper IT-approved, team-signed, notarized `AOS.app` distribution path is
explicitly deferred. This ADR does not claim that the raw repo artifact is the
production packaging model.

This compatibility contract may retire only when all of the following are
true:

1. IT approves the proposed packaged and signed AOS distribution.
2. The managed endpoint accepts that exact artifact and update path.
3. The packaged runtime provides a stable AOS-owned TCC identity for every
   privileged capability, including daemon-owned microphone capture.
4. AOS and the external Sigil product coordinate and validate the identity,
   install, readiness, and migration change together.

Until all four conditions are evidenced, the direct single-link repo build
remains authoritative.

## Enforcement

`tests/build-rebuild-policy.sh` requires exactly one direct `swiftc` output
invocation, permits the identity-free link-time plist input, and rejects
separate linking, post-link mutation, artifact inspection, and automatic
execution of the new binary. `tests/repo-runtime-link-metadata.sh`
compiles only a disposable artifact and verifies the expected linker ad-hoc,
teamless `aos` identity.

## Consequences

- Build-tool cleanup cannot silently replace this artifact contract.
- Privacy usage descriptions needed by the raw runtime must be supplied during
  the existing link, not by post-processing.
- Live rebuild validation remains an explicit human checkpoint after static
  review; implementation work must not rebuild `./aos` opportunistically.
