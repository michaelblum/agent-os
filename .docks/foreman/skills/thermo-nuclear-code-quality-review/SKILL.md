---
name: thermo-nuclear-code-quality-review
description: Run an extremely strict Foreman maintainability review for ambitious structural simplification, abstraction quality, giant files, spaghetti growth, type boundaries, test seams, and feedback loops.
argument-hint: "PR, branch range, diff, work card, or completion report to review"
disable-model-invocation: true
---

# Thermo-Nuclear Code Quality Review

Use this skill when Foreman needs an unusually strict code-quality review of a
PR, branch diff, completion report, or implementation slice. The goal is not to
confirm that behavior works. The goal is to decide whether the change leaves the
codebase cleaner, simpler, more testable, and easier to reason about.

Review with the normal Foreman stance: inspect the actual diff, changed files,
tests, relevant surrounding owners, and local evidence before accepting,
routing a correction, or recording next work. Keep findings concrete and
grounded in file and line references.

## Core Prompt

Start from this baseline:

> Perform a deep code quality audit of the current branch's changes.
> Rethink how to structure or implement the changes to meaningfully improve
> code quality without impacting behavior.
> Work to improve abstractions, modularity, feedback loops, type boundaries,
> testability, succinctness, and legibility.
> Be ambitious: if there is a clear path to improving the implementation that
> involves restructuring some of the codebase, push for it.
> Be extremely thorough and rigorous. Measure twice, cut once.

Do not approve a slice merely because tests pass. The bar is whether the design
is worthy of becoming the next layer other agents and humans will build on.

## Non-Negotiable Standards

### 1. Be Ambitious About Structural Simplification

Do not stop at "this could be cleaner." Actively look for code-judo moves:
reframings that preserve behavior while deleting whole branches, helper layers,
special modes, fallback paths, state concepts, or files. Prefer the solution
that feels inevitable in hindsight.

If a refactor only moves complexity around, say so. If a simpler model would
make the branches disappear, push for the model change rather than a tidier
version of the same tangled idea.

### 2. Treat Giant Files As A Serious Agent-Navigation Smell

Do not let a PR push a file from below 1,000 lines to above 1,000 lines without
a compelling structural reason. Treat that crossing as a presumptive blocker,
especially when the added code could become a focused helper, module,
component, adapter, or test fixture.

Also scrutinize already-large files. New orchestration, feature state, or
mode-specific logic in a large owner should usually move to a smaller canonical
owner before the file becomes harder for agents to scan safely.

### 3. Reject Spaghetti Growth

Be highly suspicious of new ad-hoc conditionals, one-off booleans, nullable
modes, or feature checks inserted into unrelated flows. "It works" is not
enough if the change makes the surrounding code more tangled.

Prefer pushing logic into a dedicated abstraction, helper, state transition,
policy object, adapter, or module that owns the concept. Repeated conditionals
usually mean the model is missing a named state, dispatcher, or boundary.

### 4. Prefer Direct, Boring Code Over Magic

Flag brittle, hacky, overly generic, cast-heavy, or magical behavior. Be
skeptical of generic machinery that hides a simple data shape. Delete thin
wrappers, identity helpers, and pass-through abstractions unless they clarify
ownership or materially reduce complexity.

### 5. Push Hard On Type And Boundary Cleanliness

Question unnecessary optionality, `unknown`, `any`, forced casts, loosely
shaped dictionaries, and silent fallbacks when a clearer type or schema
boundary could exist. Prefer explicit typed models, validators, and shared
contracts that make invalid states impossible or loud.

If downstream logic needs defensive branches everywhere, ask whether the
upstream boundary should become explicit enough that those branches disappear.

### 6. Keep Logic In The Canonical Layer

Call out feature logic leaking into shared paths, implementation details leaking
through APIs, and bespoke helpers that duplicate canonical utilities. Push code
toward the package, service, adapter, command surface, validator, or runtime
module that already owns the concept.

Compatibility layers are acceptable only with an explicit external contract,
release boundary, migration window, or live consumer. Otherwise prefer snapping
repo-internal callers to one strict contract.

### 7. Review Testing, Seams, And Feedback Loops As Design

Do not treat tests as a separate checkbox after code structure. A clean design
usually creates clean seams: pure helpers, typed adapters, validators, state
transition functions, command dispatchers, or bounded runtime surfaces that can
be tested directly.

Flag changes where:

- the behavior is only provable through broad manual testing when a smaller
  deterministic seam should exist;
- test-only hooks, dependency injection, or fake modes leak into production
  flow without earning their keep;
- tests lock in private incidental structure instead of public behavior or a
  canonical boundary;
- coverage exercises the happy path but misses the new failure mode, fallback,
  transition, or rollback path;
- live/HITL behavior lacks a bounded feedback loop through `./aos ready`,
  `./aos status`, `./aos show`, `./aos tell`, `./aos listen`, or an explicit
  Operator run when live evidence is required;
- a reviewer or future agent cannot quickly reproduce the key signal from a
  local command, fixture, or documented live check.

Prefer the narrowest honest seam that proves the behavior. Do not add seams
just for tests if the cleaner move is to extract the real concept into a pure
or canonical owner.

### 8. Treat Avoidable Orchestration Complexity As A Smell

