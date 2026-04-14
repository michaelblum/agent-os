---
name: sigil-state-behaviors
description: Agent states drive avatar visual expression — effects are semantic, not decorative. Future choreography config system.
type: project
status: validated-deferred
---

# State-Based Avatar Behaviors

Effects and animations have practical, semantic value — they denote what an agent is doing.

## Key insight (2026-04-07)

"A lot of this stuff actually has practical value when we can use visuals and motion to denote something meaningful like the state that the agent is in or what work it's doing."

## Examples discussed

| Agent state | Visual expression |
|---|---|
| Idle | Configurable: no bobbing, slow bobbing, adjustable rate/amplitude. User dislikes default slow bob — wants it optional. |
| Inhabiting mouse/keyboard | Trail effect decorates cursor movement to signal "agent is driving." Trail length is practical. |
| Moving between points | Spin burst at arrival (end of animation), not constant spin |
| Working/thinking | (not discussed, but implied — aura pulse, effects intensify) |

## User wants per-state control over

- Bobbing: on/off, rate, amplitude
- Spinning: on/off, speed, contextual (e.g., only at end of movement)
- Trail: on/off, length
- Aura: reach, intensity, pulse rate
- Effects: which are active in which state

## Standard states + custom states

There would be standard agent states (idle, working, moving, inhabiting, transitioning).
Users might also want custom states. Shape TBD.

## Architecture connection

- `avatar-behaviors.swift` already maps events to animation sequences on the Swift side
- The config system would be the user-facing control for this mapping
- Each state's visual profile would be a subset of the config blob
- The studio's current "effects" controls are really parameters the behavior system modulates

## What this means for current studio cleanup

- Don't organize Effects as "on/off toggles" — treat them as the avatar's available repertoire
- Current sliders (aura reach, pulse rate, spin speed, trail length) are parameters that will later be per-state
- Organize the panel so it's easy to wrap controls in a "configure for state X" dropdown later

## Why not now

The behavior choreography config is a separate design session. Requires defining the standard state set, the per-state parameter model, and the UI for state-contextual editing.

## When to revisit

When the roster/agent-management layer is being designed, or when avatar-behaviors.swift gets a config surface.
