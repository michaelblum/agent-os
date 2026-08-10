# Exact Focus-Channel Native Proof

Date: 2026-08-10

Status: passed supervised validation evidence, not a standing runtime guarantee

## Scope

This guarded proof used a deterministic synthetic AppKit fixture with two
overlapping layer-zero windows owned by one process. It exercised the public
`focus` and `see capture` commands against the already-running repo daemon. It
did not rebuild or restart AOS, reset TCC, request Microphone access, or use
private application content.

The tested repository revision was
`a57b71f08da90f1b3da84b61bdf58261605d1120` on
`wip/observation-fidelity-runtime-20260809`.

## Guarded Command

```bash
AOS_EXACT_FOCUS_CHANNEL_NATIVE_PROOF_OK=1 \
  zsh tests/manual/exact-focus-channel-native-proof.sh --run
```

The command ran once for the tested revision and returned `status:"passed"`.

## Content-Free Result

The terminal receipt proved all of the following without retaining or logging
captured pixels, raw accessibility payloads, fixture geometry, or unrelated
channel metadata:

- exact-window pixels and exact accessibility membership were verified for the
  target subtree;
- the overlapping sibling subtree was rejected during creation and refresh;
- a rejected refresh preserved the last good channel and its recaptured pixel
  and accessibility projections;
- after the fixture acknowledged target-window removal, exact capture and
  refresh both failed closed with the expected missing-window result;
- the proof-owned channel, fixture process, and fixture windows were removed;
- shared daemon identity, repo runtime provenance, direct-capture readiness,
  and unrelated-channel stable fields were preserved;
- cleanup completed with no ambiguous command admission, retained recovery
  root, persisted pixels, raw-capture logging, or Microphone request.

## Offline Evidence

Before the guarded run, the exact registered command passed 40 of 40 tests:

```bash
node --test \
  tests/exact-focus-channel-geometry-checkpoint.test.mjs \
  tests/exact-focus-channel-proof-protocol-contract.test.mjs \
  tests/exact-focus-channel-supervision-contract.test.mjs \
  tests/exact-focus-channel-native-proof-contract.test.mjs
```

The registry schema passed 21 of 21 tests. Syntax, import-silence, whitespace,
process-residue, command-budget, strict-review, and maintainability gates were
also green before the live proof.

## Authority

This report is historical evidence for one supervised machine result on the
tested revision. Current source, schemas, public command contracts, and routed
tests remain authoritative. A future change must rerun its current routed
proofs rather than treating this report as reusable runtime acceptance.
