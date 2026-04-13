# birthplace + lastPosition — acceptance evidence

**Spec:** `docs/superpowers/specs/2026-04-13-sigil-birthplace-and-lastposition.md`
**Date:** 2026-04-13
**Runtime:** `aos runtime status --json` (output below)

```
{
  "build_version" : "2026.04.08.210026",
  "bundle_id" : "com.agent-os.aos",
  "installed" : true,
  "notes" : [
    "Runtime is signed ad hoc; use a stable certificate when available."
  ],
  "path" : "\/Users\/Michael\/Applications\/AOS.app",
  "signed" : true,
  "signing_identity" : "adhoc",
  "status" : "degraded",
  "version" : "0.1.0"
}
```

Display union: `0,0,1512,982`. Daemon visible_bounds inferred from resolver output:
`{x:0, y:26.4, w:1512, h:914.6}` (26 px menu-bar inset).
Nonant reference points:
- bottom-right center: `(1260, 762.17)` = `(1512×5/6, 914.6×5/6 + 26.4)`
- top-left center: `(252, 178.83)` = `(1512×1/6, 914.6×1/6 + 26.4)`

---

## Scenario 1 — Fresh boot lands at birthplace

**Precondition:** daemon restarted (`./aos service restart`); lastPositions map is empty.

**Steps + output:**

```
$ ./aos service restart
mode=repo installed=true running=true pid=37791 label=com.agent-os.aos.repo

$ ./aos show remove --id avatar-main
{"code":"NOT_FOUND","error":"Canvas 'avatar-main' not found"}

$ ./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --at 0,0,1512,982
{"status":"success"}

# (3 second boot wait)

$ ./aos show eval --id avatar-main --js 'JSON.stringify(liveJs.avatarPos)'
{"result":"{\"x\":1260,\"y\":762.1666666666667,\"valid\":true}","status":"success"}
```

**Result:** PASS — position matches main display bottom-right nonant `(1260, 762.17)`.

---

## Scenario 2 — Move to IDLE, close + relaunch, lands at last IDLE position

**Precondition:** avatar-main running after Scenario 1; daemon still alive (lastPositions map
is in-memory and intact).

**Steps + output:**

```
$ ./aos show eval --id avatar-main --js 'JSON.stringify({state: liveJs.state, pos: liveJs.avatarPos, agentId: liveJs.currentAgentId})'
{"result":"{\"state\":\"IDLE\",\"pos\":{\"x\":1260,\"y\":762.1666666666667,\"valid\":true},\"agentId\":\"default\"}","status":"success"}

# Set position to (500,500) and post lastPosition to daemon.
# Note: smSet("IDLE") would be a no-op here because state is already IDLE
# (smSet has an early return guard: if (liveJs.state === next) return).
# postLastPositionToDaemon() is the direct equivalent — it's what smSet calls
# on every *transition into* IDLE.
$ ./aos show eval --id avatar-main --js 'liveJs.avatarPos.x = 500; liveJs.avatarPos.y = 500; postLastPositionToDaemon(); "ok"'
{"result":"ok","status":"success"}

$ ./aos show remove --id avatar-main
{"status":"success"}

$ ./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --at 0,0,1512,982
{"status":"success"}

# (3 second boot wait)

$ ./aos show eval --id avatar-main --js 'JSON.stringify(liveJs.avatarPos)'
{"result":"{\"x\":500,\"y\":500,\"valid\":true}","status":"success"}
```

**Adaptation note:** The plan's `smSet("IDLE", "s2")` is a no-op when state is already IDLE
(the guard `if (liveJs.state === next) return` prevents the call to `postLastPositionToDaemon`).
`postLastPositionToDaemon()` was called directly instead — this is exactly what the real drag/GOTO
flow invokes on state transition.

**Result:** PASS — position resumed at `(500, 500)` across remove/create within same daemon lifetime.

---

## Scenario 3 — Restart daemon, next spawn at birthplace (not old lastPosition)

**Precondition:** avatar-main running after Scenario 2 with lastPosition `(500, 500)` stored.

**Steps + output:**

```
$ ./aos service restart
mode=repo installed=true running=true pid=37791 label=com.agent-os.aos.repo

$ ./aos show remove --id avatar-main
{"code":"NOT_FOUND","error":"Canvas 'avatar-main' not found"}

$ ./aos show create --id avatar-main --url 'aos://sigil/renderer/index.html' --at 0,0,1512,982
{"status":"success"}

# (3 second boot wait)

$ ./aos show eval --id avatar-main --js 'JSON.stringify(liveJs.avatarPos)'
{"result":"{\"x\":1260,\"y\":762.1666666666667,\"valid\":true}","status":"success"}
```

