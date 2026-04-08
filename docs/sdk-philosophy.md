# AOS SDK — Design Philosophy

This document describes what we believe about building an SDK for AI agents that operate a desktop. It's not instructions — it's the why behind the how.

## The Problem We're Solving

An AI agent that wants to "click the Save button in Xcode" currently does this:

1. Calls a CLI to capture the screen and accessibility tree
2. Parses the JSON output (burns context tokens on mechanical data)
3. Reasons about which element is the Save button
4. Extracts coordinates from the accessibility tree
5. Calls another CLI to click those coordinates
6. Captures again to check if it worked

Six tool calls. Hundreds of tokens spent on plumbing. The agent is doing janitorial work when it should be thinking about the user's actual problem.

Every session rediscovers this plumbing from scratch.

## What We Believe

**Agents should think about problems, not mechanics.** The value of an agent is in its reasoning about *your specific situation* — which app to use, what sequence of actions to take, when to ask the user. We don't want to automate that reasoning away. We want to automate the mechanics — finding elements, clicking coordinates, polling for state changes, positioning overlays — so the agent can focus on the judgment calls.

**APIs for agents are different from APIs for humans.** This is a genuinely new discipline. When a human reads docs, they skim, search, and build mental models. When an agent reads an API surface, the type signatures *are* the documentation. The method names *are* the prompts. Error messages *are* the instructions for what to do next.

**Fewer good methods beat many precise ones.** Human developers like granular control and tend to appreciate 50 specialized methods. Agents get confused by large surfaces and pick the wrong method. Fifteen methods that each do something obviously are better than fifty that require understanding subtle distinctions.

**Return types are half the design.** If `clickElement` returns `{ clicked: true, element: { label, role, frame } }`, the agent can reason about what happened. If it returns `void`, the agent burns another tool call to check. Every SDK method should return enough for the agent to decide what to do next without calling anything else.

**Error messages are agent instructions.** `{ error: "No element matching 'Save' found in Xcode. Found: 'Save As...', 'Save All'" }` tells the agent exactly how to recover. `{ error: "ELEMENT_NOT_FOUND" }` forces another perception cycle.

## The Three Layers

### Layer 1 — Primitives

One-to-one wrappers around daemon capabilities. No intelligence, no opinion.

```typescript
aos.getWindows()                    // list windows
aos.capture({ display: 'main' })   // screenshot + AX tree
aos.click({ x: 450, y: 320 })      // synthesize click
aos.createCanvas({ id, url, at })   // create overlay
aos.say("hello")                    // speak
```

An agent *can* do everything with only these. It will just spend a lot of tokens doing it. Primitives exist as escape hatches — when the higher layers don't cover a case, you can always drop down.

### Layer 2 — Smart Operations

Absorb the mechanical reasoning that every agent session rediscovers.

```typescript
aos.clickElement("Save", { app: "Xcode" })
// Internally: capture → find element by label → click its center
// The agent never sees coordinates

aos.waitFor({ window: "Build Succeeded" }, { timeout: 30000 })
// Internally: poll getWindows() until match or timeout
// The agent doesn't write polling loops

aos.showStatus("Building...", { near: "Xcode" })
// Internally: find window → compute position → create canvas
// The agent doesn't calculate geometry
```

The boundary between Layer 1 and Layer 2: if an agent would need to call two or more primitives in a predictable sequence to accomplish something, that sequence belongs in Layer 2. If the sequence requires judgment about *what* to do (not just *how*), it stays with the agent.

### Layer 3 — Saved Workflows

Scripts composed from Layer 1 and 2, saved in the registry, invoked by name.

```typescript
// Saved as "check-xcode-build"
await aos.clickElement("Build", { app: "Xcode" });
const result = await aos.waitFor({ window: /Build (Succeeded|Failed)/ }, { timeout: 60000 });
return { status: result.title.includes("Failed") ? "failed" : "success" };
```

An agent calls `run_os_script({ script_id: "check-xcode-build" })` — one tool call instead of many. The script is tested, deterministic, and reusable across sessions.

Over time, the script registry becomes a library of capabilities. New agents inherit what previous agents learned. This is how the system gets smarter without the model getting smarter.

## Design Rules

**Build from the bottom up, motivated by the top.** Don't design primitives in the abstract. Pick a real task, write the script as you wish it worked, then see what's missing underneath. The scripts are the test suite for the SDK.

**If a script feels clunky to write, the SDK is wrong.** Not the script. If an agent needs three calls to do something that should be one, add a Layer 2 method. If it needs to parse output to get data that should be in the return type, fix the return type.

**Don't abstract reasoning, abstract mechanics.** Perception (what's on screen), action (clicking, typing), and display (showing overlays) are mechanics. Deciding *what* to perceive, *where* to click, and *when* to show an overlay — that's reasoning. The SDK owns mechanics. The agent owns reasoning.

**Every method should make the next decision obvious.** The return value of any SDK call should contain enough information for the agent to decide what to do next. No "call this, then call that to check if it worked" patterns.

**Composition over configuration.** Don't add options and flags to make one method do many things. Make multiple methods that each do one thing, and let the agent compose them. Agents are good at composition. They're bad at remembering which combination of flags produces which behavior.

## What This Is Not

This is not a framework. There's no base class to extend, no lifecycle to implement, no convention to follow. It's a bag of typed functions that do useful things. An agent that calls one function is using the SDK. An agent that calls twenty is also using the SDK. There's no wrong way to use it as long as the task gets done.

This is not a replacement for agent reasoning. The SDK doesn't decide what to do — it makes doing things cheaper. The agent still plans, reasons about errors, and adapts to unexpected situations. The SDK just makes sure those situations are described well enough for the agent to reason about.

## How We Measure Success

The SDK is working when:

- An agent can accomplish a desktop task in 2-3 tool calls that currently takes 8-10
- A script written by one agent session works when called by a different session
- The `discover_capabilities` output is sufficient for an agent to write correct scripts without examples
- Error recovery happens within the script, not by the agent re-prompting and trying again
