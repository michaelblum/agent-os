# Agent OS — Ecosystem Architecture Blueprint

A multi-agent macOS and web automation ecosystem built on Unix-style, single-purpose CLIs. An LLM orchestrator composes these tools by piping structured JSON between them. No tool knows about any other tool. The orchestrator is the only entity that holds the full picture.

## 1. Philosophy & Design Principles

### Unix-Style Composition

Every tool does one thing. Perception is separate from action. Action is separate from projection. Voice is separate from vision. Tools communicate through structured JSON on stdout (success) and stderr (errors). An orchestrator — any orchestrator — pipes them together.

This means the ecosystem is not a framework. It is a parts bin. You can use `side-eye` without `hand-off`. You can use `chrome-harness` without Syborg Studio. You can replace Syborg Studio entirely and the CLIs still work.

### JSON-First I/O Contract

Every tool in the ecosystem follows the same output contract:

**Success** (stdout, exit 0):
```json
{
  "status": "success",
  "...": "tool-specific payload"
}
```

**Failure** (stderr, exit 1):
```json
{
  "error": "Human-readable description",
  "code": "MACHINE_READABLE_CODE"
}
```

No tool emits unstructured text. No tool requires interactive input during normal operation. An LLM can parse every response without heuristics.

### Local Coordinate System (LCS)

All spatial data uses coordinates relative to the captured target, never global macOS screen space. `(0,0)` is always the top-left of whatever region is being discussed — a display, a window, a cropped zone, a DOM element.

This is a safety constraint. It means:
- Agents never do global screen math
- Coordinates from one tool's output can be fed directly to another tool's input
- Foveated perception (cropping to a region) automatically filters out everything outside the crop

### Sensor / Actuator / Projection Separation

The ecosystem draws hard lines between three categories of capability:

| Category | What it does | Example |
|----------|-------------|---------|
| **Sensor** | Reads state, emits structured data | `side-eye` captures pixels + AX tree |
| **Actuator** | Changes state, synthesizes events | `hand-off` fires CGEvent clicks |
| **Projection** | Renders visual feedback for humans | `heads-up` draws floating overlays |

No tool crosses these boundaries. A sensor never mutates. An actuator never renders UI. A projection never captures.

### "Mirror, Don't Reinvent"

When exposing capabilities to agents, use APIs they already know from pre-training. `pw-bridge` exposes real Playwright method signatures, not a custom DSL. The Chrome extension uses standard `chrome.*` APIs. This means an agent that knows Playwright or Chrome Extensions already knows how to drive these tools.

---

## 2. The Three Layers

### Layer 1: OS Layer (Native Swift CLIs)

Pure Swift binaries using only Apple frameworks. Zero external dependencies. Each manages its own macOS permissions (Screen Recording, Accessibility, Microphone). These tools treat the computer as a physical object — pixels, mouse events, audio hardware.

**Tools:**

| Tool | Role | Frameworks | Status |
|------|------|------------|--------|
| `side-eye` | **Perception** — screenshots, AX tree traversal, spatial metadata | ScreenCaptureKit, ApplicationServices, CoreGraphics | Production (v3.0) |
| `hand-off` | **Action** — mouse movement, clicks, drags, keystrokes | CoreGraphics (CGEvent), ApplicationServices | Planned |
| `heads-up` | **Projection** — floating overlays, the avatar orb, spotlights, laser pointers | AppKit (NSWindow), CoreAnimation | Planned |
| `speak-up` | **Audio** — text-to-speech output, speech-to-text dictation | AVFoundation, Speech | Planned |

All four share the LCS convention. All four emit JSON. All four are stateless — the orchestrator holds state, not the tools.

### Layer 2: Web Layer (Node / CDP)

Node.js tools that interact with the browser's internals via Chrome DevTools Protocol. These treat the browser as a programmable environment — DOM state, page lifecycle, extension APIs.

**Tools:**

