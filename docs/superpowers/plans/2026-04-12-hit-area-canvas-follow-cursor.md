# Hit-Area Canvas + Follow-Cursor Slice (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 3 slice of the avatar-streamline arc: a full-display drawing canvas that lerps an avatar shape toward the cursor and drives a small hit-area canvas via the Phase 1 canvas.update API at 60Hz, using cascade ownership for lifecycle.

**Architecture:** Two linked canvases. `avatar-draw` (full display, passthrough, subscribes to `input_event`) owns `avatar-hit` (small, interactive, empty) via Phase 1's createdBy→cascade model. Drawing canvas runs the state machine, renders the avatar, and repositions hit-area each rAF tick. Hit-area has no logic; it exists solely to absorb clicks on the avatar body.

**Tech Stack:** Plain HTML + Canvas2D + `window.webkit.messageHandlers.headsup.postMessage` / `window.headsup.receive` (existing Phase 1 + PoC plumbing). No daemon changes.

**Context:** Verification is visual/manual (WKWebView canvas behavior) — there is no unit-test harness for these pages. Each task ends with explicit manual verification steps and a commit. If an earlier task's verification fails, stop and debug before proceeding.

**Branch policy:** main, do NOT push to origin until the full 5-phase avatar-streamline arc lands.

---

### Task 1: Hit-area page (`hit-area.html`)

**Files:**
- Create: `apps/sigil/avatar-streamline/hit-area.html`

- [ ] **Step 1: Write the hit-area page**

Create `apps/sigil/avatar-streamline/hit-area.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; cursor: default; }
/* Debug tint — comment out once the slice is stable. Helps visually confirm the hit-area is where we think it is. */
body { background: rgba(255, 0, 128, 0.15); }
</style>
</head>
<body>
<script>
// Minimal absorber page. No subscriptions, no message handlers.
// Its job is to exist where canvas.update puts it so clicks land here
// instead of passing through to the desktop.
window.headsup = window.headsup || {};
window.headsup.receive = function(_b64) { /* no-op */ };
console.log('[avatar-hit] ready');
</script>
</body>
</html>
```

- [ ] **Step 2: Verify standalone**

Run:
```bash
aos show create --id hit-solo --url aos://sigil/avatar-streamline/hit-area.html --frame 400,400,80,80 --interactive
```

Expected: a small pink-tinted square appears at (400,400). Clicking on it should consume the click (whatever is behind it does not receive the click — easiest test: open a Finder window behind, click on the square, Finder should not activate).

Clean up:
```bash
aos show remove --id hit-solo
```

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/avatar-streamline/hit-area.html
git commit -m "feat(sigil): avatar-streamline hit-area absorber page"
```

---

### Task 2: Drawing canvas — subscribe + render without hit-area

**Files:**
- Create: `apps/sigil/avatar-streamline/draw.html`

Scope: verify the follow-cursor rendering works on its own before adding the canvas.update hot path. Isolates bugs.

- [ ] **Step 1: Write the drawing canvas page**

Create `apps/sigil/avatar-streamline/draw.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
#view { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block; }
#status {
  position: absolute; top: 20px; left: 20px; padding: 8px 12px;
  background: rgba(0,0,0,0.6); color: #8ef;
  font: 13px/1.4 ui-monospace, monospace; border-radius: 4px; pointer-events: none;
}
</style>
</head>
<body>
<canvas id="view"></canvas>
<div id="status">avatar-draw: starting...</div>
<script>
// ---- Tunable constants (Phase 3 first slice) ----
var FOLLOW_ALPHA = 0.2;   // linear ease toward cursor per frame
var AVATAR_R     = 20;    // drawn circle radius
var HIT_SIZE     = 80;    // hit-area square edge
var HIT_HALF     = HIT_SIZE / 2;

// ---- Canvas setup ----
var canvas = document.getElementById('view');
var ctx = canvas.getContext('2d');
var statusEl = document.getElementById('status');

