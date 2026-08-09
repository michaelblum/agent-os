# AOS Course-Correction Successor Handoff

Generated: 2026-08-05 12:25:03 EDT  
Source: side conversation forked from the Sigil PR #90 workstream  
Purpose: hydrate a fresh, equally or more capable Codex session to lead an evidence-first AOS/Sigil architectural correction.

Read this document in full before acting. Re-check live repository, GitHub, worktree, runtime, and generated-artifact truth; current truth overrides this handoff. This side conversation made no repository, Git, runtime, UI, TCC, or permission changes. Its only write is this temporary Markdown file.

## Active User Goal

Course-correct AOS toward a Playwright-CLI-like desktop substrate:

- product-neutral and deliberately “dumb” about application ergonomics or product meaning;
- ambient-authority execution: the user grants trust at the agent/host layer, macOS enforces TCC, and AOS adds no independent authorization/privacy regime;
- fidelity-first observation: raw platform output by default, with caller-owned optional transformations;
- sparse, event-driven captures and bounded proofs rather than frame recording;
- ephemeral observation refs plus re-resolving locators, ordinary typed stale errors, generic waits, unrestricted local code execution, and semantic codegen;
- strength through composable AOS skills, then product-specific Sigil/project skills and proof harnesses.

The user expects stale Markdown, skills, generated help, tests, and code that contradict this direction to be found and corrected—not left to contaminate later work.

## Normative Product Model

### Authority

The intended stack is:

```text
User grants authority
        ↓
Agent host and macOS TCC enforce that authority
        ↓
AOS faithfully observes and acts
        ↓
Optional caller-owned recipe/tool/transformer
        ↓
Model context, evidence, logs, or disk
```

AOS must not introduce another permissions or approval layer. Do not make mandatory AOS concepts out of:

- authorization tokens or allowlists;
- risk labels or action classification;
- mandatory approval gates or dry-runs;
- Work Record authorization;
- default privacy/redaction policy;
- assistant/provider restrictions.

If a future agent session is constrained by its own system policy, it must report that constraint at the agent boundary. It must not encode its own “nanny posture” into AOS product behavior.

This does **not** mean ignoring mechanical correctness. AOS owns exact identity, stale/ambiguous-reference rejection, timeouts, bounded resource use, exactly-once action semantics where relevant, cleanup, and machine-readable receipts. Those protect correctness; they do not decide whether the authorized user should be allowed to act.

“Full Access” in an agent host and macOS TCC are distinct layers. AOS should faithfully use/report the permissions the process actually has. If macOS withholds access, AOS reports the OS result; it neither overrides TCC nor adds a third gate.

### Observation, redaction, and privacy

AOS raw primitives should return the most faithful pixels, AX/DOM facts, input observations, and metadata that the platform exposes. No silent masking, omission, sensitivity classification, or opt-in-to-see-raw policy in core AOS.

When the user wants to prevent data from reaching a model or disk, that belongs in a caller-owned wrapper, recipe, skill, or product adapter. Example:

1. Obtain screenshot pixels and a semantic snapshot.
2. Identify native `AXSecureTextField` bounds, browser `input[type=password]` bounds, and project-specific selectors.
3. Mask those pixel regions in memory and remove/replace corresponding structured values.
4. Return or persist only the transformed projection.

Mask every selected channel, not just screenshot pixels: AX/DOM values, OCR, input streams, logs, receipts, and persisted artifacts can otherwise leak the same value. Metadata is not perfect—an API key can be placed in a normal text field—so recipes need custom selectors/rules.

Expose source facts, not AOS policy judgments: role, subrole, bounds, source, timestamp/state, DOM `type`, `autocomplete`, and whether the upstream API returned a value. Native macOS defines `kAXSecureTextFieldSubrole`; browsers visually obscure password controls while the DOM still owns a value. AOS must not promise to reveal data macOS itself withholds.

A neutral image operation such as “paint these rectangles” may be an AOS primitive. Deciding that a rectangle is sensitive is caller policy.

Do not perform a blind keyword purge. Classify each use:

- OS/upstream withholding or TCC status: keep and report accurately;
- caller-selected downstream transformer: keep or move above core;
- bounded/efficient telemetry or structured errors: keep if not acting as access policy;
- core default suppression/redaction: remove;
- Sigil/product proof-specific content policy: keep only as an explicit product/harness choice, never an inherited AOS invariant.

### Refs and locators

Follow Playwright’s conceptual split:

- **Observation ref**: ephemeral handle scoped to the state/snapshot that produced it. If stale, return an ordinary machine-readable stale error. Do not silently redirect it.
- **Locator**: a declarative query that re-resolves against current state for each operation and fails on zero/ambiguous matches according to explicit contract.
- **Codegen**: emits locators/queries, not supposedly permanent snapshot refs.

Stale errors require normal handlers in code; they are not authorization events. Semi-persistent references should mean re-resolvable locators backed by semantic identity, not a promise that a UI object can never disappear.

### Desktop equivalent of Playwright CLI

AOS should provide generic operations conceptually equivalent to:

- capture a display, stitched display set, window, element, or arbitrary region;
- resolve a locator/reference;
- perform pointer, keyboard, menu, window, and accessibility actions;
- inspect observable properties;
- subscribe/read from an event cursor;
- wait for a generic observable predicate;
- compare explicit image inputs;
- return timestamped, bounded receipts;
- execute unrestricted local code with the caller’s ambient process authority;
- generate semantic locator/action code from inspected interaction.

Generic waits may cover:

- window/AX element exists or disappears;
- property equals or changes from a value;
- bounds remain unchanged for a specified duration;
- pixel region remains within tolerance for a specified duration;
- event occurs after a cursor/sequence number;
- display topology remains unchanged;
- timeout.

AOS must not contain `wait until the Sigil gesture succeeds`, `prove the launcher interaction is good`, or other product meaning. Those belong above it.

Surface-specific eval and a general `run-code` facility are the desktop analogues of Playwright `eval` and executable scripts. Code must be able to catch stale/timeouts, branch, loop, retain local intermediate bytes, and return only the chosen result. Do not add an AOS sandbox merely because the execution surface is powerful.

### Proof and capture lifecycle

A “proof” is a bounded, reproducible demonstration that a behavior or claim holds. It is not necessarily a recording and does not imply hundreds of screenshots.

Expected normal model:

- most code/text tasks: zero or a few captures;
- visual action proof: usually before and after, perhaps one explicit settle/checkpoint image;
- drag: commonly start and end captures, not every intermediate frame;
- capture on meaningful state boundaries or predicates, not a fixed one-second cadence;
- delete/dispose intermediate snapshots when a proof succeeds or fails unless a later proof explicitly chains from them or the user requests evidence retention;
- `aos see compare before.png after.png` consumes caller-supplied images; AOS need not own their capture or retention policy.

The previously discussed saturated **256-event buffer was an event-stream/cursor accounting problem, not a need for 256 image snapshots**. Fresh gestures became invisible when old buffered events saturated bookkeeping. Keep event queues, semantic states, and pixel snapshots conceptually and operationally separate.

For animation-heavy Sigil proofs:

- product/harness style guides may bound transition duration;
- proofs should target meaningful UX moments, not record all frames;
- Sigil/proof harnesses may add stable watermarks or explicit animation-state markers;
- AOS supplies generic overlays, semantic identities, timestamps, waits, and comparisons but does not know what “Sigil settled” means.

The exact maximum transition duration (`x` milliseconds) has **not** been decided. Propose evidence-based options or ask the user before canonizing a number.

### Skills and product layering

Use Playwright CLI as inspiration for composability:

1. AOS core: raw platform primitives, selectors/locators, waits, events, input, capture, compare, execution, receipts.
2. AOS skills: platform-neutral acquired knowledge and robust generic workflows.
3. Sigil skills/code: Sigil ergonomics, animation watermarks, proof definitions, product acceptance.
4. Project skills/code: project-specific locators, redaction rules, workflows, and proof chains.

Do not build the cathedral, igloo, and space station into AOS. Supply the materials, fundamentals, acquired knowledge, and access.

## Live State Verified for This Handoff

Verified read-only at 2026-08-05 12:25 EDT:

### AOS

- Repository: `/Users/Michael/Code/agent-os`
- Remote: `https://github.com/michaelblum/agent-os.git`
- Branch: `main`
- HEAD: `11d06ebcfaef6c3a3bb0046a00bbf50851b882fa`
- Status: clean, `main...origin/main`

No AOS runtime/native/TCC command was run in this side conversation.

### Sigil PR #90

- PR: https://github.com/Ch-osctrl/sigil/pull/90
- State: open, non-draft, GitHub reports `MERGEABLE`
- Base: `main`
- Branch: `chaosctrl/automate-native-visual-parity-harness`
- PR/remote head: `8b454dd9ba9fecdd9010ed45d2062eff8d402443`
- GitHub returned no status-check rollup entries.

Worktrees:

- `/Users/Michael/Code/sigil` is clean and detached at `e885019ce527310f9f3005555663a86e5426e447`.
- `/Users/Michael/Code/sigil-automate-native-visual-parity-harness` is clean on the PR branch at `8b454dd9ba9fecdd9010ed45d2062eff8d402443`; remote parity was `0 0`.
- `origin/main` and local `main` resolved to `de379b0cd1008d1a72822ef55c8980e4f53060c6` during the check.

The parent thread’s earlier tail said the local/remote/PR head were all `8b454dd…`. That remains true **in the dedicated PR worktree**, but no longer describes the default `/Users/Michael/Code/sigil` checkout. Treat this as a location distinction, not proof of corruption. Do not create another Sigil worktree.

Inherited parent-thread evidence, **not rerun by this handoff**:

- exact-head reviewer approved with no P0–P2 findings;
- full guard reportedly passed 328 tests plus visual fixture, typecheck, and AOS pin/runtime checks;
- tracked launcher opened Terminal PID `55599`, ran `.command` on `ttys000`, then exited before wrapper admission;
- no proof receipt, AOS, Sigil, tools-dev process, or TCC action was created;
- parent stopped at a genuine visual checkpoint asking for the exact visible error in the newest Terminal opened around `10:52:59`.

This side conversation did not inspect, close, rerun, or interact with that Terminal or any permission dialog. Reconcile the latest main-thread/user state before touching it. Keep PR #90/native acceptance separate from AOS course-correction commits.

## Current Architectural Evidence in AOS

The live tree already contradicts itself:

- `/Users/Michael/Code/agent-os/CONTEXT.md:179-181` calls a Ref stable/durable.
- `/Users/Michael/Code/agent-os/CONTEXT.md:232-234` says a stale State ID does not invalidate a Ref.
- `/Users/Michael/Code/agent-os/shared/schemas/aos-semantic-targets.md:90-96` says refs are state-scoped, may become stale, and stale state/ref pairs must reject.
- `/Users/Michael/Code/agent-os/skills/aos-desktop/SKILL.md:23-39` mandates `--dry-run` before most desktop actions.
- `/Users/Michael/Code/agent-os/docs/api/aos-capabilities.md:371-389` prescribes capture/save/ref/dry-run/act/recapture/Work Record verification as canonical.
- `/Users/Michael/Code/agent-os/src/daemon/AGENTS.md:97-101` correctly says pixel frames are raw/in-memory and encoding, cropping, redaction, persistence, and GPU delivery belong to downstream adapters.
- `/Users/Michael/Code/agent-os/docs/guides/desktop-pixel-native-baseline.md:17-23,79` combines content-free proof telemetry with downstream redaction adapters; classify the telemetry separately from access policy.
- `/Users/Michael/Code/agent-os/docs/api/aos.md:753-766` persists Gate metadata and redacts prompt/answer payloads by default. Decide whether Gate remains a neutral explicit UI primitive; remove any implication that it authorizes ordinary AOS actions.

Existing executable SDK/gateway surface:

- `/Users/Michael/Code/agent-os/packages/gateway/src/tools/execution.ts:12-61` exposes `run_os_script`, saved scripts, and capability discovery.
- `/Users/Michael/Code/agent-os/packages/gateway/src/engine/node-subprocess.ts:21-81` executes a normal Node subprocess, captures logs, writes temporary wrapper/result files, and cleans them after close.
- SDK files: `/Users/Michael/Code/agent-os/packages/gateway/sdk/aos-sdk.js` and `/Users/Michael/Code/agent-os/packages/gateway/sdk/aos-sdk.d.ts`.

This is promising infrastructure, not proof that the intended public `run-code` contract is complete. Audit namespace coverage, raw in-memory capture, timeout/cancellation, cleanup, errors, temp-file behavior, codegen, and generated CLI/help surfaces. Do not replace ambient authority with a new sandbox.

Historical read-only investigation found GitHub issue `michaelblum/agent-os#587` closed as superseded while parts of its saved-workspace/dry-run/gate worldview remain live. Re-check the issue before relying on that status.

## Magnitude and Feasibility

Philosophically this is a significant course correction. Mechanically it appears manageable because several desired primitives and downstream boundaries already exist. Expect substantial canon convergence, deletion, and surface simplification—not necessarily a core runtime rewrite.

The highest risk is a partial migration where one ADR changes but generated help, tests, skills, schemas, and runtime behavior continue teaching the old model. Avoid leaf-by-leaf wording edits without an authority map.

## SOP for the Successor

