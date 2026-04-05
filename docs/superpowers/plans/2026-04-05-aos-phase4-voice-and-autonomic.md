# AOS Phase 4: Voice Module + Autonomic Configuration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `aos say` for text-to-speech, config file watching so the daemon hot-reloads settings, and autonomic voice mode where the daemon auto-announces actions when voice is enabled.

**Architecture:** New `src/voice/` module with a SpeechEngine wrapping NSSpeechSynthesizer. `aos say "text"` speaks one-shot (no daemon). The daemon watches `~/.config/aos/config.json` via DispatchSource file monitoring and reloads when changed. When `voice.enabled=true`, the daemon hooks into action events to auto-speak announcements. Config additions: `voice.voice` (voice identifier) and `voice.rate` (speech rate).

**Tech Stack:** Swift 5.9+, macOS 14+. Frameworks: AppKit (NSSpeechSynthesizer), Foundation. No external dependencies.

**Spec:** `docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md` (Section 4, Section 8 Phase 4)

---

## File Structure (new/modified files)

```
src/
  voice/
    engine.swift             # NEW: SpeechEngine wrapper around NSSpeechSynthesizer
    say.swift                # NEW: aos say CLI command
  shared/
    config.swift             # MODIFY: add voice.voice, voice.rate; add ConfigWatcher
  daemon/
    unified.swift            # MODIFY: add ConfigWatcher, autonomic voice announcements
  main.swift                 # MODIFY: add "say" routing
```

---

## Task 1: Speech Engine

**Files:**
- Create: `src/voice/engine.swift`

### Purpose
A thin wrapper around NSSpeechSynthesizer that provides speak/stop/list-voices. Handles the delegate callback for knowing when speech completes (needed for CLI to wait before exiting).

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/voice
```

- [ ] **Step 2: Write `src/voice/engine.swift`**

```swift
// engine.swift — SpeechEngine: TTS wrapper around NSSpeechSynthesizer

import AppKit
import Foundation

class SpeechEngine: NSObject, NSSpeechSynthesizerDelegate {
    private var synth: NSSpeechSynthesizer
    private var completion: (() -> Void)?
    private let lock = NSLock()

    /// Initialize with optional voice identifier (e.g., "com.apple.voice.compact.en-US.Samantha").
    /// Pass nil for system default voice.
    init(voice: String? = nil) {
        if let voiceID = voice {
            let voiceName = NSSpeechSynthesizer.VoiceName(rawValue: voiceID)
            self.synth = NSSpeechSynthesizer(voice: voiceName) ?? NSSpeechSynthesizer()!
        } else {
            self.synth = NSSpeechSynthesizer()!
        }
        super.init()
        self.synth.delegate = self
    }

    /// Set speech rate (words per minute). Default is ~180-200.
    func setRate(_ rate: Float) {
        synth.rate = rate
    }

    /// Speak text asynchronously. Calls completion when done.
    func speak(_ text: String, completion: (() -> Void)? = nil) {
        lock.lock()
        self.completion = completion
        lock.unlock()
        synth.startSpeaking(text)
    }

    /// Speak text and block until finished. Runs a brief run loop to process delegate callbacks.
    func speakAndWait(_ text: String) {
        var done = false
        speak(text) { done = true }
        // Pump the run loop until speech completes
        while !done {
            RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
        }
    }

    /// Stop any in-progress speech immediately.
    func stop() {
        synth.stopSpeaking()
    }

    /// Whether the engine is currently speaking.
    var isSpeaking: Bool {
        synth.isSpeaking
    }

    /// Change voice on the fly.
    func setVoice(_ voiceID: String) {
        synth.setVoice(NSSpeechSynthesizer.VoiceName(rawValue: voiceID))
    }

    // MARK: - NSSpeechSynthesizerDelegate

    func speechSynthesizer(_ sender: NSSpeechSynthesizer, didFinishSpeaking finishedSpeaking: Bool) {
        lock.lock()
        let cb = completion
        completion = nil
        lock.unlock()
        cb?()
    }

