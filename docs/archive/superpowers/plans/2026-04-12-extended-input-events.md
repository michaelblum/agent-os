# Extended Input Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add modifier-key `flags` to every `input_event` broadcast, and emit the missing counterpart events (`right_mouse_up`, `other_mouse_down`, `other_mouse_up`, `key_up`).

**Architecture:** Strictly additive. Extend the existing `CGEventTap` mask in `src/perceive/daemon.swift` with the four missing event types, extend `inputEventName` to map them to names, read `CGEvent.flags` in `inputEventPayload` and pass a `flags: [String: Bool]` dict into `inputEventData`. Extend `inputEventData` in `src/perceive/events.swift` to accept and include the dict. No changes to broadcast/subscribe/fanout machinery. No new files in `src/`.

**Tech Stack:** Swift (macOS 14+), CoreGraphics (`CGEvent`, `CGEventFlags`, `CGEventType`), AOS daemon, existing Phase 3 canvas subscription machinery.

**Reference spec:** `docs/superpowers/specs/2026-04-12-extended-input-events.md`.

---

## File Structure

**Modify:**
- `src/perceive/events.swift` — extend `inputEventData` signature with `flags:` parameter.
- `src/perceive/daemon.swift` — extend event tap mask, event name mapping, and payload builder to emit flags and the four missing events.

**Create:**
- `apps/sigil/test-input-events/index.html` — manual verification harness.

No other files change.

---

## Task 1: Extend `inputEventData` with flags parameter

**Files:**
- Modify: `src/perceive/events.swift:30-36`

- [ ] **Step 1: Replace `inputEventData` with the extended signature**

Replace lines 30–36 of `src/perceive/events.swift` (the entire `inputEventData` function) with:

```swift
func inputEventData(type: String, x: Double? = nil, y: Double? = nil, keyCode: Int64? = nil, flags: [String: Bool]? = nil) -> [String: Any] {
    var data: [String: Any] = ["type": type]
    if let x { data["x"] = x }
    if let y { data["y"] = y }
    if let keyCode { data["key_code"] = keyCode }
    if let flags { data["flags"] = flags }
    return data
}
```

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: PASS. Existing call sites in `src/perceive/daemon.swift` omit the new parameter (it has a default of `nil`) and keep compiling.

- [ ] **Step 3: Commit**

```bash
git add src/perceive/events.swift
git commit -m "feat(perceive): accept optional flags on input-event payload"
```

---

## Task 2: Add missing event types to the tap mask

**Files:**
- Modify: `src/perceive/daemon.swift:53-64`

- [ ] **Step 1: Extend the `eventTypes` array**

Locate the `eventTypes` declaration inside `startEventTap()` (around line 53) and replace its contents. The full new declaration should read:

```swift
        let eventTypes: [CGEventType] = [
            .mouseMoved,
            .leftMouseDown,
            .leftMouseUp,
            .leftMouseDragged,
            .rightMouseDown,
            .rightMouseUp,
            .rightMouseDragged,
            .otherMouseDown,
            .otherMouseUp,
            .otherMouseDragged,
            .keyDown,
            .keyUp,
            .tapDisabledByTimeout,
            .tapDisabledByUserInput,
        ]
```

Added entries: `.rightMouseUp`, `.otherMouseDown`, `.otherMouseUp`, `.keyUp`.

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: PASS. The mask computation on the following lines is unchanged — it consumes whatever `eventTypes` contains.

- [ ] **Step 3: Commit**

```bash
git add src/perceive/daemon.swift
git commit -m "feat(perceive): subscribe tap to missing counterpart events"
```

---

## Task 3: Map the new event types to names

**Files:**
- Modify: `src/perceive/daemon.swift:117-138`

- [ ] **Step 1: Replace the `inputEventName` switch**

Replace the entire body of `inputEventName(for:)` with:

```swift
    private func inputEventName(for type: CGEventType) -> String? {
        switch type {
        case .leftMouseDown:
            return "left_mouse_down"
        case .leftMouseUp:
            return "left_mouse_up"
        case .leftMouseDragged:
            return "left_mouse_dragged"
        case .mouseMoved:
            return "mouse_moved"
        case .rightMouseDown:
            return "right_mouse_down"
        case .rightMouseUp:
            return "right_mouse_up"
        case .rightMouseDragged:
            return "right_mouse_dragged"
        case .otherMouseDown:
            return "other_mouse_down"
        case .otherMouseUp:
            return "other_mouse_up"
        case .otherMouseDragged:
            return "other_mouse_dragged"
        case .keyDown:
            return "key_down"
        case .keyUp:
            return "key_up"
        default:
            return nil
        }
    }
```

