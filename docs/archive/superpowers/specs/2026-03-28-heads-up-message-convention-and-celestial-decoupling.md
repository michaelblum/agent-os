# heads-up: Content Message Convention & Celestial Decoupling

**Date:** 2026-03-28
**Status:** Approved design, pending implementation
**Scope:** `packages/heads-up/examples/celestial/`, convention docs, no changes to heads-up Swift code

## Problem

heads-up can display arbitrary HTML content in canvases and has a two-way bridge: `eval` (host→content) and `messageHandlers` (content→host). But there's no convention for how content should organize its messaging. Every canvas is a snowflake — you have to read its source to know how to talk to it.

As more content is built for heads-up (avatars, debug panels, creative tools, status displays), the lack of a shared message convention means:

- Orchestrators need bespoke glue for each canvas
- Content can't be composed or swapped without rewriting the orchestration
- No discovery — you can't ask a canvas what it understands
- No ecosystem — every author invents their own protocol

Meanwhile, the celestial polyhedron prototype (`~/Documents/celestial_2.html`) is a monolith with rendering, animation, and UI controls entangled. It needs to be refactored into a heads-up consumer that validates the full host↔content bridge.

## Design Principles

1. **heads-up stays dumb.** The convention lives in content JS, not in the daemon. Zero Swift changes.
2. **Content is autonomous.** A canvas has its own animation loop, local heuristics, idle behavior. The brain sends intent, not micromanaged instructions. A face doing lip sync processes the audio stream itself — the brain just says "speak."
3. **Unopinionated about intelligence.** Content can be as smart or as dumb as it wants. The convention prescribes the envelope, not the vocabulary.
4. **Web-native.** JSON messages, `{type, payload}` shape — the dominant pattern in the JS ecosystem (DOM events, Redux actions, postMessage). No binary formats, no new concepts.
5. **OSC-inspired addressing.** Message types use slash-separated paths for namespacing when needed (`aura/intensity`, `colors/face`), inspired by [Open Sound Control](https://opensoundcontrol.stanford.edu/spec-1_0.html) address patterns.

## The Message Convention

### Envelope

Every message is a JSON object with two fields:

```json
{"type": "mood", "payload": {"state": "curious", "intensity": 0.8}}
{"type": "aura/intensity", "payload": 0.73}
{"type": "geometry", "payload": "icosahedron"}
{"type": "ready"}
```

- **`type`** (string, required): What kind of message this is. Use slash-separated paths for namespacing (`aura/intensity`, `colors/face`). Content authors define their own vocabulary.
- **`payload`** (any, optional): The message data. Can be a primitive, object, array, or absent entirely.

That's the entire wire format. What types exist and what payloads look like is up to the content author.

### Inbound (orchestrator → canvas)

Content exposes a `receive` function on a global `headsup` object:

```js
window.headsup = {
  receive(msg) {
    switch (msg.type) {
      case "mood":
        setMood(msg.payload.state, msg.payload.intensity);
        break;
      case "aura/intensity":
        auraIntensity = msg.payload;
        break;
      // ...
    }
  }
}
```

The orchestrator calls it via heads-up's existing eval mechanism:

```bash
heads-up eval --id celestial \
  --js "headsup.receive({type:'mood', payload:{state:'curious'}})"
```

### Outbound (canvas → world)

Content sends messages via the existing WKWebView messageHandler:

```js
function emit(type, payload) {
  window.webkit.messageHandlers.headsup.postMessage(
    payload !== undefined ? {type, payload} : {type}
  );
}

// Usage
emit("ready");
emit("click", {x: 150, y: 200});
emit("stateChanged", {key: "geometry", value: "dodecahedron"});
```

The daemon already wraps outbound messages with the canvas ID and relays to subscriber connections:

```json
{"type": "event", "id": "celestial", "payload": {"type": "ready"}}
{"type": "event", "id": "celestial", "payload": {"type": "click", "payload": {"x": 150, "y": 200}}}
```

No changes to the relay. The inner `{type, payload}` is the content's message; the outer `{"type": "event", "id": ...}` is the daemon's envelope.

### Manifest (optional discovery)

Content can optionally declare what it understands:

```js
window.headsup = {
  manifest: {
    name: "celestial",
    version: "1.0",
    accepts: ["mood", "geometry", "colors", "aura/intensity", "scale", "audio/url"],
    emits: ["ready", "click", "stateChanged"]
  },
  receive(msg) { /* ... */ }
}
```

This enables future tooling (an orchestrator discovering canvas capabilities at runtime). Not required — canvases without a manifest work fine, they're just opaque.

### Boilerplate

Content authors can copy this snippet as a starting point:

```js
// headsup content bridge — copy into your canvas HTML
window.headsup = {
  manifest: { name: "my-content", accepts: [], emits: ["ready"] },
  receive(msg) {
    // handle inbound messages here
  }
};

// Outbound helper
function emit(type, payload) {
  if (window.webkit?.messageHandlers?.headsup) {
    window.webkit.messageHandlers.headsup.postMessage(
      payload !== undefined ? { type, payload } : { type }
    );
  }
}

// Signal ready when initialized
emit("ready", headsup.manifest);
```

### Conventions (recommended, not required)

- **Emit `ready` after initialization.** Tells the orchestrator it's safe to start sending messages. Content loaded via `--url` may take time to initialize (loading Three.js, setting up WebGL, etc.).
- **Accept `state` for bulk updates.** A `{type: "state", payload: {...}}` message that applies a full or partial state snapshot. Useful for restoring a saved configuration.
- **Accept `ping`, reply with `pong`.** For content-level health checks (distinct from daemon-level `heads-up ping`).

## Celestial Refactor

The celestial polyhedron is refactored into two files in `packages/heads-up/examples/celestial/`:

### renderer.html — The Face

A standalone HTML file that renders the Three.js polyhedron scene. Designed to be loaded into a heads-up canvas via `create --url`.

**Characteristics:**
- Transparent background — floats as an overlay
- Autonomous animation loop (idle spin, aura pulse) — alive by default with no messages
- No UI controls — pure visual output
- Implements the message convention (`window.headsup.receive()`)

**Message vocabulary:**

| Type | Payload | Effect |
|------|---------|--------|
| `geometry` | `"tetrahedron"` \| `"cube"` \| `"octahedron"` \| `"dodecahedron"` \| `"icosahedron"` | Switch polyhedron shape |
| `colors` | `{face?, edge?, aura?}` — hex strings | Set colors (partial update OK) |
| `colors/master` | hex string | Set all three colors at once |
| `opacity` | number 0–1 | Face opacity |
| `aura/intensity` | number 0–3 | Aura glow strength |
| `aura/pulseRate` | number | Pulse speed |
| `aura/spike` | (no payload) | Trigger an amplitude spike |
| `mood` | `{state, colors?, aura?, scale?}` | High-level preset (content maps mood to visuals) |
| `scale` | number | Z-depth scale |
| `camera` | `{type: "perspective"\|"orthographic", fov?}` | Switch camera mode |
| `moveTo` | `{x, y}` | Move the polyhedron to screen-relative position |
| `audio/url` | URL string | Load audio for local analysis (future lip sync) |
| `state` | full state object | Bulk state restore |
| `ping` | — | Health check |

**Emitted events:**

| Type | Payload | When |
|------|---------|------|
| `ready` | `{manifest}` | Initialization complete |
| `click` | `{x, y}` | User clicks (when interactive) |
| `pong` | — | Reply to ping |

### builder.html — The Workshop

A standalone HTML page opened in a regular browser (not in heads-up). Used at design time to craft polyhedron configurations.

**Characteristics:**
- Full slider panel from the original celestial (geometry, colors, opacity, aura, camera, scale, movement)
- Live Three.js preview
- "Copy Messages" button — dumps the current state as a JSON array of `{type, payload}` messages, ready to pipe into the renderer
- "Copy State" button — dumps as a single `{type: "state", payload: {...}}` message
- Can optionally connect to a running heads-up renderer for live preview (sends messages via a small WebSocket/fetch relay — stretch goal, not required for v1)

The builder's export format IS the message format. No separate config schema. The config is the messages.

## Proof-of-Concept Demo

A documented sequence (and optionally a shell script at `packages/heads-up/examples/celestial/demo.sh`) that exercises the full bridge:

```bash
#!/bin/bash
# Celestial heads-up bridge demo
# Requires: heads-up binary built and on PATH

RENDERER="$(dirname "$0")/renderer.html"

# 1. Create a transparent floating polyhedron
heads-up create --id celestial --at 500,200,600,600 \
  --url "file://$RENDERER" --interactive

# 2. Listen for events (background)
heads-up listen &
LISTEN_PID=$!
sleep 2  # wait for "ready" event

# 3. Change geometry
heads-up eval --id celestial \
  --js "headsup.receive({type:'geometry', payload:'icosahedron'})"
sleep 1

# 4. Set mood
heads-up eval --id celestial \
  --js "headsup.receive({type:'mood', payload:{state:'curious', colors:{face:'#00e5ff', edge:'#ffffff'}}})"
sleep 2

# 5. Spike the aura
heads-up eval --id celestial \
  --js "headsup.receive({type:'aura/spike'})"
sleep 1

# 6. Bulk state restore (what builder would export)
heads-up eval --id celestial --js "headsup.receive({
  type: 'state',
  payload: {
    geometry: 'dodecahedron',
    colors: {face: '#ff00ff', edge: '#00ffcc', aura: '#ff00ff'},
    opacity: 0.0,
    aura: {intensity: 1.5, pulseRate: 0.008}
  }
})"

sleep 5

# 7. Cleanup
kill $LISTEN_PID
heads-up remove --id celestial
```

## What's Not in Scope

- **Streaming infrastructure.** Real-time audio→canvas data flow is a future concern. For now, the orchestrator relays, or the canvas loads a stream URL directly.
- **Canvas-to-canvas routing.** Canvas A can't address Canvas B. The orchestrator bridges them. May add daemon-level routing later if patterns demand it.
- **Manifest discovery via `heads-up list`.** Nice-to-have: daemon could query `window.headsup.manifest` and include it in list output. Deferred.
- **Canvas groups.** Separate task (foundation layer 0.5c), no dependency.
- **Any Swift changes to heads-up.** The convention is purely content-side.

## Relationship to the Ecosystem

The message convention is a **content authoring pattern**, not an agent-os protocol. It standardizes how things loaded into heads-up canvases communicate with the outside world. It does not prescribe how agent-os tools communicate with each other — that's a broader question for when more tools exist.

The architecture for a given agent is:

```
Tools (sensors/actuators)          Content (canvases)
┌──────────┐  ┌──────────┐        ┌──────────┐  ┌─────────┐
│ speak-up │  │ side-eye │        │   Face   │  │ Workshop│
│ hand-off │  │   etc.   │        │  Panel   │  │  Debug  │
└────┬─────┘  └────┬─────┘        └────▲─────┘  └────▲────┘
     │             │                   │              │
     └──────┬──────┘           eval    │    eval      │
            │              ┌───────────┴──────────────┘
            ▼              │
     ┌──────────────────────┐
     │    Orchestrator       │  ← the brain
     │  (script, agent, LLM)│
     └──────────────────────┘
            ▲
            │  messageHandlers (events from canvases)
            │
        heads-up daemon (relay)
```

The orchestrator reads from tools and sends intent to canvases. Canvases handle their own local intelligence (animation, heuristics, lip sync). The message convention is the language spoken on the right side of this diagram.