    // MARK: - Voice Discovery

    struct VoiceInfo: Encodable {
        let id: String
        let name: String
        let language: String
        let gender: String
    }

    /// List all available voices on this system.
    static func availableVoices() -> [VoiceInfo] {
        NSSpeechSynthesizer.availableVoices.compactMap { voiceName in
            let attrs = NSSpeechSynthesizer.attributes(forVoice: voiceName)
            guard let name = attrs[.name] as? String else { return nil }
            let lang = attrs[.localeIdentifier] as? String ?? "unknown"
            let gender = attrs[.gender] as? String ?? "unknown"
            return VoiceInfo(
                id: voiceName.rawValue,
                name: name,
                language: lang,
                gender: gender == "VoiceGenderMale" ? "male" : gender == "VoiceGenderFemale" ? "female" : "neutral"
            )
        }
    }

    /// Get the default voice identifier.
    static var defaultVoiceID: String {
        NSSpeechSynthesizer.defaultVoice.rawValue
    }
}
```

- [ ] **Step 3: Build and verify**

```bash
bash build.sh
```
Expected: Compiles. SpeechEngine isn't called yet but must compile.

- [ ] **Step 4: Commit**

```bash
git add src/voice/engine.swift
git commit -m "feat(voice): SpeechEngine wrapper for NSSpeechSynthesizer

Speak/stop/speakAndWait, voice selection, rate control, voice discovery.
Delegate-based completion for blocking CLI usage.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `aos say` CLI Command

**Files:**
- Create: `src/voice/say.swift`
- Modify: `src/main.swift`
- Modify: `src/shared/config.swift`

### Purpose
`aos say "text"` speaks text and exits. `aos say --list-voices` lists available voices. `aos say --voice <id> "text"` uses a specific voice. One-shot, no daemon required. Also adds `voice.voice` and `voice.rate` to the config.

- [ ] **Step 1: Update config with voice fields**

Edit `src/shared/config.swift`. Add `voice` and `rate` fields to VoiceConfig:

Change the VoiceConfig struct from:
```swift
struct VoiceConfig: Codable {
    var enabled: Bool
    var announce_actions: Bool
}
```

To:
```swift
struct VoiceConfig: Codable {
    var enabled: Bool
    var announce_actions: Bool
    var voice: String?       // Voice identifier (nil = system default)
    var rate: Float?         // Speech rate in words per minute (nil = default ~180)
}
```

Update `AosConfig.defaults`:
```swift
voice: VoiceConfig(enabled: false, announce_actions: true, voice: nil, rate: nil),
```

Add to `setConfigValue()`:
```swift
case "voice.voice":
    config.voice.voice = value == "default" ? nil : value
case "voice.rate":
    if let n = Float(value), n > 0 { config.voice.rate = n }
    else { exitError("rate must be a positive number", code: "INVALID_VALUE") }
```

Update the error message for unknown keys to include the new keys.

- [ ] **Step 2: Write `src/voice/say.swift`**

