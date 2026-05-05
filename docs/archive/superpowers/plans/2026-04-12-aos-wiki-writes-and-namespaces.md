# AOS Wiki Writes & Namespaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add wiki write API, change event channel, and namespace convention to AOS, with a first-boot seed helper for applications.

**Architecture:** Extend existing `wiki.swift` module with PUT/DELETE endpoints wired through the content server. Add an FSEvents watcher that broadcasts `wiki_page_changed` on file mutations. Relocate existing flat-layout pages into an `aos/` namespace on first startup, with a user-visible backup copy. Provide a simple `seedIfAbsent` helper for applications to call from their own startup.

**Tech Stack:** Swift, FSEvents, existing daemon pub/sub (`broadcastEvent`), existing HTTP content server.

**Spec:** `docs/superpowers/specs/2026-04-12-aos-wiki-writes-and-namespaces.md`

---

### Task 1: Namespace migration — tests first

**Files:**
- Create: `src/commands/wiki-migrate.swift`
- Test: `tests/wiki-migrate.sh` (shell fixture — no Swift test harness in this repo yet)

- [ ] **Step 1: Write the migration test fixture**

```bash
#!/usr/bin/env bash
# tests/wiki-migrate.sh
set -euo pipefail

TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

mkdir -p "$TMP/wiki/entities" "$TMP/wiki/concepts" "$TMP/wiki/plugins/self-check"
echo "---
type: entity
name: Daemon
---
body" > "$TMP/wiki/entities/daemon.md"
echo "---
type: plugin
name: self-check
---
body" > "$TMP/wiki/plugins/self-check/SKILL.md"

# Run migration (binary under test)
./aos wiki migrate-namespaces --wiki-root "$TMP/wiki"

# Assertions
test -d "$TMP/wiki.pre-namespace-bak" || { echo "FAIL: backup not created"; exit 1; }
test -f "$TMP/wiki/aos/entities/daemon.md" || { echo "FAIL: entities not moved"; exit 1; }
test -f "$TMP/wiki/aos/plugins/self-check/SKILL.md" || { echo "FAIL: plugins not moved"; exit 1; }
test ! -d "$TMP/wiki/entities" || { echo "FAIL: old entities dir still present"; exit 1; }

# Idempotency: second run no-op
./aos wiki migrate-namespaces --wiki-root "$TMP/wiki"
test -f "$TMP/wiki/aos/entities/daemon.md" || { echo "FAIL: second run broke state"; exit 1; }

echo "PASS"
```

- [ ] **Step 2: Run to verify it fails**

```bash
chmod +x tests/wiki-migrate.sh && ./tests/wiki-migrate.sh
```
Expected: FAIL — `aos wiki migrate-namespaces` subcommand doesn't exist yet.

- [ ] **Step 3: Implement migration**

Create `src/commands/wiki-migrate.swift` with a single function:

```swift
import Foundation

enum WikiMigrate {
    /// Relocate flat entities/concepts/plugins into aos/. Idempotent.
    /// Creates wiki.pre-namespace-bak/ backup on first run.
    /// Returns true if migration ran, false if already migrated.
    @discardableResult
    static func migrateIfNeeded(wikiRoot: URL) throws -> Bool {
        let fm = FileManager.default
        let aosDir = wikiRoot.appendingPathComponent("aos")
        if fm.fileExists(atPath: aosDir.path) { return false }

        let legacy = ["entities", "concepts", "plugins"]
        let presentLegacy = legacy.filter {
            fm.fileExists(atPath: wikiRoot.appendingPathComponent($0).path)
        }
        guard !presentLegacy.isEmpty else { return false }

        // Backup first
        let backup = wikiRoot.deletingLastPathComponent()
            .appendingPathComponent(wikiRoot.lastPathComponent + ".pre-namespace-bak")
        if !fm.fileExists(atPath: backup.path) {
            try fm.copyItem(at: wikiRoot, to: backup)
        }

        try fm.createDirectory(at: aosDir, withIntermediateDirectories: true)
        for name in presentLegacy {
            let src = wikiRoot.appendingPathComponent(name)
            let dst = aosDir.appendingPathComponent(name)
            try fm.moveItem(at: src, to: dst)
        }
        return true
    }
}
```

