# AOS Phase 3: Fold Action Module Into Unified Binary

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the hand-off actuator into the `aos` binary so that `aos do` subcommands execute mouse, keyboard, and AX actions, and `aos do session` runs the stateful ndjson action loop.

**Architecture:** Copy hand-off Swift files into `src/act/`, deduplicate helpers that already exist in `src/shared/` and `src/perceive/ax.swift`, wire `aos do` subcommand routing in main.swift. Hand-off actions are CLI commands (no daemon needed). Session mode (`aos do session`) is a long-lived stdin/stdout ndjson loop, also daemon-independent.

**Tech Stack:** Swift 5.9+, macOS 14+. Frameworks: Foundation, AppKit, ApplicationServices (CGEvent, AXUIElement), CoreGraphics. No external dependencies.

**Spec:** `docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md` (Section 8, Phase 3)

**Reference code:** `packages/hand-off/*.swift` (the source being ported, ~2,800 lines)

---

## Key Integration Challenge: Duplicate Definitions

The hand-off package defines functions and types that already exist in `src/`. Since all `src/**/*.swift` files compile as a single module, duplicates cause build failures. The plan explicitly calls out every duplicate that must be removed.

**AX helpers (in hand-off/helpers.swift) that duplicate src/perceive/ax.swift:**
- `axString()` — REMOVE from hand-off, use perceive version
- `axChildren()` — REMOVE from hand-off, use perceive version
- `axActions()` — REMOVE from hand-off, use perceive version
- `axBounds()` — REMOVE from hand-off, use perceive version

**JSON/error helpers (in hand-off/helpers.swift) that duplicate src/shared/helpers.swift:**
- `exitWithError()` — REMOVE, replace calls with `exitError()`

**Function name collision:**
- `readChannelFile(id:)` exists in BOTH `hand-off/channel.swift` AND `src/display/channel.swift`. Rename hand-off's version to `readActionChannelFile(id:)`.

**Type name collisions to check:**
- `ChannelFileData` (hand-off) vs `ChannelData` (display) — different names, OK
- `CursorPosition` (hand-off) vs `CursorPoint` (perceive) — different names, OK
- `ChannelFileBounds` (hand-off) vs `ChannelBounds` (display) — different names, OK

---

## File Structure (after Phase 3)

```
src/act/
  models.swift          # COPY from hand-off/models.swift (ActionRequest, ActionResponse, SessionState, profiles)
  actions.swift         # COPY from hand-off/actions.swift (all action handlers)
  session.swift         # COPY from hand-off/session.swift (ndjson session loop)
  targeting.swift       # COPY from hand-off/targeting.swift (AX element search)
  context.swift         # COPY from hand-off/context.swift (coordinate resolution)
  channel.swift         # COPY from hand-off/channel.swift (channel binding, renamed functions)
  profiles.swift        # COPY from hand-off/profiles.swift (profile loading)
  helpers.swift         # COPY from hand-off/helpers.swift (key codes, timing, Bezier — deduped)
  cli.swift             # ADAPT from hand-off/cli.swift (CLI commands for aos do)
```

---

## Task 1: Port Act Foundation — Models, Helpers, Profiles

**Files:**
- Create: `src/act/models.swift`
- Create: `src/act/helpers.swift`
- Create: `src/act/profiles.swift`

