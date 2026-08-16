# ADR 0043: Sovereign Capability Substrate And Operation Control Plane

**Status:** Accepted
**Date:** 2026-08-16
**Program:** `aos-sovereign-capability-substrate-v1`
**Expands:** ADR 0015 and ADR 0040
**Partially supersedes:** ADR 0030's AOS-local process-lifetime direct-capture
consent/prime gate, ADR 0031's explicit direct-capture consent/prime clauses,
and ADR 0041's fixed public-operation allowlist and browser-feature non-goals
**Governed by:** ADR 0039's zero-installed-base migration policy and ADR 0042's
AOS/Sigil ownership boundary
**Paired with:** Sigil ADR 0021,
`docs/adr/0021-sigil-sovereign-workflow-composition.md`, under the same program
identifier

## Context

ADR 0015 established AOS as the stable TCC capability broker. ADR 0040 removed
AOS-owned permission policy and required raw, fidelity-first admitted
observations plus caller-owned transforms. ADR 0041 then established a rigorous
AOS-managed Playwright package, session, guardian, and cleanup lifecycle, but
also froze a small public operation set and named broad upstream Playwright
features as non-goals.

That fixed grammar is not the intended substrate boundary. A policy-free
privileged I/O substrate must expose the complete mechanically supportable
surface of its native and managed tools. It must not decide that callers may
navigate but not trace, evaluate, record video, observe network traffic, manage
storage, produce a PDF, or use another upstream operation merely because AOS
has not wrapped that operation into a product workflow.

At the same time, broad execution increases the importance of exact operational
control. AOS must know what privileged or managed operation it owns, expose its
live state and lineage, and be able to terminate and clean up that exact
authority. Status, kill, and blame are control and accountability mechanisms;
they are not an admission policy.

## Decision

### Comprehensive policy-free privileged exposure

AOS is the comprehensive, product-neutral privileged I/O substrate for supported
macOS facts, actions, streams, and AOS-managed external tools.

AOS does not add auth tokens, command or operation allowlists, risk labels,
mandatory approval, mandatory dry-run, Work Record authorization, assistant or
provider restrictions, or product policy. macOS and upstream platforms may
withhold or reject facts and actions; AOS reports those platform facts
explicitly. Unsupported mechanics are typed unsupported facts, not policy
denials.

Mechanical correctness remains mandatory:

- exact process, resource, session, stream, operation, and target identity;
- typed stale, missing, ambiguous, unsupported, protected, and platform
  rejection;
- bounded resources, output, queues, and deadlines;
- exactly-once admission where an operation requires it;
- ownership-correct cleanup and hard revocation;
- machine-readable lifecycle, outcome, and cleanup receipts.

### Full upstream managed-tool grammar

When AOS owns a reviewed external tool runtime, the boundary is
grammar-agnostic. AOS owns the pinned executable and environment and passes raw
argv, stdin, stdout, stderr, and artifact transport. It validates only
mechanical lifecycle, executable and environment identity, resource and time
bounds, transport shape, artifact containment, cleanup, and receipts. It has no
semantic command allowlist or per-upstream-operation manifest or schema wrapper.

The complete grammar is inherited from the reviewed pin. For the managed
Playwright companion that includes, as the pinned upstream version supports
them, snapshots, boxes, evaluation, tracing, video, network, storage, PDF,
tabs, input, navigation, and lifecycle. AOS does not reinterpret these grammar
families into a smaller product vocabulary. Unsupported argv or semantics are
reported from the pinned upstream tool or platform, not manufactured as AOS
policy.

AOS continues to own the reviewed pin, integrity closure, private store,
activation, session identity, guardian, process-group lifecycle, bounded raw
transport, transient artifact custody, cleanup, and receipts. Upstream
Playwright owns grammar and operation semantics. Callers own workflow
sequencing and interpretation.

This supersedes ADR 0041 only where that ADR makes its fixed operation allowlist
or feature non-goals an enduring product boundary. ADR 0041 remains authoritative
for its package, store, lease, session, guardian, ownership-correct close or
detach, and recovery mechanics until later implementation changes replace a
specific contract atomically.

### Operation and stream control plane

Every nontrivial AOS-owned privileged or managed operation participates in one
product-neutral control plane. This includes long-running sessions, streams,
recordings, transient artifacts, process trees, and one-shot operations whose
one-shot terminal history must remain inspectable for a bounded recent window.
Passive trivial reads may remain receipt-only when they create no continuing
authority or resource, but their terminal receipt still names the owning
capability.