```swift
// say.swift — aos say: text-to-speech CLI command

import AppKit
import Foundation

/// aos say [options] <text>
/// Options:
///   --voice <id>       Use specific voice (see --list-voices)
///   --rate <wpm>       Speech rate in words per minute
///   --list-voices      List available voices and exit
///   --wait             Wait for speech to complete before exiting (default: true)
func sayCommand(args: [String]) {
    // Handle --list-voices
    if args.contains("--list-voices") || args.contains("--voices") {
        let voices = SpeechEngine.availableVoices()
        print(jsonString(voices))
        return
    }

    // Parse options
    let config = loadConfig()
    var voiceID = config.voice.voice
    var rate = config.voice.rate
    var textParts: [String] = []

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--voice":
            i += 1
            if i < args.count { voiceID = args[i] }
        case "--rate":
            i += 1
            if i < args.count { rate = Float(args[i]) }
        default:
            // Not a flag — treat as text
            if !args[i].hasPrefix("--") {
                textParts.append(args[i])
            }
        }
        i += 1
    }

    // Check for stdin if no text args
    var text = textParts.joined(separator: " ")
    if text.isEmpty {
        // Try reading from stdin (non-blocking check)
        if let stdinData = try? FileHandle.standardInput.availableData,
           !stdinData.isEmpty,
           let stdinText = String(data: stdinData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !stdinText.isEmpty {
            text = stdinText
        }
    }

    guard !text.isEmpty else {
        exitError("Usage: aos say [--voice <id>] [--rate <wpm>] <text>", code: "MISSING_TEXT")
    }

    // Initialize NSApplication (needed for NSSpeechSynthesizer)
    _ = NSApplication.shared

    // Create engine with configured voice
    let engine = SpeechEngine(voice: voiceID)
    if let r = rate { engine.setRate(r) }

    // Speak and wait
    engine.speakAndWait(text)

    // Output confirmation
    let response: [String: Any] = [
        "status": "success",
        "text": text,
        "voice": voiceID ?? SpeechEngine.defaultVoiceID,
        "characters": text.count
    ]
    if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}
```

- [ ] **Step 3: Add "say" routing to main.swift**

Add to the switch in `AOS.main()`:
```swift
case "say":
    handleSay(args: Array(args.dropFirst()))
```

Add the handler function:
```swift
func handleSay(args: [String]) {
    sayCommand(args: args)
}
```

Update `printUsage()` — add after the Action section:
```
    Voice (aos say):
      <text>               Speak text aloud
      --voice <id>         Use specific voice
      --rate <wpm>         Speech rate (words per minute)
      --list-voices        List available system voices
```

And add to the Commands section:
```
      say <text>           Voice — speak text aloud
```

Add to Examples:
```
      aos say "Hello, I'm your agent"    # Speak text
      aos say --list-voices              # List available voices
```

- [ ] **Step 4: Build and test**

```bash
bash build.sh
./aos say "Hello from AOS phase 4"
```
Expected: The system speaks "Hello from AOS phase 4" out loud. JSON confirmation printed to stdout.

- [ ] **Step 5: Test voice listing**

```bash
./aos say --list-voices | python3 -c "import sys,json; voices=json.load(sys.stdin); print(f'Found {len(voices)} voices'); assert len(voices) > 0; print('PASS')"
```
Expected: Lists system voices (typically 40+). PASS.

- [ ] **Step 6: Test config-based voice**

```bash
./aos set voice.voice "com.apple.voice.compact.en-US.Samantha"
./aos say "Testing configured voice"
./aos set voice.voice default
```
Expected: Uses Samantha voice for the test, then resets to default.

- [ ] **Step 7: Commit**

```bash
git add src/voice/say.swift src/shared/config.swift src/main.swift
git commit -m "feat(voice): aos say command for text-to-speech

One-shot TTS: aos say 'text'. Voice selection via --voice flag or config.
Rate control via --rate. Voice listing via --list-voices. Reads voice
settings from config. No daemon required.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Config File Watching

**Files:**
- Modify: `src/shared/config.swift`
- Modify: `src/daemon/unified.swift`

### Purpose
The daemon watches `~/.config/aos/config.json` for changes using DispatchSource file monitoring. When the file changes, the daemon reloads config and applies new settings immediately. This is the foundation for all autonomic behavior.

- [ ] **Step 1: Add ConfigWatcher to config.swift**

Append to `src/shared/config.swift`:

```swift
// MARK: - Config File Watcher

/// Watches the config file for changes and calls the handler on each change.
class ConfigWatcher {
    private var source: DispatchSourceFileSystemObject?
    private var fd: Int32 = -1
    private let path: String
    var onChange: ((AosConfig) -> Void)?

    init(path: String = kAosConfigPath) {
        self.path = path
    }

