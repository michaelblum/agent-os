@../AGENTS.md

# Shared Contracts

## Purpose

`shared/` contains cross-layer contracts used by native code, scripts, packages,
apps, and tests.

## Ownership

- `schemas/` owns JSON schemas and adjacent contract documentation.
- `schemas/aos-sovereign-capability-authority-v1.schema.json` owns the
  machine-readable target/current precedence, unique scope/domain topology,
  active/target/generated/preserved/historical/frozen scan classification,
  path-specific contradiction evidence, generated ownership, external paired-
  authority state, and hash-backed preservation shape for program
  `aos-sovereign-capability-substrate-v1`.
- `schemas/aos-privileged-capability-ledger-v1.schema.json` owns the closed
  current/target capability-row shape and accepted M2 peer/ancestry/spawn,
  registered-set host-control, bounded retained-replay/expected-barrier-CAS,
  distinct recovery-disposition, prior-generation, and split claim-set/
  resource/broker target contracts: platform classification,
  primitive and exposure reachability, observation bounds, operation control,
  transport/custody, proof, milestone, gap, and exit-gate facts. The canonical
  instance is `docs/dev/aos-privileged-capability-ledger-v1.json`; neither the
  schema nor its target fields make a runtime capability executable.
- `schemas/aos-external-command-manifest-v0.schema.json` remains frozen
  decision history. `schemas/aos-external-command-manifest-v1.schema.json`
  owns the active wire-v2 aggregate, closed optional spawn registration, and
  v1-only decoder/generator migration; never extend v0 or add a translation,
  dual-reader path, or parallel aggregate.
- `schemas/aos-browser-companion-*-v1.schema.json` owns the exact managed
  Playwright descriptor and closed content-free lifecycle result contracts.
- `schemas/aos-browser-session-result-v1.schema.json` and
  `schemas/aos-browser-backend-identity-v2.schema.json` own the closed managed
  session receipt state/recovery variants and path-free generation-bound
  backend identity. Runtime identity admits bounded immutable package versions
  and package-relative entrypoints so retained older leases remain representable
  after source activation changes; descriptor and closure hashes plus generation
  must still match exactly.
- `gate/` owns shared gate request/record helpers.
- `swift/` owns reusable Swift IPC helpers shared by native modules.
- `user-signal/` owns shared user-signal policy helpers.

## Local Contracts

- ADR 0043, its accepted ADR 0044 owner/host/resource amendment, and
  `docs/dev/aos-sovereign-capability-authority-v1.json` own the accepted
  sovereign-capability target. Existing closed browser and native-capture
  schemas remain current executable truth and declared burn-down baseline until
  an atomic implementation/schema/help/docs/skill/test slice replaces them; the
  target alone does not make an unsupported operation available.
- Keep each capability row and accepted M2 target binding closed and evidence-backed. Source
  presence is not public reachability, an absence scan is not capability proof,
  unsupported public API and undocumented/unverified routes are distinct, and
  local owners, schemas, sources, and proofs must remain tracked or one of the
  exact declared M1 bootstrap paths.
- Keep the inventory at the exact ordered 32-row set. Non-absent CLI exposure
  binds authored AOS form ids to authored external route paths; generated
  aggregates are projections, never owners. Proof items distinguish static,
  fake, native compile, and separately authorized native live/TCC lanes.
- Schema changes must update fixtures, docs, and tests that assert the contract.
- `schemas/daemon-request.schema.json` admits the optional closed
  `asserted_attribution` envelope field only for invocation-scoped external
  microphone-intent creation. It reuses the operation-lineage vocabulary;
  omission is empty and no mechanical owner or authority fact is admissible.
- `schemas/daemon-{request,event,response}.schema.json` owns the closed private
  `see.capture` transport. Requests carry one full canonical topology snapshot
  and bounded display-ID/ordinal selection. Each optional window target is a
  closed display ID, window ID, owner PID, integral expected-bounds, and
  `display|none` fallback tuple; the daemon independently rebuilds topology,
  identity, geometry, and current window membership before capture. Ordered capture chunks
  carry bounded base64 bytes plus byte count and SHA-256, never paths or
  persisted artifact facts. Final frame metadata labels display/window source
  and window fallback exactly.
