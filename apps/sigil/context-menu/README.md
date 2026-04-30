# Sigil Context Menu Playbook

Use this playbook when diagnosing or changing the live avatar context menu.

## Perception Path

Start with AOS perception and only escalate as needed.

1. Confirm AOS is ready with `./aos ready`.
2. Use `./aos see cursor`, `./aos see observe --depth 2`, or `./aos inspect`
   for general host and accessibility perception.
3. Use `./aos do` for real mouse input when the bug appears through user
   interaction.
4. Use `apps/sigil/diagnostics/interaction-trace/launch.sh` and
   `apps/sigil/diagnostics/interaction-trace/dump.sh` when routing, duplicate
   events, or close reasons matter.
5. Use `./aos see capture --canvas avatar-main --perception` as visual
   fallback, not as the first structured read.

`./aos show eval --id avatar-main --js ...` can inspect DOM structure inside
the canvas, but it is a developer bridge under the `show` verb, not general
perception. Prefer it for targeted verification and tests, not as the primary
way to understand the menu.

## Menu Map

The root menu has four tabs:

- Shape: alpha/omega geometry and material controls.
- Look: primary colors and color submenus.
- Effects: effect toggles, travel mode, and settings submenus.
- World: grid, menu ring, window level, diagnostics, and avatar data actions.

Effects contains the fast-travel controls. The main Effects tab exposes the
Line Inter-dimensional Trail checkbox, the Line/Wormhole mode selector, and
settings entries for line trail, wormhole, lightning, magnetic, and path/trail.

## Accessibility Contract

The context menu is ordinary HTML. Keep it readable through web standards:

- The menu root is a `role="dialog"` with a concise label.
- Scrollable cards are named `role="region"` containers.
- Tabs use `role="tablist"`, `role="tab"`, `aria-selected`, and
  `aria-controls`.
- Visible panels use `role="tabpanel"` and hide inactive panels with
  `aria-hidden`.
- Segmented choices use `role="radiogroup"` and `role="radio"` with
  `aria-checked`.
- Labels must be associated with controls through native `<label for="...">`
  whenever possible.

If an agent cannot discover a control through `see/inspect` after those
semantics are present, treat that as an AOS perception capability gap before
falling back to screenshots.

## Real-Input Checks

For user-input regressions, spot-check with actual AOS events:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
bash tests/sigil-real-input-status-avatar.sh
bash tests/sigil-context-menu-real-input.sh
```

`tests/scenarios/sigil/radial-menu/real-input.sh` is the default radial-menu
entry path. It uses the live repo status item, opens the radial menu with real
drag input, and verifies the radial menu child surface through AOS semantic
targets before any screenshot or pixel fallback.

`tests/sigil-real-input-status-avatar.sh` is the default entry-path smoke. It
uses the status item as the user would: locate the AOS status item, click it
with `./aos do click`, wait for the avatar/hit target, right-click the avatar,
then interact with the context menu through real mouse events.

Real-input checks share the user's mouse. If the human moves the mouse during a
test, the test may fail for reasons unrelated to the product behavior. Treat
that as contaminated evidence and rerun after the cursor is idle.

Duplicate AOS status items are a red flag. Isolated status-item tests can create
a second AOS status item while the live repo daemon has its own item. The real
status-item smoke records the visible matching status items before it clicks so
an agent can tell whether the run had global status-item ambiguity.

`tests/sigil-context-menu-real-input.sh` starts from an already-visible avatar
and exercises deeper menu behavior: Effects, real wheel scrolling, Line Trail
Settings, trail-mode selection, back navigation, Wormhole Settings, and card
scrolling.

Synthetic routed events are still useful for deterministic state-machine tests,
but they are not enough to close a bug that was reported from physical mouse or
keyboard use.

## AOS Perception Gap

AOS already has browser-target symmetry: `aos see capture browser:<session>
--xray` returns element refs, and `aos do click browser:<session>/<ref>` can act
on those refs. Sigil's WKWebView canvas is not currently exposed as a browser
target, and `aos see/inspect` does not provide equivalent structured DOM
perception for canvas HTML. Until that platform gap is closed, Sigil tests may
use `show eval` for targeted assertions, but agent-facing diagnosis should treat
that as a workaround rather than the desired perception path.
