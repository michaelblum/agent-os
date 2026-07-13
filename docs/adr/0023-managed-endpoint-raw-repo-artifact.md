# ADR 0023: Managed-Endpoint Raw Repo Artifact

**Status:** Accepted
**Date:** 2026-07-12

## Decision

Repo-mode AOS development preserves one direct build shape:

```text
single swiftc link -> ./aos
```

The authoritative invocation is root `build.sh`: it fingerprints source inputs
inline, links plain Swift inputs plus `-lsqlite3` directly to `./aos`, and
reports the resulting size. It receives no injected plist or other metadata
section. Nothing may separately link, sign, copy, move, wrap, rewrite, install,
assess, or otherwise transform that artifact after `swiftc` returns. The
sanctioned recovery invocation always includes `--no-restart`, so the rebuilt
binary is not executed before `build.sh` exits.

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
without retry. If help succeeds, stop immediately for the human TCC checkpoint.
Do not inspect the live artifact or run another command. After the user
manually regrants TCC and replies `finished`, the exact next command is:

```bash
./aos ready --repair --post-permission --json
```

No identity inspection, status command, permission probe, or other operation
may intervene between successful help, the human checkpoint, and that bounded
resume command.

Linker experiments compile to a disposable temporary output. Read-only
`codesign` and `otool` inspection may target only that disposable artifact
during implementation review; it is never copied over live `./aos`.

## Raw TCC Identity Consequences

The raw executable's linker-generated identity does not make `./aos` a
LaunchServices app bundle. Raw code-signing identity and packaged app identity
are not interchangeable.

On this development Mac, the identifier-scoped command:

```bash
/usr/bin/tccutil reset Microphone aos
```

fails with OSStatus `-10814` because LaunchServices cannot resolve `aos` as a
bundle identifier. Do not retry with a path, edit the TCC database directly,
or broaden the command to `tccutil reset Microphone`; an unscoped service reset
changes Microphone decisions for every app. Service-wide resets remain the
explicit break-glass path already guarded by `aos permissions reset-runtime`.

The normal raw-runtime recovery remains human-owned:

- Accessibility, Input Monitoring, and Screen & System Audio Recording use
  their existing System Settings rows and manual remove/re-add or toggle flow.
- Microphone exposes a toggle rather than add/remove controls. Turning it off
  revokes access but does not remove the row; first-use authorization must be
  requested by the AOS daemon-owned microphone broker.
- Developer Tools permission does not replace any TCC grant and is not a
  Cylance exception. AOS does not require that additional authority for this
  workflow.

Successful `help --json` is the stop signal for the human checkpoint, not
authorization to inspect or continue. A later `137` observed after violating
that stop is not valid evidence that all execution of the raw artifact is
blocked. Exit `137` from the prescribed sequence still stops the run without
retry, alternate processing, or a second rebuild.

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

`tests/build-rebuild-policy.sh` requires inline source fingerprinting and
exactly one plain direct `swiftc` output invocation. It rejects metadata-section
injection, separate linking, and post-link mutation, and proves that the
sanctioned `--no-restart` path does not execute the new binary.

## Consequences

- Build-tool cleanup cannot silently replace this artifact contract.
- Privacy usage descriptions belong to the packaged runtime. They must not
  change the managed-endpoint raw artifact shape.
- Live rebuild validation remains an explicit human checkpoint after static
  review; implementation work must not rebuild `./aos` opportunistically.
