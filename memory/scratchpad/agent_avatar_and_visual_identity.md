---
name: agent avatar — visible, conspicuous, cross-display guide with personality
description: Every agent should have a visible avatar that floats freely across displays, speaks, orbits around elements it wants the user to notice, and "points" at things. It is NOT the computer — it's a visitor and guide. Different agents can have different faces, gesture styles, visual languages. Agent callouts must be visually distinct from native OS chrome. The avatar is the agent's embodiment in the user's environment.
status: exploring
date: 2026-04-02
session: hand-off-v2-design (post-compaction, dogfood phase)
trigger: when building the first autonomous agent loop or when heads-up gets its "personality" layer
related: projection_motion_language.md, headsup_activation_and_interaction_patterns.md, heads_up_serve_mode_lessons.md, persistent_app_knowledge_graph.md
keywords: avatar, identity, personality, floating, cross-display, orbiting, pointing, gesturing, visual language, visitor, guide, conspicuous, not-native, heads-up, agent face, skins
---

# Agent Avatar — Visual Identity and Embodiment

## The vision (Michael, 2026-04-02)

The agent is a VISITOR in the user's computer, not the computer itself. It needs:

1. **A visible, conspicuous avatar** — always present, clearly not native UI
2. **Free movement** — floats across displays, no display boundaries
3. **Speech** — vocalizes its status and questions (Apple neural TTS)
4. **Attention direction** — moves TO the thing it wants the user to look at, orbits around it, "points" at it
5. **Visual distinction** — callouts must NOT look like native chrome. If something looks like a focus ring, the user confuses agent action with system behavior. Agent = visitor aesthetic, System = native aesthetic.
6. **Personality** — any agent can have any face. Different "skins" for different agents or moods.

## Key principle
"This thing is a visitor and a guide in our computer — not the computer itself."

## What this means for heads-up
- The avatar is a heads-up canvas (or set of canvases)
- Cross-display movement requires the multi-display spanning trick (one canvas per display, viewport slicing — already proven in heads-up serve mode testing)
- Orbiting/pointing animations are CSS/JS in the canvas HTML
- The "skin" is just a different HTML template
- TTS is routed through the avatar surface, not the system

## Visual language for callouts
- Agent callouts must look distinctly different from native focus/selection/hover
- Not subtle blue borders — those look like AX focus rings
- Use colors, shadows, animations that are clearly "agent aesthetic"
- Think: glowing, animated, dimensional, playful — not flat, thin, system-like

## Connects to
- scratchpad/projection_motion_language.md — WHERE vs HOW vs WHAT separation
- scratchpad/hardware_target_and_jarvis_vision.md — the Jarvis embodiment
- heads-up Layer 1 (display intelligence) — avatar needs to know where it is
- The 10-4 protocol — avatar is the visual representation of the ack/status cycle

## Also mentioned
- Green agent handbook: new agents need to learn to "drive the system" — check what user sees, don't act on hidden windows, assess environment first
- System environment control: agents should be able to switch displays, spaces, minimize/maximize, make apps active