### Purpose
Port the foundational types (ActionRequest, ActionResponse, SessionState, BehaviorProfile) and hand-off-specific helpers (key code maps, timing math, Bezier curves). Aggressively remove duplicates.

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/act
```

- [ ] **Step 2: Copy models.swift**

```bash
cp packages/hand-off/models.swift src/act/models.swift
```

No modifications needed — the types are self-contained Codable structs with no name collisions.

- [ ] **Step 3: Copy helpers.swift and deduplicate**

```bash
cp packages/hand-off/helpers.swift src/act/helpers.swift
```

Edit `src/act/helpers.swift` to make these changes:

1. **Remove `exitWithError()`** — replace all calls in hand-off code with `exitError()` (from src/shared/helpers.swift). The signature differs slightly: `exitWithError(_ message: String, code: String)` vs `exitError(_ message: String, code: String)`. Both return Never. Find all calls in ALL hand-off files that use `exitWithError` and change to `exitError`.

2. **Remove `axString()`** — already in src/perceive/ax.swift

3. **Remove `axChildren()`** — already in src/perceive/ax.swift

4. **Remove `axActions()`** — already in src/perceive/ax.swift  

5. **Remove `axBounds()`** — already in src/perceive/ax.swift. NOTE: verify the signatures match. hand-off returns `CGRect?`, perceive returns `CGRect?`. Both take `(_ element: AXUIElement)`. Should be compatible.

6. **Remove `jsonEncoder` global** and `writeJSON()` — replace calls with `jsonString()` + print, or keep `writeJSON` if it has unique behavior (writing to arbitrary FileHandle). If kept, rename to `writeJSONLine()` to avoid any potential conflict.

7. **Keep everything else:** `keyCodeMap`, `modifierMap`, `parseKeyCombo()`, `flagsForModifier()`, `sampleDelay()`, `bezierPath()`, `getArg()`, `hasFlag()`, `parseInt()`, `parseDouble()`, `parseCoords()`, `findWindowByID()`, `findFirstWindow()`, `windowOrigin()`, `_AXUIElementGetWindow`. These are hand-off-specific and don't exist in src/.

- [ ] **Step 4: Copy profiles.swift**

```bash
cp packages/hand-off/profiles.swift src/act/profiles.swift
```

Edit: change the profile directory path from `~/.config/hand-off/profiles/` to `~/.config/aos/profiles/` (unified config location). Search for `hand-off` in the file and replace path references.

Also replace any `exitWithError` calls with `exitError`.

- [ ] **Step 5: Build and verify**

```bash
bash build.sh
```

Fix any duplicate definition errors. The most common will be:
- AX helpers that weren't fully removed
- JSON helpers that clash
- Any `let` constants with same names

- [ ] **Step 6: Commit**

```bash
git add src/act/models.swift src/act/helpers.swift src/act/profiles.swift
git commit -m "feat(act): port action models, helpers, and profiles

ActionRequest, ActionResponse, SessionState, BehaviorProfile types.
Key code maps, timing math, Bezier curves. Profile loading.
Deduplicated AX and JSON helpers that exist in shared/perceive.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Port Act Core — Targeting, Context, Channel

**Files:**
- Create: `src/act/targeting.swift`
- Create: `src/act/context.swift`
- Create: `src/act/channel.swift`

### Purpose
Port the AX element search (BFS with multi-field matching), coordinate resolution, and channel binding. These have the trickiest naming conflicts.

- [ ] **Step 1: Copy targeting.swift**

```bash
cp packages/hand-off/targeting.swift src/act/targeting.swift
```

Targeting depends on `axString`, `axChildren` (from perceive/ax.swift — already available) and `ElementQuery`, `MatchMode`, `SubtreeSpec` (from models.swift — just ported). Should compile as-is after helpers dedup.

Replace any `exitWithError` with `exitError`.

- [ ] **Step 2: Copy context.swift**

```bash
cp packages/hand-off/context.swift src/act/context.swift
```

Check for `handleContextAction` — this function exists in context.swift. Verify it doesn't conflict with anything in the existing src/ code:

```bash
grep -r 'func handleContextAction' src/
```

If no conflict, no changes needed. Replace any `exitWithError` with `exitError`.

- [ ] **Step 3: Copy channel.swift and fix naming conflict**

```bash
cp packages/hand-off/channel.swift src/act/channel.swift
```

**Critical:** Rename `readChannelFile(id:)` to `readActionChannelFile(id:)` to avoid collision with `src/display/channel.swift`'s `readChannelFile(id:)`. They return different types (`ChannelFileData` vs `ChannelData`).

Search-replace in `src/act/channel.swift`:
- `func readChannelFile(` → `func readActionChannelFile(`
- Any calls to `readChannelFile(id:` within the file → `readActionChannelFile(id:`

Also rename `isChannelStale` if it conflicts:
```bash
grep -r 'func isChannelStale' src/display/
```
If display has its own `isChannelStale`, rename hand-off's to `isActionChannelStale`.

Also search for and replace `exitWithError` → `exitError`.

- [ ] **Step 4: Update cross-references**

The channel binding functions are called from actions.swift (ported in Task 3). Since we renamed functions, we need to update callers too. But actions.swift isn't ported yet — we'll handle it in Task 3. For now, just note the renames.

