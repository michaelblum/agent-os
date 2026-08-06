# ADR 0040: Ambient Authority, Raw Observation, And Target Handles

**Status:** Accepted
**Date:** 2026-08-05
**Supersedes:** ADR 0006's loose-ref rule and conflicting authority, mandatory
dry-run/approval, Work Record permission, or default core-redaction guidance

## Context

AOS is a product-neutral, Playwright-CLI-like desktop substrate. The user grants
authority to an agent host, macOS TCC constrains the process, and AOS faithfully
observes or acts within that ambient authority. AOS is not a second policy
engine between the caller and the operating system.

Past contracts mixed mechanical validation with product policy: stable or
loosely re-resolved refs, mandatory preview/approval loops, Work Record
authorization, Gate-backed action permission, and default privacy projection.
Those concepts obscure the substrate boundary and make higher-level product
choices look like AOS invariants.

## Decision

### Ambient authority

The authority chain is:

```text
user -> agent host + macOS TCC -> AOS observe/act -> optional caller transform
```

AOS does not impose auth tokens, action allowlists, risk labels, mandatory
approvals, mandatory dry-run, Work Record authorization, default
privacy/redaction, or assistant/provider/product restrictions. Agent-host policy
remains visible at the agent boundary; it is not encoded as AOS behavior. macOS
TCC remains authoritative for OS permission and AOS reports the observed OS
result.

### Mechanical correctness

Ambient authority does not weaken correctness. AOS continues to own:

- exact resource and target identity;
- typed stale, missing, disabled, unsupported, and ambiguous rejection;
- bounded timeouts, queues, payloads, and resource use;
- exactly-once admission where a primitive requires it;
- cleanup and ownership release;
- machine-readable errors and timestamped receipts.

Optional `--dry-run` remains a useful mechanical preview. It is never a
permission grant or a prerequisite for the corresponding effectful command.
Status-item dry-run remains non-consuming; effectful admission remains atomic.

### Raw observation and caller-owned transforms

Within each bounded public observation contract, a primitive returns the exact
pixels, AX/DOM facts, input observations, and metadata that contract admits at
the highest fidelity available from the platform. Facts and channels outside
the declared contract remain outside it; their exclusion is not a redaction
transform or fidelity gap. For admitted facts, AOS does not silently classify,
mask, omit, or redact source content. OS-withheld data remains absent and is
reported as an upstream/platform fact.

Masking, redaction, persistence, retention, summarization, and model projection
are explicit caller-owned transforms. A neutral primitive may transform exact
caller-selected channels or regions, but AOS core does not decide what is
sensitive. Callers applying a transform must cover every selected channel that
could carry the value rather than masking pixels while leaking AX/DOM, OCR,
logs, receipts, or persisted artifacts.

### Public target types

AOS has two public semantic target types:

1. **Observation Ref** — the ephemeral pair `(state_id, ref)` returned by one
   perception state. The pair names only the observed target in that state. A
   stale or mismatched pair returns an ordinary typed stale error; AOS never
   silently redirects it to a different current target.
2. **Locator** — a declarative query over machine facts that re-resolves against
   current state for every operation. Resolution must produce exactly one
   action-compatible target. Zero matches return a typed missing result; more
   than one returns a typed ambiguous result with bounded candidate facts.

Labels, accessible text, DOM ids, geometry, and coordinates may be locator hints
but are not durable identity by themselves. Code generation emits locators or
queries, not supposedly permanent observation refs.

### Gate and Work Record boundaries

Gate may remain only as an explicitly invoked, product-neutral structured-input
primitive. Its response is caller input; it does not authorize unrelated AOS
actions.

Work Records are optional evidence/history and repair inputs. They can record
intent, actions, outputs, postconditions, and verifier results, but their
presence or contents do not grant permission to observe or act.

### Layering

Product meaning composes above the substrate:

```text
AOS core -> AOS skills -> product harness/skills -> project skills
```

AOS core owns product-neutral primitives and mechanical contracts. AOS skills
teach generic use without adding authority policy. Product and project layers
own ergonomics, proof definitions, retention, redaction, and domain-specific
locators.

## Current Implementation Gaps

The Target Handle Runtime V1 migration now enforces the Observation Ref/Locator
split, original browser pair validation, V1-only saved-handle storage, and
fail-closed browser action boundary described above. The following separate
migrations remain incomplete. A fidelity gap exists only where a bounded public contract already
admits the named fact and current behavior drops, replaces, or defaults a
transform on that fact. This ADR does not widen typed receipts, lifecycle
events, product-neutral scene envelopes, or trusted-realm boundaries to
adjacent inputs, media, source, product state, diagnostics, or private handles:

- current Work Record repair planning/execution still carries Gate-derived
  authorization and operation-allowlist coupling;
- current Gate persistence redacts prompt/answer content and continuation source
  metadata by default instead of making projection and persistence an explicit
  caller-owned transform;
- current native annotation completion replaces admitted target `title` and
  `label` fields with `null` instead of preserving their selected values or
  applying an explicit caller transform;
- the current semantic-target public decoder drops the admitted app-local
  `extension.action_id` fact read from singular `data-aos-action`; that fact is
  not a primitive capability and must not populate `actions[]`;
- the current Guided User Signal record builder defaults prompt/answer
  projection to redaction instead of requiring an explicit caller choice;
- current Step Descriptor and Supervised Run schema/harness surfaces retain
  mandatory Workflow Gate coupling even though Gate is not permission;
- existing gateway script execution is not a complete public `run-code`
  contract, and no public run-code form is claimed by this decision.

These are follow-up implementation gaps, not exceptions to the decision.

## Non-Goals

This decision does not refactor Work Record executors, refactor Gate
persistence, productize public run-code, add generic wait/event/cursor/codegen
surfaces, or redesign the command tree.

## Consequences

- ADR 0006 is superseded.
- Active docs, schemas, help sources, skills, and policy tests must distinguish
  optional mechanics from permission policy.
- Runtime-gap documentation must remain explicit until code, schemas,
  manifests, generated artifacts, and behavioral tests migrate atomically.
- Drift tests must be scoped to the relevant active sources; legitimate uses of
  dry-run, authorization, allowlists, redaction, Gate, and Work Record remain
  testable implementation facts.

## Verification

```bash
node scripts/generate-command-manifests.mjs
bash tests/command-manifest-generation.sh
node --test tests/active-authority-pointers.test.mjs
node scripts/aos-skills-validate.mjs --json
node --test tests/aos-skills-registry.test.mjs tests/aos-skills-forward-proof.test.mjs
git diff --check
```
