---
name: thermo-nuclear-code-quality-review
description: Run an unusually strict Foreman maintainability review focused on structural simplification, abstraction quality, large-file growth, branching complexity, and canonical ownership boundaries.
argument-hint: "PR, branch range, diff, work card, or completion report to review"
---

# Thermo-Nuclear Code Quality Review

Use this skill when Foreman needs a deliberately severe code-quality review of a
PR, branch diff, completion report, or implementation slice. The goal is not to
confirm that behavior works. The goal is to decide whether the change leaves the
codebase cleaner, simpler, and easier to reason about.

Review with the normal Foreman stance: inspect the actual diff, changed files,
tests, and relevant surrounding code before accepting, routing a correction, or
recording next work. Keep findings concrete and grounded in file and line
references.

## Core Review Bar

Ask whether the change can be restructured so behavior stays the same while
whole branches, helper layers, special cases, or concepts disappear. Prefer a
direct design that feels inevitable over a working patch that adds another mode,
flag, wrapper, or exception path.

Do not approve a slice merely because tests pass. The approval bar is:

- no clear structural regression;
- no obvious simpler framing that would remove meaningful complexity;
- no unjustified large-file growth;
- no scattered feature checks or special-case branches in shared flows;
- no brittle, magical, or pass-through abstraction that hides a simple shape;
- no unnecessary casts, loose optionality, or ad-hoc object contracts;
- no logic living outside the package, module, or helper that already owns the
  concept;
- no avoidable duplication of canonical helpers or local patterns.

## What To Inspect

Start with the branch or PR diff, then follow the changed code into nearby
owners and tests. Check:

- file line counts before and after the diff, especially files near or above
  1,000 lines;
- new conditionals added to already busy functions;
- duplicated fallback bodies, copied command handling, or repeated object-shape
  normalization;
- helper names and module boundaries against existing canonical helpers;
- whether command adapters, state machines, runtime surfaces, schema validators,
  and UI/debug surfaces each keep their own responsibilities;
- whether related state updates are atomic enough for the reader to reason
  about failure paths;
- whether independent orchestration is serialized in a way that makes the flow
  more fragile or harder to follow.

## Presumptive Blockers

Treat these as review findings unless the diff contains a strong justification:

- a file crosses from below 1,000 lines to above 1,000 lines;
- an already large file receives new feature orchestration that could live in a
  focused module;
- a shared path gains feature-specific branches or one-off booleans;
- the implementation moves complexity around without reducing the number of
  concepts a maintainer must hold;
- a readiness, validation, or debug surface can falsely certify incomplete or
  invalid state;
- an adapter layer calls back into the same old local branches instead of
  becoming the actual owner of dispatch;
- fallback behavior duplicates the primary path rather than sharing a single
  implementation;
- a loosely typed boundary relies on silent fallback where an explicit invariant
  would make the code simpler.

## Preferred Corrections

Push for changes that delete complexity, not just tidy it:

- collapse duplicate branches into one primary flow;
- extract a pure helper or focused runtime module when a large owner is growing;
- move feature logic behind the canonical abstraction that already owns the
  concept;
- replace repeated condition chains with an explicit model, dispatcher, or state
  transition helper;
- make the type or schema boundary explicit enough that downstream fallback
  branches disappear;
- reuse an existing helper instead of adding a near-duplicate;
- make related updates happen through one atomic operation when partial state is
  otherwise hard to reason about;
- remove wrappers that only forward arguments and do not clarify ownership.

## Output Shape

Lead with findings, ordered by severity. Each finding should include a file and
line reference, the maintainability risk, and the cleaner direction to pursue.
Do not flood the review with cosmetic notes when structural issues are present.

Use this priority order:

1. Structural regressions.
2. Missed simplifications that would delete real complexity.
3. Spaghetti growth from special-case branching.
4. Boundary, abstraction, or type-contract problems.
5. File-size and decomposition concerns.
6. Modularity and canonical-helper issues.
7. Legibility concerns that materially affect maintenance.

If there are no findings, say that explicitly and name any residual risk or
evidence gap. If the slice should not be accepted, route the next reversible
Foreman action: a correction work card, bounded verification, issue/PR comment,
or human-needed blocker packet as appropriate.
