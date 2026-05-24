# Agent Terminal Toolkit Roadmap

**Date:** 2026-05-23
**Status:** planning note after legacy-doc cleanup audit

## Current Accepted State

The generic Agent Terminal is now a toolkit-owned surface. The toolkit owns the
frontend component modules, bridge client, bridge server, session inspector
server, PTY proxy, generic launcher, and canonical Agent Terminal URL under
`packages/toolkit/components/agent-terminal/`. The Sigil wrapper remains a
product consumer of that substrate, while the historical Sigil/Codex terminal
file paths are compatibility entrypoints only. The active bridge environment
contract is `AGENT_TERMINAL_*`; old product-branded bridge env names are
historical and should not be described as active contracts.

The frontend extraction is also accepted: bridge client, session rail model and
view, session inspector model and view, and terminal controller behavior have
small toolkit-owned modules with deterministic coverage. The local bridge and
session inspector can expose terminal substrate, provider catalog, and telemetry
facts, but Agent Terminal pixels and transcript text are not provider acceptance
evidence.

## Decision Principles

Clean canonical contracts win before release unless a break blocks current
development today. Owned repo callers, tests, and current docs should migrate to
the canonical names and paths instead of preserving invisible alias layers.

Historical file-path shims may remain when they reduce immediate operator
friction. They should stay thin, clearly marked as compatibility, and carry a
retirement gate. A path shim does not create a second implementation owner, env
contract, provider lifecycle owner, or telemetry contract.

Catalog and telemetry are read-only observation surfaces. They can corroborate
or enrich a launch after provider-owned metadata exists, but they should not be
the first required proof that a provider accepted a launch.

## Roadmap Tracks

### Provider-Launch Acceptance Visibility

The open gap is launch-side acceptance visibility before catalog match. Current
bridge evidence can know selected provider, command, intended cwd, driver,
session handle, health, and snapshots before the provider catalog sees a
session. It cannot yet emit a structured provider acceptance result with fields
such as provider session id, provider-reported cwd, branch, model, version, or
head. Until that exists, a current launch can only report
`provider_acceptance_unobserved` or an equivalent not-observed state.

The next work should add deterministic launch-side acceptance fields or fixtures
without launching a real provider. That gives later live proof a stable shape
for "terminal substrate exists, provider session id not observed, catalog not
matched yet" instead of overclaiming from catalog absence.

### Catalog And Telemetry Enrichment

Catalog matching should follow launch-side acceptance visibility. The catalog is
useful for read-only resume and correlation after provider metadata appears, but
it cannot distinguish a started-but-not-cataloged launch from an absent launch
without a launch-side attempt key. Telemetry and session inspector output should
remain enrichment after a catalog record or equivalent provider-owned source is
available.

The catalog track should add matching rules only after the launch receipt has a
stable provider, command, cwd, terminal handle, and explicit acceptance status.
It should preserve unrelated all-cwd candidates as context rather than binding
them to the launch without an independent provider session id.

### Wrapper Health And Live Verification Boundaries

Wrapper health is a separate track. Recent evidence showed the canonical Sigil
wrapper launch failing health while direct bridge startup worked. That defect is
real, but it does not explain the broader catalog gap because fallback bridge
startup still produced a visible provider without a machine-observed provider
session id.

Wrapper repair should use deterministic shell/static/bridge health checks first.
Live provider verification belongs in Operator or human-supervised rounds and
should produce bounded receipts, not source or docs changes mixed into planning
slices.

### Historical File-Path Shim Retirement

The historical `apps/sigil/codex-terminal/*` paths should remain until they no
longer reduce operator friction. Their current job is file-path compatibility:
delegate to the toolkit bridge/server substrate or Sigil wrapper launch while
teaching no active env alias contract. They should not accumulate new behavior.

Retirement can be considered after current docs, launch scripts, tests, work
cards, and operator SOPs stop advertising those paths as a preferred route, and
after a short warning/deprecation period would not disrupt active dock sessions.

### Frontend And Toolkit Follow-Ups