If independent work is serialized for no good reason, ask whether parallel
structure would be simpler and clearer. If related updates can leave state
half-applied, push for a more atomic flow. Do not chase micro-optimizations, but
do flag orchestration that makes the implementation harder to reason about.

## Primary Review Questions

For every meaningful change, ask:

- Is there a code-judo move that would make this dramatically simpler?
- Can this be reframed so fewer concepts, branches, modes, or helpers exist?
- Did the diff improve or worsen the local architecture?
- Did a previously cohesive module become larger, more coupled, more stateful,
  or harder to scan?
- Is any file crossing 1,000 lines, or becoming less navigable for agents?
- Are new conditionals covering for a missing model, dispatcher, or helper?
- Is the implementation direct and legible, or special-case driven?
- Is this abstraction earning its keep, or just adding indirection?
- Are types and schemas making the invariant explicit enough?
- Is the logic in the canonical layer and using existing helpers?
- Is the new behavior testable through the right seam?
- Do tests and live checks give a fast feedback loop for the actual risk?
- Is orchestration more sequential or less atomic than it needs to be?

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
- whether the test surface proves behavior at the canonical seam rather than
  coupling to incidental internals;
- whether deterministic tests, fixtures, and bounded live checks create a
  reproducible feedback loop;
- whether related state updates are atomic enough for the reader to reason
  about failure paths;
- whether independent orchestration is serialized in a way that makes the flow
  more fragile or harder to follow.

## Presumptive Blockers

Treat these as review findings unless the diff contains a strong justification:

- a file crosses from below 1,000 lines to above 1,000 lines;
- an already large file receives new feature orchestration that could live in a
  focused module;
- a shared path gains feature-specific branches, one-off booleans, or nullable
  modes;
- the implementation moves complexity around without reducing the number of
  concepts a maintainer must hold;
- a readiness, validation, or debug surface can falsely certify incomplete or
  invalid state;
- an adapter layer calls back into the same old local branches instead of
  becoming the actual owner of dispatch;
- fallback behavior duplicates the primary path rather than sharing a single
  implementation;
- a loosely typed boundary relies on silent fallback where an explicit invariant
  would make the code simpler;
- testing requires broad manual inspection when a focused deterministic seam is
  clearly available;
- tests are missing for a new state transition, fallback, failure path, or
  atomicity risk;
- live behavior is material to acceptance but no bounded AOS or Operator
  feedback loop exists.

## Preferred Corrections

Push for changes that delete complexity, not just tidy it:

- delete a whole layer of indirection rather than polishing it;
- reframe the state model so conditionals disappear;
- collapse duplicate branches into one primary flow;
- extract a pure helper or focused runtime module when a large owner is growing;
- move feature logic behind the canonical abstraction that already owns the
  concept;
- replace repeated condition chains with an explicit model, dispatcher, or state
  transition helper;
- make the type or schema boundary explicit enough that downstream fallback
  branches disappear;
- reuse an existing helper instead of adding a near-duplicate;
- separate orchestration from business logic;
- make related updates happen through one atomic operation when partial state is
  otherwise hard to reason about;
- create or repair the narrowest useful test seam at the real ownership
  boundary;
- add a deterministic test, fixture, or bounded live check that future agents can
  rerun quickly;
- remove wrappers that only forward arguments and do not clarify ownership.

## Review Tone

Be direct, serious, and demanding about quality. Do not be rude, but do not
soften major maintainability issues into mild suggestions. If the code makes
the codebase messier, say so clearly.

Useful phrasing:

- `this pushes the file past 1k lines. can we decompose this first?`
- `this adds another special-case branch into an already busy flow. can we move this behind its own abstraction?`
- `this works, but it makes the surrounding code more spaghetti. let's keep the behavior and restructure the implementation.`
- `this feels like feature logic leaking into a shared path. can we isolate it?`
- `this abstraction seems unnecessary. can we keep the direct flow?`
- `why does this need a cast or optional here? can we make the boundary explicit instead?`
- `this looks like a bespoke helper for something we already have elsewhere. can we reuse the canonical one?`
- `i think there's a code-judo move here that makes this much simpler. can we reframe this so these branches disappear?`
- `this refactor moves complexity around, but does not really delete it. can we make the model itself simpler?`
- `the behavior lacks a fast feedback loop. can we expose the real seam and add a deterministic check?`
- `this test seam feels artificial. can we extract the production concept instead of adding a test-only path?`

## Output Shape

Lead with findings, ordered by severity. Each finding should include a file and
line reference, the maintainability risk, and the cleaner direction to pursue.
Do not flood the review with cosmetic notes when structural issues are present.

Use this priority order:

1. Structural regressions.
2. Missed simplifications that would delete real complexity.
3. Spaghetti growth from special-case branching.
4. Boundary, abstraction, or type-contract problems.
5. Missing or artificial test seams and weak feedback loops.
6. File-size and decomposition concerns.
7. Modularity and canonical-helper issues.
8. Legibility concerns that materially affect maintenance.

If there are no findings, say that explicitly and name any residual risk or
evidence gap. If the slice should not be accepted, route the next reversible
Foreman action: a correction work card, bounded verification, issue/PR comment,
or manual-intervention blocker packet as appropriate.
