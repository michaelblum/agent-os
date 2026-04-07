---
name: heads-up activation and interaction patterns — recipe book, not defaults
description: When to steal focus vs stay passive. Discovered during dogfood that makeKeyAndOrderFront on create is wrong as a default — sometimes the overlay should be passive while the user keeps working in their app. The choice belongs to the orchestrator.
status: exploring
date: 2026-04-02
session: hand-off-v2-design (post-compaction)
trigger: when building orchestration patterns or example surfaces
related: headsup_accessibility_and_native_components.md, ascconfig_panel_bootstrap.md
keywords: heads-up, interactive, activation, focus, draggable, passive overlay, orchestration, recipe book, UX
---

# heads-up Activation and Interaction Patterns

## The principle
heads-up should NOT be opinionated about when to steal focus. The orchestrator decides.

## Two modes observed during dogfood

### Passive overlay (default, non-interactive)
- Agent shows status, progress, or information
- User keeps working in their app
- Overlay does NOT steal focus, does NOT accept keyboard input
- `ignoresMouseEvents = true`, `canBecomeKey = false`
- Example: "Working on it..." spinner, progress indicator, status badge

### Interactive surface (opt-in via --interactive)
- Agent needs a response from the user
- User clicks the overlay to interact (first click activates, second click interacts)
- The "two-click" behavior is actually correct — it's standard macOS behavior for non-frontmost windows
- `ignoresMouseEvents = false`, `canBecomeKey = true`, `NSApp.activate()` on click
- Example: confirmation dialog, text input, control surface

### Immediate-focus interactive (opt-in, NOT default)
- Agent wants the user's attention RIGHT NOW
- Overlay appears AND grabs focus immediately
- User can start typing/clicking without the first "activation" click
- Would need an `--activate` flag or orchestrator calls `NSApp.activate()` via eval
- Example: urgent confirmation, error that needs immediate response
- WARNING: this is interruptive — use sparingly

## Michael's guidance (2026-04-02)
"We don't want to bake that in. It just needs to be in the recipe book."

The overlay we built during dogfood is a bespoke test fixture, not a product opinion. agent-os provides the display server (heads-up). What surfaces to build, when to steal focus, how to handle feedback loops — that's the orchestrator's job. agent-os might ship thin example surfaces, but they're examples, not prescriptions.

## The 10-4 protocol (separate concern)
The feedback loop pattern (query → response → receipt/👍) should be a message contract in shared/schemas/, not baked into heads-up. Any surface implements it. See session notes for the proposed schema.
