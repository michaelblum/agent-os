# Visual Object Profiler Live Bootstrap Correction V0

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: repair the profiler-backed visual-object live proof so the
  Sigil renderer boots in AOS and exposes `window.__sigilDebug.stellationResourceSmoke()`.
- Source artifact: Foreman live review of
  `docs/design/work-cards/visual-object-profiler-backed-leak-proof-v0.md`.
- Branch/base: continue from the current working tree on
  `gdi/selection-mode-cursor-ancestor-ladder-v0`; do not discard existing dirty
  implementation changes.
- Stop conditions: complete, failed, or human_needed only if live status-item
  discovery still cannot find a menu item after the renderer bootstrap is fixed.

## Fresh Context

Read:

- `docs/design/work-cards/visual-object-profiler-backed-leak-proof-v0.md`
- `apps/sigil/renderer/index.html`
- `apps/sigil/renderer/live-modules/main.js`
- `packages/toolkit/workbench/visual-object-resource-lifecycle.js`
- `tests/lib/sigil/visual-harness.sh`

Rediscover:

```bash
git status --short --branch
./aos ready --json
./aos content status --json
./aos show list
```

## Foreman Finding

The deterministic implementation path is green:

```bash
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
node --test tests/toolkit/visual-object-resource-lifecycle.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/panel-form.test.mjs
git diff --check
```

But the live renderer bootstrap is broken by the current diff. The new static
import in `apps/sigil/renderer/live-modules/main.js` resolves in browser URL
space from:

```text
http://127.0.0.1:<port>/sigil/renderer/live-modules/main.js
```

to:

```text
http://127.0.0.1:<port>/packages/toolkit/workbench/visual-object-resource-lifecycle.js
```

That content root does not exist:

```text
GET /packages/toolkit/workbench/visual-object-resource-lifecycle.js
=> 404 Unknown content root: packages
```

The toolkit content root is available at:

```text
GET /toolkit/workbench/visual-object-resource-lifecycle.js
=> 200
```

Observed live state after direct Sigil harness launch:

```text
document.title => "Sigil Renderer"
location.href => http://127.0.0.1:<port>/sigil/renderer/index.html?toolkit-root=toolkit
window.__sigilDebug => false
window.liveJs => false
```

So the live failure is not the profiler loop itself; the ES module never
finishes evaluating.

## Required Correction

Make the Sigil live renderer consume the lifecycle helper through a browser-safe
content-root URL or another existing Sigil/toolkit pattern that works in both:

- Node tests importing renderer modules from the filesystem;
- AOS WebView loading `aos://sigil.../renderer/index.html?toolkit-root=<key>`.

Do not add a broad compatibility layer. Keep the resource-lifecycle contract
canonical at `packages/toolkit/workbench/visual-object-resource-lifecycle.js`.

Suggested direction to evaluate first:

- avoid a static browser import that climbs out to `/packages/...`;
- use the existing `toolkit-root` query parameter or existing content-root
  runtime constants when the code runs in the browser;
- preserve deterministic imports/tests without duplicating the helper.

## Live Proof Sequence

After the bootstrap fix, use AOS-first commands and the Sigil harness:

```bash
./aos ready --json
bash -lc 'set -euo pipefail
source tests/lib/sigil/visual-harness.sh
aos_visual_prepare_live_roots
./aos show remove --id avatar-main >/dev/null 2>&1 || true
aos_visual_launch_sigil_avatar avatar-main
aos_visual_wait_sigil_avatar_ready avatar-main 15s
aos_visual_show_sigil_avatar avatar-main
./aos show eval --id avatar-main --js '\''JSON.stringify(window.__sigilDebug.stellationResourceSmoke({ edits: 300, minDurationMs: 1000 }))'\'''
'
```

If the real status-item path is specifically retried, set the expected label to
the active Sigil status item label:

```bash
AOS_STATUS_ITEM_LABEL=Sigil aos_visual_show_sigil_avatar_via_live_status_click avatar-main
```

Foreman observed that this still returned:

```text
FAIL: expected exactly one AOS status item, found 0: []
```

If that remains true after the renderer bootstrap is fixed, report it as a
separate live status-item discovery blocker instead of continuing to loop.

## Verification

Run at minimum:

```bash
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
node --test tests/toolkit/visual-object-resource-lifecycle.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/panel-form.test.mjs
git diff --check
./aos ready --json
```

Then run the live proof sequence above and report the returned evidence summary.

## Completion Report

Return:

- exact bootstrap fix made;
- deterministic tests run and result;
- live proof result, including whether `window.__sigilDebug` exists;
- profiler measurement summary from `stellationResourceSmoke`;
- status-item real-click result if retried;
- final `git status --short --branch`.