| Tool | Role | Tech | Status |
|------|------|------|--------|
| `chrome-harness` | **Lifecycle** — boot Chrome, manage profiles, install/reload extensions, broker CDP connections | Node.js, raw WebSocket CDP | Production (in syborg repo) |
| `pw-bridge` | **DOM Action** — expose Playwright commands to agents via stdin line protocol | Playwright Core over CDP | Production (in chrome-harness/scripts/) |
| `tear-sheet` | **Artifact Extraction** — high-fidelity element capture, scroll stitching, DOM/CSS/metadata extraction for reports and decks | Playwright, CDP | Planned (code exists in DRAW scrapyard) |

`chrome-harness` is the foundational piece. It hand-rolls WebSocket frames against CDP endpoints with zero npm dependencies (in its core). `pw-bridge` currently ships as a script inside `chrome-harness/scripts/` — it's a consumer of the CDP connection that `chrome-harness` brokers, not a standalone tool. `tear-sheet` would follow the same pattern: connect to the Chrome instance that `chrome-harness` manages.

### Layer 3: Control Surface Layer (UI Clients)

The control surface is what a human sees and interacts with. It is **not** the agent. It is a display client that renders the agent's state and accepts human input.

**Current assembly: Syborg Studio**

Syborg Studio uses a dedicated Chrome instance as its display layer. The Chrome extension (Manifest V3) provides:
- A **React sidebar** (chat interface, annotation chip system, "Teach Syborg" menu)
- A **portal tab** (durable GUI with routes for publications, multi-agent hierarchy)
- **Content scripts** (in-page annotation overlays inside a closed shadow DOM)
- A **background service worker** (message routing between content scripts and sidebar)

Syborg Studio is one possible assembly. The CLIs don't know it exists. Another team could build a completely different control surface — a native macOS app, a terminal TUI, an iOS companion — using the same underlying tools.

---

## 3. Component Roster

| Component | Layer | Language | Repo | Status | Key Capabilities |
|-----------|-------|----------|------|--------|-----------------|
| `side-eye` | OS | Swift | `michaelblum/side-eye` | Production | Screenshots, `--xray` AX tree, grids, overlays, zones, LCS |
| `hand-off` | OS | Swift | `michaelblum/hand-off` | Planned | CGEvent mouse/keyboard, coordinate-targeted actions |
| `heads-up` | OS | Swift | `michaelblum/heads-up` | Planned | Floating overlays, avatar orb, spotlight, laser, `--skin` system |
| `speak-up` | OS | Swift | `michaelblum/speak-up` | Planned | TTS (ElevenLabs/native), STT (Whisper/native), global hotkey |
| `chrome-harness` | Web | Node.js | `syborg/tools/chrome-harness` | Production | Chrome lifecycle, CDP broker, extension install/reload |
| `pw-bridge` | Web | Node.js | `syborg/tools/chrome-harness/scripts` | Production | Playwright stdin protocol, target switching, DOM interaction |
| `tear-sheet` | Web | Node.js | TBD | Planned | Element capture, scroll stitch, artifact packaging |
| Syborg Studio | Control | React/TS | `michaelblum/syborg` | Production | Chrome extension: sidebar, portal, annotation system |

---

## 4. Control Surface Architecture

### The Chat Component Problem

The current chat interface is built directly into the Chrome extension sidebar (`src/sidepanel/main.tsx`). This welds the conversation UI to Chrome — if you want a chat interface in a floating desktop window, a standalone web page, or a different browser, you'd have to rebuild it.

### The Portable Session Renderer

The chat component should be abstracted into a standalone, embeddable module: a **session renderer** that takes a connection to any local runtime and renders it as a conversation. It has no opinion about where it lives.

**What the session renderer does:**
- Renders a message stream (agent turns, user turns, tool calls, status updates)
- Accepts user text input and sends it to the connected runtime
- Displays tool-specific UI affordances (annotation chips, inline plan cards, etc.)
- Adapts to its container (sidebar width, floating window, full page)

**What it does NOT do:**
- Manage the agent runtime
- Hold conversation state (the runtime holds state)
- Know whether it's inside Chrome, Electron, Tauri, or a standalone browser tab

