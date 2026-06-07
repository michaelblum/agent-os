# Surface Inspector Semantic Target Late-Attach Replay V0

## Historical Status

This card is historical for target identity guidance. It predates the accepted
#429 target descriptor contract and #432 drift cleanup. Replay/request behavior
should preserve the current descriptor split in
`shared/schemas/aos-semantic-targets.md`: state-scoped `ref`/`state_id`,
durable `target.target_id` scoped by `target.owner_namespace`, current `state`,
`actions`, `provenance`, and machine-first `reacquisition` hints.

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Related adapter issue: https://github.com/michaelblum/agent-os/issues/297
- HTML expression issue: https://github.com/michaelblum/agent-os/issues/301
- Follows:
  `docs/design/work-cards/surface-inspector-html-expression-semantic-annotation-reveal-v0.md`

## Goal

Make AOS-owned semantic targets discoverable by Surface Inspector even when the
inspector attaches after the target surface has already published its target
inventory.

The latest Operator smoke proved the corrected HTML Workbench Expression
annotation/reveal path works after republishing while Surface Inspector is
listening:

- `html-workbench-expression:goal` and
  `html-workbench-expression:suggested-verification` were visible in SI;
- both exposed `can_reveal=true`;
- reveal returned `already_visible` or `revealed`;
- a goal semantic pin/comment reached `pinCount=1`, `commentCount=1`;
- clearing returned both counts to zero.

But the smoke also found a lifecycle gap: if Surface Inspector launches after
the HTML Workbench Expression has already published semantic targets, SI can
initially show zero semantic rows until the expression surface is relaunched or
the payload is manually reposted.

Fix that late-attach gap.

## Required Behavior

Surface Inspector must not depend on being open at the exact moment an AOS-owned
canvas publishes semantic targets.

Implement one or both of these neutral mechanisms:

1. target surfaces retain their latest semantic target payload in inspectable
   canvas/window state and replay it when asked; or
2. Surface Inspector requests/reloads current semantic targets from existing
   live canvases when it launches, refreshes, or enters Annotation Mode.

The implementation should be generic for AOS-owned semantic targets, with HTML
Workbench Expression as the concrete smoke surface.

## Acceptance Criteria

With `html-workbench-expression` already open and loaded:

1. Launch or relaunch Surface Inspector after the expression surface is stable.
2. Without relaunching or reposting the HTML expression payload, Surface
   Inspector discovers semantic targets for the expression canvas.
3. SI sees at least:
   - `html-workbench-expression:document`
   - `html-workbench-expression:goal`
   - `html-workbench-expression:suggested-verification`
4. `goal` and `suggested-verification` still report `can_reveal=true`.
5. Reveal still works for both targets.
6. The semantic pin/comment flow still works for `goal`:
   - clean start `pinCount=0`, `commentCount=0`;
   - create pin -> `pinCount=1`, `commentCount=0`;
   - add comment -> `pinCount=1`, `commentCount=1`;
   - clear/remove -> `pinCount=0`, `commentCount=0`.
7. No minimap action controls are introduced.

## Implementation Notes

Inspect current Canvas/Surface Inspector and AOS canvas message paths before
editing. Useful areas may include:

- `packages/toolkit/components/surface-inspector/`
- HTML Workbench Expression semantic target publishing code
- semantic target projection/reveal adapter helpers
- `aos see capture --canvas <id> --xray` semantic target discovery if it is the
  right durable state source
- existing canvas lifecycle or message replay hooks

Prefer durable canvas state or an explicit request/reply event over timing-based
polling. If polling is unavoidable, keep it bounded and documented.

Do not implement app-specific annotation storage for HTML Workbench Expression.
The expression surface may be the first proving surface, but the mechanism
should serve any AOS-owned canvas that publishes semantic targets.

## Verification

Add or update focused tests that prove:

- late Surface Inspector attach can acquire existing semantic targets;
- semantic target payload replay/request keeps target ids, refs, selectors,
  visibility, and `can_reveal` intact;
- HTML Workbench Expression still publishes live semantic target payloads;
- existing annotation projection and SI annotation tests still pass.

Suggested focused commands:

```bash
node --test tests/toolkit/html-workbench-expression.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/schemas/aos-html-workbench-expression-v0.test.mjs
bash tests/help-contract.sh
git diff --check
```

Run a bounded AOS smoke if `./aos ready` passes:

```bash
./aos ready
packages/toolkit/components/html-workbench-expression/launch.sh \
  docs/design/fixtures/aos-html-workbench-expression-v0/expression.json
```

Then launch/relaunch Surface Inspector after the expression is already stable
and verify the acceptance criteria without relaunching/reposting the expression
surface.

If `CONTENT_WAIT_TIMEOUT` recurs, run one `./aos ready` recheck and report the
blocker. Do not run repeated repair loops.

## Non-Goals

- Do not add minimap action controls.
- Do not revive Surface-Zoom annotation behavior.
- Do not add global pointer capture.
- Do not browse arbitrary live websites.
- Do not mutate Employer Brand capture manifests, repair patches, diagnostics,
  data bundles, or report artifacts.
- Do not migrate Markdown docs to HTML.
- Do not make generated HTML canonical.
- Do not add arbitrary source-authored JavaScript execution.