Wire a `wiki migrate-namespaces` subcommand in `src/main.swift` that parses `--wiki-root` (default: `~/.config/aos/{mode}/wiki`) and calls `migrateIfNeeded`.

- [ ] **Step 4: Run tests**

```bash
bash build.sh && ./tests/wiki-migrate.sh
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/wiki-migrate.swift src/main.swift tests/wiki-migrate.sh
git commit -m "feat(wiki): namespace migration with backup + migrate-namespaces subcommand"
```

---

### Task 2: Automatic migration at daemon startup

**Files:**
- Modify: `src/daemon/unified.swift` (daemon init around line 224 where content server wires up)

- [ ] **Step 1: Add startup call**

Before `contentServer` initialization, call the migration:

```swift
// Relocate legacy flat layout into aos/ namespace. Idempotent, creates backup.
let wikiRoot = aosStateDir().appendingPathComponent("wiki")
do {
    if try WikiMigrate.migrateIfNeeded(wikiRoot: wikiRoot) {
        log("wiki: migrated flat layout into aos/ namespace (backup at wiki.pre-namespace-bak)")
    }
} catch {
    log("wiki: migration failed: \(error) — continuing with current layout")
}
```

- [ ] **Step 2: Manual integration test**

```bash
# Prep a fake state dir with legacy layout
STATE=$HOME/.config/aos/repo/wiki
cp -R "$STATE" /tmp/wiki-backup-sanity
# (or snapshot git first, do whatever makes the fallback safe)
./aos serve --once  # or equivalent short-boot to trigger init
```
Expected: `aos/entities/`, `aos/concepts/`, `aos/plugins/` exist. `wiki.pre-namespace-bak` exists. Log line printed.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): run wiki namespace migration at startup"
```

---

### Task 3: Content server write API — tests first

**Files:**
- Modify: content server source (find via `grep -rn "ContentServer" src/`)
- Test: `tests/wiki-write-api.sh`

- [ ] **Step 1: Write test fixture**

```bash
#!/usr/bin/env bash
set -euo pipefail

PORT=$(grep '"port"' ~/.config/aos/repo/config.json | head -1 | grep -oE '[0-9]+' || echo 7777)
URL="http://127.0.0.1:$PORT/wiki/test/hello.md"
BODY='---
type: test
name: Hello
---
Hello world'

# PUT creates
curl -sf -X PUT "$URL" -H 'Content-Type: text/markdown' --data-binary "$BODY" >/dev/null
# GET readable
curl -sf "$URL" | grep -q "Hello world"
# GET via wiki path
test -f "$HOME/.config/aos/repo/wiki/test/hello.md"
# DELETE removes
curl -sf -X DELETE "$URL" >/dev/null
test ! -f "$HOME/.config/aos/repo/wiki/test/hello.md"

echo "PASS"
```

- [ ] **Step 2: Run to verify FAIL**

Expected: 404 or 405 on PUT — endpoint doesn't exist.

- [ ] **Step 3: Implement PUT and DELETE handlers**

In the content server, add routing for `PUT /wiki/<path>` and `DELETE /wiki/<path>`:

```swift
// Handler sketch. Validate path: no "..", no absolute, must be under wiki root.
func handleWikiWrite(method: String, path: String, body: Data) -> HTTPResponse {
    guard let relative = safeWikiRelative(path) else { return .badRequest("invalid path") }
    let target = wikiRoot.appendingPathComponent(relative)
    switch method {
    case "PUT":
        try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        do {
            let isNew = !FileManager.default.fileExists(atPath: target.path)
            try body.write(to: target)
            WikiIndex.reindex(path: relative)
            WikiChangeBus.emit(path: relative, op: isNew ? .created : .updated)
            return .ok(body: "")
        } catch { return .serverError("\(error)") }
    case "DELETE":
        do {
            try FileManager.default.removeItem(at: target)
            WikiIndex.remove(path: relative)
            WikiChangeBus.emit(path: relative, op: .deleted)
            return .ok(body: "")
        } catch { return .serverError("\(error)") }
    default:
        return .methodNotAllowed
    }
}