### "Casting" — How a Runtime Connects to a UI

When an agent session starts, the runtime needs to "cast" into a display surface. The casting protocol is the contract between the headless runtime and the visual renderer:

```
Runtime (headless)                    Control Surface (visual)
     |                                        |
     |--- WebSocket / local HTTP ------------>|  session.connect
     |                                        |
     |<-- user.message ---------------------|  user types
     |--- agent.message -------------------->|  agent responds
     |--- agent.tool_call ------------------>|  tool activity
     |--- agent.status --------------------->|  state changes
     |                                        |
```

The specifics of this protocol are an open design question (see Section 7). The key architectural decision is: **the runtime and the renderer are separate processes connected by a well-defined protocol, not a monolithic app.**

### Syborg Studio as One Assembly

With this factoring, Syborg Studio becomes an assembly of portable parts:

| Part | What it is | Could also live in... |
|------|-----------|----------------------|
| Session renderer (chat) | Embeddable React component | Tauri window, standalone page, iOS app |
| Annotation system | Content scripts + shadow DOM | Only makes sense in a browser context |
| Portal | Multi-route React app | Standalone web app, Electron |
| Background worker | Extension message router | Would need equivalent in non-Chrome contexts |

The annotation system is inherently browser-scoped (it overlays DOM elements). The chat and portal are portable. This means a "desktop mode" could be: chat in a floating Tauri window + annotations still in Chrome when needed.

---

## 5. Communication & Data Flow

### Between CLIs and the Orchestrator

The orchestrator (whatever it is — Codex, Claude Code, a custom daemon) calls CLIs as subprocesses:

```
Orchestrator
  |-- side-eye main --xray --base64    --> JSON { status, base64, elements }
  |-- hand-off click 450,320            --> JSON { status: "success" }
  |-- heads-up cast --skin orb --at ... --> JSON { id: "avatar" }
  |-- speak-up say "Hello"              --> JSON { status: "success" }
```

Each call is fire-and-forget. The CLI does its job and exits. The orchestrator decides what to do next based on the JSON response.

### Between chrome-harness and the Browser

`chrome-harness` talks to Chrome via raw CDP WebSocket on port 9224:

```
chrome-harness                          Chrome (CDP)
     |                                       |
     |--- HTTP GET /json/list ------------->|  discover targets
     |--- WebSocket to target -------------->|  send CDP commands
     |    Runtime.evaluate(...)              |
     |    Page.navigate(...)                 |
     |<-- CDP event/response ---------------|
```

`pw-bridge` layers Playwright on top of this same CDP connection, providing a higher-level command interface via stdin.

### Between Extension Components

Inside the Chrome extension, communication flows through the background service worker:

```
Content Script (page)          Background Worker          Sidebar (React)
     |                              |                          |
     |-- chrome.runtime.sendMsg --->|                          |
     |                              |-- message to sidebar --->|
     |                              |<-- message from sidebar -|
     |<-- chrome.runtime.sendMsg ---|                          |
```

The content scripts run in a closed shadow DOM on the page. They cannot be queried with normal CSS selectors from outside — interaction requires coordinate-based clicks or evaluation inside the shadow root.

### The Two Feedback Loops

The ecosystem has two parallel ways for the agent to show the human what it's doing:

**Loop A — OS Physical (Desktop Apps)**

For non-browser contexts (Xcode, Terminal, Finder):
1. `side-eye --xray` perceives the screen
2. `heads-up` draws a spotlight or laser pointer on the native desktop
3. `hand-off` clicks at the identified coordinates
4. `speak-up` narrates what happened

Everything is native macOS. No DOM involved.

**Loop B — DOM-Scoped (Web Pages)**

For browser contexts:
1. `pw-bridge` inspects the DOM (or `side-eye --xray` reads the AXWebArea)
2. The Chrome extension's content scripts draw overlays (toolbar, annotations, cursors) inside the shadow DOM
3. `pw-bridge` executes DOM actions (click, fill, navigate) OR `hand-off` fires physical clicks
4. `speak-up` narrates what happened