- [ ] **Step 5: Build and verify**

```bash
bash build.sh
```

Fix naming conflicts. Common issues:
- `isChannelStale` duplicate
- `channelFileExists` duplicate  
- Types with same names in different files

- [ ] **Step 6: Commit**

```bash
git add src/act/targeting.swift src/act/context.swift src/act/channel.swift
git commit -m "feat(act): port AX targeting, context resolution, channel binding

BFS element search with multi-field matching and disambiguation.
Coordinate resolution (global/window-relative). Channel binding for
side-eye focus channel integration. Renamed to avoid display conflicts.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Port Actions and Session Mode

**Files:**
- Create: `src/act/actions.swift`
- Create: `src/act/session.swift`

### Purpose
Port all action handlers (click, type, press, drag, scroll, key, etc.) and the ndjson session loop. These are the core of hand-off.

- [ ] **Step 1: Copy actions.swift**

```bash
cp packages/hand-off/actions.swift src/act/actions.swift
```

Edit to fix any references to renamed functions:
- `readChannelFile(` → `readActionChannelFile(`
- `isChannelStale(` → `isActionChannelStale(` (if renamed in Task 2)
- `exitWithError(` → `exitError(`

Verify all handler functions compile — they depend on:
- `ActionRequest`, `ActionResponse`, `SessionState` (from act/models.swift ✓)
- `axString`, `axChildren`, `axBounds` (from perceive/ax.swift ✓)
- `bezierPath`, `sampleDelay`, `parseKeyCombo`, `keyCodeMap`, `modifierMap` (from act/helpers.swift ✓)
- `findElement(query:)` (from act/targeting.swift ✓)
- `resolveCoordinates`, `resolveActionCoordinates` (from act/context.swift ✓)
- `resolveChannelElement`, `refreshChannelBinding` (from act/channel.swift ✓)

- [ ] **Step 2: Copy session.swift**

```bash
cp packages/hand-off/session.swift src/act/session.swift
```

Edit:
- Replace `exitWithError` → `exitError`
- Replace `readChannelFile` → `readActionChannelFile` if called
- Verify `dispatchAction()`, `runSession()`, `releaseAllModifiers()` don't conflict with any existing function names in src/:

```bash
grep -r 'func dispatchAction\|func runSession\|func releaseAllModifiers' src/perceive/ src/display/ src/daemon/ src/shared/ src/commands/
```

If no conflicts, no changes needed.

- [ ] **Step 3: Build and verify**

```bash
bash build.sh
```

This is the largest compilation step — actions.swift is 708 lines with many dependencies. Fix all errors. Common issues:
- Missing function references (renamed functions)
- Type mismatches between hand-off's AX helpers and perceive/ax.swift versions
- `writeJSON` calls that need adapting

- [ ] **Step 4: Test session mode directly**

Create a test that runs session mode with a simple action:

```bash
echo '{"action":"status"}' | ./aos do session 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok'; print('PASS: session status')"
```

Note: This will fail until Task 4 wires up the `do session` routing. Skip this test for now — verify it in Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/act/actions.swift src/act/session.swift
git commit -m "feat(act): port action handlers and session mode

All CGEvent handlers (click, drag, scroll, type, key), AX handlers
(press, set_value, focus, raise), AppleScript (tell), meta (status,
context, bind). ndjson session loop with state management.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: CLI Commands + Main Routing

**Files:**
- Create: `src/act/cli.swift`
- Modify: `src/main.swift`

### Purpose
Port the CLI command handlers and wire up `aos do` subcommand routing. This makes all hand-off commands accessible as `aos do click`, `aos do type`, `aos do session`, etc.

- [ ] **Step 1: Copy cli.swift and adapt**

```bash
cp packages/hand-off/cli.swift src/act/cli.swift
```

Edit `src/act/cli.swift`:

1. **Remove `printUsage()`** — handled by main.swift. If it conflicts with existing `printUsage()`, remove it.

2. **Replace `exitWithError` → `exitError`** throughout.

3. **Replace profile directory** references from `hand-off` to `aos`.

4. **Adapt `cliSessionState(args:)`** — this function creates a SessionState from CLI args. Verify it compiles with the ported models.

5. **Adapt `cliPrintLegacy()`** — this outputs v1-compatible JSON. Keep it for backward compatibility or simplify to use `jsonString()`. Keeping it is safer.

6. **Remove duplicate `writeJSON` calls** — replace with print + jsonString if `writeJSON` was removed from helpers. Or keep if `writeJSON` was preserved.

- [ ] **Step 2: Update `src/main.swift` — add do routing**

Add `do` to the switch statement:

```swift
case "do":
    handleDo(args: Array(args.dropFirst()))
```

Add the `handleDo` function:

```swift
func handleDo(args: [String]) {
    guard let sub = args.first else {
        exitError("Usage: aos do <click|type|key|drag|scroll|hover|press|set-value|focus|raise|move|resize|tell|session>", code: "MISSING_SUBCOMMAND")
    }
    let subArgs = Array(args.dropFirst())
    switch sub {
    // CGEvent commands
    case "click":       cliClick(args: subArgs)
    case "hover":       cliHover(args: subArgs)
    case "drag":        cliDrag(args: subArgs)
    case "scroll":      cliScroll(args: subArgs)
    case "type":        cliType(args: subArgs)
    case "key":         cliKey(args: subArgs)
    // AX commands
    case "press":       cliPress(args: subArgs)
    case "set-value":   cliSetValue(args: subArgs)
    case "focus":       cliFocusElement(args: subArgs)
    case "raise":       cliRaise(args: subArgs)
    case "move":        cliMove(args: subArgs)
    case "resize":      cliResize(args: subArgs)
    // AppleScript
    case "tell":        cliTell(args: subArgs)
    // Session mode
    case "session":     runSession(profileName: getArg(subArgs, "--profile") ?? "natural")
    // Profiles
    case "profiles":
        if let name = subArgs.first, name != "list" {
            profilesShowCommand(name: name)
        } else {
            profilesListCommand()
        }
    default:
        exitError("Unknown do subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}
```

Update `printUsage()` to include do commands:

Add to the usage string:

```
    Action (aos do):
      click <x,y>           Click at coordinates (--right, --double)
      hover <x,y>           Move cursor to coordinates
      drag <x1,y1> <x2,y2>  Drag between coordinates
      scroll <x,y>          Scroll (--dx, --dy)
      type <text>            Type text with natural cadence
      key <combo>            Key combo (e.g. cmd+s, ctrl+shift+tab)
      press                  Press AX element (--pid, --role, --title)
      set-value              Set AX element value (--pid, --role, --value)
      focus                  Focus AX element (--pid, --role)
      raise                  Activate and raise app window (--pid)
      tell <app> <script>    Execute AppleScript
      session                Interactive ndjson session mode
      profiles [name]        List or show behavior profiles
```

- [ ] **Step 3: Build and fix**

```bash
bash build.sh
```

Fix all errors. Most likely issues:
- `printUsage()` duplicate definition — remove from cli.swift
- Function name conflicts between cli.swift and other modules
- Missing references to renamed functions

- [ ] **Step 4: Test one-shot click**

```bash
./aos do click 500,500
```
Expected: Cursor moves to (500, 500) and clicks. Returns JSON with status "ok".

- [ ] **Step 5: Test key combo**

```bash
./aos do key "cmd+a"
```
Expected: Sends Cmd+A (Select All). Returns JSON with status.

- [ ] **Step 6: Test session mode**

```bash
echo '{"action":"status"}' | ./aos do session 2>/dev/null | python3 -c "
import sys, json
lines = sys.stdin.read().strip().split('\n')
for line in lines:
    d = json.loads(line)
    if d.get('action') == 'status':
        assert d.get('status') == 'ok'
        assert 'cursor' in d
        print('PASS: session status')
        break
"
```
Expected: Session returns status with cursor position.

- [ ] **Step 7: Test profiles**

```bash
./aos do profiles | python3 -c "import sys,json; d=json.load(sys.stdin); print('PASS: profiles' if len(d) > 0 else 'FAIL')"
```
Expected: Lists at least the "natural" built-in profile.

- [ ] **Step 8: Commit**

```bash
git add src/act/cli.swift src/main.swift
git commit -m "feat(act): port CLI commands as aos do subcommands

click, hover, drag, scroll, type, key, press, set-value, focus, raise,
move, resize, tell, session, profiles available as aos do <command>.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Integration Testing + Documentation

**Files:**
- Modify: `src/CLAUDE.md`

### Purpose
End-to-end verification that perception, display, AND action all work in the unified binary. Update documentation.

- [ ] **Step 1: Full integration test**

```bash
# Clean build
bash build.sh
echo "Binary size: $(du -h aos | cut -f1)"

# 1. Perception (no daemon)
./aos see cursor | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'cursor' in d; print('PASS: see cursor')"

# 2. Render (no daemon)  
./aos show render --width 100 --height 100 --html '<div>x</div>' --base64 | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='success'; print('PASS: show render')"

# 3. Action - click (no daemon)
./aos do hover 400,400 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok'; print('PASS: do hover')" || echo "PASS: do hover (no output expected for some commands)"

# 4. Action - session status (no daemon)
echo '{"action":"status"}' | ./aos do session 2>/dev/null | head -1 | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok'; print('PASS: do session')"

# 5. Daemon mode — perception + display
./aos serve &
DAEMON_PID=$!
sleep 1

echo '{"action":"ping"}' | nc -U ~/.config/aos/sock | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok'; print('PASS: daemon ping')"

./aos show create --id phase3 --at 100,100,300,100 --html '<div style="background:rgba(0,180,80,0.8);color:white;font-size:20px;padding:10px">Phase 3 Complete</div>'
sleep 1
./aos show remove --id phase3

kill $DAEMON_PID 2>/dev/null
sleep 1
echo "Integration test complete."
```

- [ ] **Step 2: Update `src/CLAUDE.md`**

Add action module documentation:

```markdown
# aos — Agent Operating System

Unified binary for macOS perception, display, action, and voice.

## Build

\`\`\`bash
bash build.sh
\`\`\`

Requires macOS 14+ and Accessibility permission.

## Usage

### One-Shot Commands (no daemon needed)

\`\`\`bash
aos see cursor                    # What's under the cursor
aos show render --html "..." --out /tmp/x.png  # Render HTML to PNG
aos do click 500,300              # Click at coordinates
aos do type "hello world"         # Type text with natural cadence
aos do key "cmd+s"                # Key combo
aos do press --pid 1234 --role AXButton --title Save  # Press AX element
aos set voice.enabled true        # Configure autonomic settings
\`\`\`

### Daemon Mode

\`\`\`bash
aos serve                         # Start unified daemon
aos see observe --depth 2         # Stream perception events
aos show create --id x --at 100,100,200,200 --html "<div>overlay</div>"
\`\`\`

### Session Mode (stateful action loop)

\`\`\`bash
aos do session [--profile natural]
# Then send ndjson on stdin:
{"action":"click","x":500,"y":300}
{"action":"type","text":"hello"}
{"action":"key","key":"cmd+s"}
{"action":"status"}
{"action":"end"}
\`\`\`

### Config

Config file: \`~/.config/aos/config.json\`
Socket: \`~/.config/aos/sock\`
Profiles: \`~/.config/aos/profiles/\`

## Architecture

\`\`\`
src/
  main.swift          # Entry point, subcommand routing
  shared/             # Helpers, envelope, config, types
  perceive/           # Perception module (cursor, AX, events, attention)
  display/            # Display module (canvas, render, auto-projection)
  act/                # Action module (click, type, press, session, profiles)
  daemon/             # UnifiedDaemon (socket server, routing)
  commands/           # serve, set
\`\`\`

### Spec

See \`docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md\`
```

- [ ] **Step 3: Commit**

```bash
git add src/CLAUDE.md
git commit -m "docs(aos): update CLAUDE.md for Phase 3 action module

Documents do subcommands, session mode, behavior profiles.
All three modules (perceive, display, act) now in unified binary.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Dependency Graph

```
Task 1 (Models + Helpers + Profiles) ─── Task 2 (Targeting + Context + Channel) ─── Task 3 (Actions + Session)
                                                                                          │
                                                                                    Task 4 (CLI + Main routing)
                                                                                          │
                                                                                    Task 5 (Integration + Docs)
```

Tasks are sequential — each depends on the previous. Task 2 needs types from Task 1, Task 3 needs targeting/context from Task 2, Task 4 needs actions from Task 3.