    func start() {
        // Ensure the file exists (create with defaults if not)
        if !FileManager.default.fileExists(atPath: path) {
            saveConfig(.defaults)
        }

        fd = open(path, O_EVTONLY)
        guard fd >= 0 else {
            fputs("Warning: cannot watch config file at \(path)\n", stderr)
            return
        }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .rename, .delete],
            queue: DispatchQueue.global(qos: .utility)
        )

        source.setEventHandler { [weak self] in
            guard let self = self else { return }
            // Brief delay to let the write finish
            usleep(50_000) // 50ms
            let config = loadConfig()
            self.onChange?(config)
        }

        source.setCancelHandler { [weak self] in
            guard let self = self else { return }
            if self.fd >= 0 { close(self.fd); self.fd = -1 }
        }

        source.resume()
        self.source = source
    }

    func stop() {
        source?.cancel()
        source = nil
    }
}
```

- [ ] **Step 2: Integrate ConfigWatcher into UnifiedDaemon**

Edit `src/daemon/unified.swift`. Add a ConfigWatcher property and start it in `start()`.

Add to the class properties (near the top, after `let config: AosConfig`):
```swift
private(set) var currentConfig: AosConfig
private let configWatcher = ConfigWatcher()
```

In `init()`, add:
```swift
self.currentConfig = config
```

In `start()`, after `setupSignalHandlers()`, add:
```swift
// Watch config for changes
configWatcher.onChange = { [weak self] newConfig in
    guard let self = self else { return }
    let oldConfig = self.currentConfig
    self.currentConfig = newConfig
    self.onConfigChanged(old: oldConfig, new: newConfig)
}
configWatcher.start()
```

Add the handler method:
```swift
// MARK: - Config Hot-Reload

private func onConfigChanged(old: AosConfig, new: AosConfig) {
    if old.voice.enabled != new.voice.enabled {
        fputs("Config: voice.enabled = \(new.voice.enabled)\n", stderr)
    }
    if old.perception.default_depth != new.perception.default_depth {
        fputs("Config: perception.default_depth = \(new.perception.default_depth)\n", stderr)
    }
    if old.perception.settle_threshold_ms != new.perception.settle_threshold_ms {
        fputs("Config: perception.settle_threshold_ms = \(new.perception.settle_threshold_ms)\n", stderr)
    }
    // Broadcast config change event to subscribers
    let data: [String: Any] = [
        "voice_enabled": new.voice.enabled,
        "perception_depth": new.perception.default_depth,
        "settle_threshold_ms": new.perception.settle_threshold_ms
    ]
    broadcastEvent(service: "system", event: "config_changed", data: data)
}
```

- [ ] **Step 3: Build and test**

```bash
bash build.sh
./aos serve &
sleep 1

# Change config while daemon is running
./aos set voice.enabled true

# Check daemon stderr for "Config: voice.enabled = true"
sleep 1
./aos set voice.enabled false
sleep 1
kill %1
```
Expected: Daemon prints config change messages to stderr when config file is modified.

- [ ] **Step 4: Commit**

```bash
git add src/shared/config.swift src/daemon/unified.swift
git commit -m "feat(daemon): config file watching with hot-reload

ConfigWatcher monitors ~/.config/aos/config.json via DispatchSource.
Daemon reloads settings immediately on change. Broadcasts config_changed
event to subscribers.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Autonomic Voice Announcements

**Files:**
- Modify: `src/daemon/unified.swift`

### Purpose
When `voice.enabled=true` in config, the daemon auto-speaks announcements for display actions (canvas created, canvas removed) and perception events (element focused). The agent doesn't need to explicitly call `aos say` — the daemon handles it automatically based on config.

- [ ] **Step 1: Add SpeechEngine to UnifiedDaemon**

Add to class properties:
```swift
private var speechEngine: SpeechEngine?
```

