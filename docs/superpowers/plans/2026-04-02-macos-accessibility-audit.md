# Research Plan: macOS Accessibility Infrastructure Audit

**Date:** 2026-04-02
**Status:** Ready for execution
**Type:** Deep research — no implementation
**Output:** Structured reference document at `memory/reference_macos_accessibility_audit.md`
**Estimated scope:** 1 thorough agent session

---

## Why This Matters

agent-os is building perception (side-eye), actuation (hand-off), projection (heads-up), and voice (speak-up) as independent CLI tools. macOS has an extensive built-in accessibility layer that provides overlapping capabilities across ALL of these areas. We have not systematically audited what Apple provides, what we can use directly, what we can build on, and what we're unnecessarily reinventing.

The screenshots show at minimum:
- **Switch Control** — custom panels with a Panel Editor, auto-scanning, gliding lens
- **Voice Control** — speech-driven element targeting with numbered overlays, progressive drill-down
- **Full Keyboard Access** — full navigation via keyboard, Tab/Space to activate
- **Accessibility Keyboard** — on-screen keyboard with custom panels
- **VoiceOver** — screen reader with recognition, screen sharing control, activities, commands

Each of these is a complete input→perception→action system. Some of them may expose APIs, panels, or infrastructure we can use.

---

## Research Questions

### Category 1: What does macOS already provide?

For EACH of these accessibility features, document:
- What it does (capabilities, not marketing)
- How it works internally (AX tree? CGEvent? Private framework? XPC?)
- What APIs or hooks it exposes (public, private, AppleScript, defaults, notifications)
- Whether an agent can programmatically enable/disable/configure it
- Whether an agent can read its state or receive events from it
- Whether it can be used WITHOUT a human present (i.e., can an AI agent drive it?)

**Features to audit:**

1. **Voice Control**
   - Show Numbers / Show Labels / Show Grid overlay modes
   - Custom voice commands
   - Command vocabulary (what built-in commands exist?)
   - Element enumeration and action dispatch
   - Dictation integration

2. **Switch Control**
   - Panel Editor — can we create custom panels programmatically?
   - Auto-scanning — how does it traverse the UI?
   - Platform switching — can it control another device?
   - Custom panels — format, capabilities, can we generate them?

3. **Full Keyboard Access**
   - Navigation model (Tab, Space, arrows)
   - Does it expose focus state that we can read?
   - Can we drive it programmatically (simulate Tab navigation)?

4. **Accessibility Keyboard**
   - Custom panels via Panel Editor
   - Panel format — is it the same as Switch Control panels?
   - Can we create/load panels programmatically?
   - Does it support arbitrary buttons/controls?

5. **VoiceOver**
   - VoiceOver Recognition (what does this do?)
   - Activities (what are these?)
   - Commands system
   - Screen sharing mode — can it control a remote Mac?
   - AppleScript interface (`tell application "VoiceOver"`)
   - VoiceOver cursor vs system cursor
   - Does VoiceOver set `AXEnhancedUserInterface`?

6. **Pointer Control**
   - Head tracking / eye tracking
   - Dwell control (hover to click)
   - Alternate pointer actions

7. **Spoken Content**
   - Speak selection, Speak screen
   - Can we trigger "speak this text" programmatically?
   - What TTS voices/APIs are available?

8. **Live Captions / Live Speech**
   - Can we read the caption stream?
   - Can we inject text into Live Speech?

9. **Siri / Shortcuts integration**
   - Can Shortcuts trigger accessibility features?
   - Can we create Shortcuts that drive Voice Control or Switch Control?

### Category 2: What can we use directly?

For each feature above, assess:
- **Use directly:** Can an agent use this as-is instead of our custom tool?
- **Build on top:** Can we use this as infrastructure and add our layer?
- **Learn from:** Design patterns or interaction models worth stealing
- **Ignore:** Not relevant to agent-os use case

### Category 3: Panel Editor deep dive

The Panel Editor appears in both Switch Control and Accessibility Keyboard. This could be significant — Apple has a tool for creating custom floating control surfaces. Questions:
- What is the panel file format? (plist? XML? binary?)
- Where are panels stored?
- Can we create panels programmatically (write files)?
- What can a panel contain? (buttons, grids, text, scripts?)
- Can a panel button execute an action? (AppleScript? shell? URL scheme?)
- Can panels be loaded/shown/hidden dynamically?
- Is this the same system heads-up is partially reinventing?

### Category 4: MCP and tool landscape

- Are there MCP servers that wrap macOS accessibility features?
- Are there existing open-source tools that drive Voice Control, Switch Control, or VoiceOver programmatically?
- Are there Swift libraries for the private accessibility frameworks?
- What does `AXorcist` (steipete) actually expose?
- What does the macOS Accessibility Inspector (Xcode tool) expose that we're not using?

### Category 5: Agent-as-assistive-device

The most provocative question: can an AI agent register itself as an assistive technology? If the agent could present itself to macOS as an assistive device (like a Switch Control switch or a VoiceOver client), it might get access to infrastructure that's otherwise private:
- Could the agent be a "switch" in Switch Control's model?
- Could the agent be a "voice" in Voice Control's model?
- Is there a registration mechanism for assistive technologies?
- What does `AXIsProcessTrusted()` actually grant beyond basic AX API access?

---

## Output Format

Create a structured reference document with:

1. **Capability matrix** — rows = macOS features, columns = [what it does, API access, can agent drive it?, agent-os overlap, recommendation]
2. **Panel Editor section** — detailed findings on the panel format and programmatic creation
3. **Steal list** — specific patterns, taxonomies, or mechanisms worth adopting
4. **Architecture implications** — what should change in agent-os based on findings
5. **Open questions** — things that need hands-on testing to resolve

Save to: `memory/reference_macos_accessibility_audit.md`

---

## How to Execute

This is a research task. The executing agent should:
1. Use web search extensively — Apple's documentation, developer forums, WWDC sessions
2. Use `defaults read` and filesystem exploration to find panel formats, preference files, etc.
3. Try AppleScript interfaces for VoiceOver, Voice Control, System Events
4. Check the Accessibility Inspector tool if available
5. Look at open-source projects that interact with these systems
6. Check if any WWDC 2024/2025 sessions introduced new accessibility APIs

Do NOT implement anything. Do NOT modify agent-os code. Just research and document.
