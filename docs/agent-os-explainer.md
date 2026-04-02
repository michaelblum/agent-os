# agent-os: Giving AI Agents a Body

## What agent-os does

agent-os gives AI agents physical capabilities on a Mac. Today's AI agents can think — write code, answer questions, generate text — but they can't *do*. They can't look at your screen, click a button, scroll through a document, switch between apps, or show you what they're about to do. They're a brain in a jar.

agent-os is a set of tools that give an AI agent the equivalent of eyes, hands, a face, and a voice on a macOS computer. Each tool does one thing:

**side-eye** (eyes) — sees the screen. Takes screenshots, reads the accessibility tree to understand what UI elements exist, reports which windows are where across all displays. The agent perceives the computer the same way a human does: by looking at it.

**hand-off** (hands) — operates the computer. Clicks, types, drags, scrolls, presses buttons, holds modifier keys, switches apps. The agent acts on the computer the same way a human does: by using it physically, with human-like timing and movement.

**heads-up** (face + control surface) — serves two purposes. First, it shows the human what the agent is doing: spotlights, cursor trails, highlights, status indicators rendered as floating overlays on the desktop. Second, it gives the human a way to talk back. The agent can spin up interactive canvases on the fly — approval dialogs, option menus, stop buttons, progress panels, configuration sliders — rendered as floating HTML surfaces. When the user clicks a button or makes a choice, the event flows back to the agent through a message relay. The agent creates its own UI, purpose-built for the moment, without needing a pre-built application.

**speak-up** (voice) — talks and listens. Text-to-speech narration, speech-to-text dictation. The agent explains what it's doing and hears what the human says.

## The design target: broken hands

The design target for agent-os is this scenario: a user who can't use their hands needs an AI agent to operate the computer *for* them — not through APIs or scripts, but by literally looking at the screen, moving the mouse, clicking buttons, typing text, switching apps, scrolling through documents. Everything a human does with their eyes and hands, the agent does instead.

This means:

- The agent must see what's on screen (not just read a DOM or API)
- The agent must operate the computer physically (not just call programmatic interfaces)
- The actions must look and feel human (not instant teleportation and robotic input)
- The agent must be able to do *everything* — switch Spaces, use keyboard shortcuts, hold modifier keys while clicking, drag and drop between apps, use the app switcher
- The human must be able to see what the agent is doing and understand its intent
- The human must be able to communicate back — approving actions, making choices, stopping the agent — even without a keyboard, through floating control surfaces the agent renders on screen

## Four communication directions

The ecosystem enables four directions of communication, not just "agent does things":

| Direction | Tool | How |
|---|---|---|
| Computer → Agent | side-eye | Screenshots, accessibility tree, spatial topology |
| Agent → Computer | hand-off | Mouse events, keyboard events, accessibility actions, AppleScript |
| Agent → Human | heads-up | Floating overlays, highlights, status indicators, visual feedback |
| Human → Agent | heads-up | Interactive canvases — buttons, dialogs, menus — with events relayed back to the agent |

The last direction is what makes this a collaboration, not just automation. The agent creates context-appropriate control surfaces: a simple yes/no for a file deletion, a multi-option menu for choosing a deployment target, a live status dashboard during a long operation. The human who can't type can still tap a floating "Approve" button. The agent adapts its interface to the task.

## Tools, not a framework

agent-os is not an agent. It's not an orchestrator. It's not a framework you build agents inside of. It's a **parts bin** — a set of independent command-line tools that any AI agent can use.

Claude Code can use them. A custom Python script can use them. Codex can use them. A future agent system that doesn't exist yet can use them. The tools don't know or care who's calling them. They take structured input, do one thing, and emit structured output. No tool knows any other tool exists.

This is the Unix philosophy applied to agent capabilities. `side-eye` is `ls` for the screen. `hand-off` is your keyboard and mouse as a CLI. You pipe them together however you want.

## The perceive-act-project loop

The core operating loop:

