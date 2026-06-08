# Recent UI Tabs Keyboard Focus Correction V0

## Fresh Context Contract

Continue on branch `implementer/recent-ui-live-regression-implementer-repairs-v0` in
`/Users/Michael/Code/agent-os`. Do not work in `.docks/`. This is a targeted
review correction for commit `17aded471d855ede48f99e37cfe9c0fb7192cdf4`.

## Review Finding

`packages/toolkit/adapters/zag/tabs.js` replaced the browser-unsafe bare
`@zag-js/tabs` import with a local browser-safe tabs adapter. That fixes the
blank-page blocker, but the keyboard navigation behavior regressed.

In `handleTriggerKeydown`, Arrow/Home/End keys compute the next tab value and
call `setFocusedValue(values[nextIndex])`, but they do not focus the next tab
element and do not update bound trigger/content attributes unless a consumer
happens to re-render and rebind.

Foreman probe on the current branch:

```text
after ArrowRight from tab a:
adapter value: b
active element: a
a aria-selected: true
b aria-selected: false
```

That violates the Operator sweep requirement that tab focus, arrow-key behavior,
ARIA state, and visual selected state stay in sync.

## Goal

Make `createAosZagTabs` keyboard behavior match expected tab semantics for the
local browser-safe adapter:

- ArrowRight/ArrowDown moves focus to the next trigger, respecting orientation.
- ArrowLeft/ArrowUp moves focus to the previous trigger.
- Home/End move focus to the first/last trigger.
- In automatic activation mode, keyboard navigation also updates selected value,
  trigger `aria-selected`, trigger `tabindex`, content `hidden`, and content
  label linkage for the currently bound DOM.
- In manual activation mode, keyboard navigation moves focus without activating
  until the user clicks or otherwise activates the focused tab.
- `loopFocus: false` clamps at the first/last tab.

## Suggested Implementation Direction

Stay inside `packages/toolkit/adapters/zag/tabs.js` unless tests prove another
small helper is needed. Preserve the browser-safe no-bare-`@zag-js` property.

The adapter may keep a record of the current bound root/triggers/contents and
resync their props after value/focus changes, or it may call a focused rebind
path that does not replace DOM nodes. Avoid relying on each consumer to re-render
after every keyboard event; the adapter should maintain the attributes it owns.

When moving keyboard focus, call `focus()` on the target trigger. Keep
`onValueChange` and `onFocusChange` behavior compatible with the current
Integration Hub and Wiki KB consumers.

## Tests

Add focused tests in `tests/toolkit/zag-adapter-tabs.test.mjs` that would fail
on commit `17aded4`:

- ArrowRight from the first trigger moves `document.activeElement` to the second
  trigger, selects the second trigger in automatic mode, and updates content
  visibility.
- ArrowLeft wraps back when `loopFocus` is true.
- `loopFocus: false` clamps at the boundary.
- Manual activation mode moves focus but does not change selected value until
  click or explicit activation.

Run at minimum:

```bash
node --test tests/toolkit/zag-adapter-tabs.test.mjs tests/toolkit/integration-hub-semantics.test.mjs tests/toolkit/wiki-kb-layout-modes.test.mjs
git diff --check
```

If the correction touches live consumers, also run their relevant focused tests.

## Hard Boundaries

- Do not reintroduce bare `@zag-js/...` imports in browser-consumed files.
- Do not broaden into other Zag adapters.
- Do not rerun the full Operator sweep in Implementer. Report completion to Foreman so
  Foreman can decide whether to merge or route the next live verification pass.

## Completion Report

Report:

- files changed;
- the keyboard/focus semantics fixed;
- tests run and results;
- whether the branch remains clean;
- whether any live AOS blocker appeared while testing.