The control plane exposes:

- stable operation identity, parent/child operation lineage, initiating peer,
  capability, tool, session, target, start time, state, and bounded progress;
- live list, inspect, status, and recent content-free history, including
  terminal outcome, blame, and cleanup state plus typed residual-authority
  facts;
- cancel or kill one exact operation within the controllable set established by
  the mechanically authenticated peer or owner, and kill by a mechanically
  bound owner scope;
- caller-asserted client, agent, task, project, and capability values may only
  filter within that mechanically established set. They never add an operation
  to the set, expand control, or become signal or kill authority. Where AOS can
  mechanically bind one of those scopes to the initiating peer or exact
  operation ancestry, that bound scope may establish a stronger owner boundary;
- host-wide emergency stop-all is a separate mechanically authenticated
  host-operator control. It is not inferred from caller lineage, a string label,
  an unverified PID or PGID, or ordinary peer ownership;
- reveal, remove, release, or explicitly retain an operation artifact, with
  exact artifact identity and cleanup receipts;
- an optional explicit data tap for live raw-data inspection. A tap is
  observation-only, separately bounded in bytes and time, and does not grant
  mutation or kill authority.

The default plane retains content-free metadata and bounded terminal history,
not raw operation data. Raw streams and artifacts are transient by default and
are released or removed after their ownership-correct handoff unless the caller
explicitly retains them. AOS does not silently accumulate tap output, stream
bytes, screenshots, recordings, traces, or other artifacts as history.

Mechanically authenticated peer and owner facts are distinct from
caller-asserted Sigil lineage. Sigil client, project, run, task, skill, retry,
capability, or agent identifiers are attribution, not ownership facts. They may
narrow list, inspect, cancel, or kill selection only within the mechanically
established controllable set and never add operations or expand control. If a
later reviewed adapter mechanically binds a specific scope, that mechanically
bound scope may establish the stronger owner boundary. Caller-asserted lineage
is never authorization or kill-scope authority, and it never grants host-wide
emergency control.

Here, mechanically authenticated means derived from AOS's exact current peer,
lease, session, process-group, or operation-ancestry records. It is not a new
user auth token, admission permission, approval gate, or trust decision based on
a caller-supplied label.

These facts do not authorize execution. They make already-admitted execution
observable, revocable, and accountable. Control surfaces use the exact identity
and ownership proof appropriate to each resource and report terminal outcome,
blame, cleanup, and any residual authority without inferring from numeric
process state.

### Raw transport and caller-owned transforms

AOS returns the highest-fidelity facts and bytes admitted by each supported
contract. For streams and potentially large outputs, AOS may expose bounded
streaming, file-descriptor, artifact, or caller-selected persistence transports
instead of embedding every byte in one JSON receipt. That transport choice is
mechanical plumbing, not content policy.

Masking, redaction, cropping, summarization, retention, persistence, artifact
layout, model projection, and domain interpretation remain caller-owned
transforms. AOS skills may teach reusable transforms and product skills may
require them, but AOS core does not silently apply them. Explicit retention is
a custody request, not permission or approval, and remains bounded by exact
artifact ownership and cleanup mechanics.

### Ownership

AOS owns:

- the stable TCC identity and privileged native broker;
- complete supported native facts, actions, and streams;
- managed external-tool pins, integrity, stores, sessions, processes, streams,
  operation lineage, status, hard revocation, cleanup, and receipts;
- neutral active-operation and recording projections through the AOS-owned
  status-item host, without product labels or action policy;
- product-neutral CLI, IPC, schemas, Toolkit and SDK projections;
- installable AOS skills that teach substrate use without adding policy.

Sigil owns:

- projects, runs, tasks, skills, retries, budgets, memory, policy, and result
  interpretation;
- composition of AOS primitives and managed-tool operations into product
  workflows;
- product-specific persistence, transforms, evidence requirements, and UX.
- product labels, presentation choices, and action policy for any status-item
  projection it composes over the neutral AOS operation facts.

AOS owns the neutral active-operation and recording projection through the
status item. Sigil owns product labels and action policy; it must not become the
owner of AOS lifecycle identity, kill mechanics, artifact custody, or cleanup.

The paired Sigil ADR 0021 is separately sequenced. Naming it here records the
intended paired authority; it does not claim that the Sigil ADR or cross-repo
activation has already landed.

### CLI, IPC, Toolkit, and SDK projection

