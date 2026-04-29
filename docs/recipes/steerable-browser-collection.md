# Steerable Browser Collection

Use this recipe for the V0 browser-only steerable collection substrate. It
produces a source pack with a canonical timeline, human marks, evidence items,
observation artifacts, a narrative stub, and a replay stub.

## Prerequisites

Run the repo readiness gate first:

```bash
./aos ready
```

For live browser checks, the Playwright browser adapter must already be healthy
for the target session. The deterministic demo and source-pack writer tests do
not require a live browser or a Swift rebuild.

## Run Control

The toolkit run-control plane lives at `packages/toolkit/run-control/`. It owns
state transitions, action gating, safety-gate dispatch, bounded step behavior,
and single-writer timeline append semantics.

The ambient puck is served from the toolkit content root:

```bash
./aos show create --id run-puck-<session> --url 'aos://toolkit/run-puck/index.html?session=<session>' --track union
```

The puck emits `run.control` events for clicks and routed hotkeys. It is a
sibling daemon canvas, not a Sigil renderer module.

## Browser Marks

The browser intent sensor lives at `packages/toolkit/browser-intent-sensor/`.
V0 supports element selection, rectangular region marks, and comments. Each
mark is canonicalized into a `human.mark` event with
`locator_strategy_version: "aos.browser-locator.v0"` and a
`locator_candidates[]` array.

The selected locator is deterministic: `role_name`, then `text`, then `css`,
then `ref`, then `rect`, choosing the first candidate validated at mark time.

## Source Pack

Live output should use the mode-scoped root:

```text
~/.config/aos/{mode}/source-packs/<session_id>/
```

The V0 layout is:

```text
source-pack.json
collection-session.jsonl
narrative.md
playwright-replay.spec.ts
artifacts/
  screenshots/
  page-text/
  selected-regions/
  crops/
  observations/
evidence/evidence-items.jsonl
marks/human-marks.jsonl
```

The checked-in deterministic sample is at:

```text
docs/superpowers/artifacts/v0-demo/source-pack/
```

## Deterministic Demo

Regenerate the sample pack with:

```bash
node -e "import('./src/sessions/steerable-collection/demo.js').then(async ({runDeterministicDemo}) => { await runDeterministicDemo({rootDir: 'docs/superpowers/artifacts/v0-demo/source-pack'}); })"
```

Verify it with:

```bash
node --test tests/steerable-collection-source-pack.test.mjs
```

## V0 Boundaries

V0 is browser-only. It intentionally does not implement desktop sensing, replay
codegen, Employer Brand Audit workflow, Swift schema validation, voice
attribution, or freehand draw mode. `playwright-replay.spec.ts` remains a stub
until replay codegen has its own implementation plan.