1. **Perceive** — side-eye captures the screen and reports what's visible: windows, UI elements, positions, labels, types
2. **Decide** — the AI agent (any agent, any model) interprets what it sees and decides what to do
3. **Act** — hand-off executes the action physically: clicking, typing, scrolling, with human-like feel
4. **Project** — heads-up shows the human what happened: highlighting the clicked button, drawing a cursor trail, displaying a status message
5. **Verify** — side-eye captures again to confirm the action worked
6. **Communicate** — heads-up presents choices or status to the human; the human responds through interactive canvases

## Human-like feel

The agent doesn't teleport the cursor or type at machine speed. hand-off supports behavioral profiles — named configurations that control timing, mouse movement curves, keystroke cadence, click behavior, and scroll momentum. A profile defines what it *feels like* when the agent operates the computer:

- Mouse movement follows Bezier curves at natural speed with slight overshoot
- Typing happens at human WPM with per-keystroke variance and pauses between words
- Clicks have realistic dwell time between mouse-down and mouse-up
- Scrolling uses multi-event momentum with deceleration
- Delays between actions are randomized within natural ranges

An agent that discovers the right parameters for a specific app (Electron apps need slower typing, deep accessibility trees need higher depth limits) can save those parameters as a named profile. The next agent — or the next session — loads that profile by name. Learned knowledge about how to operate specific software persists and is discoverable.

## Focus channels: intent over mechanics

The current tool model requires the orchestrator to do mechanical plumbing: parse side-eye's JSON, extract coordinates, convert between coordinate systems, construct targeting parameters for hand-off. This is exactly what LLM agents are worst at — precise field extraction and coordinate math.

The next evolution introduces **focus channels** — live spatial references that eliminate this translation work entirely. A focus channel is a persistent view into a region of the UI, maintained by side-eye, that any tool can bind to:

- The agent tells side-eye: "watch Slack's message area"
- side-eye creates a focus channel: a live, updating view of that region with pre-computed coordinates in every space (pixel, window-relative, global)
- The agent tells hand-off: "bind to that channel"
- hand-off inherits all targeting context — pid, window, coordinates, scale factor — from the channel automatically
- The agent says: "click the Reply button"
- hand-off resolves "Reply button" against the channel's element list and clicks it. No coordinates specified. No conversion. No mechanical work.

The agent works at the level of intent. The tools handle the mechanics through shared spatial references.

Focus channels also enable heads-up to render context-aware control surfaces — a floating panel that shows actions relevant to what the agent is currently looking at, updated live as the agent's attention moves.

## What makes this different

Most computer-use agent projects take one of two approaches:

**Screenshot-and-click** (Anthropic computer use, OpenAI Operator) — the agent sees a screenshot and outputs coordinates to click. Simple but brittle: no understanding of UI structure, no semantic actions, no way to hold modifier keys or perform compound interactions, no human-like feel.

**Framework-based** (UFO2, Agent-S, various research projects) — the agent lives inside a framework that manages perception, action, and orchestration as one monolithic system. Capable but locked-in: you can't use the perception module without the orchestrator, you can't swap out the action layer, you can't integrate with a different agent system.

agent-os is neither. It's a layer of **independent, composable capabilities** that sit between the operating system and any agent. The agent doesn't need to know how macOS accessibility works, how CGEvent posting works, or how coordinate systems translate between displays. It focuses on intent, and the tools handle the rest.

## Current status

| Tool | Status | What works |
|---|---|---|
| side-eye | Production (v3.0) | Screenshots, AX tree (--xray), labeled screenshots (--label), cursor query, selection query, spatial topology, grids, zones |
| hand-off | Production (v1.0) | 12 commands across 3 backends (AX, CGEvent, AppleScript), --dry-run on all |
| heads-up | Render mode production, serve mode production | Stateless HTML→PNG rendering, persistent floating canvases, window anchoring, full-duplex content bridge (eval + messageHandler), TTL, connection-scoped canvases |
| speak-up | Planned | — |
| tear-sheet | Planned | — |

hand-off v2 is in active design: session mode (stateful streaming for compound interactions), behavioral profiles, context operator, focus channel binding, expanded AX targeting.

side-eye daemon mode (persistent spatial perception graph with progressive depth) is the next major architectural piece after hand-off v2.
