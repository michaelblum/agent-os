# Implementer Work Card: Reconcile #409 After Main Retarget

## Tracker

- Governing issue: #407 `Governance: local relay and AOS GitHub control surface`
- Pull request: #409 `refactor(aos): externalize TCC broker workflows`
- Prior accepted correction: `docs/design/work-cards/implementer-aos-broker-js-composition-correction-v0.md`
- Current stack event: #405 was retargeted to `main`, reconciled, and merged as `d442f863fe2c290e96f5ac1620a0401fe385ae5c`. #409 was retargeted to `main` and is now GitHub `CONFLICTING`.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon, canvas, issue, or prior implementation state. Read and rediscover before editing.

## Branch / Base

- Repo: `/Users/Michael/Code/agent-os`
- Required start ref: `implementer/aos-target-addressed-action-ergonomics-v0`
- Required start HEAD: `179aca98f269c36ddf93658cd235ba652404d03e`
- Merge source: `origin/main` at or after `d442f863fe2c290e96f5ac1620a0401fe385ae5c`
- Expected output: one local reconciliation commit on `implementer/aos-target-addressed-action-ergonomics-v0`.
- Do not push. Foreman owns push, PR update, merge, branch cleanup, and ledger mutation.
- Do not create linked git worktrees. Work in the single checkout.

## Goal

Make #409 mergeable against `main` while preserving the already accepted AOS TCC broker external-composition behavior and the canonical post-#405 Sigil/avatar-controls stack state.

## Read First

- `AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/work-cards/implementer-aos-broker-js-composition-correction-v0.md`
- `scripts/lib/aos-cli.mjs`
- `scripts/lib/aos-facts.mjs`
- `scripts/lib/aos-readiness.mjs`
- `tests/aos-readiness-composition.test.mjs`
- `tests/schemas/aos-external-command-manifest-v0.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main origin/implementer/aos-target-addressed-action-ergonomics-v0
gh pr view 409 --json number,title,state,url,baseRefName,headRefName,isDraft,mergeable,statusCheckRollup,reviewDecision
git merge-tree origin/main HEAD
```

Then merge `origin/main` into the branch and resolve conflicts:

```bash
git merge --no-edit origin/main
```

Known conflict set from Foreman before routing:

- `apps/sigil/context-menu/compact-surface-session.js` file-location conflict into renamed `apps/sigil/avatar-controls/`
- `apps/sigil/avatar-controls/surface.js`
- `docs/api/aos.md`
- `packages/toolkit/runtime/semantic-targets.js`
- `shared/schemas/aos-semantic-targets.md`
- `src/act/canvas-ref-targeting.swift`
- `src/perceive/models.swift`
- `src/perceive/semantic-targets.swift`
- `tests/renderer/context-menu-hit-test.test.mjs` modify/delete after avatar-controls rename
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`

## Required Behavior

- Keep the accepted #409 boundary: Swift exposes only small privileged facts/actions/streams; JS owns public command behavior, readiness/doctor/status/permissions composition, recovery policy, help, grammar, and presentation.
- Keep #409's shared JS composition modules as the source of truth: `scripts/lib/aos-cli.mjs`, `scripts/lib/aos-facts.mjs`, and `scripts/lib/aos-readiness.mjs`.
- Preserve `main`'s post-#405 compact surface session behavior inside the canonical avatar-controls path. Do not resurrect `apps/sigil/context-menu/*` as an active implementation path.
- Resolve the file-location conflict by applying the compact-surface-session behavior to `apps/sigil/avatar-controls/compact-surface-session.js` if that helper remains needed by the renamed surface.
- Keep canonical avatar-controls test names. If `tests/renderer/context-menu-hit-test.test.mjs` only conflicts because HEAD renamed/replaced it, port any still-relevant #405 assertions into the avatar-controls tests and keep the old context-menu test deleted.
- For semantic-target conflicts, preserve target-addressed action semantics and schemas from #409 while retaining any `main` additions that are not obsolete aliases or stale vocabulary.
- Keep evergreen contracts strict. Do not add compatibility aliases, transitional wrappers, or legacy `context-menu` vocabulary unless a live in-repo caller requires it and the removal gate is explicit.

## Hard Boundaries

- Do not push or mutate GitHub.
- Do not rebuild the native `./aos` binary or ask for TCC regrant.
- Do not route broad workflow composition, help, recovery policy, command grammar, or public behavior into Swift.
- Do not add broad Swift `__ready`, `__status`, `__doctor`, or public-policy `__permissions` bodies.
- Do not clean unrelated untracked files. The checkout already has unrelated untracked work cards/reports and `tests/lib/__pycache__/`.
- Do not continue adjacent visual-object or Sigil architecture work beyond what is necessary to resolve this retarget conflict.

## Suggested Implementation Areas

- `apps/sigil/avatar-controls/compact-surface-session.js`
- `apps/sigil/avatar-controls/surface.js`
- `tests/renderer/avatar-controls-hit-test.test.mjs`
- `tests/renderer/avatar-controls-snapshot-projection.test.mjs`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`
- `packages/toolkit/runtime/semantic-targets.js`
- `shared/schemas/aos-semantic-targets.md`
- `src/act/canvas-ref-targeting.swift`
- `src/perceive/models.swift`
- `src/perceive/semantic-targets.swift`
- `docs/api/aos.md`

## Verification

Required deterministic checks:

```bash
git diff --check
node --test tests/aos-readiness-composition.test.mjs
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
node --test tests/renderer/avatar-controls-hit-test.test.mjs
node --test tests/renderer/avatar-controls-snapshot-projection.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs
bash tests/external-parser-flags.sh
bash tests/external-command-dispatch.sh
bash tests/ready-fast-healthy-path.sh
bash tests/ready-ownership-mismatch.sh
bash tests/permissions-broker-primitives.sh
bash tests/runtime-readiness-broker-primitives.sh
bash tests/help-contract.sh
```

Run the recommendation surface if the merged branch supports it:

```bash
./aos dev recommend --json --paths scripts/aos-ready.mjs scripts/aos-status.mjs scripts/aos-doctor.mjs scripts/aos-permissions.mjs scripts/lib tests
```

Live/public smoke, only if `./aos ready --json` passes:

```bash
./aos ready --json
./aos permissions check --json
./aos doctor --json
```

If live AOS verification hits a repo-mode TCC/input-tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention` and report the blocker to Foreman. Do not retry live checks, reset permissions, open Settings, rebuild native, or route around `./aos` with raw daemon tools.

## Completion Report

Report:

- Final commit SHA and commit message.
- Conflict files resolved and the chosen resolution for each conflict group.
- Exact tests/checks run with pass/fail results.
- Whether live AOS smoke ran; if not, the exact readiness blocker or command failure.
- Any unresolved risk, especially around semantic target schema/API choices or avatar-controls rename migration.
- Current `git status --short --branch`, including unrelated untracked files.