func safeWikiRelative(_ path: String) -> String? {
    // Strip leading /wiki/
    let trimmed = path.hasPrefix("/wiki/") ? String(path.dropFirst("/wiki/".count)) : nil
    guard let rel = trimmed, !rel.contains(".."), !rel.hasPrefix("/") else { return nil }
    return rel
}
```

`WikiChangeBus` and `WikiIndex.reindex/remove` — stubs for Task 4 / existing indexer. Add stubs that compile now if needed.

- [ ] **Step 4: Run tests**

```bash
bash build.sh && ./aos serve &
sleep 1 && ./tests/wiki-write-api.sh
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add <content server source> tests/wiki-write-api.sh
git commit -m "feat(wiki): PUT/DELETE endpoints on content server"
```

---

### Task 4: wiki_page_changed channel + FSEvents watcher

**Files:**
- Create: `src/daemon/wiki-watch.swift`
- Modify: `src/daemon/unified.swift` (wire into init, add to subscribe handler)
- Test: `tests/wiki-change-events.sh`

- [ ] **Step 1: Write channel test**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Subscribe via existing aos stream tool (or a small test harness)
# Listen for wiki_page_changed; write a file; expect an event
PIPE=$(mktemp -u)
mkfifo "$PIPE"
./aos stream wiki_page_changed > "$PIPE" &
STREAM_PID=$!
trap "kill $STREAM_PID 2>/dev/null; rm -f $PIPE" EXIT

sleep 0.3  # let subscription register
echo "---
type: test
---
x" > "$HOME/.config/aos/repo/wiki/test/fs-edit.md"

# Read one event, must contain the path
read -t 2 LINE < "$PIPE"
echo "$LINE" | grep -q '"path":"test/fs-edit.md"' || { echo "FAIL: $LINE"; exit 1; }
echo "$LINE" | grep -q '"op":"created"' || { echo "FAIL: expected created op"; exit 1; }

rm "$HOME/.config/aos/repo/wiki/test/fs-edit.md"
echo "PASS"
```

- [ ] **Step 2: Run, confirm fail**

Expected: timeout or nothing on the pipe — channel doesn't exist.

- [ ] **Step 3: Implement WikiChangeBus**

```swift
// src/daemon/wiki-watch.swift
import Foundation

enum WikiChangeOp: String { case created, updated, deleted }

final class WikiChangeBus {
    static let shared = WikiChangeBus()
    private init() {}

    weak var daemon: UnifiedDaemon?

    func emit(path: String, op: WikiChangeOp) {
        guard let daemon = daemon else { return }
        // Best-effort read type from frontmatter of existing file
        var type: String? = nil
        if op != .deleted {
            let full = aosStateDir().appendingPathComponent("wiki").appendingPathComponent(path)
            type = WikiFrontmatter.readType(at: full)
        }
        var payload: [String: Any] = ["path": path, "op": op.rawValue]
        if let t = type { payload["type"] = t }
        daemon.broadcastEvent(service: "wiki", event: "wiki_page_changed", data: payload)
    }
}

final class WikiWatcher {
    private var stream: FSEventStreamRef?
    private let wikiRoot: URL
    private let debounceMs: Int = 100
    private var pendingPaths: [String: (op: WikiChangeOp, fireAt: DispatchTime)] = [:]
    private let queue = DispatchQueue(label: "wiki.watch")

    init(wikiRoot: URL) { self.wikiRoot = wikiRoot }

    func start() {
        let callback: FSEventStreamCallback = { _, info, numEvents, paths, flags, _ in
            let watcher = Unmanaged<WikiWatcher>.fromOpaque(info!).takeUnretainedValue()
            let pathsPtr = unsafeBitCast(paths, to: UnsafePointer<UnsafePointer<CChar>>.self)
            for i in 0..<numEvents {
                let p = String(cString: pathsPtr[i])
                let f = flags[i]
                watcher.handle(path: p, flags: f)
            }
        }
        var ctx = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil, release: nil, copyDescription: nil
        )
        let paths = [wikiRoot.path] as CFArray
        stream = FSEventStreamCreate(
            kCFAllocatorDefault, callback, &ctx, paths,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.1, // latency
            FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents
                | kFSEventStreamCreateFlagNoDefer)
        )
        if let s = stream {
            FSEventStreamSetDispatchQueue(s, queue)
            FSEventStreamStart(s)
        }
    }

    private func handle(path: String, flags: FSEventStreamEventFlags) {
        guard path.hasPrefix(wikiRoot.path) else { return }
        let rel = String(path.dropFirst(wikiRoot.path.count + 1))
        guard rel.hasSuffix(".md") else { return }

        let isDelete = (flags & UInt32(kFSEventStreamEventFlagItemRemoved)) != 0
            && !FileManager.default.fileExists(atPath: path)
        let isCreate = (flags & UInt32(kFSEventStreamEventFlagItemCreated)) != 0
            && FileManager.default.fileExists(atPath: path)
        let op: WikiChangeOp = isDelete ? .deleted : (isCreate ? .created : .updated)

        let fireAt = DispatchTime.now() + .milliseconds(debounceMs)
        pendingPaths[rel] = (op, fireAt)
        queue.asyncAfter(deadline: fireAt) { [weak self] in
            guard let self = self, let pending = self.pendingPaths[rel] else { return }
            if pending.fireAt <= DispatchTime.now() {
                self.pendingPaths.removeValue(forKey: rel)
                WikiChangeBus.shared.emit(path: rel, op: pending.op)
            }
        }
    }
}
```

