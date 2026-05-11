# Input Tap Force Quit Carveout V0

## Tracker

- Runtime input tap implementation: `src/perceive/daemon.swift`
- Daemon input routing: `src/daemon/unified.swift`
- Related runtime safety issue: input lockups after rebuild/permission churn

## Goal

Make macOS Force Quit reachable even if AOS input routing is misbehaving.

`Option+Command+Escape` is the system escape hatch the human can still
sometimes break through to trigger. AOS must never intercept, delay, transform,
or consume that chord. When the input tap sees it, AOS should immediately pass
it through unchanged and temporarily enter an input safety passthrough window so the
Force Quit dialog can receive arrow keys and Return.

This is the preferred simple safety layer over a terminal killswitch, because
when input is locked up the human may not be able to switch to Terminal and type
a command.

## Human Evidence

The human reports:

- when input gets locked up, they cannot reliably switch to Terminal and type a
  command;
- pressing `Option+Command+Escape` several times eventually opens Force Quit;
- arrow keys and Return can then break through enough to select and force quit;
- therefore the emergency path must preserve Force Quit, not depend on a CLI
  typed after lockup.

## Required Behavior

### 1. Hard Top-Priority Carveout

At the very top of the CGEventTap callback path, before broadcasting or
consumption decisions:

- detect `Option+Command+Escape` keyDown and keyUp events;
- return/pass the original event unchanged;
- never call downstream consume/routing logic for that chord;
- never return `nil` for that chord.

Use the canonical Escape key code already used elsewhere in the repo (`53`) and
CGEvent flags for command and option/alternate.

### 2. Input Safety Passthrough Window

When `Option+Command+Escape` is detected:

- set an in-memory input safety passthrough deadline, initially 10-15 seconds;
- during that window, all input events should be passed through unchanged and
  must not be consumed by AOS;
- the event tap may still observe enough to maintain health/debug state, but no
  AOS feature may consume keyboard/mouse events during the window;
- if the chord is seen again, extend the passthrough deadline.

This should make the Force Quit dialog usable with arrow keys and Return after
the chord breaks through.

### 3. Fail Open

The carveout should be fail-open:

- if event classification is uncertain, pass through;
- if debug/logging fails, pass through;
- if downstream handlers would consume the event, bypass them during the input safety
  window.

Do not add any behavior that makes Force Quit depend on daemon IPC, Surface
Inspector, canvases, status item state, or Terminal input.

### 4. Debug State

Expose lightweight debug state in the daemon/system ping or existing health
surface, if practical:

- `panic_passthrough_active` (legacy compatibility field name);
- `panic_passthrough_until` (legacy compatibility field name);
- `panic_trigger: "cmd_opt_escape"` (legacy compatibility field name);
- count of safety shortcut trigger events seen.

If adding the health fields is too broad, at minimum add deterministic tests
around the pure event-classification / passthrough helper and leave health fields
as a follow-up.

### 5. Tests

Add tests around the pure logic, not live CGEventTap:

- `Option+Command+Escape` keyDown is classified as input safety passthrough;
- `Option+Command+Escape` keyUp is classified as passthrough;
- Command+Escape without Option is not the input safety trigger;
- Option+Escape without Command is not the input safety trigger;
- during input safety passthrough, ordinary mouse/key events are not consumable;
- repeated trigger extends the deadline;
- downstream consume decisions are ignored while input safety passthrough is active.

Prefer extracting small pure helpers from `src/perceive/daemon.swift` if needed
so tests can run without macOS input permissions.

## Suggested Implementation Areas

Inspect before editing:

- `src/perceive/daemon.swift`
  - `startEventTap`;
  - `handleTapEvent`;
  - `inputEventPayload`;
  - `modifierFlags`;
- `src/daemon/unified.swift`
  - `handleInputEvent`;
  - input consumption paths;
  - daemon health/system ping fields;
- tests around input tap/readiness or add a focused Swift/script test.

Potential implementation shape:

- add an `InputSafetyHotkeyState` / helper that can be unit tested;
- in the event tap callback or first line of `handleTapEvent`, check
  `isForceQuitChord(event)`;
- if true, activate input safety passthrough and return false;
- if input safety passthrough is active, return false before `onInputEvent` can consume;
- keep mouse cursor tracking optional during the safety window if it cannot consume.

## Verification

Run focused tests:

```bash
bash tests/input-tap-readiness.sh
bash tests/daemon-ipc-system.sh
bash tests/help-contract.sh
git diff --check
```

Add and run any new focused test for the pure input safety shortcut logic.

If Swift files change, run:

```bash
./aos dev build
```

Completion report must explicitly say that a runtime rebuild occurred and that
the safe post-build sequence is:

```bash
./aos service stop --mode repo
# human removes/re-adds /Users/Michael/Code/agent-os/aos in Accessibility/Input Monitoring if needed
./aos ready --post-permission
```

Do not ask Operator to run live AOS smoke until the post-build permission state
is clean.

## Non-Goals

- no external watchdog app;
- no terminal-only killswitch;
- no macOS Settings automation;
- no Surface Inspector feature work;
- no Employer Brand work;
- no broad daemon lifecycle rewrite;
- no attempt to intercept or replace the Force Quit dialog.