CLI forms are one projection of the substrate, not the sole capability model.
Every capability and operation-control contract must be representable through
stable machine-readable IPC and a maintained SDK surface. Toolkit remains the
AOS-owned reusable surface layer. Sigil and other consumers may call the CLI,
SDK, or Toolkit according to their needs without moving orchestration into AOS.

Command source manifests remain the authorship source for generated command
manifests and help. A future command change must update source manifests,
generated artifacts, API docs, schemas, implementation, skills, tests, and proof
routing atomically.

### Staged migration and current executable truth

This ADR accepts the target architecture. It does not claim that unimplemented
capabilities, full Playwright grammar, a general SDK, or the operation control
plane exist today.

During the migration:

1. `docs/adr/README.md` owns ADR status and partial supersession.
2. This ADR owns target direction.
3. `docs/dev/aos-sovereign-capability-authority-v1.json` owns the
   machine-readable active-authority and burn-down map.
4. `docs/dev/aos-sovereign-capability-remodel-ledger.md` is the human
   disposition and publication ledger.
5. Current source, command-source manifests, generated help, schemas, API docs,
   tests, and runtime readback remain executable truth until a later atomic
   implementation slice changes them.

Claims that browser operations are fixed, that direct native capture requires an
AOS-local process-lifetime consent gate, or that only narrow status-item
inspection exists are retained as path-specific declared burn-down baseline.
They are not exceptions to this decision and must not be silently deleted before
their implementation, schema, help, docs, skills, and proofs change together.
The tracked active-authority scan excludes target authority, generated ownership
classification, preserved ADR bodies, dated design research, reports, archives,
and frozen fixtures according to the machine map; generated current help remains
separately classified and scanned.

### Reference workflows

The first implementation flagship is the find, center, and record-video vertical
slice. It must prove composition across observation, target resolution, action,
full managed Playwright grammar, streaming or artifact output, operation lineage,
status, hard revocation, cleanup, and caller-owned transformation.

Simulation Author is the first follow-on flagship consumer. Its future
integration seam belongs at the Sigil workflow-composition boundary over
reviewed AOS capabilities. Its independent workstream is not joined, read, or
modified by this decision packet.

## Migration dispositions

The program uses six dispositions:

- **Keep**: already aligned authority or implementation.
- **Expand**: aligned owner whose surface must become more complete.
- **Repoint**: active guidance that must route to the accepted authority.
- **Rewrite**: current contract that must change atomically with implementation.
- **Retire**: restriction, shim, or competing owner that must disappear.
- **Archive**: frozen or historical material retained unchanged.

The schema-backed authority map and human ledger apply these dispositions to
current assets. Historical ADR bodies, archives, reports, frozen schemas and
fixtures remain unchanged.

## Publication boundary

Milestone 0 publishes authority and drift control only. It adds no native
capability, managed Playwright operation, SDK method, status/kill/blame command,
or permission behavior. No future capability may be advertised as implemented
until its source, manifest/help, schema, API, skill, test, and proof owners land
atomically.

Authority publication is not runtime implementation publication. The AOS
authority packet lands first and yields an exact AOS commit. A later Sigil
authority commit must atomically advance both reviewed AOS pin fields to that
exact landed SHA before Sigil ADR 0021 is published. Neither docs landing makes
the full grammar, control plane, SDK, or native permission remodel executable.

## Consequences

- ADR 0015's broker boundary expands from a minimal primitive posture to complete
  mechanically supportable privileged exposure.
- ADR 0040's ambient-authority and caller-transform rules remain controlling.
- ADR 0030's texture-lease and mechanical capture ownership remains controlling
  while its AOS-local process-lifetime consent/prime gate is superseded target
  doctrine and current burn-down baseline.
- ADR 0031's pixel broker, warm snapshot, serialization, identity, and cleanup
  mechanics remain controlling while its explicit direct-capture consent/prime
  clauses are superseded target doctrine and current burn-down baseline.
- ADR 0041's managed runtime lifecycle remains controlling while its fixed
  operation grammar and feature non-goals are partially superseded.
- Current contradictions are visible migration debt with an enforced baseline,
  not hidden competing architecture.
- AOS and Sigil can evolve in separately reviewed commits while cross-repo
  activation remains explicitly sequenced by the shared program identifier.

## Verification

The Milestone 0 packet is static and must not execute `./aos`, a daemon,
Playwright, a browser, native UI, or TCC-sensitive code. Its focused proof is:

```bash
node --test tests/sovereign-capability-active-authority.test.mjs
```

Later milestones add focused offline and live proof lanes only when their
implementation authority explicitly permits them.
