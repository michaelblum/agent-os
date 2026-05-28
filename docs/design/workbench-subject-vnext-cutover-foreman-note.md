# Workbench Subject v-next Cutover Foreman Note

**Status:** deliberation note for Foreman prompt design
**Date:** 2026-05-06

## Purpose

This note captures the recommended steering context for a Foreman session that
will write the next Goal-Driven Implementation prompt. It is intentionally not a
GDI implementation plan. The Foreman should rediscover live repo, issue, branch,
and daemon state before turning this into an executable prompt.

## Recommendation

The current #281 compatibility-reader migration should probably be superseded
by a bounded Workbench Subject v-next cutover. The cutover should make the
v-next descriptor shape canonical for live writers and consumers while keeping
legacy handling only at real persisted/import boundaries.

The recommendation is time-sensitive to the current early-stage state of
agent-os. If Foreman finds concrete external or persisted compatibility evidence
that was missed, it should preserve that boundary explicitly instead of doing a
blanket cutover.

## Reasoning Summary

- The interrupted #281 work is already moving consumers toward compatibility
  readers, but that can accidentally preserve old internal shapes as a long-term
  contract.
- The recent Subject work has already introduced the pieces needed for a cleaner
  model: high-level capabilities, operation contracts, Facets, Hosts, Subject
  References, Wiki Subject Browser, Playbook Workbench, and Work Record
  handoffs.
- The knowledge-graph research signal supports a typed, atomic, linked model
  with provenance and health instead of loose folder-style or legacy descriptor
  fields.
- The GitNexus research signal supports a derived graph/index that helps agents
  navigate code and assess impact, but provider-specific hooks and generated
  assistant files should not become canonical AOS architecture.
- AOS already has a durable placement rule: repo docs, schemas, tests, and
  source files remain authoritative; wiki and graph surfaces are first-class
  runtime knowledge substrates, not dumping grounds or hidden sources of truth.

## Impact On Interrupted GDI Work

The interrupted dirty files appear to be a narrow #281 slice:

- `packages/toolkit/components/markdown-workbench/model.js`
- `packages/toolkit/components/playbook-workbench/model.js`
- `packages/toolkit/components/work-record-workbench/model.js`
- `packages/toolkit/workbench/browser-step-descriptor-prototype.js`
- `tests/toolkit/browser-step-descriptor-prototype.test.mjs`
- `tests/toolkit/work-record-workbench-model.test.mjs`

Foreman should not assume these are disposable. It should require GDI to
rediscover the diff, confirm the edits are only interrupted #281 edits, and
discard only those tracked edits if that confirmation holds. Any unrelated user
edits must be preserved.

If the pivot proceeds, #281 should be superseded rather than silently abandoned:
create the new v-next cutover issue first, then close #281 with a link and a
short rationale.

## Suggested Foreman Output Shape

Foreman should produce:

1. A recommendation: continue #281, supersede #281, or use a hybrid.
2. A short rationale grounded in live repo evidence.
3. A preparation prompt for GDI that handles issue/branch/handoff cleanup.
4. A follow-up long-run GDI prompt for the bounded v-next cutover.

The GDI prompt should stay bounded. It should not add new public `aos` command
surface, replay/repair, macro playback, or live browser execution.

## Candidate GDI Steering Points

Use these as inputs, not as mandatory wording:

- Make the v-next descriptor shape canonical now for live code.
- Use `capabilities[]` for high-level capabilities only.
- Use `contracts[]` for operation/event contracts.
- Use `facets[]` for projections/layers.
- Use `facets[].hosts[]` for host implementations.
- Use `subject_references[]` for typed Subject links.
- Stop emitting `views[]` and `controls[]` from live writers unless a concrete
  persisted/import boundary requires an adapter.
- Keep at most one explicit legacy adapter for archived fixtures or old
  persisted records if evidence shows it is needed.
- Do not preserve compatibility merely because old in-repo code still reads the
  old fields.
- Do not replace legacy fields with another vague abstraction. Live affordances
  should derive from the canonical fields, artifacts, verification/health, and
  state.

## Durable Docs For Foreman Study

- `AGENTS.md`
- `docs/guides/agent-entry-paths-and-verification.md`
- `docs/guides/layered-subject-expressions.md`
- `docs/design/aos-grand-unification-plan.md`
- `docs/design/aos-grand-unification-next-session-goal.md`
- `docs/design/aos-subject-model-compatibility-audit.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-workbench-subject-vnext.md`
- `shared/schemas/aos-subject-capabilities.md`
- `shared/schemas/aos-work-record-v0.schema.json`
- GitNexus as research signal only, not AOS architecture authority:
  <https://github.com/abhigyanpatwari/GitNexus>
