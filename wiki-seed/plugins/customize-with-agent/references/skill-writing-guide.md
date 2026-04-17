---
type: concept
name: Skill Writing Guide
description: Conventions and best practices for writing wiki plugin SKILL.md files
tags: [meta, authoring, conventions]
---

# Skill Writing Guide

## Anatomy of a Plugin

```
plugin-name/
├── SKILL.md          # Required: frontmatter + instructions
├── references/       # Optional: domain knowledge loaded on demand
├── scripts/          # Optional: executable code
└── assets/           # Optional: templates, icons, files
```

## SKILL.md Frontmatter

Required fields:
- `name` — plugin identifier (kebab-case)
- `description` — when to trigger, what it does (be highly specific)

Optional fields:
- `version` — semver string
- `author` — who created this
- `tags` — categorization keywords
- `triggers` — natural language phrases that should activate this plugin
- `requires` — runtime dependencies (e.g., gateway, aos-daemon)

## Progressive Disclosure

1. **Metadata** (~100 words) — name + description, always in agent context
2. **SKILL.md body** (<500 lines) — loaded when plugin triggers
3. **References** (unlimited) — loaded on demand when the agent needs deeper context

Keep SKILL.md focused on the workflow. Move domain knowledge, schemas, and frameworks to `references/`.

## Writing Style

- Use imperative form: "Run the build" not "You should run the build"
- Explain *why* things matter, not just *what* to do
- Prefer concrete examples over abstract descriptions
- Use decision trees for branching logic
- Include exact commands with expected output where applicable

## Description as Trigger

The description field determines whether an agent invokes the plugin. Write it to over-match rather than under-match:

**Weak:** "Audit competitor employer brands"
**Strong:** "Run employer brand competitor audits using the KILOS framework. Use when the user asks to research competitors, audit employer brands, analyze careers sites, do a KILOS audit, or build a competitor analysis. Trigger whenever a user provides a client name and a list of companies to research."

## Cross-Linking

Link to wiki entity and concept pages from your SKILL.md and references:
```markdown
See [Gateway](../../../entities/gateway.md) for tool documentation.
```

This connects the plugin to the broader knowledge graph and helps agents find relevant context during execution.

## Common Patterns

**Mode detection:** If a plugin operates differently based on input, use a mode table at the top:
```markdown
| Mode | When |
|------|------|
| Plan | User provides requirements, no artifacts yet |
| Execute | User provides plan + data |
| Resume | Partial output, continue from last point |
```

**Decision trees:** For branching logic, use explicit if/then:
```markdown
- If build fails -> add a troubleshooting reference or point to an existing diagnostic workflow
- If tests pass → proceed to deployment step
```

**Reference loading:** Tell the agent when to read references:
```markdown
For the full KILOS framework details, read `references/kilos-framework.md` before beginning analysis.
```