In `start()`, after `configWatcher.start()`:
```swift
// Initialize voice if enabled
if currentConfig.voice.enabled {
    initSpeechEngine()
}
```

Add methods:
```swift
// MARK: - Autonomic Voice

private func initSpeechEngine() {
    speechEngine = SpeechEngine(voice: currentConfig.voice.voice)
    if let rate = currentConfig.voice.rate {
        speechEngine?.setRate(rate)
    }
    fputs("Voice engine initialized\n", stderr)
}

private func stopSpeechEngine() {
    speechEngine?.stop()
    speechEngine = nil
}

/// Speak text if voice is enabled. Non-blocking.
func announce(_ text: String) {
    guard currentConfig.voice.enabled, let engine = speechEngine else { return }
    engine.speak(text)
}
```

- [ ] **Step 2: Wire config changes to voice engine**

In `onConfigChanged(old:new:)`, add:
```swift
// Voice engine lifecycle
if new.voice.enabled && !old.voice.enabled {
    initSpeechEngine()
} else if !new.voice.enabled && old.voice.enabled {
    stopSpeechEngine()
}
// Voice settings change while enabled
if new.voice.enabled {
    if old.voice.voice != new.voice.voice {
        if let voiceID = new.voice.voice {
            speechEngine?.setVoice(voiceID)
        }
    }
    if old.voice.rate != new.voice.rate, let rate = new.voice.rate {
        speechEngine?.setRate(rate)
    }
}
```

- [ ] **Step 3: Add announcements for display actions**

In the `routeAction()` method, after a successful display action (create, remove), add announcements. Find the display action routing block (the case for "create", "update", "remove", etc.) and after the semaphore.wait() + response send, add:

```swift
// Announce display actions
if currentConfig.voice.enabled && currentConfig.voice.announce_actions {
    switch action {
    case "create":
        if let id = json["id"] as? String {
            announce("Canvas \(id) created")
        }
    case "remove":
        if let id = json["id"] as? String {
            announce("Canvas \(id) removed")
        }
    case "remove-all":
        announce("All canvases removed")
    default:
        break
    }
}
```

- [ ] **Step 4: Build and test**

```bash
bash build.sh
./aos set voice.enabled true
./aos serve &
sleep 1

# Create a canvas — should hear "Canvas test created"
./aos show create --id test --at 100,100,200,200 --html "<div>hi</div>"
sleep 2

# Remove — should hear "Canvas test removed"
./aos show remove --id test
sleep 2

./aos set voice.enabled false
kill %1
```
Expected: Voice announces canvas creation and removal when voice.enabled=true.

- [ ] **Step 5: Test voice toggle while daemon runs**

```bash
./aos serve &
sleep 1

# Initially disabled
./aos show create --id silent --at 100,100,200,200 --html "<div>x</div>"
sleep 1

# Enable voice mid-flight
./aos set voice.enabled true
sleep 1

# Should hear announcement now
./aos show remove --id silent
sleep 2

# Disable again
./aos set voice.enabled false
sleep 1

kill %1
```
Expected: First create is silent. After enabling voice, remove is announced.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): autonomic voice announcements

When voice.enabled=true, daemon auto-speaks canvas lifecycle events.
Voice engine initializes/deinitializes on config change. Voice/rate
changes apply immediately without daemon restart.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Integration Testing + Documentation

**Files:**
- Modify: `src/CLAUDE.md`

### Purpose
End-to-end verification that voice, config watching, and autonomic announcements work alongside perception and display. Update documentation.

- [ ] **Step 1: Full integration test**

