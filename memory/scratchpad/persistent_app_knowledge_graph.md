---
name: persistent app knowledge graph — minesweeper memory that survives sessions
description: Users do the same things repeatedly. Discovered app knowledge (AX trees, navigation paths, element locations, user behaviors) should persist across sessions in a local DAG with semantic annotations. Not append-only — needs autonomous pruning. Background process maintains it during idle time. Connects to LightRAG assessment, minesweeper progressive perception model, and focus channels.
status: exploring
date: 2026-04-02
session: hand-off-v2-design (post-compaction)
trigger: when the agent is re-discovering things it already knew from a previous session, or when focus channel data is being thrown away at session end
related: lightrag_assessment.md, spatial_model_proposal.md, dogfood_bootstrap_strategy.md
keywords: knowledge graph, DAG, persistence, memory, minesweeper, app discovery, user behavior, annotations, pruning, LightRAG, background process, semantic, edges
---

# Persistent App Knowledge Graph

## The problem
Every new agent session starts from zero. It has to re-discover the AX tree of Slack, re-navigate System Settings, re-find the user's project files. Users only use ~10% of their apps regularly, and they use the same paths through those apps over and over.

## The idea
A local directed acyclic graph (DAG) that persists across sessions. Think of the minesweeper metaphor from focus channels, but durable:

### Nodes
- Apps (bundle_id, name, version)
- Windows (title patterns, typical positions)
- UI elements (role, identifier, title — the AX identity)
- Files/locations the user cares about
- Settings/preferences the user touches

### Edges (semantic annotations)
- "user frequently clicks" (behavioral frequency)
- "leads to" (navigation path)
- "contains" (hierarchy)
- "user's files are here" (personalization)
- "this setting controls X" (semantic meaning)

### Properties
- Staleness score (apps update, UIs change — can't trust forever)
- Last-verified timestamp
- Confidence level (observed once vs. observed 50 times)
- Version-gated (this was true in app version X)

## Key constraints
- **Not append-only** — must prune. Apps change, UIs update, user habits shift.
- **Autonomous maintenance** — background process runs during idle time. Prunes stale nodes, reinforces frequently-used paths, detects version changes.
- **Brittle is OK** — the graph is a hint, not truth. The agent should use it to skip re-discovery when it can, but verify when things look wrong.
- **Lean annotations** — not full AX tree snapshots. Just enough semantic meaning to connect an element to what the user does with it.

## How it connects to existing pieces
- **Focus channels** already produce rich element data — that data currently dies when the channel is removed. The graph would persist the useful parts.
- **Progressive perception** (graph-deepen/collapse) already has the minesweeper model. The persistent graph is "what we already swept."
- **LightRAG** (assessed in scratchpad) is the right architecture for this when the corpus gets large enough. Dual-level retrieval (entity + theme) maps to node lookup + path traversal.
- **Behavioral profiles** could be informed by the graph — if the user always navigates Settings → Accessibility → Voice Control, the agent can use that path directly.

## What this is NOT
- Not a full app model/registry (see scratchpad/app_reconnaissance_and_registry.md)
- Not a replacement for live AX queries (always verify)
- Not a product feature yet — this is infrastructure thinking

## Open questions
- Storage format? JSON files? SQLite? LightRAG's flat-file store?
- How to detect "app updated, graph is stale"? Bundle version comparison?
- Privacy: does the graph contain PII? (file paths, user content in AX values)
- How big does this get? 100 nodes? 10,000?