function resize() {
  var dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.floor(window.innerWidth  * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width  = window.innerWidth  + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ---- State ----
var target  = { x: 0, y: 0, valid: false };
var current = { x: 0, y: 0, valid: false };
var eventCount = 0;

// ---- Daemon → canvas plumbing ----
function postToHost(type, payload) {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
    window.webkit.messageHandlers.headsup.postMessage(
      payload !== undefined ? { type: type, payload: payload } : { type: type }
    );
  }
}

window.headsup = window.headsup || {};
window.headsup.receive = function(b64) {
  try {
    var msg = JSON.parse(atob(b64));
    eventCount++;
    if (typeof msg.x === 'number' && typeof msg.y === 'number') {
      target.x = msg.x;
      target.y = msg.y;
      target.valid = true;
      if (!current.valid) { current.x = msg.x; current.y = msg.y; current.valid = true; }
    }
  } catch (e) { console.error('[avatar-draw] parse error', e); }
};

// ---- Status banner ----
setInterval(function() {
  statusEl.textContent = 'avatar-draw: events=' + eventCount +
    ' target=' + (target.valid ? Math.round(target.x) + ',' + Math.round(target.y) : '—') +
    ' pos=' + (current.valid ? Math.round(current.x) + ',' + Math.round(current.y) : '—');
}, 500);

// ---- Animation loop ----
function tick() {
  if (target.valid) {
    current.x += (target.x - current.x) * FOLLOW_ALPHA;
    current.y += (target.y - current.y) * FOLLOW_ALPHA;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (current.valid) {
    ctx.beginPath();
    ctx.arc(current.x, current.y, AVATAR_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(140, 220, 255, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---- Subscribe to cursor events ----
postToHost('subscribe', { events: ['input_event'] });
console.log('[avatar-draw] subscribed, waiting for events');
</script>
</body>
</html>
```

- [ ] **Step 2: Launch and verify follow-cursor rendering**

Run:
```bash
aos show create --id avatar-draw --url aos://sigil/avatar-streamline/draw.html
```

Expected:
- Transparent full-display canvas appears with status banner top-left
- Move mouse around: a blue circle with white outline should ease toward the cursor, trailing slightly (not glued exactly — the lerp is visible as a soft drag)
- Status banner shows event count climbing and target/pos updating
- Rapid cursor motion: no stutter, no jumps to origin, no disappearing

Leave running for the next task (or clean up and relaunch fresh).

If the circle flickers or fails to appear, check daemon logs at `~/.config/aos/repo/daemon.log` and the WKWebView console via Safari's Develop menu.

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/avatar-streamline/draw.html
git commit -m "feat(sigil): avatar-streamline drawing canvas with lerp follow"
```

---

### Task 3: Drawing canvas creates hit-area via canvas.create

**Files:**
- Modify: `apps/sigil/avatar-streamline/draw.html`

Scope: drawing canvas issues one `canvas.create` on startup to spawn the hit-area at the current avatar position. Hot-path `canvas.update` lands in Task 4.

- [ ] **Step 1: Add hit-area creation + response handling**

Modify `apps/sigil/avatar-streamline/draw.html`. Replace the existing `window.headsup.receive` handler with a version that also handles `canvas.response`, and add a creation call after the subscribe line at the bottom of the script.

Find this block:
```javascript
window.headsup = window.headsup || {};
window.headsup.receive = function(b64) {
  try {
    var msg = JSON.parse(atob(b64));
    eventCount++;
    if (typeof msg.x === 'number' && typeof msg.y === 'number') {
      target.x = msg.x;
      target.y = msg.y;
      target.valid = true;
      if (!current.valid) { current.x = msg.x; current.y = msg.y; current.valid = true; }
    }
  } catch (e) { console.error('[avatar-draw] parse error', e); }
};
```

Replace with:
```javascript
// Track whether hit-area has been created (guards canvas.update until ready).
var hitReady = false;

window.headsup = window.headsup || {};
window.headsup.receive = function(b64) {
  try {
    var msg = JSON.parse(atob(b64));

    // Response envelope from canvas.create / canvas.remove (Phase 1 API).
    if (msg.type === 'canvas.response') {
      if (msg.request_id === 'create-hit' && msg.status === 'ok') {
        hitReady = true;
        console.log('[avatar-draw] hit-area created');
      } else if (msg.request_id === 'create-hit') {
        console.error('[avatar-draw] hit-area create failed:', msg.code, msg.message);
      }
      return;
    }

    // Input event fan-out (PoC path).
    eventCount++;
    if (typeof msg.x === 'number' && typeof msg.y === 'number') {
      target.x = msg.x;
      target.y = msg.y;
      target.valid = true;
      if (!current.valid) { current.x = msg.x; current.y = msg.y; current.valid = true; }
    }
  } catch (e) { console.error('[avatar-draw] parse error', e); }
};
```

Find this block at the bottom:
```javascript
postToHost('subscribe', { events: ['input_event'] });
console.log('[avatar-draw] subscribed, waiting for events');
```

Replace with:
```javascript
postToHost('subscribe', { events: ['input_event'] });
console.log('[avatar-draw] subscribed, waiting for events');

// Create the hit-area as our child. Initial frame is off-screen until we get
// our first cursor event; Task 4 will reposition it every rAF tick.
postToHost('canvas.create', {
  id: 'avatar-hit',
  url: 'aos://sigil/avatar-streamline/hit-area.html',
  frame: [-1000, -1000, HIT_SIZE, HIT_SIZE],
  interactive: true,
  request_id: 'create-hit'
});
```

- [ ] **Step 2: Verify hit-area spawns and cascades**

Run (remove any prior instance first):
```bash
aos show remove --id avatar-draw 2>/dev/null
aos show create --id avatar-draw --url aos://sigil/avatar-streamline/draw.html
aos show list --json
```

Expected: `aos show list --json` shows BOTH `avatar-draw` and `avatar-hit`. The hit-area is a pink-tinted 80×80 square parked at approximately (-1000,-1000) — may be off-screen, that's fine.

Console log on draw canvas shows `[avatar-draw] hit-area created`.

Cascade test:
```bash
aos show remove --id avatar-draw
aos show list --json
```

Expected: both canvases gone. The hit-area removed automatically via Phase 1 cascade ownership.

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/avatar-streamline/draw.html
git commit -m "feat(sigil): drawing canvas spawns hit-area child via canvas.create"
```

---

### Task 4: Drive hit-area position via canvas.update per rAF tick (hot path)

**Files:**
- Modify: `apps/sigil/avatar-streamline/draw.html`

Scope: this is the 60Hz hot path. First real exercise of Phase 1's `canvas.update` under sustained load.

- [ ] **Step 1: Add canvas.update inside the animation tick**

Modify the `tick` function in `apps/sigil/avatar-streamline/draw.html`. Find:
```javascript
function tick() {
  if (target.valid) {
    current.x += (target.x - current.x) * FOLLOW_ALPHA;
    current.y += (target.y - current.y) * FOLLOW_ALPHA;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (current.valid) {
    ctx.beginPath();
    ctx.arc(current.x, current.y, AVATAR_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(140, 220, 255, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  requestAnimationFrame(tick);
}
```

Replace with:
```javascript
function tick() {
  if (target.valid) {
    current.x += (target.x - current.x) * FOLLOW_ALPHA;
    current.y += (target.y - current.y) * FOLLOW_ALPHA;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (current.valid) {
    ctx.beginPath();
    ctx.arc(current.x, current.y, AVATAR_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(140, 220, 255, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Drive hit-area — fire-and-forget per Phase 1 spec (no request_id).
  if (hitReady && current.valid) {
    postToHost('canvas.update', {
      id: 'avatar-hit',
      frame: [
        Math.round(current.x - HIT_HALF),
        Math.round(current.y - HIT_HALF),
        HIT_SIZE,
        HIT_SIZE
      ]
    });
  }

  requestAnimationFrame(tick);
}
```

- [ ] **Step 2: Launch, verify glue, and measure hot-path cost**

In terminal A:
```bash
aos show remove --id avatar-draw 2>/dev/null
aos show create --id avatar-draw --url aos://sigil/avatar-streamline/draw.html
```

In terminal B, sample daemon CPU during sustained cursor motion:
```bash
# Find the daemon pid
pgrep -f 'aos serve' || launchctl list | grep com.agent-os.aos
# Sample it for 10s during cursor swirling — move the mouse in continuous circles the whole time
top -pid $(pgrep -f 'aos serve') -l 10 -s 1 | grep -E '^\s*[0-9]+\s+aos'
```

Expected:
- Blue avatar circle eases toward cursor with the same smoothness as Task 2
- Pink-tinted hit-area is glued to the avatar body, tracking every frame
- No visible lag between avatar and hit-area — they should appear as a single object
- Daemon CPU during motion: single-digit percent, comparable to PoC baseline (~0% was the Task 9 measurement). If >10% sustained, flag for failure-mode investigation.
- No dropped frames / no stuttering of the avatar circle (indicates `canvas.update` is not starving the input_event forwarding or animation loop)

Click test (hit-area absorbs):
- Open a Finder window behind the avatar
- Click on the avatar body — Finder should not activate (hit-area consumed it)
- Click just outside the avatar body — Finder should activate normally

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/avatar-streamline/draw.html
git commit -m "feat(sigil): drive hit-area position at 60Hz via canvas.update"
```

---

### Task 5: Verification pass against spec success criteria

**Files:**
- None (verification only)

Scope: walk through the spec's success criteria table and record results. Produces the artifact the next-phase session needs.

- [ ] **Step 1: Run each success criterion**

Spec section "Success criteria" lists 5 checks. For each, record PASS / FAIL / PARTIAL with a short note:

1. **Avatar lerps smoothly toward cursor, no stutter** — swirl cursor in circles, swipe diagonally, rapid back-and-forth. Visual-only.
2. **Hit-area stays glued to avatar body** — click on/off the avatar body with Finder (or any app) behind. Verify capture is correct at the avatar's boundary.
3. **No lock contention at 60Hz** — daemon CPU sampled during sustained motion. Baseline from PoC: ~0%. Flag anything >10% sustained.
4. **Cascade cleanup works** — `aos show remove --id avatar-draw` then `aos show list --json` shows neither canvas.
5. **Hit-area absorbs during drag** — mousedown on avatar, drag in a small circle while the avatar follows. Document observed capture-loss behavior (this is Phase 4 groundwork; some lag is expected and acceptable — the spec is explicit that Phase 4's expand-on-mousedown resolves it structurally).

- [ ] **Step 2: Write the verification report as a handoff channel message**

Use the `mcp__aos-gateway__post_message` tool to post to the `handoff` channel:

```json
{
  "channel": "handoff",
  "from": "hit-area-canvas",
  "payload": {
    "to": "next-session",
    "type": "session_brief",
    "summary": "Phase 3 complete — hit-area canvas + follow-cursor slice ships. Ready for Phase 4 (expand-on-mousedown) or Phase 2 (display geometry stream).",
    "context": {
      "branch_policy": "main, do NOT push to origin — full avatar-sub elimination arc lands as one push.",
      "success_criteria_results": {
        "smooth_follow": "<PASS|FAIL|PARTIAL + note>",
        "hit_area_glued": "<...>",
        "no_lock_contention": "<... include daemon CPU sample number>",
        "cascade_cleanup": "<...>",
        "drag_capture_behavior": "<... note any lag for Phase 4 context>"
      },
      "commits_this_session": ["<git log --oneline main ^<prev-tip>>"],
      "artifacts": {
        "spec": "docs/superpowers/specs/2026-04-12-hit-area-canvas-follow-cursor.md",
        "plan": "docs/superpowers/plans/2026-04-12-hit-area-canvas-follow-cursor.md",
        "pages": "apps/sigil/avatar-streamline/draw.html and hit-area.html"
      },
      "remaining_phases": [
        "Phase 2 — Display geometry stream (needed for multi-display handoff)",
        "Phase 4 — Expand-on-mousedown for drag (hit-area resizes during drag, enables radial menu trigger)",
        "Phase 5 — Retire avatar-sub binary (port remaining behaviors)"
      ],
      "recommended_next": "Phase 4 — it directly consumes the hit-area and unlocks the radial menu reimplementation (#5). Phase 2 is independent and can wait until a multi-display handoff need appears.",
      "parent_brief": "handoff 01KNZTW54BNPB6D76Z3G2RWFGY from canvas-mutation-api"
    }
  }
}
```

Then post a pointer to the next session (same pattern as prior phase handoffs).

- [ ] **Step 3: Invoke finishing-a-development-branch**

The arc is not complete (phases 4 + 5 remain), so do NOT push to origin. Instead, use `superpowers:finishing-a-development-branch` to decide what checkpoint this phase needs (likely: no PR, no push, just a session-close handoff to the next phase).

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| Canvas topology: two canvases | Tasks 1–3 |
| No launcher canvas | Task 3 (draw.html is the entry point) |
| Data flow: subscribe + lerp + render | Task 2 |
| Data flow: canvas.update from rAF | Task 4 |
| State machine: one state `followCursor` | Task 2 (`target`/`current` pair IS the state — single state has no transitions worth naming explicitly in code) |
| File layout: `draw.html` + `hit-area.html` | Tasks 1–4 |
| Daemon changes: none | (no task needed) |
| Running it | Task 2 Step 2, Task 3 Step 2, Task 4 Step 2 |
| Success criteria (5 rows) | Task 5 Step 1 |
| Failure modes table | Referenced in Task 4 Step 2 (CPU threshold) and Task 5 Step 1 (drag capture) |
| Dependencies | (no task needed — all shipped) |

Gaps: none.

**2. Placeholder scan:** no TBD/TODO/"implement later" text remains. Manual verification steps are concrete (named commands, named expected observations). The one angle-bracket placeholders are in Task 5's handoff report body, which are runtime values the operator fills in — not plan placeholders.

**3. Type / name consistency:**
- `hitReady` defined in Task 3, used in Task 4 ✓
- `FOLLOW_ALPHA`, `AVATAR_R`, `HIT_SIZE`, `HIT_HALF` defined in Task 2, used in Tasks 3 and 4 ✓
- Canvas ids `avatar-draw` and `avatar-hit` consistent across tasks ✓
- Phase 1 API field names (`frame`, `interactive`, `request_id`, `orphan_children`) match the test-mutation harness ✓
- `canvas.response` envelope matches Phase 1 spec (status/code/message/request_id) ✓