- [ ] **Step 4: Wire into daemon init**

In `unified.swift`, after content server starts:

```swift
WikiChangeBus.shared.daemon = self
let watcher = WikiWatcher(wikiRoot: wikiRoot)
watcher.start()
self.wikiWatcher = watcher  // retain
```

Make sure the `broadcastEvent` path in WikiChangeBus matches the subscriber event-name filter — subscribers asking for `wiki_page_changed` must be routed. Follow the same pattern as `display_geometry` (`unified.swift:280+` where subscribe events are accepted).

- [ ] **Step 5: Run tests**

```bash
bash build.sh && pkill -f 'aos serve' ; sleep 1 ; ./aos serve &
sleep 1 && ./tests/wiki-change-events.sh
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/wiki-watch.swift src/daemon/unified.swift tests/wiki-change-events.sh
git commit -m "feat(wiki): FSEvents watcher + wiki_page_changed channel with debounce"
```

---

### Task 5: PUT/DELETE emit change events (integration)

**Files:**
- Modify: content server write handler (Task 3) — replace stubbed `WikiChangeBus.emit` calls with real ones now that Task 4 exists.
- Test: `tests/wiki-write-emits-event.sh`

- [ ] **Step 1: Write test**

```bash
#!/usr/bin/env bash
set -euo pipefail

PIPE=$(mktemp -u); mkfifo "$PIPE"
./aos stream wiki_page_changed > "$PIPE" &
SPID=$!; trap "kill $SPID; rm -f $PIPE" EXIT
sleep 0.3

curl -sf -X PUT "http://127.0.0.1:7777/wiki/test/api-emit.md" \
  -H 'Content-Type: text/markdown' --data-binary '---
type: test
---
x' >/dev/null

read -t 2 LINE < "$PIPE"
echo "$LINE" | grep -q 'test/api-emit.md' || { echo "FAIL: $LINE"; exit 1; }

curl -sf -X DELETE "http://127.0.0.1:7777/wiki/test/api-emit.md" >/dev/null
read -t 2 LINE < "$PIPE"
echo "$LINE" | grep -q '"op":"deleted"' || { echo "FAIL: $LINE"; exit 1; }

echo "PASS"
```

- [ ] **Step 2: Run**

Should already PASS if Task 3's handler calls `WikiChangeBus.shared.emit`. If it doesn't, wire it now.