The overlays move with the page when it scrolls, respect CSS z-index, and lock onto DOM elements.

**The orchestrator decides which loop to use** based on what it's interacting with. The tools themselves don't know or care about the other loop.

---

## 6. The Scrapyard: Code Archaeology Map

A historical code bundle from the DRAW project (`/Users/Michael/Documents/DRAW_scavenger_bundle_5047887f`) contains ~38K lines of battle-tested extraction and capture code. Here's where each capability maps in the new ecosystem:

### Capabilities That Map to `tear-sheet` (Artifact Archivist)

These are about producing pristine, high-fidelity artifacts for human consumption (reports, decks):

| Scrapyard Function | Source File | What It Does |
|-------------------|-------------|-------------|
| `cropToElement()` | clipUtils.js | Device-pixel-aware element cropping |
| `stitchImagesWithOverlap()` | clipUtils.js | Overlap-aware vertical image stitching from scroll captures |
| `_captureVisibleTabWithQuota()` | taskExecutors.js | Rate-limited viewport capture with retry/backoff |
| Body/element/internal stitch paths | taskExecutors.js | Multi-pass capture for tall elements and scrollable containers |
| `captureSnapshotModalStitch()` | indeed_timer_sweep.cjs | Modal content scroll-and-stitch |
| `stitchSlicesWithFfmpeg()` | indeed_timer_sweep.cjs | ffmpeg vertical stitch for pre-rendered slices |
| `captureCompanyLogo()` | indeed_timer_sweep.cjs | Download-first or screenshot-fallback asset capture |
| `optimizeFullPageImageCapture()` | semantic_workflow_runner.js | Resize/recompress with quality budget |
| `extract_content()` | content.js | Browser-side text/HTML extraction |
| `extractLinksFromPage()` | content.js | Link extraction |
| `_getScopedHtml()` | content.js | Scoped HTML extraction with optional metadata |
| `downloadPdf()` | content.js | PDF fetch |
| GAS Backend conversion | sources.js, export.js | Google Docs/Slides/Sheets/PDF conversion |

### Capabilities That Map to `pw-bridge` Payloads (DOM Prep)

These are about taming the browser environment before perception or action:

| Scrapyard Function | Source File | What It Does |
|-------------------|-------------|-------------|
| `hideObscuringElementsForCapture()` | semantic_workflow_runner.js | Hide sticky/fixed elements, known modal selectors, geometry-based obscurers |
| `restoreAutoHiddenElementsForCapture()` | semantic_workflow_runner.js | Restore hidden elements, resume animations/videos |
| `_waitForAnimations()` | content.js | Wait for finite/chained animations to finish |
| `_suppressScrollbarsAndRounding()` | content.js | Remove border-radius, box-shadow, hide scrollbars for clean capture |
| Animation finish/pause | semantic_workflow_runner.js | `anim.finish()` for finite, `anim.pause()` for infinite |
| Video pause/resume | semantic_workflow_runner.js | Pause playing videos before capture |
| CSS injection capture guard | semantic_workflow_runner.js | Disable transitions/animations/caret/scrollbars globally |

These functions would be injected via `pw-bridge`'s `page.evaluate()` before `side-eye` captures, solving the Actuator Asymmetry problem (sticky headers blocking CGEvent clicks).

### Capabilities Superseded by `side-eye`

| Scrapyard Function | Why It's Superseded |
|-------------------|-------------------|
| `_getSimplifiedDom()` | `side-eye --xray` provides this natively via the AX tree, without DOM injection |
| `_precomputeInspectionData()` | Same — perception is now OS-level, not browser-level |
| `get_element_context_bundle()` | `side-eye --xray`'s `context_path` breadcrumbs serve the same purpose |

### Capabilities That Are Out of Scope (But Preserved)