Added cases: `.rightMouseUp`, `.otherMouseDown`, `.otherMouseUp`, `.keyUp`.

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/perceive/daemon.swift
git commit -m "feat(perceive): map new event types to canonical names"
```

---

## Task 4: Read flags and include in payload

**Files:**
- Modify: `src/perceive/daemon.swift:140-149`

- [ ] **Step 1: Replace `inputEventPayload` with the flags-aware version**

Replace the body of `inputEventPayload(for:event:eventName:)` with:

```swift
    private func inputEventPayload(for type: CGEventType, event: CGEvent, eventName: String) -> [String: Any] {
        let flags = modifierFlags(from: event.flags)
        switch type {
        case .keyDown, .keyUp:
            let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
            return inputEventData(type: eventName, keyCode: keyCode, flags: flags)
        default:
            let point = event.location
            return inputEventData(type: eventName, x: point.x, y: point.y, flags: flags)
        }
    }

    /// Map `CGEventFlags` to the shared {shift, ctrl, cmd, opt, fn} dict used
    /// in every `input_event` payload. `.maskAlphaShift` (capslock) is ignored
    /// intentionally.
    private func modifierFlags(from flags: CGEventFlags) -> [String: Bool] {
        return [
            "shift": flags.contains(.maskShift),
            "ctrl": flags.contains(.maskControl),
            "cmd": flags.contains(.maskCommand),
            "opt": flags.contains(.maskAlternate),
            "fn": flags.contains(.maskSecondaryFn),
        ]
    }
```

Changes: `.keyUp` joined `.keyDown` in the key-events branch; `flags` is always computed and passed through.

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: PASS.

- [ ] **Step 3: Kickstart daemon and confirm clean boot**

Run: `launchctl kickstart -k gui/$(id -u)/com.agent-os.aos.repo`
Then: `tail -10 ~/.config/aos/repo/daemon.log`
Expected: clean startup, no Swift crash or assertion related to the new tap entries.

- [ ] **Step 4: Commit**

```bash
git add src/perceive/daemon.swift
git commit -m "feat(perceive): emit modifier flags on every input event"
```

---

## Task 5: Test harness page

**Files:**
- Create: `apps/sigil/test-input-events/index.html`

- [ ] **Step 1: Write the page**

Create `apps/sigil/test-input-events/index.html` with exactly:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body { margin: 0; padding: 16px; background: #0a0e14; color: #cbd5e1;
  font: 12px/1.4 ui-monospace, SFMono-Regular, monospace; }
h1 { font-size: 14px; margin: 0 0 12px 0; color: #8ef; }
#log { background: #020617; padding: 8px 12px; border-radius: 4px;
  max-height: 75vh; overflow-y: auto; white-space: pre-wrap; }
.line { padding: 1px 0; }
.ts { color: #64748b; }
.type { font-weight: bold; margin-left: 6px; }
.mods { color: #fbbf24; margin-left: 6px; }
.pos { color: #94a3b8; margin-left: 6px; }
.down { color: #f87171; }
.up { color: #60a5fa; }
.drag { color: #c084fc; }
.moved { color: #64748b; }
.key { color: #fbbf24; }
.hint { color: #64748b; margin-bottom: 8px; }
</style>
</head>
<body>
<h1>input_event test harness</h1>
<div class="hint">Clicks, key presses, and modifier combos will appear below. mouse_moved is dimmed.</div>
<div id="log"></div>
<script>
function postToHost(type, payload) {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
    window.webkit.messageHandlers.headsup.postMessage(
      payload !== undefined ? { type: type, payload: payload } : { type: type }
    );
  }
}

var logEl = document.getElementById('log');

function classify(type) {
  if (type.endsWith('_down')) return 'down';
  if (type.endsWith('_up')) return 'up';
  if (type.endsWith('_dragged')) return 'drag';
  if (type === 'mouse_moved') return 'moved';
  if (type.startsWith('key_')) return 'key';
  return '';
}

function mods(flags) {
  if (!flags) return '';
  var active = [];
  if (flags.cmd) active.push('cmd');
  if (flags.shift) active.push('shift');
  if (flags.ctrl) active.push('ctrl');
  if (flags.opt) active.push('opt');
  if (flags.fn) active.push('fn');
  return active.length ? active.join('+') : '';
}

function line(msg) {
  var ts = new Date().toISOString().slice(11, 23);
  var cls = classify(msg.type);
  var el = document.createElement('div');
  el.className = 'line ' + cls;
  var posText = '';
  if (typeof msg.x === 'number') {
    posText = Math.round(msg.x) + ',' + Math.round(msg.y);
  } else if (typeof msg.key_code === 'number') {
    posText = 'key=' + msg.key_code;
  }
  var modText = mods(msg.flags);
  el.innerHTML =
    '<span class="ts">' + ts + '</span>' +
    '<span class="type">' + msg.type + '</span>' +
    (posText ? '<span class="pos">' + posText + '</span>' : '') +
    (modText ? '<span class="mods">[' + modText + ']</span>' : '');
  logEl.insertBefore(el, logEl.firstChild);
  // Cap log length.
  while (logEl.childNodes.length > 400) logEl.removeChild(logEl.lastChild);
}

window.headsup = window.headsup || {};
window.headsup.receive = function(b64) {
  try {
    var msg = JSON.parse(atob(b64));
    if (typeof msg.type === 'string') line(msg);
  } catch (e) {
    var el = document.createElement('div');
    el.textContent = 'parse error: ' + e;
    logEl.insertBefore(el, logEl.firstChild);
  }
};

postToHost('subscribe', { events: ['input_event'] });
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add apps/sigil/test-input-events/index.html
git commit -m "test(sigil): input_event harness page"
```

