---
name: multi-display agent reasoning — bird's eye first, focus ≠ attention, two strategies
description: Agents must reason about multi-display environments before acting. The bird's-eye topology (side-eye list) is always step 1. user_active ≠ where the user is looking. Two strategies for multi-display work — "agent moves to target" vs "target moves to agent" (moving the universe). Always restore state when done.
status: exploring
date: 2026-04-02
session: hand-off-v2-design (post-compaction, dogfood phase)
trigger: when building the agent reasoning layer or the "green agent handbook"
related: agent_avatar_and_visual_identity.md, spatial_model_proposal.md, dogfood_scenarios.md
keywords: multi-display, topology, bird's eye, focus, attention, user_active, main, external, reasoning, strategy, workspace, moving universe, restore state, orientation, physical layout, green agent
---

# Multi-Display Agent Reasoning

## The mistake (2026-04-02)
Agent used `user_active` as a default capture target, treating "last-clicked app" as "where the user is." This is wrong. Focus ≠ attention ≠ location.

## The correct approach

### Step 1: Bird's eye (always first)
Run `side-eye list`. This gives:
- All displays, their positions, sizes, scale factors, physical orientation
- Which is main, which is external
- All windows on each display
- Which app is focused (but this is just "last clicked," not "where user is looking")
- Cursor position (this IS where the user is pointing right now)

### Step 2: Reason about the environment
- How many displays? How are they oriented? (stacked, side-by-side, mirrored)
- Where is the target app/window?
- Where is the cursor? (better proxy for attention than focus)
- What might the user be looking at?

### Step 3: Choose a strategy

**Strategy A: Agent moves to target ("roaming")**
- Avatar/agent goes to whatever display has the target
- Needs seamless cross-display movement (display orientation math)
- Works when the user is already looking at that display

**Strategy B: Target moves to agent ("moving the universe")**
- Agent picks one display as its workspace
- Uses system commands (AppleScript, Spaces, window management) to move/switch whatever it needs onto that display
- Does all work there
- **Restores everything when done** — put windows back, restore spaces, etc.
- Works when the agent wants to do complex multi-window work without confusing the user

### Step 4: Act
Now that the agent understands the layout and has a strategy, it can act with the right capture target and coordinates.

## Key insight: cursor position > focus
`user_active` tells you which app was last clicked. Cursor position tells you where the user is RIGHT NOW. Neither tells you what the user is looking at, but cursor is a better proxy. A future improvement: eye tracking via Vision framework (on 2021+ Macs with camera).

## "No correct default"
There is no single capture target that's always right:
- `main` = the primary display (might not have the target)
- `external` = first non-main display (might not have the target either)
- `user_active` = display with last-clicked app (might not be where user is)
- `mouse` = display under cursor (best proxy for attention, but still not perfect)

The agent must REASON about which to use. This is the "green agent handbook" lesson #1.

## Display orientation awareness
For cross-display avatar movement, the agent needs to know physical layout:
- side-eye list gives display bounds in global CG coordinates
- Stacked displays: Display 2 at (x, y) where y = Display 1 height
- Side-by-side: Display 2 at (x, y) where x = Display 1 width
- The bounds tell you exactly how they're arranged
- Animation across displays = interpolate through the coordinate space, rendering on whichever display the current position falls within
