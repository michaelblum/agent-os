# Claude Re-Alignment Brief

You have been out of the loop for roughly the last day of work on this repo. Do not assume your cached understanding is still correct.

Your job is to re-orient quickly, verify the actual code and runtime behavior yourself, and then realign any Claude-specific guidance, memory, or assumptions that are now stale.

For chronology and original debugging context, also read [2026-04-06-runtime-and-sigil-handoff.md](/Users/Michael/Code/agent-os/docs/superpowers/plans/2026-04-06-runtime-and-sigil-handoff.md), but treat it as historical context. Its main blocker section has been resolved by later follow-on work.

## What Changed At A High Level

The main theme was reducing ambiguity and cross-session chaos in the AOS/Sigil runtime model.

Recent changes introduced:

- explicit runtime identity separation between `repo` and `installed` modes
- mode-scoped runtime state instead of one shared bucket
- clearer launch-agent targeting and reporting
- deterministic cleanup/reset tooling
- better runtime/doctor visibility into what is actually running
- upfront permission preflight and one-time setup semantics
- hard gating so interactive commands stop early when onboarding is incomplete
- cleanup of stale artifacts and mixed-state confusion between repo builds and the installed app

The intent was not to add features for their own sake. The intent was to stop wasting hours on invisible drift between repo binaries, installed binaries, launch agents, logs, sockets, and permissions state.

## What To Revisit

Revisit and update any Claude-facing governance or memory that assumes the old runtime model, especially:

- `CLAUDE.md`
- `src/CLAUDE.md`
- `apps/sigil/CLAUDE.md`
- `packages/*/CLAUDE.md` where relevant
- `.claude/`
- `memory/`

If any of those files still imply fuzzy runtime selection, shared state, or outdated testing expectations, fix them.

## What To Inspect First

Use the codebase as source of truth. Start by understanding the new runtime/lifecycle model and the new operator surfaces. Focus on the files that define:

- runtime path/state identity
- service install/start/status behavior
- doctor/reset/permissions behavior
- Sigil runtime invocation assumptions
- any interactive-command gating tied to setup readiness

Do not rely on this brief as authoritative beyond orientation.

## Evaluation Task

After re-orienting, do a deep review of the recent changes and answer:

1. Which parts are necessary to preserve the new safety/coherency?
2. Which parts are overly complex, redundant, leaky, or too clever?
3. Where can the design be simplified without reintroducing ambiguity, mixed runtime state, or permission confusion?
4. Which governance/memory files should be rewritten so future sessions start from the correct mental model?

Prioritize simplification opportunities that reduce operational confusion, not cosmetic refactors.

## Constraints

- Preserve the new guarantees around runtime identity, upfront setup clarity, and mode coherence.
- Prefer fewer concepts and fewer fallback paths.
- Be skeptical of hidden magic, silent auto-detection, and convenience behavior that can drift across sessions.
- If you recommend changes, distinguish clearly between:
  - must-keep safety/coherency mechanisms
  - optional cleanup or simplification
  - documentation/governance realignment

## Deliverable

Produce:

- a concise orientation summary of the current model as you verified it
- a list of stale Claude-facing files or memories that need updating
- specific simplification recommendations, ordered by impact
- any risks where simplification would accidentally remove an important safety guard