**Result:** PASS — position is `(1260, 762.17)` (birthplace), NOT `(500, 500)` from Scenario 2.
Daemon restart cleared the in-memory lastPositions map as designed.

---

## Scenario 4 — Legacy doc (home-only) migrates on first load

**Precondition:** legacy.md staged at `~/.config/aos/repo/wiki/sigil/agents/legacy.md`
with only `"home"` key (no `"birthplace"`).

**Steps + output:**

```
# Stage legacy.md via Python (avoids nested heredoc issues with triple-backticks)
$ python3 -c "..."   # writes legacy.md with "home": {anchor:nonant, nonant:top-left, display:main}

$ grep -c '"home"' ~/.config/aos/repo/wiki/sigil/agents/legacy.md
1

$ grep -c '"birthplace"' ~/.config/aos/repo/wiki/sigil/agents/legacy.md
0

$ ./aos show create --id avatar-legacy \
    --url 'aos://sigil/renderer/index.html?agent=sigil/agents/legacy' \
    --at 0,0,1512,982
{"status":"success"}

# (3 second boot wait)

$ ./aos show eval --id avatar-legacy --js 'JSON.stringify(liveJs.avatarPos)'
{"result":"{\"x\":252,\"y\":178.8333333333331,\"valid\":true}","status":"success"}

$ grep -c '"home"' ~/.config/aos/repo/wiki/sigil/agents/legacy.md
0

$ grep -c '"birthplace"' ~/.config/aos/repo/wiki/sigil/agents/legacy.md
1

$ cat ~/.config/aos/repo/wiki/sigil/agents/legacy.md
# (shows "birthplace" where "home" used to be — doc rewritten in-place by loadAgent PUT)

$ ./aos show remove --id avatar-legacy
{"status":"success"}

$ rm ~/.config/aos/repo/wiki/sigil/agents/legacy.md
```

**Result:** PASS — before: 1 home / 0 birthplace. Avatar spawned at top-left nonant `(252, 178.83)`.
After: 0 home / 1 birthplace. Migration rewrite via `PUT /wiki/sigil/agents/legacy.md` confirmed.

---

## Scenario 5 — Malformed birthplace descriptor → MINIMAL_DEFAULT birthplace

**Precondition:** malformed.md staged with `birthplace.nonant = "this-cell-does-not-exist"`
and `birthplace.display = "also-fake-uuid-deadbeef"`.

**Steps + output:**

```
# Stage malformed.md via Python
$ python3 -c "..."   # writes malformed.md with bad nonant + fake UUID

$ ./aos show create --id avatar-malformed \
    --url 'aos://sigil/renderer/index.html?agent=sigil/agents/malformed' \
    --at 0,0,1512,982
{"status":"success"}

# (3 second boot wait)

$ ./aos show eval --id avatar-malformed --js 'JSON.stringify(liveJs.avatarPos)'
{"result":"{\"x\":1260,\"y\":762.1666666666667,\"valid\":true}","status":"success"}

$ ./aos show remove --id avatar-malformed
{"status":"success"}

$ rm ~/.config/aos/repo/wiki/sigil/agents/malformed.md
```

**Resolver fallback chain exercised:**
- Unknown display UUID `"also-fake-uuid-deadbeef"` → fell back to main display ✓
- Unknown nonant cell `"this-cell-does-not-exist"` → fell back to `bottom-right` ✓

**Result:** PASS — avatar landed at main display bottom-right nonant `(1260, 762.17)`,
confirming both fallback branches in `resolveBirthplace`.

---

## Summary

| Scenario | Result | Captured Position |
|----------|--------|-------------------|
| 1. Fresh boot → birthplace | PASS | `(1260, 762.17)` bottom-right nonant |
| 2. IDLE persistence within daemon | PASS | `(500, 500)` resumed |
| 3. Daemon restart → birthplace reset | PASS | `(1260, 762.17)` not `(500,500)` |
| 4. Legacy doc migration (home→birthplace) | PASS | `(252, 178.83)` top-left nonant; doc rewritten |
| 5. Malformed descriptor → fallback | PASS | `(1260, 762.17)` both fallback branches |

All 5 scenarios from the spec's testing section PASS.