1. **Rehydrate exact truth.** Read applicable `AGENTS.md`, repository instructions, generator ownership, `tests/README.md`, current branch/worktree state, PR state, and named artifacts. Do not run native/UI/AOS/TCC routes during reconciliation.
2. **Keep lanes isolated.** Do not mix AOS course correction into Sigil PR #90. Do not create another Sigil worktree. Resolve or explicitly park the PR visual checkpoint before merge decisions.
3. **Build an active-authority inventory.** Search active code, schemas, manifests, generated help/docs, ADRs, skills, and tests for at least: `dry-run`, `authorize`, `authorization`, `allowlist`, `approval`, `gate`, `Work Record`, `saved ref`, `state_id`, `redact`, `privacy`, `content-free`, `permission`, `risk`, and `capability`. Classify each occurrence by owner, behavior, generated/source status, and disposition; keyword presence alone is not a defect.
4. **Establish one normative contract first.** Draft or update the smallest authoritative ADR/constitution covering ambient authority, fidelity-first output, caller-owned transformations, mechanical correctness, ephemeral refs versus locators, and product/skill layering. Add an active-authority index so superseded Markdown cannot quietly remain normative.
5. **Protect against drift.** Add generated-artifact checks and behavioral/contract tests. Negative invariants should ensure public AOS docs/manifests/skills do not mandate dry-run/approval/redaction for ordinary authorized actions. Do not ban legitimate words globally.
6. **Correct refs atomically.** Align schema, terminology, CLI manifests/help, SDK types, resolver behavior, tests, and skills. Observation refs reject stale state; locators re-resolve and reject missing/ambiguous targets.
7. **Productize execution and generic observation.** Turn existing `run_os_script` infrastructure into a coherent public run-code/eval story; add/finish generic targets, waits, cursor subscriptions, bounded receipts, and semantic codegen based on verified gaps.
8. **Remove policy coupling.** Delete or relocate Work Record authorization, mandatory dry-run loops, action risk/approval semantics, and default core redaction. Preserve Work Records only as optional evidence/history if useful; they must not grant permission to act.
9. **Move product meaning upward.** Put Sigil transition limits, animation watermarks, gesture-success definitions, snapshot retention, and privacy projections in Sigil/project recipes and skills. AOS supplies only generic mechanisms.
10. **Use repository generators correctly.** In AOS, source manifests own generated help/examples. Start routing changed paths with `./aos dev recommend --json --paths <paths>`, consult `tests/README.md`, edit `manifests/commands/source/...` where applicable, and regenerate checked-in derivatives.
11. **Validate proportionally.** Run deterministic unit/contract/generated-artifact tests before any native acceptance. Stop for genuine TCC, visual, speech, or approval checkpoints. Obtain exact-head review before publication/merge decisions.

Do not ask the user to re-decide the trust/privacy direction above; it is explicit. Ask only for a genuinely unresolved product choice that materially changes the result.

## Exact Bounded First Action

Without editing or running native/TCC routes:

1. verify AOS/Sigil live state and applicable instructions;
2. produce the active-authority inventory described above;
3. report conflicts against this normative model and propose one bounded first implementation slice.

Recommended first implementation slice after inventory: the authoritative ambient-authority/fidelity/ref-locator contract plus drift guard, with generated docs/skills/tests updated in the same atomic change. Do not begin broad runtime refactoring until that authority layer identifies the intended source of truth.

## Open Decisions

- Exact public spelling and placement of `run-code`, surface-specific eval, and codegen.
- Locator grammar and uniqueness rules for native AX/windows/displays.
- Whether Gate remains as an explicitly invoked neutral structured-prompt primitive; it must not authorize unrelated actions.
- Exact retention defaults and chaining handles for explicit proof artifacts.
- Exact Sigil maximum transition duration and watermark contract.
- Whether `aos show` already provides the desired large invisible semantic canvas and addressable subjects in full; verify implementation rather than infer from docs.
- Which Work Record features remain valuable as optional evidence after authorization coupling is removed.

## Durable References

- AOS repository: `/Users/Michael/Code/agent-os`
- Sigil PR worktree: `/Users/Michael/Code/sigil-automate-native-visual-parity-harness`
- Sigil PR #90: https://github.com/Ch-osctrl/sigil/pull/90
- Apple AX subroles: https://developer.apple.com/documentation/applicationservices/carbon_accessibility/subroles
- WHATWG password input: https://html.spec.whatwg.org/multipage/input.html#password-state-(type=password)
- Playwright locators: https://playwright.dev/docs/locators
- Playwright locator input values: https://playwright.dev/docs/api/class-locator#locator-input-value

## Suggested Skills

- `handoff` only when relaying the successor’s later exact state; do not repeatedly summarize instead of working.
- No security-review skill is implied by the trust discussion. This is a product-boundary and architecture correction, not a request to impose secure-by-default policy.