- [ ] **Step 3: De-dup concern** — API write triggers FSEvents too. Confirm only one event fires per write (the API's explicit emit should suppress the FSEvents-sourced one, or both are acceptable if downstream is idempotent).

Policy: both may fire. Spec's failure-modes table accepts this ("subscribers must be idempotent"). Document in a code comment in `wiki-watch.swift`:

```swift
// Note: API writes both call WikiChangeBus.emit directly and trigger FSEvents.
// Two events may fire per write. Subscribers are required to be idempotent per spec §Failure modes.
```

- [ ] **Step 4: Commit**

```bash
git add <modified files>
git commit -m "test(wiki): integration — write API emits change events"
```

---

### Task 6: seedIfAbsent helper

**Files:**
- Create: `src/daemon/wiki-seed.swift`
- Test: `tests/wiki-seed.sh`

- [ ] **Step 1: Write test**

```bash
#!/usr/bin/env bash
set -euo pipefail

WIKI="$HOME/.config/aos/repo/wiki"
TESTDIR="$WIKI/seed-test"
rm -rf "$TESTDIR"

./aos wiki seed --namespace seed-test \
  --file "agents/default.md:$(pwd)/tests/fixtures/default-agent.md"

test -f "$TESTDIR/agents/default.md" || { echo "FAIL: seed not written"; exit 1; }
ORIG_MTIME=$(stat -f %m "$TESTDIR/agents/default.md")

# Idempotent — second call no-op
sleep 1
./aos wiki seed --namespace seed-test \
  --file "agents/default.md:$(pwd)/tests/fixtures/default-agent.md"
NEW_MTIME=$(stat -f %m "$TESTDIR/agents/default.md")
test "$ORIG_MTIME" = "$NEW_MTIME" || { echo "FAIL: seed overwrote existing"; exit 1; }

rm -rf "$TESTDIR"
echo "PASS"
```

Make `tests/fixtures/default-agent.md` a simple markdown file.

- [ ] **Step 2: Implement helper + CLI**

```swift
// src/daemon/wiki-seed.swift
import Foundation

enum WikiSeed {
    /// For each (relativePath, contentURL), write contentURL's bytes to
    /// wikiRoot/<namespace>/<relativePath> iff the target file doesn't exist.
    /// Never overwrites. Returns count of files actually written.
    @discardableResult
    static func seedIfAbsent(wikiRoot: URL, namespace: String, files: [(String, URL)]) throws -> Int {
        let fm = FileManager.default
        var written = 0
        for (rel, source) in files {
            let dst = wikiRoot.appendingPathComponent(namespace).appendingPathComponent(rel)
            if fm.fileExists(atPath: dst.path) { continue }
            try fm.createDirectory(at: dst.deletingLastPathComponent(),
                                   withIntermediateDirectories: true)
            try fm.copyItem(at: source, to: dst)
            written += 1
        }
        return written
    }
}
```

Wire `aos wiki seed --namespace <ns> --file <rel:sourcePath>` subcommand. Multiple `--file` flags allowed. This is primarily for test and tooling; the helper is also callable in-process from applications that live in the same binary. For out-of-process apps, they'll write files directly or shell out to this subcommand — Sigil chooses its path in its own plan.

- [ ] **Step 3: Run**

```bash
bash build.sh && ./tests/wiki-seed.sh
```

- [ ] **Step 4: Commit**

```bash
git add src/daemon/wiki-seed.swift src/main.swift tests/wiki-seed.sh tests/fixtures/default-agent.md
git commit -m "feat(wiki): seedIfAbsent helper + CLI subcommand"
```

---

### Task 7: Full acceptance sweep

**Files:** None new — runs all previous test fixtures.

- [ ] **Step 1: Write aggregate runner**

```bash
# tests/wiki-acceptance.sh
set -e
./tests/wiki-migrate.sh
./tests/wiki-write-api.sh
./tests/wiki-change-events.sh
./tests/wiki-write-emits-event.sh
./tests/wiki-seed.sh
echo "ALL WIKI ACCEPTANCE TESTS PASSED"
```

- [ ] **Step 2: Run**

```bash
./tests/wiki-acceptance.sh
```

- [ ] **Step 3: Manual spec check**

Walk the spec's acceptance criteria (1-6). Each should map to a passing test above. If one isn't covered, add it.

- [ ] **Step 4: Commit**

```bash
git add tests/wiki-acceptance.sh
git commit -m "test(wiki): aggregate acceptance runner"
```

---

## Completion

At this point, AOS plan is done. Sigil plan can start (its early tasks depend only on Tasks 4 and 6 here; Studio-save depends on Tasks 3 + 5). See `docs/superpowers/plans/2026-04-12-sigil-foundation-agents-and-global-canvas.md`.