---

## Task 6: Manual verification

**Files:** None (manual procedure against the live daemon).

- [ ] **Step 1: Launch harness**

Run: `./aos show create --id input-test --url aos://sigil/test-input-events/index.html --at 80,80,720,520`
Expected: dark window opens with empty log. mouse_moved events start scrolling as the cursor moves.

- [ ] **Step 2: Plain click**

Action: click somewhere on screen (outside the harness).
Expected: the log shows `left_mouse_down <pos>` (red) followed by `left_mouse_up <pos>` (blue), both with no `[mods]` tag.

- [ ] **Step 3: Cmd-click**

Action: hold cmd, click.
Expected: both down and up lines show `[cmd]`.

- [ ] **Step 4: Shift+cmd-click**

Action: hold shift+cmd, click.
Expected: both lines show `[cmd+shift]`.

- [ ] **Step 5: Right-click and release**

Action: right-click somewhere.
Expected: `right_mouse_down` (red) AND `right_mouse_up` (blue) both appear. Before this spec, only `right_mouse_down` fired.

- [ ] **Step 6: Middle-click (if hardware supports it — mouse with scroll-wheel button)**

Action: middle-click.
Expected: `other_mouse_down` and `other_mouse_up`. Skip if hardware has no middle button.

- [ ] **Step 7: Key press (plain)**

Action: focus the harness window (click into its title area if draggable, or focus any other app that accepts keystrokes — the CGEventTap is system-wide so focus does not matter for observation), then press a letter key and release.
Expected: `key_down key=<code>` (yellow), then `key_up key=<code>` (yellow). Before this spec, only `key_down` fired.

- [ ] **Step 8: Key press with modifier**

Action: press cmd+A.
Expected: `key_down key=0 [cmd]` (keycode 0 for 'a'), followed by `key_up key=0 [cmd]`.

- [ ] **Step 9: Phase 3 regression check**

Run: `./aos show create --id avatar-draw --url aos://sigil/avatar-streamline/draw.html --at 0,0,1512,982`
Expected: Phase 3 behavior unchanged — blue dot snaps to cursor with wake trail. Clicks still absorbed by hit-area. No JS errors in daemon.log or in the canvas console (inspect with Safari Develop menu if needed).
Cleanup: `./aos show remove --id avatar-draw`

- [ ] **Step 10: Cleanup**

Run: `./aos show remove --id input-test`
Expected: `{"status":"success"}`. Log tail shows `[canvas-sub] cleared subscriptions for removed canvas=input-test`.

- [ ] **Step 11: Record outcome**

No code to commit. Note in the session handoff which hardware-dependent steps (middle-click, fn-key) were skipped.

---

## Self-review checklist (run after implementation)

- Spec acceptance criteria map to Task 6 steps: 1→2, 2→7, 3→3, 4→4, 5→5, 6→6, 7→7, 8→9, 9→(automatic; no existing field removed across tasks).
- `inputEventData`'s new `flags:` parameter has a default of `nil`; call sites that don't pass it continue to compile. Only the call in `inputEventPayload` passes `flags`.
- No placeholders.
- Type consistency: the flags dict keys `shift`, `ctrl`, `cmd`, `opt`, `fn` are used in both `modifierFlags(from:)` (Swift) and the harness's `mods(flags)` (JS).
- Non-goals: no `flags_changed`, click count, scroll, or capslock added. Confirmed.
