# Lineage: Work Record V1 Authority-Excision Migration and Publish Hardening

Status: durable lineage record for orchestrator grounding
Authored: 2026-08-08
Current branch: `wip/work-record-v1-migration-checkpoint` @ `fdb9bd21`

This document links the full arc of the Work Record authority-excision
migration so a fresh orchestrating session can inherit context without
re-reading two days of session history. It is intentionally high-altitude:
technical detail lives in the named source documents.

## 1. Origin (2026-08-05)

Forked from the Sigil PR #90 workstream as an evidence-first architectural
course correction. Source document (preserved from /tmp):
`docs/archive/aos-course-correction-handoff-20260805.md`.

Core doctrine established there:

- AOS is a product-neutral desktop substrate; authority flows from the user
  through the agent host and macOS TCC. **AOS adds no independent
  authorization, approval, risk, or allowlist layer.**
- Work Records are optional evidence/history, never authorization. Gate is a
  neutral structured-input primitive, never a permission source.
- Fidelity-first observation: raw platform output by default; masking and
  redaction are caller-owned transforms.
- Mechanical correctness (exact identity, stale rejection, timeouts,
  cleanup, receipts) is AOS's job; deciding whether the authorized user may
  act is not.
- Sessions constrained by their own provider policy must report that at the
  agent boundary rather than encoding the constraint into AOS behavior.

## 2. Orchestration phase (2026-08-05 → 2026-08-07)

Orchestrator thread `019fd2cb-0e5c-7e03-8b8d-ae1d21e55664` (retired
2026-08-08; do not resume — its world model is stale). It ran from
`/Users/Michael/Code` as a cross-repo overseer, not inside any single repo's
instruction stack; sister repos were pulled in as needed, and that broader
cross-repo context remains available in agent memory and history. This
document covers the agent-os lane only, which forked from the sigil PR #90
workstream. Operating pattern it established, still in force:

- Sub-agents freely, coordinating on the single shared worktree. Never
  create worktrees that own an `aos` binary/daemon or compete for singleton
  resources (TCC, daemon identity); concurrent `aos` consumers conflict
  insidiously. Writes serial by default; parallel writer sub-agents permitted
  when intelligently bounded (sub-agents can message/steer each other). Fresh
  frontier-model (`xhigh`) review gates on every slice. (Its proactive sub-chat delegation was a 2026-08 usage-pressure choice,
  retired as standing doctrine on 2026-08-08: session orchestration method is now
  intentionally unprescribed so the agent stack’s own orchestration is not subverted.)
- No `./aos`, daemon, native UI, TCC, Sigil, push, PR, or GitHub mutation.
- Verified truth first: it reconciled repo/GitHub/worktree state, built the
  active-authority inventory, and proposed single atomic implementation
  slices.

Sub-chat lineage: audit lanes `019fd2e8`, `019fd31e` (×3), `019fd34c`,
`019fd47d`; migration implementation `019fd8c1`.

## 3. Migration implementation (2026-08-06)

Thread `019fd8c1` implemented the neutral V1 migration atomically: active V1
schemas/validators for Work Record, Step Descriptor, Repair Plan, Attempt
Plan, and Attempt Artifact; Gate bridge, `gate-request`/`gate-check`, public
repair execution, controlled fixture executor, and all
authorization/risk/approval/allowlist mechanics removed; V0 bytes frozen as
historical-only. Static validation passed 215/215 audited tests plus
validators, manifests, and syntax checks.

Landing was correctly **deferred fail-closed**: fresh review found that the
publication path in `work-record-atomic-publish.js` could create or remove
filesystem entries it did not own when entries were legitimately replaced
between a check and a later name-based operation. The migration stayed
uncommitted by deliberate decision.

Scope traceability (verified 2026-08-08 against the course-correction handoff
in docs/archive): the migration deleted repair *execution* machinery
(`work-record-controlled-repair-executor.js` plus fixtures/tests) while
retaining the repair *record-keeping* pipeline (guide, plan, attempt, bundle,
finalizer, writer, supersession) as agent-invoked receipts with no autonomous
behavior. Repair execution was the course correction’s target; honest
receipts are its retained core. The retained pipeline is therefore in-doctrine,
not superseded.

## 4. Publication-hardening attempts (2026-08-07)

Three sessions — implementation `019fde86`, its reviewer `019fdf29`, and a
successor `019fdf45` — were each terminated mid-turn by the provider's
automated content filter (a false positive on legitimate filesystem
correctness work; no technical failure occurred). The successor confirmed
all three review findings and began the first patch before termination. Work
survived only as uncommitted paths. These threads are archived; treat their
uncommitted-state beliefs as superseded.

## 5. Resolution (2026-08-08)

Resolved outside the terminated stack, then completed by a fresh
implementation session under a corrected dispatch:

| Commit | Content |
|---|---|
| `1ea8a06f` | Safety checkpoint: the entire uncommitted migration + first hardening patch |
| `5fd64608` | Acceptance suite + Darwin platform contract probe + work card + checkpoint invariant in root AGENTS.md |
| `1b869c9a` | Removed the repo's local agent model/effort pin |
| `3c788dee` | Hardened publication: atomic no-replace descriptor-relative transfer, scrub-and-preserve rollback receipts, one continuous staged-entry observer |
| `fdb9bd21` | V1 validation at subject-catalog construction |

Session `019fe237` completed the hardening in two committed increments. All
suites green: hardening acceptance 4/4, platform probe 1/1, legacy atomic
publish 18/18, subject catalog 5/5 (independently re-verified). The dispatch
technique, filter incident history, and memory-grounding corrections are
recorded in the `agent-filter-resilience` skill and its trigger registry.

## 6. Where things stand

**Done:** the V1 migration and the publication hardening that blocked it.
**Remaining:**

1. Fresh full review of the hardening implementation (`3c788dee`,
   `fdb9bd21`) at the established review bar.
2. The landing decision for the migration (merge strategy, timing, and the
   user's own push/PR — agents do not mutate GitHub).
3. Deferred items from the migration, unchanged: Gate persistence/redaction,
   continuation-provider metadata, Guided User Signal, ask/defer semantics.
4. **Cross-repo downstream (overseer scope):** after the migration lands in
   agent-os, Sigil’s pinned AOS SHA goes stale — bump the pin and re-validate
   Sigil PR #90 (open, cleanly mergeable at `8b454dd9` as of 2026-08-05;
   verify current truth). Other sister repos consume AOS only through the
   pin, so no further coordination is expected.
5. **Post-landing architectural review:** re-evaluate the retained repair
   pipeline’s scope (guided-recovery state machine, bundle assembly,
   finalizer) against the course correction’s optional-evidence framing —
   does the elaborateness still earn its keep? Not a landing blocker.

**Dispatch rules for the next orchestrator:** read the work card
(`docs/design/work-record-publish-hardening-handoff-20260808.md`) and this
lineage first; short single-purpose turns; correctness vocabulary; no
external platform research; commit after every validated increment (root
AGENTS.md invariant); a single shared worktree (no worktrees owning an
`aos` binary/daemon or competing for singleton resources; writes serial by
default, parallel writer sub-agents permitted when intelligently bounded) and
fresh review gates.

## 7. Amendment — AOS bridge access for Perplexity sessions (owner decision 2026-08-08)

Recorded post-landing (2026-08-09) by the foreman session; the decision
predates the landing and governed the 2026-08-08 dispatch work.

The "no `./aos`" gate in §2 was written for contract-lane Codex sessions and
remains in force for those dispatches unless a work card says otherwise. It
is amended for Perplexity foreman sessions on the owner's Mac (via the `pc`
device bridge), which are authorized to use AOS under a tiered protocol. This
is agent-host and bridge operating policy; it changes no AOS authorization or
runtime behavior.

- **Passive diagnostic tier (standing):** `aos status`/`doctor`/plain
  `ready`, work-record discovery and report-only verification, and other
  commands whose current manifest proves they are passive and daemon-free.
- **Existing-daemon observation tier (standing after the singleton check):**
  non-interactive `aos see` queries and capture plus `aos focus`/`graph`
  reads. These commands may consume an existing daemon, but the bridge must
  not let them auto-start one. Saved capture may persist local workspace
  evidence. Interactive selection, clipboard projection, click waiting,
  input injection, and UI projection are excluded from this tier.
- **Action tier (per-task, explicit owner authorization):** `aos do`,
  `aos show` (heads-up prompted, focused collaboration only), daemon
  lifecycle (`serve`/`service`/`clean`/`reset`), `aos tell`/`say`/`listen`,
  config mutations, annotation create/consume/delete.
- **Singleton-competition check** before every daemon-backed operation:
  daemon ownership and runtime mode (repo versus installed), Sigil runtime,
  and concurrent agent consumers. If ownership is unclear or an observation
  would need daemon auto-start, stop for action-tier authorization.
- **Bridge hazards:** the bridge cannot bind sockets (daemon launch must
  come from the owner's terminal or an authorized agent session), output
  truncates ~5 KB (full text lands in the local tool-output cache), and
  System Events UI-scripting is categorically blocked — `aos see` is the
  available AX probe.

Full protocol, rationale, invocation rules, and provenance for the
bridge-specific hazard claims: the 2026-08-08 library-persisted version of
the `aos-bridge-access` Perplexity user skill. Those claims describe that
external bridge version, not AOS product guarantees, and must be re-verified
when the skill or bridge changes. This section cites the skill by name without
duplicating its operational detail; the repo skills under `skills/` remain the
operational authority for HOW to drive AOS and are read in place, never
mirrored.
