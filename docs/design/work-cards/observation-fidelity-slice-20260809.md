# Work Card: Observation Fidelity Slice — Annotation Titles and Semantic-Target Action Facts

Status: ready dispatch context (implementation not started)
Branch: owner-selected at dispatch from the reviewed current AOS authority ref
Authored: 2026-08-09 course-correction review

## Scope

Two small, mechanical fidelity-first conformance fixes, both already
documented as explicit follow-up gaps in `docs/api/aos.md` (gaps section,
~lines 95–120). Both are pure "return the admitted fact" corrections under
ADR 0040's fidelity-first observation contract. No new capability, no schema
widening, no authority or persistence changes.

The gap confirmation phase is complete — the gaps are recorded in the public
API doc. Do not re-derive or re-litigate them; implement and converge the
docs.

## Item 1 — Preserve admitted native annotation `title`/`label`

Current behavior (per the recorded gap): native annotation completion
replaces admitted target `title` and `label` fields with `null` instead of
preserving their selected values.

Required behavior: the completion record carries the admitted `title` and
`label` values exactly as selected. No caller transform is applied by
default; callers who want projection apply their own (ADR 0040).

## Item 2 — Preserve the admitted semantic-target `extension.action_id`

Current behavior (per the recorded gap): the semantic-target public decoder
drops the admitted app-local `extension.action_id` fact read from singular
`data-aos-action`.

Required behavior: the decoder preserves `extension.action_id` as an
admitted fact on the decoded target. It is NOT a primitive capability and
MUST NOT populate `actions[]` — the gap text is explicit on this boundary;
keep it.

## Acceptance

1. New or extended tests demonstrating each preserved fact (annotation
   completion record; semantic-target decode), added beside the existing
   suites for those surfaces.
2. All existing suites for the touched packages stay green. Do not weaken
   or reshape existing assertions — change the implementation.
3. Contract convergence: remove the two corresponding bullets from the
   `docs/api/aos.md` gaps section in the same increment that closes each
   one; update any schema/manifest/generated-help text that restates the
   stale behavior. Runtime, schema, docs, and tests must agree
   (root `AGENTS.md` convergence invariant).
4. Commit after every validated increment. Two increments expected
   (one per item); more are fine if smaller.

## Working agreements

- agent-os only; no Sigil changes. Sigil pin implications belong to a separate
  cross-repo owner, not this card.
- Git authority: the dispatched branch only (commit; push if granted). No PR,
  no merge — landing is the owner's.
- No `./aos` daemon lifecycle; static implementation + tests only. If a
  test needs runtime facts that only a live daemon provides, stop and
  report rather than starting one.
- No external platform research; all needed facts are in the repo (gap
  text, ADR 0040, existing tests for both surfaces).
- Short single-purpose turns; describe the work in correctness terms:
  observation fidelity, admitted facts, contract convergence.
- Final report: commit list, gate commands + results, the exact
  `docs/api/aos.md` diff, and any adjacent stale-doc findings NOT fixed
   (list them for the owning orchestration session; do not scope-creep into
   them).

## Read first, in order

1. This card.
2. `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`
   (fidelity-first observation; caller-owned transforms).
3. The gaps section of `docs/api/aos.md` (the two bullets this card
   closes; note which bullets it does NOT touch — Gate persistence,
   Guided User Signal, the legacy Supervised Run V0 projection,
   generic wait/event-cursor/codegen, and `run-code` are out of scope).
4. Existing tests for annotation completion and semantic-target decoding
   (locate via the test tree; follow the naming of adjacent suites).
