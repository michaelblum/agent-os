---
name: orchestration layering — core runtime vs. bundled vs. user-provided
description: agent-os should ship a core runtime (side-eye, hand-off, heads-up) plus optional orchestration layers that users can adopt, refine, or replace entirely. Competitive landscape patterns (Peekaboo's monolithic approach, mediar-ai's act-then-perceive, macos-automator-mcp's recipe knowledge base) should be evaluated as potential bundled orchestration layers, not baked into the core.
status: exploring
date: 2026-04-02
session: hand-off-v2-design (post-compaction)
trigger: when defining the packaging/distribution model or writing the "getting started" guide
related: dogfood_bootstrap_strategy.md, project_context.md
keywords: orchestration, layering, toolkit, opinionated, core runtime, bundled, recipes, patterns, architecture, packaging
---

# Orchestration Layering

## The question
What's core runtime vs. what's bundled orchestration vs. what's user-provided?

## Core runtime (non-negotiable, ships with agent-os)
- side-eye — perceive
- hand-off — act
- heads-up — project
- shared/schemas/ — contracts (spatial model, coordinate conventions, message contract)
- Focus channel protocol
- Daemon lifecycle

## Bundled orchestration (ships with agent-os, users can adopt/refine/replace)
- The confirmation overlay pattern (query → response → receipt)
- The "act-then-perceive" pattern (every action triggers fresh perception)
- Example surfaces (the dogfood overlay HTML, status indicators, etc.)
- Behavioral profiles (natural, fast, precise — the JSON files)
- Recipe knowledge base? (à la macos-automator-mcp's 200 recipes)

## User-provided (not our problem, but we should make it easy)
- Custom orchestration logic
- Custom surfaces
- App-specific navigation strategies
- Workflow automation scripts

## Open question
Where does the "10-4 protocol" (message contract for human↔agent communication) land? It feels like it belongs in shared/schemas/ as a contract, but the orchestration that implements it is bundled, not core.

## Competitive patterns to evaluate as potential layers
- mediar-ai's act-then-perceive (every tool call returns fresh AX state)
- Peekaboo/AXorcist's fuzzy AX queries (chainable selectors)
- macos-automator-mcp's 200-recipe knowledge base
- The "10-4" feedback loop (our invention from dogfooding)