The main Agent Terminal decomposition has landed, but follow-ups remain:

- keep page orchestration in `index.html` small by resisting new inline model or
  DOM logic;
- align remaining controls with shared toolkit controls where it improves
  consistency without churning stable terminal behavior;
- document module ownership only at the public component boundary, not in old
  implementation cards;
- keep generic toolkit launch free of Sigil avatar behavior while letting Sigil
  keep product-specific wrapper controls.

## Prioritized Next Slices

### 1. Provider-Launch Acceptance Visibility Fixture

Owner: GDI implementation, routed by Foreman.

Goal: add a provider-free fixture or parser around bridge launch-side facts that
emits selected provider, command, intended cwd, terminal driver/session handle,
structured title/status observations when present, explicit provider session id
not-observed state when absent, catalog not-observed state, and a mismatch code
such as `provider_acceptance_unobserved`.

Deterministic evidence: focused tests over synthetic bridge health, ensure, and
snapshot/title bundles; no real provider launch; no provider transcript reads.

Non-goals: catalog matching, telemetry parsing, wrapper repair, gateway or
scheduler implementation, live Codex/Claude/Gemini proof.

Why before catalog work: catalog matching needs a stable launch attempt shape
and explicit acceptance absence state. Without that, catalog absence keeps
collapsing several different cases into one ambiguous failure.

### 2. Catalog Correlation Enrichment

Owner: GDI implementation after the launch-side fixture is accepted.

Goal: enrich a launch receipt with provider catalog records only when the record
can be bound by provider session id or another accepted launch-side key, while
preserving unrelated all-cwd candidates as context.

Deterministic evidence: synthetic catalog fixtures for current matching,
stale requested-cwd records, current unrelated all-cwd candidates, wrong-cwd
records, and no-catalog-yet states.

Non-goals: provider transcript mutation, live provider launches, telemetry
semantic expansion, wrapper health repair.

Why after acceptance visibility: catalog data is corroboration. It should not be
asked to create the launch identity that it later validates.

### 3. Wrapper Health Fixture Or Repair

Owner: GDI implementation if Foreman prioritizes launch ergonomics after the
acceptance shape is stable.

Goal: isolate why the Sigil wrapper launch failed bridge health while direct
bridge startup worked, then add the smallest deterministic health check or fix.

Deterministic evidence: shell syntax checks, launcher static assertions,
provider-free bridge health tests, and any no-provider process-driver smoke that
does not open canvases or launch providers.

Non-goals: acceptance parsing, catalog matching, live provider proof, removal of
compatibility shims.

Why after or parallel to catalog work: wrapper health matters for operator
friction, but the launch acceptance/correlation model should not depend on
whether one wrapper path happened to start cleanly in a supervised run.

## Shim Retirement Gate

It is safe to remove or stop advertising `apps/sigil/codex-terminal/*`
file-path shims only after all of these are true:

- current docs and SOPs point users to `packages/toolkit/components/agent-terminal/`
  for generic launch or `apps/sigil/agent-terminal/` for Sigil wrapper launch;
- deterministic tests prove the canonical toolkit and Sigil paths cover the
  bridge server, session inspector, PTY proxy, launcher, and compatibility
  behavior that active workflows need;
- search of current, non-historical docs shows no preferred operational command
  still using the historical paths;
- open work cards and active Operator/GDI dispatches no longer require the
  historical paths as the expected entrypoint;
- Foreman accepts that any remaining references are historical evidence or old
  task contracts, not current usage.

Until that gate is met, keep the shims thin and documented as compatibility.
Do not remove them in roadmap or planning rounds.

## Open Questions

- Should the provider-launch acceptance fixture parse terminal title/status
  text now, or should v0 only model the fields and not-observed states so live
  parsing can be added after the receipt shape is reviewed?
- Should wrapper health repair be routed immediately after the acceptance
  fixture, or deferred until catalog correlation has a stable launch key?
- What exact field name should become the durable launch-side key when provider
  session id is not observed: terminal session handle, dispatch attempt id, or a
  new bridge launch attempt id?