| Capability | Why It's Archived |
|-----------|------------------|
| YouTube URL discovery / video analysis routing | Domain-specific to DRAW's use case |
| LLM-assisted selector generation (llmProcessor.js) | Interesting but not part of the CLI ecosystem |
| Google Apps Script backend | Historical; Google API access would be a separate concern |
| Structured projection extraction | Domain-specific scraping pattern |

### Entry Points for Scavenger Agents

If an agent needs to mine the scrapyard:
1. Start with `CAPTURE_INDEX.md` — function-level map
2. `content.js` — browser-side extraction core
3. `taskExecutors.js` — capture orchestration
4. `clipUtils.js` — image stitching math
5. `semantic_workflow_runner.js` — modern capture guard

The scrapyard lives at `/Users/Michael/Documents/DRAW_scavenger_bundle_5047887f`. The full historical repo is at `/Users/Michael/Documents/GitHub/DRAW` (1.5GB).

---

## 7. Open Questions & Future Work

### Naming Unification

The current names are a mix of idiomatic (`side-eye`, `hand-off`), literal (`chrome-harness`), and abbreviated (`pw-bridge`). A naming brainstorming session has been outlined (see the Perplexity discussion) but not yet executed. The Perplexity conversation proposed four thematic directions:
1. Idiomatic/anthropomorphic (extend the `side-eye`/`hand-off` vibe)
2. Professional/purpose-centric (`os-sensor`, `os-actuator`, etc.)
3. Cybernetic/exoskeleton (matching "Syborg")
4. Wildcard metaphor (nautical, theatrical, etc.)

**Decision status:** Deferred. Current working names are used throughout this doc.

### Casting Protocol Specification

The "casting" protocol between runtime and control surface (Section 4) needs a concrete spec:
- Transport: WebSocket? Local HTTP streaming? Unix socket?
- Message format: JSON-RPC? Custom envelope? Server-Sent Events?
- Session lifecycle: How does a runtime advertise availability? How does a UI discover runtimes?
- State sync: Who is the source of truth for conversation history?

### chrome-harness Extraction

`chrome-harness` currently lives inside the Syborg repo (`tools/chrome-harness/`). Following the ecosystem philosophy, it should be its own repo — it's a general-purpose Chrome lifecycle tool, not Syborg-specific. However, it currently has tight coupling to Syborg's build paths and extension names. Extraction requires:
- Generalizing hardcoded extension names and paths
- Deciding whether `pw-bridge` stays bundled with chrome-harness or becomes independent
- Publishing connection info in a discoverable way (so any tool can find the CDP endpoint)

### The `heads-up` Skin System

The floating overlay tool needs design work:
- How are custom skins defined and loaded?
- How does the orb "fly into" Chrome when summoned? (Animation + state handoff to extension)
- How does click-through vs. interactive mode toggle?
- Does it need to manage multiple simultaneous projections (orb + spotlight)?

### Voice Integration Architecture

`speak-up` raises questions:
- Local vs. cloud STT? (Whisper.cpp on-device vs. Groq/OpenAI API)
- How does the global hotkey interact with the OS's built-in dictation?
- Streaming TTS: does the CLI block until playback finishes, or emit events?
- Persona system: how are ElevenLabs voice IDs mapped to agent personas?

### tear-sheet Scope

The archivist CLI needs clearer boundaries:
- Does it own the "frame" feature (adding device frames, browser chrome, drop shadows)?
- Does it handle video/motion capture (`video_capture.cjs`), or is that yet another tool?
- Does it run standalone, or does it require `chrome-harness` to already be managing a Chrome instance?

### The AXWebArea Bridge

`side-eye --xray` can already pierce into Chrome/Safari via macOS Accessibility, reading web DOM elements as native AX nodes. Open questions from the Perplexity discussion:
- Can we extract `AXDOMIdentifier` (HTML `id`), `AXDOMClassList` (CSS classes), and `AXURL` (link href) from web elements?
- How do scroll-area coordinates behave for off-screen DOM elements?
- Does the AX bridge reliably report z-index occlusion?