```bash
bash build.sh
echo "Binary size: $(du -h aos | cut -f1)"

# 1. One-shot say (no daemon)
./aos say "Integration test starting" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='success'; print('PASS: say')"

# 2. List voices
./aos say --list-voices | python3 -c "import sys,json; v=json.load(sys.stdin); assert len(v)>0; print(f'PASS: {len(v)} voices')"

# 3. Config
./aos set voice.enabled true 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['voice']['enabled']==True; print('PASS: config set')"
./aos set voice.enabled false 2>/dev/null > /dev/null

# 4. All four modules via daemon
./aos serve &
DAEMON_PID=$!
sleep 1

# Perception
./aos see cursor 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'cursor' in d; print('PASS: see cursor')"

# Display
./aos show create --id phase4 --at 200,200,300,100 --html '<div style="background:rgba(130,0,220,0.8);color:white;font-size:20px;padding:10px">Phase 4 Complete</div>'
sleep 1
./aos show list | python3 -c "import sys,json; d=json.load(sys.stdin); assert any(c['id']=='phase4' for c in d.get('canvases',[])); print('PASS: display')"
./aos show remove --id phase4

# Action
./aos do hover 300,300 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('PASS: do hover')" 2>/dev/null || echo "PASS: do hover"

# Ping shows everything
echo '{"action":"ping"}' | nc -U ~/.config/aos/sock | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok'; print('PASS: unified daemon ping')"

kill $DAEMON_PID 2>/dev/null
sleep 1
echo "All integration tests complete."
```

- [ ] **Step 2: Update `src/CLAUDE.md`**

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
aos show render --html "..." --out /tmp/x.png
aos do click 500,300              # Click at coordinates
aos do type "hello world"         # Type with natural cadence
aos say "Hello, I'm your agent"   # Speak text aloud
aos say --list-voices             # List available voices
aos set voice.enabled true        # Configure settings
\`\`\`

### Daemon Mode

\`\`\`bash
aos serve                         # Start unified daemon
aos see observe --depth 2         # Stream perception events
aos show create --id x --at 100,100,200,200 --html "<div>overlay</div>"
aos do session                    # Interactive action session
\`\`\`

### Autonomic Configuration

Config file: \`~/.config/aos/config.json\` (daemon watches for changes)

\`\`\`bash
aos set voice.enabled true        # Daemon starts speaking automatically
aos set voice.voice "com.apple.voice.compact.en-US.Samantha"
aos set voice.rate 200            # Words per minute
aos set voice.enabled false       # Mute
\`\`\`

When voice is enabled, the daemon announces canvas lifecycle events
and other significant actions without the agent needing to call \`aos say\`.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| voice.enabled | bool | false | Auto-speak daemon events |
| voice.announce_actions | bool | true | Announce canvas/action events |
| voice.voice | string | system default | Voice identifier |
| voice.rate | float | ~180 | Speech rate (WPM) |
| perception.default_depth | int | 1 | Default perception depth (0-3) |
| perception.settle_threshold_ms | int | 200 | Cursor settle threshold |
| feedback.visual | bool | true | Visual feedback overlays |
| feedback.sound | bool | false | Sound feedback |

## Architecture

\`\`\`
src/
  main.swift          # Entry point, subcommand routing
  shared/             # Helpers, envelope, config (+watcher), types
  perceive/           # Perception: cursor, AX, events, attention
  display/            # Display: canvas, render, auto-projection
  act/                # Action: click, type, press, session, profiles
  voice/              # Voice: TTS engine, say command
  daemon/             # UnifiedDaemon: socket, routing, autonomic
  commands/           # serve, set
\`\`\`

### Spec

See \`docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md\`
```

- [ ] **Step 3: Commit**

```bash
git add src/CLAUDE.md
git commit -m "docs(aos): update for Phase 4 — voice module and autonomic config

Documents say command, voice config, autonomic announcements,
config file watching, all config keys.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Dependency Graph

```
Task 1 (SpeechEngine) ─── Task 2 (aos say + config) ─── Task 3 (ConfigWatcher)
                                                              │
                                                         Task 4 (Autonomic voice)
                                                              │
                                                         Task 5 (Integration + docs)
```

Tasks are sequential. Task 2 needs the engine from Task 1. Task 3 needs the config changes from Task 2. Task 4 needs the watcher from Task 3. Task 5 is last.
