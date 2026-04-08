# SDK First Scripts — Design Sketches

Three real tasks, written as we wish they worked. The gap between these scripts and what the SDK supports today tells us exactly what to build.

---

## Script 1: "What's on screen right now?"

**The task:** An agent needs situational awareness. What apps are open, what's focused, what's the user looking at? This is the most common first step in any desktop automation.

**How we wish it worked:**

```typescript
const scene = await aos.perceive();
// Returns:
// {
//   focused: { app: "VS Code", title: "ui.js — agent-os", frame: {...} },
//   windows: [
//     { app: "VS Code", title: "ui.js — agent-os", focused: true, frame: {...} },
//     { app: "Safari", title: "GitHub - agent-os", frame: {...} },
//     { app: "Terminal", title: "~/Code/agent-os", frame: {...} }
//   ],
//   displays: [
//     { id: "main", width: 1512, height: 982, primary: true },
//     { id: "external-1", width: 2560, height: 1440 }
//   ],
//   cursor: { x: 450, y: 320, display: "main" }
// }

// Agent now knows: user is editing ui.js in VS Code, has GitHub open in Safari,
// terminal in the background. Everything it needs to decide what to do next.
// One call. No parsing. No screenshots unless it needs pixel-level detail.
```

**What this tells us the SDK needs:**
- `aos.perceive()` — combined windows + cursor + displays in one call
- The return type is the entire "what's happening" context
- No screenshots by default (expensive) — agent asks for those separately when needed
- `aos.getWindows()` exists today but doesn't include cursor or displays

---

## Script 2: "Show the user something, then clean up"

**The task:** An agent wants to display a status message near the app it's working with, keep it visible while it works, then remove it when done. This is the basic "I'm here, I'm doing something" pattern.

**How we wish it worked:**

```typescript
// Find where to put the overlay
const target = await aos.findWindow({ app: "Xcode" });

// Show a status overlay near the target window
const overlay = await aos.showOverlay({
  content: "Building project...",
  near: target,
  style: "status"  // small, non-intrusive, auto-positioned
});
// Returns: { id: "overlay-abc123", frame: { x, y, w, h } }

// Do the actual work...
await aos.clickElement("Build", { app: "Xcode" });
const result = await aos.waitFor(
  { window: /Build (Succeeded|Failed)/ },
  { timeout: 60000 }
);

// Update the overlay with the result
await aos.updateOverlay(overlay.id, {
  content: result.title.includes("Failed") ? "Build failed" : "Build succeeded",
  style: result.title.includes("Failed") ? "error" : "success",
  ttl: 3000  // auto-dismiss after 3 seconds
});
```

**What this tells us the SDK needs:**
- `aos.findWindow({ app })` — find a window by app name (subset of perceive)
- `aos.showOverlay({ content, near, style })` — create a positioned overlay with smart defaults
- `aos.updateOverlay(id, changes)` — modify an existing overlay
- `aos.clickElement(label, { app })` — the big Layer 2 method: perceive + find + click
- `aos.waitFor(pattern, { timeout })` — poll until a condition is met
- `aos.createCanvas()` exists today but requires manual HTML, positioning, and cleanup
- The `near` parameter means the SDK handles geometry — agent never calculates coordinates

---

## Script 3: "Check on the system and report"

**The task:** A monitoring script that runs periodically (or on demand) and reports on the health of the agent-os system itself. Dogfooding: the SDK inspects the system that hosts it.

**How we wish it worked:**

```typescript
const health = await aos.selfCheck();
// Returns:
// {
//   daemon: { status: "ok", pid: 66940, mode: "repo", uptime: 3600 },
//   permissions: { accessibility: true, screenRecording: true },
//   canvases: [
//     { id: "avatar", url: "aos://sigil/renderer/index.html", interactive: false },
//     { id: "studio", url: "aos://sigil/studio/index.html", interactive: true }
//   ],
//   services: {
//     sigil: { running: true, pid: 67001 },
//     gateway: { running: true, tools: 10 }
//   }
// }

// Post to coordination bus so other sessions can see it
await aos.coordination.setState("system:health", health);

// If something's wrong, say so
if (!health.permissions.accessibility) {
  await aos.say("Warning: accessibility permission is missing");
  await aos.showOverlay({
    content: "Accessibility permission required",
    style: "warning",
    display: "main",
    ttl: 10000
  });
}

return health;
```

**What this tells us the SDK needs:**
- `aos.selfCheck()` — runtime health in one call (wraps `aos doctor --json`)
- `aos.listCanvases()` — what overlays/surfaces are currently displayed
- The coordination store is already there — this script is a real consumer of it
- `aos.say()` already exists
- This script would be the first saved workflow: `run_os_script({ script_id: "self-check" })`

---

## Gap Analysis

Comparing "wish it worked" to "what exists today":

| Method | Layer | Exists? | What's needed |
|--------|-------|---------|---------------|
| `aos.getWindows()` | 1 | Yes | Works |
| `aos.click({ x, y })` | 1 | Yes | Works |
| `aos.say(text)` | 1 | Yes | Works |
| `aos.coordination.*` | 1 | Yes | All 6 methods work |
| `aos.capture(opts)` | 1 | **No** | Wrap `aos see capture` |
| `aos.getCursor()` | 1 | **No** | Wrap `aos see cursor` |
| `aos.getDisplays()` | 1 | **No** | Wrap display enumeration |
| `aos.createCanvas(opts)` | 1 | **No** | Wrap `aos show create` |
| `aos.removeCanvas(id)` | 1 | **No** | Wrap `aos show remove` |
| `aos.evalCanvas(id, js)` | 1 | **No** | Wrap `aos show eval` |
| `aos.listCanvases()` | 1 | **No** | Wrap `aos show list` |
| `aos.getConfig()` | 1 | **No** | Needs daemon endpoint |
| `aos.setConfig(key, val)` | 1 | **No** | Wrap `aos set` |
| `aos.perceive()` | 2 | **No** | Compose: windows + cursor + displays |
| `aos.findWindow(query)` | 2 | **No** | Filter from getWindows |
| `aos.clickElement(label, opts)` | 2 | **No** | capture + find + click |
| `aos.waitFor(pattern, opts)` | 2 | **No** | Poll loop with timeout |
| `aos.showOverlay(opts)` | 2 | **No** | createCanvas + positioning + template |
| `aos.updateOverlay(id, opts)` | 2 | **No** | evalCanvas with smart diffing |
| `aos.selfCheck()` | 2 | **No** | Wrap `aos doctor --json` |

**Current state: 4 methods. Target: ~20 methods. Ratio: 10 primitives + 6 smart ops + keep 4 existing.**

## Build Order

1. **Primitives first** — the 10 Layer 1 methods. Pure wrappers, no intelligence. This is plumbing.
2. **Self-check script** — uses only primitives. Proves the pipe works end to end. Becomes the first saved workflow.
3. **Smart ops** — `perceive()`, `clickElement()`, `waitFor()`, `showOverlay()`. These are the high-leverage additions.
4. **Remaining scripts** — "what's on screen" and "show and clean up" become real saved workflows.

Each step is independently useful. We don't need all 20 methods before the SDK is valuable.
