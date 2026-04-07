---
name: hardware target (2015+ Macs) and the Jarvis vision — edge ML as agent input
description: Target 2015+ MacBooks because they have on-device ML models powering dictation (double-tap Control), Voice Control (on-device speech recognition), and webcam gesture recognition (head tracking, facial gestures via Switch Control). These aren't features to build — they're Apple's accessibility infrastructure that agent-os can leverage as human→agent input channels. The Jarvis vision: wake the agent with voice or a glance.
status: exploring
date: 2026-04-02
session: hand-off-v2-design (post-compaction)
trigger: when defining system requirements, or when building the human→agent input layer
related: voice_control_parallel_and_accessibility.md, logitech_peripheral_macros.md, shortcuts_as_agent_commands.md, reference_macos_accessibility_audit.md
keywords: hardware target, 2015 MacBook, Neural Engine, edge model, dictation, Voice Control, webcam, gesture recognition, head tracking, Switch Control, Jarvis, always-on, wake word, camera trigger, Apple Silicon, on-device ML
---

# Hardware Target and the Jarvis Vision

## Hardware target decision
**2015+ MacBooks.** Michael's machine is on the older end of this range and already has:
- On-device dictation model (double-tap Control to activate)
- Voice Control with on-device speech recognition
- Webcam gesture recognition for Switch Control (head tracking, facial expressions)

These are Apple's edge ML models running locally. No cloud dependency.

## What this means for agent-os
The human→agent input channel doesn't need custom ML. Apple already built it:

| Input method | Apple feature | How agent-os uses it |
|-------------|--------------|---------------------|
| Voice | Voice Control custom commands | User says a phrase → macOS Shortcut fires → agent receives command |
| Voice | Dictation (double-tap Control) | Text input to any active surface including heads-up overlays |
| Gesture | Switch Control camera | User raises eyebrow / turns head → mapped to agent trigger |
| Hardware | Logitech buttons | Physical button → Shortcut → agent command |
| Keyboard | Keyboard shortcuts | Standard macOS hotkeys → Shortcut → agent command |

## The Jarvis vision
An always-present agent that:
1. **Wakes on voice** — "Hey, check this" → Voice Control triggers agent
2. **Wakes on gesture** — Look at camera a certain way → Switch Control triggers agent
3. **Shows status via overlay** — heads-up displays agent state, progress, questions
4. **Acts on the computer** — hand-off operates whatever app is needed
5. **Verifies its own work** — side-eye confirms the action succeeded
6. **Goes idle** — returns to background, overlay fades

The remarkable thing: none of this requires building custom ML, custom voice recognition, or custom gesture detection. Apple's accessibility infrastructure IS the input layer. agent-os just needs to be the thing that responds.

## Why this matters
This is the "broken hands" design target taken to its logical conclusion. The accessibility infrastructure was built for people who can't use standard input. An AI agent that can't use standard input (no fingers, no eyes) is the same user profile. The infrastructure fits perfectly.

## Not now
This is extra sauce. Core runtime comes first. But it should inform architectural decisions — don't build anything that would make this harder later.
