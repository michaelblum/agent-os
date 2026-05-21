# Sigil Reticle Preview Anchor Shape Correction V0

## Tracker

- Display-first annotation epic: https://github.com/michaelblum/agent-os/issues/295
- Source correction card:
  `docs/design/work-cards/sigil-reticle-comet-preview-anchor-bridge-correction-v0.md`
- Returned GDI branch under Foreman review:
  `gdi/sigil-reticle-comet-preview-anchor-bridge-correction-v0`
- Returned GDI commit:
  `eeec4c59582a81691dd05724966225feccec8c98`

Foreman rejected the returned slice for one blocking shape mismatch. Do not
restart the broader browser targeting work or undo the preview-anchor direction.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
browser state, display topology, Sigil state, Comet state, or temp artifact
availability. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Branch / Base

- `branch_from: origin/gdi/sigil-reticle-comet-preview-anchor-bridge-correction-v0`
- `required_start_ref: origin/gdi/sigil-reticle-comet-preview-anchor-bridge-correction-v0`
- Expected output branch: keep working on
  `gdi/sigil-reticle-comet-preview-anchor-bridge-correction-v0`
- Stop and report instead of rebasing if the current branch is not the GDI
  branch above or if `apps/sigil/renderer/live-modules/main.js` lacks
  `annotationReticleNativeBrowserWindowAnchor`.

## Foreman Review Finding

The returned implementation correctly changes preview/release ordering so the
browser bridge can receive `liveJs.annotationReticle?.preview_target` as an
anchor candidate. But the helper that recognizes that anchor does not accept
the actual reticle snapshot subject shape seen in live Operator artifacts.

Current helper condition in
`apps/sigil/renderer/live-modules/main.js`:

```js
const isNativeWindow = subject.adapter_id === 'macos-ax'
    && (subject.root_kind === 'native_window' || subject.subject_kind === 'native_window');
```

The live `preview_target` from
`/tmp/aos-operator-sigil-reticle-295-20260521/pass2/03-reticle-entered.json`
uses nested subject/root fields instead:

```json
{
  "adapter_id": "macos-ax",
  "role": "native_window",
  "root": { "kind": "native_window" },
  "subject": { "kind": "native_window" },
  "source_metadata": {
    "window_id": "195",
    "pid": 732,
    "bundle_id": "ai.perplexity.comet"
  }
}
```

Foreman confirmation command:

```bash
jq '.annotationReticle.preview_target | {id,subject_id,root_id,adapter_id,root_kind,subject_kind,role,root,subject,source_metadata,window_id,pid,projection}' \
  /tmp/aos-operator-sigil-reticle-295-20260521/pass2/03-reticle-entered.json
```

Because top-level `root_kind` and `subject_kind` are absent, the returned helper
would still return `null` for the selected Comet `preview_target`, fall back to
the committed display root active scope, and continue recording
`browser_native_window_scope_required`.

## Goal

Make the preview/release browser anchor recognition accept the actual reticle
snapshot subject shape, so a selected Comet native window can be used as the
browser bridge anchor.

The fix should be narrow: normalize native-window kind evidence from the same
candidate fields already used elsewhere in the reticle snapshot:

- `root_kind`;
- `subject_kind`;
- `root.kind`;
- `subject.kind`;
- `role` when it is `native_window`;
- optionally a native-window subject path/id pattern only if needed and bounded.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/work-cards/sigil-reticle-comet-preview-anchor-bridge-correction-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `tests/renderer/annotation-reticle.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
rg -n "annotationReticleNativeBrowserWindowAnchor|root_kind|subject_kind|root\\.kind|subject\\.kind|role: 'native_window'|preview_target" apps/sigil/renderer/live-modules/main.js tests/renderer/annotation-reticle.test.mjs
```

If the Operator artifact still exists, inspect the exact preview target shape:

```bash
jq '.annotationReticle.preview_target | {adapter_id,root_kind,subject_kind,role,root,subject,source_metadata}' \
  /tmp/aos-operator-sigil-reticle-295-20260521/pass2/03-reticle-entered.json
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or input
tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and include the script output. After the human
returns with `ready`, run `./aos ready --post-permission`.

## Required Behavior

When `annotationReticleRequestBrowserDomTarget()` is passed the current
`liveJs.annotationReticle.preview_target` and that preview target is a macOS AX
native window represented with nested `root.kind` / `subject.kind`, the bridge
must:

- accept it as a native browser window anchor;
- preserve `anchor_source: "selected_native_window"`;
- preserve `anchor_candidate_id` from the best available subject id;
- preserve `anchor_window_id` from `source_metadata.window_id`;
- not record `browser_native_window_scope_required` for this shape.

Keep stale native window/AX evidence gated to the selected anchor, as in the
returned direction. Do not broaden browser discovery.

## Scope

Likely ownership is limited to:

- `apps/sigil/renderer/live-modules/main.js`
- `tests/renderer/annotation-reticle.test.mjs`

Avoid daemon, Swift, browser adapter, Surface Inspector, persistent storage, or
schema redesign changes.

## Hard Boundaries / Non-Goals

- Do not add broad DOM/CDP discovery on every mousemove.
- Do not crawl pages, export reports, bypass login/CAPTCHA/consent, or revive a
  browser extension.
- Do not use screenshot pixels as source of truth.
- Do not weaken native scoped targeting accepted at `a363613`.
- Do not accept source-shape assertions alone if a small behavioral helper test
  can prove the snapshot shape is recognized.

## Verification

Minimum deterministic evidence:

```bash
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check apps/sigil/renderer/live-modules/host-runtime.js
node --check packages/toolkit/workbench/annotation-candidates.js
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/toolkit/annotation-candidates.test.mjs
node --test tests/toolkit/browser-dom-element-picker.test.mjs tests/toolkit/surface-inspector.test.mjs
git diff --check origin/main...HEAD
./aos ready
```

Add or update focused deterministic coverage proving that a reticle
`preview_target` shaped like the live artifact, with nested `root.kind` and
`subject.kind`, is accepted as a native browser window anchor and does not
fall through to `browser_native_window_scope_required`.

If deterministic checks pass and `./aos ready` is green, report whether live
smoke was run. Foreman can route Operator for the full Comet reticle smoke after
acceptance if GDI does not take over the desktop.

## Completion Report

Return a concise report with:

- files changed;
- exact native-window preview target shape now recognized;
- tests run with exact pass/fail results;
- `./aos ready` result;
- live smoke result or why it was skipped;
- final `git status --short --branch`;
- remaining blocker or follow-up recommendation.
