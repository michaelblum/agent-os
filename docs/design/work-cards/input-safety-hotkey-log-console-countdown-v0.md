# Input Safety Hotkey Log Console Countdown V0

## Tracker

- Safety hotkey implementation: `src/perceive/input-safety-hotkeys.swift`
- Input tap pre-routing path: `src/perceive/daemon.swift`
- Daemon input routing / system ping: `src/daemon/unified.swift`
- Existing log command: `src/commands/log.swift`
- Existing log surface: `packages/toolkit/components/log-console/index.js`

## Goal

Add conspicuous, best-effort visual confirmation when the Force Quit input
safety passthrough opens, without introducing a new bespoke graphic surface.

When the user presses `Option+Command+Escape`, AOS should still immediately
pass the chord through to macOS and open/extend the 12 second input safety
passthrough window. In addition, AOS should asynchronously bring the existing
log console surface forward when possible and show a simple countdown:

```text
AOS input passthrough
12
11
10
9
8
7
6
5
4
3
2
1
```

The visual feedback is confirmation only. The safety behavior must not depend
on the log console, canvas IPC, WebKit, JavaScript, Surface Inspector, or any
other UI path.

## Design Decision

Use the existing `__log__` console instead of creating a dedicated panic chip or
new custom surface.

Arbitrary JavaScript can be run inside a canvas through the existing canvas eval
mechanism, but this work should prefer explicit message APIs over eval. The log
console already accepts `log/append` and `log/clear` style messages. If a small
new log-console message type is needed for a cleaner self-updating countdown,
add it narrowly and test it. Do not inject arbitrary JS from the input tap path.

Acceptable implementation shapes, in preference order:

1. Reuse the existing log-console message channel and append countdown entries
   from an async daemon-side presenter.
2. Add a narrow log-console message such as `log/countdown` or
   `log/input_safety_countdown` that renders a temporary countdown block inside
   the existing log console.
3. Use canvas eval only as a fallback if the existing runtime has no practical
   message route, and document why eval was required.

## Required Behavior

### 1. Event Tap Remains Tiny And Fail-Open

The CGEvent tap path must remain safety-first:

- classify the Force Quit input safety hotkey;
- open or extend the passthrough window;
- enqueue visual feedback asynchronously;
- immediately return passthrough.

Do not perform canvas creation, canvas lookup, WebKit evaluation, sleeps,
timers, file IO, log writes, shell commands, or daemon IPC work synchronously
inside the event tap callback.

### 2. Reuse Or Create The Log Console

When the input safety passthrough is triggered:

- if `__log__` already exists, bring it forward/resume it and write the
  countdown there;
- if `__log__` does not exist, create the standard log console using
  `aos://toolkit/components/log-console/index.html`;
- if AOS created `__log__` only for this countdown, auto-remove it after the
  countdown finishes;
- if the log console already existed, leave it open after the countdown.

This should be daemon-internal runtime behavior. Do not shell out to
`./aos log`, and do not rely on a connection-scoped CLI log session from
`src/commands/log.swift`.

### 3. Bring-To-Front Is Best Effort

The visual confirmation should make the log console conspicuous:

- resume it if suspended;
- bring/focus/order it forward using existing canvas lifecycle primitives;
- avoid stealing input in a way that interferes with the Force Quit dialog;
- do not block waiting for confirmation that it came forward.

If bring-to-front fails, still attempt to append the countdown. If all visual
feedback fails, the input safety passthrough still succeeds.

### 4. Countdown Lifecycle

The countdown must be duplicate-safe:

- repeated `Option+Command+Escape` extends the passthrough deadline;
- repeated triggers update/restart the same countdown sequence rather than
  creating duplicate log consoles or multiple overlapping timers;
- the countdown stops when the active passthrough window ends;
- auto-cleanup removes only a log console created solely for this visual
  feedback;
- never remove a pre-existing user/agent log console.

The displayed countdown should match the current remaining passthrough time as
closely as practical. Minor one-second display rounding is acceptable.

### 5. Debug State

Expose enough debug state for deterministic verification, either through
existing system ping fields, a focused helper, or the log-console serialized
state:

- whether visual feedback is active;
- whether it reused an existing log console or created one;
- the current countdown deadline;
- the last displayed remaining value;
- whether cleanup is pending or complete.

Keep existing `input_tap.panic_*` compatibility fields stable.

## Suggested Implementation Areas

Inspect before editing:

- `src/perceive/input-safety-hotkeys.swift`
- `src/perceive/daemon.swift`
- `src/daemon/unified.swift`
- `src/daemon/canvas-inspector-bundle.swift`
- `src/commands/log.swift`
- `packages/toolkit/components/log-console/index.js`
- existing canvas lifecycle helpers under `src/display/`
- existing tests around daemon IPC, input safety hotkeys, and log console.

Likely implementation shape:

- add a daemon-owned `InputSafetyVisualFeedbackPresenter` or equivalent small
  helper near daemon/runtime code, not in the event classification helper;
- have the input tap safety decision report a `triggered` transition;
- on trigger, dispatch to the main queue and call the presenter with the new
  deadline;
- presenter creates/resumes/foregrounds `__log__` asynchronously;
- presenter sends log messages or a narrow countdown message to the log console;
- presenter owns one timer and invalidates/restarts it on repeated triggers;
- presenter records whether it created the log console so cleanup does not
  remove a pre-existing console.

## Verification

Run focused tests:

```bash
bash tests/input-safety-hotkeys.sh
bash tests/input-tap-readiness.sh
bash tests/daemon-ipc-system.sh
bash tests/help-contract.sh
git diff --check
```

Add focused coverage for the countdown presenter:

- existing `__log__` is reused and not removed after countdown;
- missing `__log__` is created and then removed after countdown;
- repeated trigger extends/restarts one countdown without duplicate timers;
- visual feedback failure does not change passthrough classification;
- no shell command is invoked from the event tap path;
- log-console message handling or serialized state exposes the countdown
  evidence if a new message type is added.

If Swift files change, run:

```bash
./aos dev build
```

If `./aos ready` passes after the build, run a bounded live smoke:

1. ensure no unrelated `__log__` console is open, if safe;
2. trigger the presenter through a test hook or synthetic safety-hotkey event;
3. verify the standard log console appears/comes forward;
4. verify visible countdown entries or countdown block;
5. verify auto-removal when AOS created the log console;
6. repeat with an existing `__log__` console and verify it is preserved.

If readiness is blocked after rebuild, report the safe post-build sequence:

```bash
./aos service stop --mode repo
# human removes/re-adds /Users/Michael/Code/agent-os/aos in Accessibility/Input Monitoring if needed
./aos ready --post-permission
```

Do not ask Operator to run live AOS smoke until the post-build permission state
is clean.

## Non-Goals

- no new bespoke panic chip canvas;
- no Surface Inspector feature work;
- no Annotation Mode changes;
- no changes to `ctrl+opt+c` see-bundle behavior;
- no changes to `ctrl+opt+a` Annotation Mode behavior;
- no shelling out from the event tap;
- no synchronous canvas/WebKit/JS work in the event tap;
- no Employer Brand work;
- no broad hotkey/router rewrite.
