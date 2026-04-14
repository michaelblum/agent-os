---
name: sigil-app-vision
description: Sigil is evolving from a studio into a full agent management app — roster, settings, voice, chat, workflows
type: project
status: validated-deferred
---

# Sigil App Vision

Sigil is growing beyond a visual customization studio into a multi-surface agent management app.

## Surfaces discussed (2026-04-07)

| Surface | Purpose | Status |
|---|---|---|
| **Studio** | Design avatar appearance (shape, colors, effects) | Active — being reorganized now |
| **Roster** | Browse/manage multiple avatars, assign to agents | Conceptual — 4th panel placeholder |
| **Settings** | App-level config (voice on/off, voice-per-agent, display prefs) | Conceptual |
| **Chat overlay** | Projected agent session, bundled with Sigil | Conceptual |
| **Agent toolkit** | Workflows, skills, plugins attached per-agent or globally | Conceptual — undefined |

## Per-agent config model

Each agent in the roster would have:
- **Visual identity** — avatar appearance (studio config blob, already self-contained via getConfig())
- **Voice** — TTS configuration, assignable per-agent for multi-agent orchestration
- **Toolkit** — workflows, skills, plugins (shape TBD)

## What connects to current work

- Nav rail will need to accommodate top-level sections (Studio, Roster, Settings, Chat) — not just studio sub-panels
- The 4th panel slot we're preserving in the studio cleanup is a natural future home for the roster
- The naming choice "SIGIL" for the header works because it's the app name, not just the studio

## Why not now

The studio cleanup is scoped to structural reorganization of the existing UI. The broader app shell is a separate design session once these surfaces are more defined.

## When to revisit

When Michael is ready to define the roster or settings surface, or when the chat overlay integration comes up.
