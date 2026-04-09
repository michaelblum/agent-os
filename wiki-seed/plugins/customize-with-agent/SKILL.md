---
name: customize-with-agent
description: >
  Create new wiki plugins or edit existing ones through guided conversation.
  Use when the user asks to create a plugin, build a workflow, make a new
  skill, automate a task, or says "customize with agent". Also use when
  the user wants to turn a conversation or process into a reusable workflow.
version: "1.0.0"
author: agent-os
tags: [meta, authoring, plugin-creation]
triggers: ["create a plugin", "build a workflow", "make a skill", "customize with agent", "turn this into a plugin"]
requires: []
---

# Customize with Agent — Plugin Creator

Create new wiki plugins or improve existing ones through collaborative dialogue.

## Overview

A plugin is a reusable workflow stored in the wiki. It consists of:
- `SKILL.md` — instructions the agent follows when the plugin is invoked
- `references/` — supporting knowledge documents loaded on demand
- `scripts/` — optional executable code for deterministic tasks
- `assets/` — optional templates, icons, or other files

Your job is to help the user define what the plugin should do, then create it using wiki tools.

## Process

### 1. Capture Intent

Understand what the user wants to automate or codify. Ask:

1. What should this plugin enable an agent to do?
2. When should it trigger? (what user phrases or contexts)
3. What's the expected output?
4. Are there existing tools, commands, or APIs it should use?

If the current conversation already contains a workflow the user wants to capture, extract answers from context first. The user may need to fill gaps.

### 2. Interview for Details

Ask one question at a time about:
- Edge cases and error handling
- Input/output formats
- Dependencies (does it need the daemon running? gateway? specific tools?)
- Success criteria — how do you know it worked?

### 3. Create the Plugin

Use wiki tools to scaffold:

```bash
aos wiki create-plugin <name>
```

Then write the SKILL.md and any reference files. Follow these guidelines:

**SKILL.md structure:**
- Frontmatter with name, description (assertive — include trigger phrases), version, tags
- Clear purpose statement
- Step-by-step instructions
- Decision trees for branching logic
- Related links to wiki pages

**Writing principles:**
- Explain the *why* behind instructions, not just the *what*
- Keep SKILL.md under 500 lines — move domain knowledge to `references/`
- Use concrete examples over abstract descriptions
- If all test runs would write a similar helper script, bundle it in `scripts/`

**Description field:**
The description is the primary trigger mechanism. Make it clear and explicit:
- Include what the skill does AND specific contexts for activation
- List natural language phrases that should trigger it
- Err on the side of over-matching — undertriggering is worse

### 4. Test

Offer to test the plugin:
> "Want me to try running this plugin to see how it works?"

If yes, invoke it: `aos wiki invoke <name>` — read the output and follow the instructions as if you were a fresh agent receiving them. Note any confusion, missing context, or unclear steps.

### 5. Iterate

Based on testing or user feedback:
- Revise SKILL.md for clarity
- Add missing reference files
- Improve the description for better triggering
- Update the index: `aos wiki reindex`

### 6. Finalize

After the user approves:
- Verify with `aos wiki lint` — fix any issues
- Confirm the plugin appears in `aos wiki list --type workflow`
- Tell the user how to invoke it: from chat compose menu or by asking the agent

## Editing Existing Plugins

If the user wants to modify an existing plugin:

1. Read it: `aos wiki show <name> --raw`
2. Understand what needs to change
3. Edit the files directly
4. Reindex: `aos wiki reindex`
5. Test the changes

## Reference

See [Skill Writing Guide](references/skill-writing-guide.md) for detailed authoring conventions.
