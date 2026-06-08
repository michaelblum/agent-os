# Recipe: Test Harness Ladder And Prep

Use this recipe when a change touches runtime, canvas, input, status-item,
lifecycle, visual, supervised, or cross-layer behavior and the right test
harness is not obvious. Skip it for tiny parser, docs, schema, or copy-only
changes unless the work card asks for a harness plan.

The rule is speed with fidelity: choose the cheapest adequate harness that is
canonical-path representative. Use that phrase rather than
production-faithful. The current canonical runtime/design path can change while
AOS is greenfield; the test only needs to preserve the variable at risk for the
path that currently owns the behavior.

## Harness Plan

```text
Risk under test:
Existing harness/workspace:
Why this harness is enough:
What this harness does not cover:
Required representative fixture shape:
Must not use as sole proof:
Existing primitives/helpers to reuse:
Candidate reusable artifact reporting:
```

## Prep Steps

1. Name the risk under test in concrete terms. Avoid broad labels like
   "runtime bug" when the actual variable is URL identity, canvas lifecycle,
   status-item owner PID, display coordinate frame, or real pointer delivery.
2. Start at the foundational ladder in `tests/README.md` and choose the lowest
   level that still observes that variable.
3. Check existing helpers before adding new test code. Look first under
   `tests/lib/`, then nearby scenario tests and schema tests.
4. Describe the fixture shape needed to remain canonical-path representative.
   A fake fixture is not adequate if it removes the distinction that caused the
   defect.
5. Name what cannot be used as sole proof. Common examples are inline HTML
   canvases for URL-resolution defects, `show eval` state mutation for real
   input defects, and isolated daemons for shared repo-daemon singleton defects.
6. If new helper code is still needed, keep it local until a second caller or a
   clear platform boundary proves it should be promoted.

## Canonical URL And Fresh Runtime Evidence

Use shared helpers in `tests/lib/visual-harness.sh` when a visual or live-canvas
test touches generic content-root URLs, reloads, or canvas setup. Use
app-specific harnesses such as `tests/lib/sigil/visual-harness.sh` for
product-specific launch composition, renderer freshness, fixtures, and status
item setup. New app-specific visual helpers should start under
`tests/lib/<app>/` and source the generic harness rather than growing the
generic file.

- Command/config boundary: pass canonical `aos://...` URLs. AOS may rewrite
  those to `http://127.0.0.1:<port>/...` inside WKWebView or `show list`
  runtime evidence.
- Comparison boundary: compare canonical and resolved URLs by content-root,
  path, and query equivalence. Do not require raw string equality between
  `aos://sigil/...` and the localhost URL that served the page.
- Reload boundary: reload URL-backed canvases with
  `aos show update --url 'aos://...'`; do not copy a resolved localhost URL
  back into launch or update inputs.
- Root scoping: the single-worktree dev workflow defaults to canonical
  `sigil` and `toolkit` content-root keys, even on feature branches. Use
  branch-scoped keys only for explicit overrides or true parallel
  worktree/session isolation.
- Namespace boundary: a content-root key is a served namespace, not proof of a
  Git worktree. Use show-list owner metadata to prove
  `owner.worktree_root` matches the expected repo root.
- Freshness boundary: when code changes matter, live smoke evidence must prove
  `window.__sigilDebug.snapshot().runtime.loadedAt` is newer than or equal to
  `git show -s --format=%cI HEAD`.

## Examples

- URL-backed canvas versus inline HTML canvas: if the risk is canvas source URL
  identity or `aos://` resolution, create the canvas through the URL-backed path
  that the current runtime uses. Inline HTML can be a cheap model fixture for DOM
  assertions, but it cannot be the sole proof for a URL identity defect.
- Isolated daemon versus live repo daemon: use `tests/lib/isolated-daemon.sh`
  when the behavior needs a daemon but should not touch the user's repo runtime.
  Use shared repo-daemon live canvas tests, with `tests/lib/live-canvas-serial.sh`,
  when singleton canvas namespace, live content roots, or the current repo
  daemon is the variable under test.
- Real pointer input versus renderer state mutation: renderer or toolkit tests
  can cover deterministic state transitions. If the failure happens through
  mouse movement, keyboard input, input taps, status-item clicks, or
  DesktopWorld/native coordinate conversion, use a real-input scenario or record
  why that proof is blocked.
- Optional Sigil example: for avatar launch through the status item, a
  status-item owner/click harness is representative. Directly creating
  `avatar-main` with `show create --html` or changing renderer state with
  `show eval` skips the ownership and click path and is not enough by itself.

## Reporting Hooks

For runtime, canvas, input, status, lifecycle, visual, supervised, or
cross-layer slices, include the relevant fields in the Implementer completion report or
work-card-specific report:

- `harness_selection`: harness used, level chosen, and why it preserved the
  defect variable.
- `fixture_blind_spots`: fixture shortcuts that would erase the variable under
  test or evidence the selected fixture still preserves it.
- `new_test_artifact_candidates`: new primitives, helpers, fixtures, scenarios,
  or reports that Foreman should later promote, keep local, or delete.
- `why_no_harness_prep_needed`: short explanation for tiny docs/parser/schema
  changes or cases where the existing manifest-backed recommendation is enough.

Do not force every tiny Implementer task to carry these fields. They are required when
the slice crosses runtime/canvas/input/status/lifecycle boundaries and optional
otherwise.