- `schemas/display-topology-v1.*` owns the closed content-addressed display
  mapping snapshot embedded by spatial-topology 0.3.0 and explicit or
  interactively selected region captures; keep its canonical ordering,
  fallback, and binary identity encoding synchronized with the production Swift
  helper and deterministic fixtures.
- `schemas/aos-ax-observation-v1.schema.json` owns the closed internal M4 AX
  request, immutable snapshot, retained page, raw value, outcome, completeness,
  frontier, and state-scoped Observation Ref contract. Its presence does not
  add daemon or CLI reachability; that public integration belongs to M4C.
- Shared helpers must stay product-neutral and layer-neutral.
- Source facts admitted by each bounded public observation contract are exposed
  faithfully by default; facts outside that contract remain outside it.
  Sensitivity classification, masking, redaction, persistence, and model
  projection belong to explicit caller-owned transforms, not shared defaults.
- Semantic target contracts distinguish state-scoped observation refs from
  action-time re-resolving locators. Stale observation pairs and missing or
  ambiguous locator results fail with typed mechanical errors.
- `schemas/aos-target-handle-v1.*` owns the closed handle union and
  `schemas/aos-agent-workspace-v1.*` owns saved storage indirection. V0
  workspace files are historical and unsupported by active readers.
- `schemas/aos-work-record-v1.*`, `schemas/aos-step-descriptor-v1.*`, and the
  versioned repair/attempt schemas own neutral evidence, proposal, outcome, and
  finalization inputs. The V1 repair chain carries at most one atomic candidate
  patch/outcome so proposal projection cannot silently select among payloads.
  Plan mechanics and their Artifact mirrors reject nested Gate, authorization,
  approval, risk, operation-allowlist, resume, and continuation policy fields;
  caller evidence remains an exact carrier rather than being rewritten.
  Attempt Artifact candidate-patch outcomes validate proposed execution maps
  against the Work Record V1 execution-map definition before proposal use.
  Work Record source labels, commands, targets, State IDs, paths, and URIs are
  exact carriers. Replacement proposal provenance must fail closed on source
  metadata key collisions instead of overwriting caller bytes; materialized
  caller evidence retains exact metadata and caller timing.
  Step Descriptor V1 supports only its declared action template tokens and
  expected role/name args; active capture must project promotion identity and
  scope rather than ignoring them.
  Their V0 predecessors remain frozen historical bytes and
  are rejected by active readers; do not add aliases, translation, or a dual
  active reader.
- `swift/ipc/ndjson.swift`, `request-client.swift`, and `event-stream.swift`
  bound every frame. Request reads use one monotonic absolute deadline across
  all partial reads; a peer cannot extend a call by dripping bytes without a
  newline. Event streams treat a rejected bounded append as connection loss so
  the existing reconnect loop owns recovery.
- Do not hide app-specific semantics in shared schema fields.
- `swift/ipc/runtime-paths.swift` owns executable identity. Resolve the running
  Mach-O image authoritatively to an absolute, symlink-resolved path and begin
  repo-root discovery from that identity. If image lookup fails, normalize
  slash-bearing argv from the caller cwd; resolve bare argv by PATH order to an
  executable regular file, including empty and relative entries, with an
  absolute caller-relative path retained as the diagnostic fallback.
  User-facing invocation names remain owned by raw argv in
  `src/shared/invocation.swift`.

## Work Guidance

## Verification

- For schema changes, run the matching `node --test tests/schemas/*.test.mjs`
  file when present.
- For shared Swift IPC changes, run the native or daemon test named by the
  changed contract.

## Child DOX Index

- `gate/` contains shared gate helpers.
- `schemas/` contains schema contracts and documentation.
- `swift/` contains shared Swift helpers.
- `user-signal/` contains shared user-signal policy.
